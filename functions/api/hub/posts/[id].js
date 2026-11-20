import { json, fail } from '../../../../server/http.js';
import { deletePost } from '../../../../server/store.js';
export async function onRequestDelete({ params, env }) {
    return (await deletePost(env.DB, params.id)) ? new Response(null, { status: 204 }) : fail('That post was already deleted.', 404);
}
