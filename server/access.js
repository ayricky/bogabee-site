import { createRemoteJWKSet, jwtVerify } from 'jose';

const keysets = new Map();

export function accessConfig(env) {
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN || '') || !env.ACCESS_AUD || !env.DASHBOARD_EMAILS) return null;
  return { issuer: `https://${env.ACCESS_TEAM_DOMAIN}`, audience: env.ACCESS_AUD, emails: env.DASHBOARD_EMAILS.split(',').map(email => email.trim().toLowerCase()).filter(Boolean) };
}

export async function verifyIdentity(token, config, key) {
  const { payload } = await jwtVerify(token, key, { issuer: config.issuer, audience: config.audience, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub', 'email'] });
  if (typeof payload.email !== 'string' || !config.emails.includes(payload.email.toLowerCase())) throw new Error('Email not allowed');
  return { email: payload.email.toLowerCase() };
}

export async function readIdentity(request, config) {
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return null;
  if (!keysets.has(config.issuer)) keysets.set(config.issuer, createRemoteJWKSet(new URL(`${config.issuer}/cdn-cgi/access/certs`), { timeoutDuration: 5000 }));
  try { return await verifyIdentity(token, config, keysets.get(config.issuer)); }
  catch { return null; }
}
