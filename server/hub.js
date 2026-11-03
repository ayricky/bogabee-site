// Shared by the hub's Functions: sign-in, same-site checks and the D1 handle.
import { accessConfig, readIdentity } from './access.js';
import { json } from './http.js';
import { seedIfEmpty } from './store.js';

/** Middleware for /hub/* and /api/hub/*: only signed-in owners get through. */
export async function requireOwner(context, { api }) {
    const { request, env } = context;
    const config = accessConfig(env);
    const deny = (error, code, status) => api ? json({ error, code }, status)
        : new Response(error, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
    if (!config) return deny('The owner hub has not been connected to Cloudflare Access yet.', 'auth_unconfigured', 503);
    const identity = await readIdentity(request, config);
    if (!identity) return deny('Sign in with an owner email to open the hub.', 'unauthorized', 401);
    if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('origin') !== new URL(request.url).origin) return deny('Make changes from the hub.', 'cross_site', 403);
    if (api && !env.DB) return deny('The hub database is not connected yet.', 'db_unconfigured', 503);
    if (env.DB) await seedIfEmpty(env.DB, () => env.ASSETS.fetch(new URL('/_seed/content.json', request.url)).then(r => r.json()));
    context.data.email = identity.email;
    const res = await context.next();
    // Hub pages and answers are private: never cache them, never index them.
    const out = new Response(res.body, res);
    out.headers.set('cache-control', 'no-store');
    out.headers.set('x-robots-tag', 'noindex');
    return out;
}
