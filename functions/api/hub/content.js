import { json } from '../../../server/http.js';
import { listPosts, getPage } from '../../../server/store.js';
export const onRequestGet = async ({ env }) => json({ posts: await listPosts(env.DB), pages: { apiary: await getPage(env.DB, 'apiary') } });
