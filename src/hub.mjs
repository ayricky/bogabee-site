// The owner hub's pages. Each is a shell (public/hub/hub.js draws the navigation) around its
// screen. The hub sits behind Cloudflare Access (functions/hub/_middleware.js).
import { esc } from './content.mjs';

function hubLayout({ title, screen, body, css = [], js = [] }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex">
    <title>${esc(title)} | Bogabee Hub</title>
    <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">
    <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..600;1,9..144,300..600&family=Jost:wght@400..600&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/assets/css/brand.css">
    <link rel="stylesheet" href="/hub/hub.css">
${css.map(href => `    <link rel="stylesheet" href="${href}">`).join('\n')}
</head>
<body class="hub">
    <aside class="hub-side" data-screen="${screen}"></aside>

    <main class="hub-main">
${body}
    </main>

    <script src="/hub/hub.js"></script>
${js.map(src => `    <script src="${src}"></script>`).join('\n')}
</body>
</html>
`;
}

// Screens for features that come in later releases.
const SOON = [
    { screen: 'orders', title: 'Orders', line: 'Orders paid on the site, with porch pickup codes.' },
    { screen: 'events', title: 'Events', line: 'Event check-in, with the guest list for each market.' },
    { screen: 'favors', title: 'Party favors', line: 'Quote requests for wedding and shower favors.' },
    { screen: 'hubspot', title: 'HubSpot', line: 'What the site sends to HubSpot, and anything that failed.' },
];

const journal = `        <header class="hub-head">
            <div><h1>Journal</h1></div>
            <div class="hub-actions"><a class="btn btn-quiet" href="/journal/" target="_blank" rel="noopener">View the journal</a><button class="btn" type="button" id="new-post" disabled>New post</button></div>
        </header>

        <p class="load-err" id="load-err" role="alert" hidden></p>
        <div class="j-layout" id="layout" aria-busy="true">
            <section class="panel list" aria-labelledby="list-title">
                <div class="panel-head">
                    <h2 id="list-title" tabindex="-1">Posts</h2>
                    <div class="chips" role="group" aria-label="Show">
                        <button class="chip" type="button" data-filter="all" aria-pressed="true">All</button>
                        <button class="chip" type="button" data-filter="published" aria-pressed="false">Published</button>
                        <button class="chip" type="button" data-filter="draft" aria-pressed="false">Drafts</button>
                    </div>
                </div>
                <div class="search"><input type="search" id="search" placeholder="Find a post" aria-label="Find a post"></div>
                <ul class="posts" id="posts"></ul>
            </section>

            <section class="panel editor" aria-label="Post editor">
                <p class="empty-editor" id="empty-editor" hidden>No post open.</p>
                <div class="savebar" id="savebar">
                    <span class="state" id="state" aria-live="polite"></span>
                    <span class="tag gold" id="starter" hidden>Starter copy</span>
                    <button class="btn btn-quiet" type="button" id="preview">Preview</button>
                    <a class="btn btn-quiet" id="view" target="_blank" rel="noopener">View on site</a>
                    <button class="btn btn-quiet" type="button" id="save-draft">Save draft</button>
                    <button class="btn" type="button" id="publish">Publish</button>
                </div>
                <div class="panel-body" id="form">
                    <textarea class="title-in" id="title" rows="1" placeholder="Post title" maxlength="160" aria-label="Title"></textarea>
                    <div class="field">
                        <label for="slug">Address</label>
                        <div class="addr"><span>bogabeeapiaries.com/journal/</span><input id="slug" type="text" maxlength="60" autocomplete="off" spellcheck="false" aria-describedby="slug-note"><button type="button" class="addr-btn" id="slug-change" hidden>Change</button></div>
                        <small id="slug-note"></small>
                    </div>
                    <div class="two">
                        <div class="field"><span>Cover photo</span><div id="cover"></div></div>
                        <label class="field"><span>Summary</span><textarea id="excerpt" maxlength="300" rows="3"></textarea></label>
                    </div>
                    <label class="field"><span>Cover photo description</span><input type="text" id="cover-alt" maxlength="200"></label>
                    <div class="field"><span id="body-label">Post</span><div id="body"></div></div>
                    <div class="foot-acts"><button class="btn btn-quiet btn-small" type="button" id="unpublish">Unpublish</button><button class="btn btn-quiet btn-small" type="button" id="delete">Delete post</button></div>
                </div>
            </section>
        </div>`;

const apiary = `        <header class="hub-head">
            <div><h1>Apiary page</h1></div>
        </header>

        <p class="load-err" id="load-err" role="alert" hidden></p>
        <div class="p-layout" id="layout" aria-busy="true">
            <div class="form">
                <div class="savebar">
                    <span class="state" id="state" aria-live="polite"></span>
                    <span class="tag gold" id="starter" hidden>Starter copy</span>
                    <a class="btn btn-quiet" href="/apiary/" target="_blank" rel="noopener">View page</a>
                    <button class="btn" type="button" id="save" disabled>Publish changes</button>
                </div>

                <section class="panel" aria-labelledby="h-top">
                    <div class="panel-head"><h2 id="h-top">Top of the page</h2></div>
                    <div class="panel-body">
                        <div class="two">
                            <label class="field"><span>Small heading</span><input type="text" data-key="eyebrow" maxlength="60"></label>
                            <div class="field"><span>Main photo</span><div id="hero-image"></div></div>
                        </div>
                        <label class="field"><span>Headline</span><input type="text" data-key="title" maxlength="160"></label>
                        <label class="field"><span>Introduction</span><textarea data-key="intro" rows="3" maxlength="600"></textarea></label>
                    </div>
                </section>

                <section class="panel" aria-labelledby="h-sections">
                    <div class="panel-head"><h2 id="h-sections">Sections</h2></div>
                    <div class="panel-body">
                        <div id="sections" class="form"></div>
                        <button class="btn btn-quiet btn-small add" type="button" id="add-section">Add a section</button>
                    </div>
                </section>

                <section class="panel" aria-labelledby="h-seasons">
                    <div class="panel-head"><h2 id="h-seasons">Seasons</h2></div>
                    <div class="panel-body">
                        <label class="field"><span>Heading</span><input type="text" data-key="seasonsTitle" maxlength="120"></label>
                        <div id="seasons" class="form"></div>
                        <button class="btn btn-quiet btn-small add" type="button" id="add-season">Add a season</button>
                    </div>
                </section>

                <section class="panel" aria-labelledby="h-keeper">
                    <div class="panel-head"><h2 id="h-keeper">The beekeeper</h2></div>
                    <div class="panel-body">
                        <div class="two">
                            <label class="field"><span>Heading</span><input type="text" data-key="keeperTitle" maxlength="120"></label>
                            <div class="field"><span>Photo</span><div id="keeper-image"></div></div>
                        </div>
                        <label class="field"><span>Photo description</span><input type="text" data-key="keeperImageAlt" maxlength="200"></label>
                        <div class="field"><span>Text</span><div id="keeper"></div></div>
                    </div>
                </section>
            </div>

            <aside class="panel preview" aria-labelledby="h-preview">
                <div class="panel-head"><h2 id="h-preview">Preview</h2><a href="/apiary/" target="_blank" rel="noopener">Open the live page</a></div>
                <div class="frame" id="frame"></div>
            </aside>
        </div>`;

/** Every hub page, as [path under dist/, html]. */
export function hubPages() {
    return [
        ['hub/index.html', hubLayout({ title: 'Journal', screen: 'journal', body: journal, css: ['/hub/editor.css', '/hub/journal.css'], js: ['/hub/photos.js', '/hub/editor.js', '/hub/journal.js'] })],
        ['hub/apiary/index.html', hubLayout({ title: 'Apiary page', screen: 'apiary', body: apiary, css: ['/hub/editor.css', '/hub/apiary.css'], js: ['/hub/photos.js', '/hub/editor.js', '/hub/apiary.js'] })],
        ...SOON.map(s => [`hub/${s.screen}/index.html`, hubLayout({
            title: s.title, screen: s.screen,
            body: `        <header class="hub-head"><div><h1>${esc(s.title)}</h1></div></header>
        <div class="panel soon">
            <span class="tag gold">Coming soon</span>
            <p>${esc(s.line)}</p>
        </div>`,
        })]),
    ];
}
