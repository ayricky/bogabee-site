// Who is signed in to the owner hub. Cloudflare Access puts a signed JWT on every request
// it lets through; this checks its signature, issuer, audience, expiry and email. A plain
// email header is not enough. (Same checks as PR #4's internal dashboard.)
import { createRemoteJWKSet, jwtVerify } from 'jose';

const keysets = new Map();

export function accessConfig(env) {
    if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN || '') || !env.ACCESS_AUD || !env.HUB_EMAILS) return null;
    const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
    return {
        issuer, audience: env.ACCESS_AUD,
        // Only local tests point this elsewhere; the token must still be signed for the issuer and audience.
        certs: env.ACCESS_CERTS_URL || `${issuer}/cdn-cgi/access/certs`,
        emails: env.HUB_EMAILS.split(',').map(e => e.trim().toLowerCase()).filter(Boolean),
    };
}

export async function verifyIdentity(token, config, key) {
    const { payload } = await jwtVerify(token, key, { issuer: config.issuer, audience: config.audience, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub', 'email'] });
    if (typeof payload.email !== 'string' || !config.emails.includes(payload.email.toLowerCase())) throw new Error('Email not allowed');
    return { email: payload.email.toLowerCase() };
}

export async function readIdentity(request, config) {
    const token = request.headers.get('cf-access-jwt-assertion');
    if (!token) return null;
    if (!keysets.has(config.certs)) keysets.set(config.certs, createRemoteJWKSet(new URL(config.certs), { timeoutDuration: 5000 }));
    try { return await verifyIdentity(token, config, keysets.get(config.certs)); }
    catch { return null; }
}
