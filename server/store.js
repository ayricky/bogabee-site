// The owner hub's content in D1: Journal posts and editable pages.
import { sanitize, plain } from './sanitize.js';

// The tables, created on the hub's first request, so there is no migration step to run.
const SCHEMA = [
    `CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
    date TEXT,                      -- YYYY-MM-DD, set when first published
    title TEXT NOT NULL,
    excerpt TEXT NOT NULL DEFAULT '',
    cover TEXT NOT NULL DEFAULT '', -- a site photo name (sunflower) or an uploaded /media/ path
    cover_alt TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',  -- sanitized HTML
    aliases TEXT NOT NULL DEFAULT '[]', -- earlier slugs of a renamed published post, as JSON
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    updated_by TEXT NOT NULL DEFAULT ''
)`,
    `CREATE INDEX IF NOT EXISTS posts_published ON posts (status, date DESC)`,
    `CREATE TABLE IF NOT EXISTS pages (
    key TEXT PRIMARY KEY,           -- 'apiary'
    data TEXT NOT NULL,             -- the page's fields as JSON, rich text sanitized
    updated_at INTEGER NOT NULL,
    updated_by TEXT NOT NULL DEFAULT ''
)`
];
let ready = false;
export async function ensureSchema(db) {
    if (ready) return;
    await db.batch(SCHEMA.map(sql => db.prepare(sql)));
    ready = true;
}

const PAGE_KEYS = new Set(['apiary']);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export const slugify = t => String(t || 'post').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim()
    .replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'post';

// A cover or page photo: a site photo name, or a path to an upload.
const photo = v => {
    const s = String(v ?? '').trim();
    if (!s) return '';
    if (/^[a-z0-9_]+$/.test(s)) return s;
    if (/^\/media\/[\w.-]+$/.test(s)) return s;
    return '';
};

const fromRow = r => r && ({
    id: r.id, slug: r.slug, status: r.status, date: r.date, title: r.title, excerpt: r.excerpt,
    cover: r.cover, coverAlt: r.cover_alt, body: r.body, aliases: JSON.parse(r.aliases || '[]'),
    created: r.created_at, updated: r.updated_at, updatedBy: r.updated_by,
});

export async function hasContent(db) {
    try {
        const r = await db.prepare('SELECT (SELECT COUNT(*) FROM posts) + (SELECT COUNT(*) FROM pages) AS n').first();
        return r.n > 0;
    } catch (err) {
        // Before the hub's first use the tables don't exist yet: nothing saved, nothing to show.
        if (/no such table/.test(String(err && err.message))) return false;
        throw err;
    }
}

export async function listPosts(db) {
    const { results } = await db.prepare('SELECT * FROM posts ORDER BY COALESCE(date, \'9999\') DESC, updated_at DESC').all();
    return results.map(fromRow);
}

/** A post by its current slug, or by an old one (then `moved` is true). */
export async function findPost(db, slug) {
    const now = fromRow(await db.prepare('SELECT * FROM posts WHERE slug = ?').bind(slug).first());
    if (now) return { post: now, moved: false };
    const old = fromRow(await db.prepare('SELECT posts.* FROM posts, json_each(posts.aliases) WHERE json_each.value = ? LIMIT 1').bind(slug).first());
    return old ? { post: old, moved: true } : null;
}

export class InputError extends Error {}

/**
 * Saves a post from the hub. Cleans every field, keeps slugs unique, remembers the old
 * slug when a published post is renamed, and dates a post the first time it's published.
 */
