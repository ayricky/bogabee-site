# Bogabee Apiaries

The website for Bogabee Apiaries: raw, small-batch honey from Manalapan Township, NJ.

## Structure

```
content/            Text that changes: the Apiary page and Journal posts (one JSON file per post)
src/                Page templates: layout.mjs (head, nav, footer), home.mjs, content.mjs
public/assets/      CSS, JS (site.js, bee.js) and photos, copied as they are
tools/build.mjs     Renders everything into dist/
```

## Build and preview

```
npm run build       # writes dist/
npm run preview     # builds, then serves dist/ on 127.0.0.1:4518
```

Staging is the Cloudflare Pages project `bogabee-site`: it runs `npm run build` and publishes `dist/` for every push. A merge to `main` shows at https://bogabee-site.pages.dev, and other branches get a preview at `<branch>.bogabee-site.pages.dev`. Google Tag Manager loads only on bogabeeapiaries.com, so staging and previews don't count as visits.

## Releases

Production, bogabeeapiaries.com and www, is the Direct Upload Pages project `bogabee-apiaries`. Merging never deploys it. A release does, through the AYR client kit in `ayr/`: it drafts the client note, the owner reads its review page and presses Release, and the kit builds and deploys that draft, checks the live site, tags it and emails Danny. `CLAUDE.md` has the rules, and `node ayr/bin/ayr.ts release doctor` checks the setup.

## Journal posts

Add `content/journal/<slug>.json` with `slug` (same as the file name), `status` (`published` or `draft`), `date` (`2026-10-29`), `title`, `excerpt`, `cover` and `body` (HTML). Each published post gets `/journal/<slug>/`, a card on the Journal page, and a spot on the homepage if it's one of the three newest.

Photos are named without an extension (`sunflower`), from the list in `src/content.mjs`. Each one has `NAME.webp` and a smaller copy in `public/assets/img`.

## The bee

`public/assets/js/bee.js` draws the bee that follows the pointer. It keeps its distance from fast moves and dozes when the visitor stops. The footer has a "Hide the bee" switch, and with reduced motion turned on the bee sits still.

## Links

- Instagram: [@bogabee_apiaries](https://www.instagram.com/bogabee_apiaries/)
