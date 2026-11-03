// Starts the site the way Cloudflare Pages runs it: `wrangler pages dev` on a fresh build, with a
// local D1 and R2 and a stand-in for Cloudflare Access's signing keys. Shared by the hub tests.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const TEAM = 'test.cloudflareaccess.com', AUD = 'hub-test-aud', OWNER = 'owner@example.com';

/** @returns {Promise<{ B: string, token: (email?: string, aud?: string) => Promise<string>, log: () => string, stop: () => void }>} */
export async function startSite() {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    const certs = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] })); }).listen(0, '127.0.0.1');
    await new Promise(r => certs.once('listening', r));
    const token = (email = OWNER, aud = AUD) => new SignJWT({ email }).setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(`https://${TEAM}`).setAudience(aud).setSubject('u1').setIssuedAt().setExpirationTime('30m').sign(privateKey);

    execFileSync('node', ['tools/build.mjs'], { cwd: root, stdio: 'inherit' });
    const state = mkdtempSync(join(process.env.TMPDIR || root, 'hub-test-'));
    const PORT = 8790 + Math.floor(Math.random() * 200);
    const dev = spawn(join(root, 'node_modules/.bin/wrangler'), ['pages', 'dev', 'dist', '--port', String(PORT), '--ip', '127.0.0.1',
        '--d1', 'DB=hub-test', '--r2', 'MEDIA=media-test', '--persist-to', state, '--compatibility-date', '2026-10-01',
        '--binding', `ACCESS_TEAM_DOMAIN=${TEAM}`, '--binding', `ACCESS_AUD=${AUD}`, '--binding', `HUB_EMAILS=${OWNER}`,
        '--binding', `ACCESS_CERTS_URL=http://127.0.0.1:${certs.address().port}/certs`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    dev.stdout.on('data', d => { log += d; }); dev.stderr.on('data', d => { log += d; });
    const stop = () => { dev.kill(); certs.close(); rmSync(state, { recursive: true, force: true }); };
    const B = `http://127.0.0.1:${PORT}`;
    for (let i = 0; ; i++) {
        try { if ((await fetch(B + '/')).ok) break; } catch {}
        if (i > 120) { stop(); console.log(log); throw new Error('wrangler pages dev did not start'); }
        await new Promise(r => setTimeout(r, 500));
    }
    return { B, token, log: () => log, stop };
}
