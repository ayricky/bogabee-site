# Bogabee Apiaries

The website for Bogabee Apiaries: raw, small-batch honey from Manalapan Township, NJ.

## Structure

```
content/            The starting Apiary page and Journal posts (one JSON file per post)
src/                Page templates: layout.mjs (head, nav, footer), pages.mjs, home.mjs, content.mjs, hub.mjs
public/assets/      CSS, JS (site.js, bee.js) and photos, copied as they are
public/hub/         The owner hub's scripts and styles
functions/          Cloudflare Pages Functions: the hub API, uploads, and public pages from the hub's content
server/             Code the Functions share: sign-in, the D1 store, the HTML sanitizer
tools/build.mjs     Renders everything into dist/
tests/              npm test (sanitizer, hub API) and npm run test:browser (hub screens)
```

## Build and preview

```
npm run build       # writes dist/
npm run preview     # builds, then serves dist/ on 127.0.0.1:4518
```

Cloudflare Pages (project `bogabee-site`) runs `npm run build` and publishes `dist/` for every push. A merge to `main` goes live at bogabeeapiaries.com; other branches get a preview at `<branch>.bogabee-site.pages.dev`. Google Tag Manager loads only on bogabeeapiaries.com, so previews don't count as visits.

## Journal posts

Add `content/journal/<slug>.json` with `slug` (same as the file name), `status` (`published` or `draft`), `date` (`2026-10-29`), `title`, `excerpt`, `cover` and `body` (HTML). Each published post gets `/journal/<slug>/`, a card on the Journal page, and a spot on the homepage if it's one of the three newest.

Photos are named without an extension (`sunflower`), from the list in `src/content.mjs`. Each one has `NAME.webp` and a smaller copy in `public/assets/img`.

## Owner hub

Danny edits the Journal and the Apiary page at `/hub/`. Orders, events, party favors and HubSpot show "Coming soon" until those features ship.

- **Content** lives in D1 (binding `DB`). The tables are created on first use, and the first hub visit copies the posts and page built from `content/` into D1. From then on D1 is the source: `/`, `/apiary/` and `/journal/*` render from it, and fall back to the built pages if D1 is missing or unreachable.
- **Photos** upload to R2 (binding `MEDIA`) and are served from `/media/<key>`. Only real JPEG, PNG, WebP and GIF files under 10 MB are accepted.
- **Sign-in** is Cloudflare Access. Every hub request checks the Access JWT's signature, issuer, audience, expiry and email (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `HUB_EMAILS`). Requests that change things must also come from the site itself. Without these settings the hub answers 503.
- **Saved rich text** goes through `server/sanitize.js`, an allowlist, before it's stored, because public pages render it as is.

To launch the hub, the Pages project needs a D1 database bound as `DB`, an R2 bucket bound as `MEDIA`, an Access application covering `/hub*` and `/api/hub/*` with email one-time codes for the owners, and those three variables set.

## The bee

`public/assets/js/bee.js` draws the bee that follows the pointer. It keeps its distance from fast moves and dozes when the visitor stops. The footer has a "Hide the bee" switch, and with reduced motion turned on the bee sits still.

## Links

- Instagram: [@bogabee_apiaries](https://www.instagram.com/bogabee_apiaries/)
