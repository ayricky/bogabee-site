// The page shell every page shares: head, nav, footer and scripts.
import { esc } from './content.mjs';

export const ORIGIN = 'https://bogabeeapiaries.com';
export const INSTAGRAM = 'https://www.instagram.com/bogabee_apiaries/';
export const DM = 'https://ig.me/m/bogabee_apiaries';
const GTM = 'GTM-MT39Z35D';

const ICON = {
    instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r=".9" fill="currentColor" stroke="none"/></svg>',
};
export { ICON };

const NAV = [
    { href: '/apiary/', label: 'The Apiary', key: 'apiary' },
    { href: '/journal/', label: 'Journal', key: 'journal' },
    { href: '/#order', label: 'Jars', key: 'jars' },
];

/**
 * @param {object} page
 * @param {string} page.title        Full <title>.
 * @param {string} page.description  Meta and social description.
 * @param {string} page.path         Canonical path, e.g. "/journal/".
 * @param {string} page.body         The page's <main> and anything between nav and footer.
 * @param {string} [page.active]     Nav key to mark as the current page.
 * @param {boolean} [page.overHero]  Nav starts transparent over a dark hero.
 * @param {string} [page.head]       Extra tags for <head> (page styles, preloads, JSON-LD).
 * @param {string} [page.image]      Social image path.
 * @param {string} [page.type]       og:type.
 * @param {boolean} [page.noindex]
 */
export function layout(page) {
    const image = ORIGIN + (page.image || '/assets/og.jpg');
    const nav = NAV.map(n => `<a href="${n.href}"${n.key === page.active ? ' aria-current="page"' : ''}>${n.label}</a>`).join('\n                ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <script>/* Analytics only on the live site, so previews and local builds don't count as visits. */
    if (/^(www\\.)?bogabeeapiaries\\.com$/.test(location.hostname)) (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM}');</script>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(page.title)}</title>
    <meta name="description" content="${esc(page.description)}">
    ${page.noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${ORIGIN}${page.path}">`}
    <meta property="og:type" content="${page.type || 'website'}">
    <meta property="og:site_name" content="Bogabee Apiaries">
    <meta property="og:title" content="${esc(page.title)}">
    <meta property="og:description" content="${esc(page.description)}">
    <meta property="og:url" content="${ORIGIN}${page.path}">
    <meta property="og:image" content="${image}">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">
    <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
    <script>document.documentElement.classList.add('js');</script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..600;1,9..144,300..600&family=Jost:wght@400..600&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/assets/css/brand.css">
    <link rel="stylesheet" href="/assets/css/content.css">
    ${page.head || ''}
</head>
<body id="top">
    <header class="nav${page.overHero ? ' on-dark' : ' is-solid'}">
        <div class="wrap">
            <a class="brand" href="/" aria-label="Bogabee Apiaries, home"><img src="/assets/img/logo-96.webp" width="42" height="42" alt=""><span>Bogabee Apiaries</span></a>
            <nav class="links" aria-label="Site">
                ${nav}
                <a class="btn" href="${DM}" target="_blank" rel="noopener">Order</a>
            </nav>
        </div>
    </header>

${page.body}

    <footer class="footer">
        <div class="wrap">
            <a href="${INSTAGRAM}" target="_blank" rel="noopener"><img class="logo" src="/assets/img/logo-192.webp" width="104" height="104" alt="Bogabee Apiaries on Instagram" loading="lazy"></a>
            <h2 class="display">Support Local Bees.</h2>
            <div class="row">
                <a href="${INSTAGRAM}" target="_blank" rel="noopener">${ICON.instagram}@bogabee_apiaries</a>
                <span>Manalapan Township, NJ</span>
            </div>
            <small>© 2023–<span data-year>${new Date().getFullYear()}</span> Bogabee Apiaries</small>
        </div>
    </footer>

    <script src="/assets/js/site.js" onerror="document.documentElement.classList.remove('js')"></script>
    <script src="/assets/js/bee.js"></script>
</body>
</html>
`;
}
