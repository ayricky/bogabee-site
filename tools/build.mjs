import { cp, mkdir, rm, writeFile } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist');
for (const path of ['index.html', 'assets', 'event', 'event-qr', 'internal']) {
  await cp(path, `dist/${path}`, { recursive: true });
}
await writeFile('dist/_routes.json', JSON.stringify({ version: 1, include: ['/api/*'], exclude: [] }));
await writeFile('dist/_headers', '/event*\n  X-Robots-Tag: noindex, nofollow\n  Referrer-Policy: no-referrer\n/internal*\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n  Referrer-Policy: no-referrer\n');
console.log('Built static site in dist/. Cloudflare Pages compiles functions/ separately.');
