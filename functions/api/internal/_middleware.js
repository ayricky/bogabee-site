import { accessConfig, readIdentity } from '../../../server/access.js';
import { json } from '../../../server/dashboard.js';

export async function onRequest(context) {
  const config = accessConfig(context.env);
  if (!config) return json({ error: 'Private dashboard access has not been connected yet.', code: 'auth_unconfigured' }, 503);
  const identity = await readIdentity(context.request, config);
  if (!identity) return json({ error: 'Sign in with an allowed email to open the dashboard.', code: 'unauthorized' }, 401);
  if (!['GET', 'HEAD'].includes(context.request.method) && context.request.headers.get('origin') !== new URL(context.request.url).origin) return json({ error: 'Please use the dashboard to make changes.' }, 403);
  context.data.identity = identity;
  return context.next();
}
