// Cleans rich text from the owner hub's editor before it's stored. Public pages render the
// stored HTML as is, so this allowlist is the only thing between the editor and the site.

const TAGS = new Set(['p', 'h2', 'h3', 'strong', 'em', 'b', 'i', 'a', 'ul', 'ol', 'li', 'blockquote', 'br', 'figure', 'figcaption', 'img']);
const VOID = new Set(['br', 'img']);
// Elements whose content is dropped along with them, not kept as text.
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'head', 'title', 'textarea', 'select']);

const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k[0] === '#') {
        const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENTITY[k] ?? m;
});
const escText = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => escText(s).replace(/"/g, '&quot;');

// Links may go to web pages, email, phone, or a path on this site. Images: this site, or https.
function safeUrl(raw, { image = false } = {}) {
    const url = decode(raw).replace(/[\u0000- \u007f]/g, '');
    if (/^\/(?![\/\\])/.test(url)) return url;
    if (image) return /^https:\/\//i.test(url) ? url : null;
    if (/^(https?:|mailto:|tel:)/i.test(url)) return url;
    if (/^#[\w-]*$/.test(url)) return url;
    return null;
}

function attrs(src) {
    const out = {};
    const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let m;
    while ((m = re.exec(src))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
    return out;
}

/** @param {string} html @returns {string} */
export function sanitize(html) {
    const input = String(html ?? '').replace(/<!--[\s\S]*?(-->|$)/g, '');
    const tokens = input.split(/(<\/?[a-zA-Z][^>]*>)/);
    const open = [];
    let out = '', dropping = null;

    for (const tok of tokens) {
        const tag = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>$/.exec(tok);
        if (!tag) {
            if (!dropping) out += escText(decode(tok));
            continue;
        }
        const [, close, rawName, rest] = tag;
        const name = rawName.toLowerCase();
        if (dropping) { if (close && name === dropping) dropping = null; continue; }
        if (DROP.has(name)) { if (!close && !/\/\s*$/.test(rest)) dropping = name; continue; }
        if (!TAGS.has(name)) continue;

        if (close) {
            if (VOID.has(name)) continue;
            const i = open.lastIndexOf(name);
            if (i < 0) continue;
            while (open.length > i) out += `</${open.pop()}>`;
            continue;
        }
        const a = attrs(rest);
        if (name === 'a') {
            const href = a.href != null ? safeUrl(a.href) : null;
            if (!href) { open.push(name); out += '<a>'; continue; }
            const external = /^https?:/i.test(href);
            out += `<a href="${escAttr(href)}"${external ? ' target="_blank" rel="noopener"' : ''}>`;
            open.push(name);
        } else if (name === 'img') {
            const src = a.src != null ? safeUrl(a.src, { image: true }) : null;
            if (src) out += `<img src="${escAttr(src)}" alt="${escAttr(decode(a.alt ?? ''))}">`;
        } else if (VOID.has(name)) {
            out += `<${name}>`;
        } else {
            out += `<${name}>`;
            open.push(name);
        }
    }
    while (open.length) out += `</${open.pop()}>`;
    return out.replace(/<a>([\s\S]*?)<\/a>/g, '$1');
}

/** Plain text, for titles and excerpts: tags removed, length capped. */
export const plain = (s, max = 300) => decode(String(s ?? '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim().slice(0, max);
