// The review page with its buttons: `ayr release serve`.
//
// A plain file server shows the review page, and the owner says "send it" in a
// thread. This serves the same folder and adds one thing: the page's Release
// and Test on a preview buttons, which start `ayr release run` for the draft the page
// is of. Nothing else is asked of it, so the page under a plain file server
// still works, without buttons.
//
// Who may press. The server listens on loopback only, and the devbox puts it
// on the tailnet with Tailscale Serve. A press must:
//   - be the owner's: Serve names the tailnet user behind each request in a
//     header it sets itself and strips from what a client sends, and that
//     name must be one this server was started for. Another machine on the
//     tailnet, or one that is no person's, can read the page and nothing more;
//   - come from the page itself: its Origin is one this server was started
//     for, so another site open in the same browser can't press for the owner,
//     and the page can't be shown inside another site's frame;
//   - carry the token this server hands out on a same-origin read;
//   - name the commit the page is of, which `ayr release run` checks again.

import { timingSafeEqual } from 'node:crypto';
import { createReadStream, lstatSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { API, parseReview, REVIEW_FILE, reviewDigest } from './review.ts';

export const API_PATH = `/${API}`;
/** What `ayr release wait` reads to hear of a run that ended without writing any progress. */
export const PRESS_FILE = 'press.json';
/** The header Tailscale Serve sets to the login of the tailnet user behind a request. */
export const LOGIN_HEADER = 'tailscale-user-login';
const BODY_LIMIT = 4096;
// The page frames its own email preview, and nobody else frames the page.
const SHIELD = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': "frame-ancestors 'self'", 'Cache-Control': 'no-store' };

/** What the page reads to know it has buttons, and what the last press came to. */
export interface ButtonState {
  version: 1;
  token: string;
  /** The run in progress, started from this server. */
  running: { rehearsal: boolean } | null;
  /** The last run this server started. `message` is the one sentence `ayr release run` ended with. */
  last: { rehearsal: boolean; ok: boolean; message: string } | null;
}

export interface ButtonOptions {
  dir: string; // the review directory
  /** Origins the owner opens the page from, such as https://devbox.example.ts.net:8805. A press from any other is refused. */
  origins: string[];
  /** Tailnet logins that may press. Empty: nobody is asked who they are, which is only right when nothing but this machine can reach the server. */
  logins: string[];
  token: string;
  /** Runs `ayr release run` for this commit and resolves when it ends. Never rejects. */
  /** `review`: the digest of the review the owner pressed on, which the release checks again when it reads review.json. */
  run(input: { commit: string; review: string; rehearsal: boolean }): Promise<{ ok: boolean; message: string }>;
  /** Called with each run's end, before the state shows it. `ayr release serve` writes PRESS_FILE here. */
  ended?(press: { commit: string; rehearsal: boolean; ok: boolean; message: string }): void;
  log(event: string, fields: Record<string, unknown>): void;
}

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  json: 'application/json; charset=utf-8',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  mp4: 'video/mp4',
};

const same = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/** "https://host:8805/" as "host:8805": what the Host header of a request to it says. */
const hostOf = (origin: string): string | null => (URL.canParse(origin) ? new URL(origin).host : null);

/** The request's body as text. Null when it is larger than a press ever is: the rest is read and dropped, so the answer still arrives. */
function body(request: IncomingMessage): Promise<string | null> {
  return new Promise(resolve => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= BODY_LIMIT) chunks.push(chunk);
    });
    request.on('end', () => resolve(size > BODY_LIMIT ? null : Buffer.concat(chunks).toString('utf8')));
    request.on('error', () => resolve(null));
  });
}

