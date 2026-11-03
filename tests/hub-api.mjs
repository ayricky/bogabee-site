// End-to-end check of the hub API and the public pages it feeds, against `wrangler pages dev`
// with a local D1 and R2 and a stand-in for Cloudflare Access's signing keys.
//   node tests/hub-api.mjs
import assert from 'node:assert/strict';
import { startSite, OWNER } from './harness.mjs';

const site = await startSite();
const { B, token } = site;
const get = (path, opts = {}) => fetch(B + path, { redirect: 'manual', ...opts });
const as = async (email, aud) => ({ 'cf-access-jwt-assertion': await token(email, aud) });
const api = async (method, path, body, { headers = {}, origin = B } = {}) => fetch(B + path, {
    method, redirect: 'manual',
    headers: { ...(await as()), ...(origin ? { origin } : {}), ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
});
const text = r => r.text();
let n = 0;
const check = async (name, fn) => { await fn(); n++; console.log('ok', name); };

try {
    await check('public pages come from the build before the hub is used', async () => {
        const r = await get('/journal/'); assert.equal(r.status, 200);
        assert.match(await text(r), /No posts yet/);
    });
    await check('the hub turns away anyone not signed in as an owner', async () => {
        assert.equal((await get('/api/hub/content')).status, 401);
        assert.equal((await get('/api/hub/content', { headers: await as('someone@example.com') })).status, 401);
        assert.equal((await get('/api/hub/content', { headers: await as(OWNER, 'other-aud') })).status, 401);
        assert.equal((await get('/api/hub/content', { headers: { 'cf-access-jwt-assertion': 'garbage' } })).status, 401);
        assert.equal((await get('/hub/')).status, 401);
    });
    let seeded;
    await check('first use copies the Apiary page into the hub; the Journal starts empty', async () => {
        const r = await get('/api/hub/content', { headers: await as() }); assert.equal(r.status, 200);
        assert.equal(r.headers.get('cache-control'), 'no-store');
        seeded = await r.json();
        assert.equal(seeded.posts.length, 0);
        assert.equal(seeded.pages.apiary.title, 'Where the honey comes from.');
    });
    await check('changes from another site are refused', async () => {
        assert.equal((await api('PUT', '/api/hub/posts', { title: 'x' }, { origin: 'https://evil.example' })).status, 403);
        assert.equal((await api('PUT', '/api/hub/posts', { title: 'x' }, { origin: null })).status, 403);
    });
    let post;
    await check('a draft saves cleaned and stays off the site', async () => {
        const r = await api('PUT', '/api/hub/posts', { title: 'Spring <b>splits</b>', excerpt: 'New colonies.', body: '<p onclick="x()">Hi<script>alert(1)</script></p><img src="javascript:x">', cover: 'javascript:x' });
        assert.equal(r.status, 200);
        ({ post } = await r.json());
        assert.deepEqual([post.title, post.slug, post.status, post.date, post.body, post.cover], ['Spring splits', 'spring-splits', 'draft', null, '<p>Hi</p>', '']);
        assert.equal((await get('/journal/spring-splits/')).status, 404);
        assert.doesNotMatch(await text(await get('/journal/')), /Spring splits/);
        const pv = await get(`/hub/preview/${post.id}`, { headers: await as() });
        assert.equal(pv.status, 200);
        assert.match(await text(pv), /Draft preview, not published/);
        assert.equal((await get(`/hub/preview/${post.id}`)).status, 401);
    });
    await check('publishing puts it on the Journal, the homepage and its own page', async () => {
        const r = await api('PUT', '/api/hub/posts', { ...post, status: 'published' }); ({ post } = await r.json());
        assert.match(post.date, /^\d{4}-\d{2}-\d{2}$/);
        assert.equal((await get('/journal/spring-splits/')).status, 200);
        assert.match(await text(await get('/journal/')), /Spring splits/);
        assert.match(await text(await get('/')), /Spring splits/);
    });
    await check('a renamed post keeps its old address working', async () => {
        const r = await api('PUT', '/api/hub/posts', { ...post, slug: 'Splitting hives!' }); ({ post } = await r.json());
        assert.equal(post.slug, 'splitting-hives');
        const old = await get('/journal/spring-splits/');
        assert.equal(old.status, 301);
        assert.equal(new URL(old.headers.get('location')).pathname, '/journal/splitting-hives/');
    });
    await check('slugs stay unique', async () => {
        await api('PUT', '/api/hub/posts', { title: 'Honey notes', status: 'draft' });
        const r = await api('PUT', '/api/hub/posts', { title: 'Honey notes', status: 'draft' });
        assert.equal((await r.json()).post.slug, 'honey-notes-2');
    });
    await check('a post needs a title', async () => {
        const r = await api('PUT', '/api/hub/posts', { title: '  ' });
        assert.equal(r.status, 400); assert.match((await r.json()).error, /title/);
    });
    await check('deleting takes it off the site', async () => {
        assert.equal((await api('DELETE', `/api/hub/posts/${post.id}`)).status, 204);
        assert.equal((await get('/journal/splitting-hives/')).status, 404);
        assert.equal((await api('DELETE', `/api/hub/posts/${post.id}`)).status, 404);
    });
    await check('the Apiary page saves cleaned and shows on the site', async () => {
        const page = { ...seeded.pages.apiary, title: 'Our hives <i>today</i>.', keeper: '<p>Hi <a href="javascript:x">there</a></p>' };
        const r = await api('PUT', '/api/hub/pages/apiary', page); assert.equal(r.status, 200);
        const saved = (await r.json()).page;
        assert.equal(saved.title, 'Our hives today.'); assert.equal(saved.keeper, '<p>Hi there</p>');
        assert.match(await text(await get('/apiary/')), /Our hives today\./);
        assert.equal((await api('PUT', '/api/hub/pages/nope', page)).status, 400);
    });
    await check('photo uploads accept real images only', async () => {
        const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000100e221bc330000000049454e44ae426082', 'hex');
        const ok = new FormData(); ok.append('file', new Blob([png], { type: 'image/png' }), 'dot.png');
        const r = await api('POST', '/api/hub/media', ok); assert.equal(r.status, 200);
        const { url } = await r.json(); assert.match(url, /^\/media\/[\w.-]+\.png$/);
        const img = await get(url); assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
        const fake = new FormData(); fake.append('file', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'x.png');
        assert.equal((await api('POST', '/api/hub/media', fake)).status, 400);
        const svg = new FormData(); svg.append('file', new Blob(['<svg/>'], { type: 'image/svg+xml' }), 'x.svg');
        assert.equal((await api('POST', '/api/hub/media', svg)).status, 400);
        assert.equal((await get('/media/..%2F..%2Fetc')).status, 404);
    });
    console.log(`\n${n} checks passed`);
} catch (err) {
    console.log(site.log().split('\n').filter(l => /error|Error/.test(l)).slice(-20).join('\n'));
    throw err;
} finally {
    site.stop();
}
