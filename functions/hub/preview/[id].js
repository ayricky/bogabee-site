// A draft (or any post) as it will look on the site, for Danny only (the hub's sign-in covers /hub/).
import { listPosts } from '../../../server/store.js';
import { postPage, notFoundPage } from '../../../src/pages.mjs';
import { html } from '../../../server/http.js';

export async function onRequestGet({ params, env }) {
    if (!env.DB) return html(notFoundPage(), 404);
    const posts = await listPosts(env.DB);
    const p = posts.find(x => x.id === params.id);
    return p ? html(postPage(p, posts, { preview: true })) : html(notFoundPage(), 404);
}
