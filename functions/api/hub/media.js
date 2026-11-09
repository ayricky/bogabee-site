// Photo uploads from the hub's editor, stored in R2 and served from /media/<key>.
import { json, fail } from '../../../server/http.js';

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX = 10 * 1024 * 1024;

export async function onRequestPost({ request, env, data }) {
    if (!env.MEDIA) return fail('Photo storage is not connected yet.', 503);
    const form = await request.formData().catch(() => null);
    const file = form && form.get('file');
    if (!file || typeof file === 'string') return fail('Choose a photo to upload.');
    const ext = TYPES[file.type];
    if (!ext) return fail('Use a JPEG, PNG, WebP or GIF photo.');
    if (file.size > MAX) return fail('That photo is over 10 MB. Try a smaller one.');
    const bytes = await file.arrayBuffer();
    // Check the file really is the image type it claims, not just its label.
    const head = new Uint8Array(bytes.slice(0, 12));
    const is = (...b) => b.every((v, i) => head[i] === v);
    const ok = { jpg: is(0xff, 0xd8, 0xff), png: is(0x89, 0x50, 0x4e, 0x47), gif: is(0x47, 0x49, 0x46), webp: is(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...head.slice(8, 12)) === 'WEBP' }[ext];
    if (!ok) return fail("That file isn't a photo the site can show.");
    const key = `${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' }, customMetadata: { by: data.email, name: String(file.name || '').slice(0, 120) } });
    return json({ url: `/media/${key}` });
}
