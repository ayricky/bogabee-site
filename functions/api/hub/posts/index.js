import { json, fail } from '../../../../server/http.js';
import { savePost } from '../../../../server/store.js';
export async function onRequestPut({ request, env, data }) {
    const input = await request.json().catch(() => null);
    if (!input || typeof input !== 'object') return fail('That save was empty.');
    return json({ post: await savePost(env.DB, input, data.email) });
}
