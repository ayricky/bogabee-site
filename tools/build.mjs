// Builds the site into dist/: copies public/ and renders the pages from src/ and content/.
// Cloudflare Pages runs this on every push (build command `npm run build`, output `dist`).
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layout, ORIGIN } from '../src/layout.mjs';
import { apiaryMain, journalMain, postMain, published, postPath } from '../src/content.mjs';
import { homeMain, homeHead } from '../src/home.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
const json = p => JSON.parse(readFileSync(join(root, p), 'utf8'));

const apiary = json('content/apiary.json');
// The Journal starts empty; Danny adds posts in the owner hub (or as files here).
const journalDir = join(root, 'content/journal');
const posts = (existsSync(journalDir) ? readdirSync(journalDir) : []).filter(f => f.endsWith('.json')).map(f => {
    const p = json(`content/journal/${f}`);
    for (const k of ['slug', 'status', 'title']) if (!p[k]) throw new Error(`content/journal/${f}: missing "${k}"`);
    if (p.status === 'published' && !/^\d{4}-\d{2}-\d{2}$/.test(p.date || '')) throw new Error(`content/journal/${f}: published posts need a date like 2026-10-29`);
    if (`${p.slug}.json` !== f) throw new Error(`content/journal/${f}: file name must be the slug`);
    return p;
});
const live = published(posts);

rmSync(out, { recursive: true, force: true });
cpSync(join(root, 'public'), out, { recursive: true });
const page = (path, html) => {
    const file = join(out, path, path.endsWith('/') ? 'index.html' : '');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html);
};

page('/', layout({
    title: 'Bogabee Apiaries | Manalapan Township, NJ Honey',
    description: 'Raw, unfiltered wildflower honey from our hives in Manalapan Township, New Jersey. Small-batch, hand-poured, and ordered by DM on Instagram.',
    path: '/', overHero: true, head: homeHead, body: homeMain(posts),
}));

page('/apiary/', layout({
    title: `${apiary.title.replace(/\.$/, '')} | Bogabee Apiaries`,
    description: apiary.intro,
    path: '/apiary/', active: 'apiary',
    image: apiary.heroImage ? `/assets/img/${apiary.heroImage}.webp` : undefined,
    body: `    <main>${apiaryMain(apiary)}\n    </main>`,
}));

page('/journal/', layout({
    title: 'Journal | Bogabee Apiaries',
    description: 'Notes from the Bogabee Apiaries hives in Manalapan Township, NJ: the bees, the harvest and raw wildflower honey.',
    path: '/journal/', active: 'journal', body: `    <main>${journalMain(posts)}\n    </main>`,
}));

for (const p of live) {
    page(postPath(p), layout({
        title: `${p.title} | Bogabee Apiaries`,
        description: p.excerpt || 'Notes from the Bogabee Apiaries hives in Manalapan Township, NJ.',
        path: postPath(p), active: 'journal', type: 'article',
        image: p.cover ? `/assets/img/${p.cover}.webp` : undefined,
        head: `<script type="application/ld+json">${JSON.stringify({
            '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title, description: p.excerpt || undefined,
            datePublished: p.date, image: p.cover ? `${ORIGIN}/assets/img/${p.cover}.webp` : undefined,
            author: { '@type': 'Organization', name: 'Bogabee Apiaries' }, publisher: { '@type': 'Organization', name: 'Bogabee Apiaries' },
        }).replace(/</g, '\\u003c')}</script>`,
        body: `    <main>${postMain(p, posts)}\n    </main>`,
    }));
}

writeFileSync(join(out, '404.html'), layout({
    title: 'Page not found | Bogabee Apiaries', description: 'This page is not here.', path: '/404', noindex: true,
    body: `    <main>
        <div class="missing">
            <span class="eyebrow">Not found</span>
            <h1 class="display">That page isn't here.</h1>
            <p>It may have moved. The honey is still on the homepage.</p>
            <a class="btn" href="/">Back to the homepage</a>
        </div>
    </main>`,
}));

const urls = ['/', '/apiary/', '/journal/', ...live.map(postPath)];
writeFileSync(join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${ORIGIN}${u}</loc></url>`).join('\n')}
</urlset>
`);
writeFileSync(join(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);

console.log(`built dist/: ${urls.length} pages, ${posts.length - live.length} unpublished posts skipped`);