/** The request handler. One run at a time: a second press while one runs is refused. */
export function createButton(options: ButtonOptions): (request: IncomingMessage, response: ServerResponse) => void {
  const { dir, token, log } = options;
  const origins = new Set(options.origins.map(origin => (URL.canParse(origin) ? new URL(origin).origin : origin)));
  const hosts = new Set([...origins].map(hostOf).filter((host): host is string => host !== null));
  const logins = new Set(options.logins.map(login => login.toLowerCase()));
  let running: ButtonState['running'] = null;
  let last: ButtonState['last'] = null;

  const send = (response: ServerResponse, status: number, value: object): void => {
    response.writeHead(status, { ...SHIELD, 'Content-Type': TYPES.json, 'Cross-Origin-Resource-Policy': 'same-origin' });
    response.end(JSON.stringify(value));
  };
  /** Whether the request is from someone who may press. The header can't be forged from the tailnet: Serve overwrites it. */
  const allowed = (request: IncomingMessage): boolean => {
    if (logins.size === 0) return true;
    const login = request.headers[LOGIN_HEADER];
    return typeof login === 'string' && logins.has(login.toLowerCase());
  };
  const refuse = (response: ServerResponse, status: number, error: string): void => send(response, status, { error });

  /** The review in this directory, as its commit and digest, or null when there is none to release. */
  const reviewed = (): { commit: string; digest: string } | null => {
    try {
      const review = parseReview(readFileSync(join(dir, REVIEW_FILE), 'utf8'));
      return { commit: review.commit, digest: reviewDigest(review) };
    } catch {
      return null;
    }
  };

  async function press(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // A form or a no-cors request from another site can't send this content type or this Origin.
    if (!/^application\/json\b/i.test(request.headers['content-type'] ?? '')) return refuse(response, 415, 'Send JSON.');
    if (!origins.has(request.headers.origin ?? '')) return refuse(response, 403, 'This press did not come from the review page.');
    const text = await body(request);
    if (text === null) return refuse(response, 413, 'That is more than a press sends.');
    let asked: { token?: unknown; commit?: unknown; review?: unknown; rehearsal?: unknown } = {};
    try {
      const parsed: unknown = JSON.parse(text ?? '');
      if (typeof parsed === 'object' && parsed !== null) asked = parsed;
    } catch {
      // refused below: no token
    }
    if (typeof asked.token !== 'string' || !same(asked.token, token)) return refuse(response, 403, 'Reload the page and press again.');
    if (typeof asked.commit !== 'string' || !/^[0-9a-f]{40}$/.test(asked.commit) || typeof asked.rehearsal !== 'boolean') return refuse(response, 400, 'Name the draft commit, and say whether this is a rehearsal.');
    const held = reviewed();
    if (held?.commit !== asked.commit) return refuse(response, 409, 'This page is of another draft than the one waiting now. Ask for a new review page.');
    // The same draft rebuilt, with new pictures or a new recording, is not what this page showed.
    if (held.digest !== asked.review) return refuse(response, 409, 'The review was rebuilt since this page loaded. Reload it, look again, then press.');
    const { commit } = held;
    if (running) return refuse(response, 409, 'A release is already running.');
    const { rehearsal } = asked;
    running = { rehearsal };
    log('button.pressed', { commit, rehearsal, by: request.headers[LOGIN_HEADER] ?? null });
    void options.run({ commit, review: held.digest, rehearsal }).then(ended => {
      try {
        options.ended?.({ commit, rehearsal, ...ended });
      } catch (error) {
        log('button.ended-unrecorded', { reason: String(error) });
      }
      last = { rehearsal, ...ended };
      running = null;
      log('button.ended', { commit, rehearsal, ok: ended.ok });
    });
    send(response, 202, { started: true });
  }

  function file(request: IncomingMessage, response: ServerResponse, path: string): void {
    const name = path === '/' ? 'index.html' : path.slice(1);
    // A review holds plain files with plain names, so nothing outside it can be asked for.
    const type = TYPES[name.split('.').pop() ?? ''];
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || !type) return void refuse(response, 404, 'Not found.');
    const full = join(dir, name);
    let size: number;
    try {
      // lstat, so a link is not followed out of the review directory: a review holds only plain files.
      const stat = lstatSync(full);
      if (!stat.isFile()) throw new Error('not a plain file');
      size = stat.size;
    } catch {
      return void refuse(response, 404, 'Not found.');
    }
    const headers = { ...SHIELD, 'Content-Type': type, 'Referrer-Policy': 'no-referrer', 'Accept-Ranges': 'bytes' };
    // A phone plays a video only from a server that answers byte ranges.
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
    let start = 0;
    let end = size - 1;
    if (range && (range[1] || range[2]) && size > 0) {
      if (range[1]) {
        start = Number(range[1]);
        if (range[2]) end = Math.min(Number(range[2]), size - 1);
      } else {
        start = Math.max(size - Number(range[2]), 0);
      }
      if (start > end || start >= size) {
        response.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` });
        return void response.end();
      }
      response.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    } else {
      response.writeHead(200, { ...headers, 'Content-Length': size });
    }
    if (request.method === 'HEAD' || size === 0) return void response.end();
    createReadStream(full, { start, end }).on('error', () => response.destroy()).pipe(response);
  }

  return (request, response) => {
    // A name that only points at this machine (DNS rebinding) is not one the page is served under.
    if (!hosts.has(request.headers.host ?? '')) return refuse(response, 421, 'This server is not known by that name.');
    let path: string;
    try {
      path = new URL(request.url ?? '/', 'http://x').pathname;
    } catch {
      return refuse(response, 400, 'Bad request.');
    }
    if (path === API_PATH) {
      // Anyone who can reach the page may read it. Only the owner gets the buttons.
      if (!allowed(request)) return refuse(response, 403, 'The buttons are the owner\'s.');
      if (request.method === 'GET') return send(response, 200, { version: 1, token, running, last } satisfies ButtonState);
      if (request.method === 'POST') return void press(request, response).catch(error => refuse(response, 500, String(error)));
      return refuse(response, 405, 'GET or POST.');
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return refuse(response, 405, 'GET or HEAD.');
    file(request, response, path);
  };
}