export async function savePost(db, input, email, today = new Date().toISOString().slice(0, 10)) {
    const id = input.id ? String(input.id) : null;
    const before = id ? fromRow(await db.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first()) : null;
    if (id && !before) throw new InputError('That post no longer exists.');
    const title = plain(input.title, 160);
    if (!title) throw new InputError('Give the post a title.');
    const status = input.status === 'published' ? 'published' : 'draft';
    let date = input.date && ISO_DAY.test(input.date) ? input.date : before?.date ?? null;
    if (status === 'published' && !date) date = today;

    const base = slugify(input.slug || title);
    let slug = base;
    for (let n = 2; ; n++) {
        const clash = await db.prepare('SELECT id FROM posts WHERE slug = ? AND id != ?').bind(slug, id ?? '').first();
        if (!clash) break;
        slug = `${base}-${n}`;
    }
    const aliases = new Set(before?.aliases || []);
    if (before && before.slug !== slug && before.status === 'published') aliases.add(before.slug);
    aliases.delete(slug);

    const row = {
        id: id || crypto.randomUUID(), slug, status, date, title,
        excerpt: plain(input.excerpt, 300), cover: photo(input.cover), cover_alt: plain(input.coverAlt, 200),
        body: sanitize(input.body), aliases: JSON.stringify([...aliases]),
    };
    const now = Date.now();
    await db.prepare(`INSERT INTO posts (id, slug, status, date, title, excerpt, cover, cover_alt, body, aliases, created_at, updated_at, updated_by)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, ?12)
        ON CONFLICT (id) DO UPDATE SET slug = ?2, status = ?3, date = ?4, title = ?5, excerpt = ?6, cover = ?7, cover_alt = ?8, body = ?9, aliases = ?10, updated_at = ?11, updated_by = ?12`)
        .bind(row.id, row.slug, row.status, row.date, row.title, row.excerpt, row.cover, row.cover_alt, row.body, row.aliases, now, email).run();
    return fromRow(await db.prepare('SELECT * FROM posts WHERE id = ?').bind(row.id).first());
}

export async function deletePost(db, id) {
    const r = await db.prepare('DELETE FROM posts WHERE id = ?').bind(String(id)).run();
    return r.meta.changes > 0;
}

export async function getPage(db, key) {
    const r = await db.prepare('SELECT data, updated_at, updated_by FROM pages WHERE key = ?').bind(key).first();
    return r ? { ...JSON.parse(r.data), updated: r.updated_at, updatedBy: r.updated_by } : null;
}

/** The Apiary page's fields, cleaned the same way as posts. */
export function cleanPage(input) {
    const p = input || {};
    const rich = v => sanitize(v);
    return {
        eyebrow: plain(p.eyebrow, 60), title: plain(p.title, 160) || 'The Apiary', intro: plain(p.intro, 600),
        heroImage: photo(p.heroImage),
        sections: (Array.isArray(p.sections) ? p.sections : []).slice(0, 12).map(s => ({
            heading: plain(s?.heading, 120), image: photo(s?.image), imageAlt: plain(s?.imageAlt, 200), body: rich(s?.body),
        })).filter(s => s.heading || s.image || s.body.replace(/<[^>]*>/g, '').trim()),
        seasonsTitle: plain(p.seasonsTitle, 120),
        seasons: (Array.isArray(p.seasons) ? p.seasons : []).slice(0, 12).map(s => ({ name: plain(s?.name, 60), text: plain(s?.text, 300) })).filter(s => s.name || s.text),
        keeperTitle: plain(p.keeperTitle, 120), keeper: rich(p.keeper),
        keeperImage: photo(p.keeperImage), keeperImageAlt: plain(p.keeperImageAlt, 200),
    };
}

export async function savePage(db, key, input, email) {
    if (!PAGE_KEYS.has(key)) throw new InputError('There is no page by that name.');
    const data = cleanPage(input);
    await db.prepare('INSERT INTO pages (key, data, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (key) DO UPDATE SET data = ?2, updated_at = ?3, updated_by = ?4')
        .bind(key, JSON.stringify(data), Date.now(), email).run();
    return getPage(db, key);
}

/**
 * The first time the hub is used, copy the site's current content (built from content/
 * into /_seed/content.json) into D1, so saving one post doesn't hide the others.
 */
export async function seedIfEmpty(db, loadSeed) {
    await ensureSchema(db);
    if (await hasContent(db)) return false;
    const seed = await loadSeed();
    const now = Date.now();
    const stmts = (seed.posts || []).map(p => db.prepare(`INSERT OR IGNORE INTO posts (id, slug, status, date, title, excerpt, cover, cover_alt, body, aliases, created_at, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, 'seed')`)
        .bind(crypto.randomUUID(), slugify(p.slug), p.status === 'published' ? 'published' : 'draft', p.date || null, plain(p.title, 160), plain(p.excerpt, 300),
            photo(p.cover), plain(p.coverAlt, 200), sanitize(p.body), now, now));
    if (seed.apiary) stmts.push(db.prepare('INSERT OR IGNORE INTO pages (key, data, updated_at, updated_by) VALUES (\'apiary\', ?, ?, \'seed\')').bind(JSON.stringify(cleanPage(seed.apiary)), now));
    if (stmts.length) await db.batch(stmts);
    return true;
}
