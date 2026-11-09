// Whole pages, as HTML strings. The build renders them from content/ into dist/, and the
// site's Functions render the same pages from the owner hub's saved content.
import { layout, ORIGIN } from './layout.mjs';
import { apiaryMain, journalMain, postMain, postPath } from './content.mjs';
import { homeMain, homeHead } from './home.mjs';

export const homePage = posts => layout({
    title: 'Bogabee Apiaries | Manalapan Township, NJ Honey',
    description: 'Raw, unfiltered wildflower honey from our hives in Manalapan Township, New Jersey. Small-batch, hand-poured, and ordered by DM on Instagram.',
    path: '/', overHero: true, head: homeHead, body: homeMain(posts),
});

export const apiaryPage = a => layout({
    title: `${(a.title || 'The Apiary').replace(/\.$/, '')} | Bogabee Apiaries`,
    description: a.intro || 'Where the Bogabee honey comes from: our hives in Manalapan Township, NJ.',
    path: '/apiary/', active: 'apiary',
    image: a.heroImage && !a.heroImage.includes('/') ? `/assets/img/${a.heroImage}.webp` : a.heroImage || undefined,
    body: `    <main>${apiaryMain(a)}\n    </main>`,
});

export const journalPage = posts => layout({
    title: 'Journal | Bogabee Apiaries',
    description: 'Notes from the Bogabee Apiaries hives in Manalapan Township, NJ: the bees, the harvest and raw wildflower honey.',
    path: '/journal/', active: 'journal', body: `    <main>${journalMain(posts)}\n    </main>`,
});

/** A post's page. `preview` marks a draft shown to Danny in the hub: not indexed, with a bar saying so. */
export function postPage(p, posts, { preview = false } = {}) {
    const cover = p.cover ? (p.cover.includes('/') ? p.cover : `/assets/img/${p.cover}.webp`) : undefined;
    return layout({
        title: `${p.title || 'Untitled'} | Bogabee Apiaries`,
        description: p.excerpt || 'Notes from the Bogabee Apiaries hives in Manalapan Township, NJ.',
        path: postPath(p), active: 'journal', type: 'article', image: cover, noindex: preview,
        head: preview ? '' : `<script type="application/ld+json">${JSON.stringify({
            '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title, description: p.excerpt || undefined,
            datePublished: p.date || undefined, image: cover ? ORIGIN + cover : undefined,
            author: { '@type': 'Organization', name: 'Bogabee Apiaries' }, publisher: { '@type': 'Organization', name: 'Bogabee Apiaries' },
        }).replace(/</g, '\\u003c')}</script>`,
        body: `    <main>${preview && p.status !== 'published' ? '<div class="draft-bar" role="status">Draft preview, not published</div>' : ''}${postMain(p, posts)}\n    </main>`,
    });
}

export const notFoundPage = () => layout({
    title: 'Page not found | Bogabee Apiaries', description: 'This page is not here.', path: '/404', noindex: true,
    body: `    <main>
        <div class="missing">
            <span class="eyebrow">Not found</span>
            <h1 class="display">That page isn't here.</h1>
            <p>It may have moved. The honey is still on the homepage.</p>
            <a class="btn" href="/">Back to the homepage</a>
        </div>
    </main>`,
});
