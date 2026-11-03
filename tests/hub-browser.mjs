// The owner hub in a real browser, against `wrangler pages dev` (see harness.mjs): writing,
// publishing, renaming and deleting a post, editing the Apiary page, the coming-soon screens,
// errors from the API, accessibility (axe) and layout, at desktop and phone sizes.
//   node tests/hub-browser.mjs            (SHOTS=<dir> also saves screenshots)
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { startSite } from './harness.mjs';

const site = await startSite();
const { B } = site;
const SHOTS = process.env.SHOTS;
// A 4x3 PNG to upload.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000040000000308020000003b9639910000001049444154789c6338b140038e18707200755612c19daaee080000000049454e44ae426082', 'hex');
const SCREENS = ['/hub/', '/hub/apiary/', '/hub/orders/', '/hub/events/', '/hub/favors/', '/hub/hubspot/'];

const browser = await chromium.launch();
let n = 0;
const check = async (name, fn) => { await fn(); n++; console.log('ok', name); };

async function owner(viewport) {
    const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 600 });
    const jwt = await site.token();
    // The Access header goes to this site only, as Cloudflare Access would add it.
    await ctx.route(`${B}/**`, route => route.continue({ headers: { ...route.request().headers(), 'cf-access-jwt-assertion': jwt } }));
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error' && !/status of 400/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    return { ctx, page, errors, jwt };
}
const toast = page => page.locator('.toast:not([hidden])');
const confirmYes = page => page.locator('dialog[open] button[value="yes"]').click();
const apiContent = async (page, jwt) => (await page.request.get(`${B}/api/hub/content`, { headers: { 'cf-access-jwt-assertion': jwt } })).json();
const status = async (page, path) => (await page.request.get(B + path, { maxRedirects: 0 })).status();

async function axeAndLayout(page, label) {
    for (const path of SCREENS) {
        await page.goto(B + path);
        await page.locator('.hub-side .hub-brand').waitFor();
        await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
        const { violations } = await new AxeBuilder({ page }).analyze();
        assert.deepEqual(violations.map(v => `${v.id}: ${v.nodes.map(x => x.target).join(' ')}`), [], `${label} ${path}`);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        assert.ok(over <= 0, `${label} ${path} scrolls sideways by ${over}px`);
        assert.equal(await page.locator('meta[name="robots"][content="noindex"]').count(), 1);
    }
}

