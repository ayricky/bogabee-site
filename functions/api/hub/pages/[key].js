import { json, fail } from '../../../../server/http.js';
import { savePage } from '../../../../server/store.js';
export async function onRequestPut({ request, env, params, data }) {
    const input = await request.json().catch(() => null);
    if (!input || typeof input !== 'object') return fail('That save was empty.');
    return json({ page: await savePage(env.DB, params.key, input, data.email) });
}
