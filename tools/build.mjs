// Builds the site into dist/: copies public/ and renders the pages from src/ and content/.
// Cloudflare Pages runs this on every push (build command `npm run build`, output `dist`).
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORIGIN } from '../src/layout.mjs';
import { published, postPath, PHOTOS } from '../src/content.mjs';
import { homePage, apiaryPage, journalPage, postPage, notFoundPage } from '../src/pages.mjs';
import { hubPages } from '../src/hub.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
const json = p => JSON.parse(readFileSync(join(root, p), 'utf8'));

const apiary = json('content/apiary.json');
const posts = readdirSync(join(root, 'content/journal')).filter(f => f.endsWith('.json')).map(f => {
    const p = json(`content/journal/${f}`);
    for (const k of ['slug', 'status', 'title']) if (!p[k]) throw new Error(`content/journal/${f}: missing "${k}"`);
    if (p.status === 'published' && !/^\d{4}-\d{2}-\d{2}$/.test(p.date || '')) throw new Error(`content/journal/${f}: published posts need a date like 2026-10-29`);
    if (`${p.slug}.json` !== f) throw new Error(`content/journal/${f}: file name must be the slug`);
    return p;
});
const live = published(posts);

rmSync(out, { recursive: true, force: true });
cpSync(join(root, 'public'), out, { recursive: true });
// The owner hub's photo picker offers the same site photos the pages use.
for (const [path, html] of hubPages()) { mkdirSync(dirname(join(out, path)), { recursive: true }); writeFileSync(join(out, path), html); }
writeFileSync(join(out, 'hub/photos.js'), `window.HUB_PHOTOS = ${JSON.stringify(PHOTOS)};\n`);
const page = (path, html) => {
    const file = join(out, path, path.endsWith('/') ? 'index.html' : '');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html);
};

page('/', homePage(posts));
page('/apiary/', apiaryPage(apiary));
page('/journal/', journalPage(posts));
for (const p of live) page(postPath(p), postPage(p, posts));
writeFileSync(join(out, '404.html'), notFoundPage());

// What the owner hub starts from the first time it opens (see seedIfEmpty in server/store.js).
mkdirSync(join(out, '_seed'), { recursive: true });
writeFileSync(join(out, '_seed/content.json'), JSON.stringify({ apiary, posts: live }));

const urls = ['/', '/apiary/', '/journal/', ...live.map(postPath)];
writeFileSync(join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${ORIGIN}${u}</loc></url>`).join('\n')}
</urlset>
`);
writeFileSync(join(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);

console.log(`built dist/: ${urls.length} pages, ${posts.length - live.length} unpublished posts skipped`);