try {
    for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
        const { ctx, page, errors, jwt } = await owner(viewport);
        const title = `Spring splits ${label}`, slug = `spring-splits-${label}`;

        await check(`${label}: the Journal opens`, async () => {
            await page.goto(B + '/hub/');
            await page.locator('#posts').waitFor();
            // The site launches with no posts, so the hub opens a new one to write.
            // (The phone run sees the desktop run's posts.)
            if (label === 'desktop') await page.locator('#posts').getByText('Not saved').waitFor();
        });

        let id;
        await check(`${label}: a draft with a heading, bold text and an uploaded photo`, async () => {
            await page.click('#new-post');
            await page.fill('#title', title);
            assert.equal(await page.inputValue('#slug'), slug);
            const area = page.locator('#body .rte-area');
            await area.click();
            await page.keyboard.type('Splitting hives');
            await page.click('#body [data-block="h2"]');
            await page.keyboard.press('End');
            await page.keyboard.press('Enter');
            await page.click('#body [data-cmd="bold"]');
            await page.keyboard.type('strong words');
            await page.click('#body [data-image]');
            await page.locator('dialog[open] input[type=file]').setInputFiles({ name: 'frame.png', mimeType: 'image/png', buffer: PNG });
            await page.locator('dialog[open] .up-name').getByText('frame.png').waitFor();
            await page.fill('dialog[open] [name=alt]', 'A frame of comb');
            await confirmYes(page);
            await page.click('#save-draft');
            await toast(page).getByText('Draft saved').waitFor();
            const post = (await apiContent(page, jwt)).posts.find(p => p.title === title);
            id = post.id;
            assert.equal(post.status, 'draft');
            assert.match(post.body, /<h2>Splitting hives<\/h2>/);
            assert.match(post.body, /<(strong|b)>strong words<\/(strong|b)>/);
            assert.match(post.body, /<img src="\/media\/[\w.-]+\.jpg" alt="A frame of comb">/);
            assert.equal(await status(page, `/journal/${slug}/`), 404);
        });

        await check(`${label}: Preview shows the draft`, async () => {
            const [tab] = await Promise.all([ctx.waitForEvent('page'), page.click('#preview')]);
            await tab.waitForURL(`**/hub/preview/${id}`);
            await tab.getByText('Draft preview, not published').waitFor();
            await tab.close();
        });

        await check(`${label}: publishing puts it on the Journal`, async () => {
            await page.click('#publish');
            await toast(page).getByText('Post published').waitFor();
            assert.equal(await status(page, `/journal/${slug}/`), 200);
            assert.match(await (await page.request.get(B + '/journal/')).text(), new RegExp(title));
            assert.equal(await page.locator('#view').getAttribute('href'), `/journal/${slug}/`);
        });

        await check(`${label}: a new address keeps the old one working`, async () => {
            await page.click('#slug-change');
            await confirmYes(page);
            await page.fill('#slug', `${slug}-renamed`);
            await page.locator('#slug').dispatchEvent('change');
            await page.click('#publish');
            await toast(page).getByText('Post updated').waitFor();
            const old = await page.request.get(`${B}/journal/${slug}/`, { maxRedirects: 0 });
            assert.equal(old.status(), 301);
            assert.equal(new URL(old.headers().location, B).pathname, `/journal/${slug}-renamed/`);
        });

        await check(`${label}: deleting takes it off the site`, async () => {
            await page.click('#delete');
            await confirmYes(page);
            await toast(page).getByText('Post deleted').waitFor();
            assert.equal(await status(page, `/journal/${slug}-renamed/`), 404);
            assert.equal(await page.locator('#posts').getByText(title).count(), 0);
        });

        await check(`${label}: the API's error shows when a save fails`, async () => {
            await page.click('#new-post');
            await page.click('#save-draft');
            await toast(page).getByText('Give the post a title.').waitFor();
            await page.fill('#title', `Kept ${label}`);
            await page.click('#save-draft');
            await toast(page).getByText('Draft saved').waitFor();
        });

        await check(`${label}: the Apiary page edits show on the site`, async () => {
            await page.goto(B + '/hub/apiary/');
            await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
            const headline = `Our hives, ${label}.`;
            await page.fill('[data-key="title"]', headline);
            if (viewport.width >= 1320) {
                const frame = page.frameLocator('#frame iframe');
                await frame.getByRole('heading', { name: headline }).waitFor();
                assert.equal(await page.locator('#frame iframe').getAttribute('sandbox'), '');
            }
            await page.click('#save');
            await toast(page).getByText('Apiary page published').waitFor();
            assert.match(await (await page.request.get(B + '/apiary/')).text(), new RegExp(headline.replace('.', '\\.')));
        });

        await check(`${label}: the coming-soon screens load`, async () => {
            for (const path of SCREENS.slice(2)) {
                await page.goto(B + path);
                await page.getByText('Coming soon').waitFor();
            }
        });

        await check(`${label}: no axe violations, no sideways scrolling`, () => axeAndLayout(page, label));

        if (SHOTS) {
            if (label === 'desktop') {
                await page.goto(B + '/hub/');
                await page.locator('#posts button[data-id]').nth(1).click();
                await page.screenshot({ path: `${SHOTS}/journal-desktop.png` });
                await page.goto(B + '/hub/apiary/');
                await page.frameLocator('#frame iframe').locator('h1').waitFor();
                await page.waitForTimeout(500);
                await page.screenshot({ path: `${SHOTS}/apiary-desktop.png` });
            } else {
                await page.goto(B + '/hub/');
                await page.locator('#posts button[data-id]').first().waitFor();
                await page.screenshot({ path: `${SHOTS}/journal-phone.png` });
            }
        }

        await check(`${label}: no console errors`, async () => assert.deepEqual(errors, []));
        await ctx.close();
    }

    await check('signed-out visitors get no hub', async () => {
        const ctx = await browser.newContext();
        const res = await (await ctx.newPage()).goto(B + '/hub/');
        assert.equal(res.status(), 401);
        await ctx.close();
    });
    console.log(`\n${n} checks passed`);
} catch (err) {
    console.log(site.log().split('\n').filter(l => /error|Error/.test(l)).slice(-20).join('\n'));
    throw err;
} finally {
    await browser.close();
    site.stop();
}
