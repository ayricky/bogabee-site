// The Apiary page with unsaved edits from the hub, cleaned the same way a save would be.
import { fail, html } from '../../../../server/http.js';
import { cleanPage } from '../../../../server/store.js';
import { apiaryPage } from '../../../../src/pages.mjs';

export async function onRequestPost({ request }) {
    const input = await request.json().catch(() => null);
    if (!input || typeof input !== 'object') return fail('That preview was empty.');
    // The hub shows this in a sandboxed frame where scripts can't run, so leave them out
    // (and the analytics fallback that would load without them).
    const page = apiaryPage(cleanPage(input)).replace(/<script\b[\s\S]*?<\/script>|<noscript\b[\s\S]*?<\/noscript>/gi, '');
    return html(page);
}
