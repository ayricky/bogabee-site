// Public pages rendered from the hub's content in D1. Until the hub has content, or if D1
// can't be reached, the pages built from content/ are served instead.
import { hasContent, listPosts, getPage, findPost } from './store.js';
import { homePage, apiaryPage, journalPage, postPage, notFoundPage } from '../src/pages.mjs';
import { html } from './http.js';

export function fromHub(render) {
    return async context => {
        const { env, request } = context;
        if (!env.DB || !['GET', 'HEAD'].includes(request.method)) return context.next();
        try {
            if (!(await hasContent(env.DB))) return context.next();
            return await render(env.DB, context);
        } catch (err) {
            console.error(err);
            return context.next();
        }
    };
}

export const home = fromHub(async db => html(homePage(await listPosts(db))));
export const apiary = fromHub(async (db, context) => {
    const page = await getPage(db, 'apiary');
    return page ? html(apiaryPage(page)) : context.next();
});
export const journal = fromHub(async db => html(journalPage(await listPosts(db))));
export const post = fromHub(async (db, { params, request }) => {
    const found = await findPost(db, String(params.slug));
    if (!found || found.post.status !== 'published') return html(notFoundPage(), 404);
    if (found.moved) return Response.redirect(new URL(`/journal/${found.post.slug}/`, request.url), 301);
    return html(postPage(found.post, await listPosts(db)));
});
