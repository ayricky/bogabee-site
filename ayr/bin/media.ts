// `ayr media`: the pictures and the recording that changes/*.md declare, made
// against config.release.serve and the live site, written under --out, so an
// agent can look at them before the release.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { shell } from '../src/adapters/process.ts';
import { parseChange, type Change } from '../src/changes.ts';
import type { ClientConfig } from '../src/config.ts';
import { makeMedia, type MediaOptions } from '../src/media.ts';
import { clientDate } from '../src/release.ts';
import { startServer } from '../src/serve.ts';


/** changes/*.md, parsed, in file name order. None is an empty list. */
export function readChangeFiles(dir = 'changes'): Change[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(file => file.endsWith('.md'))
    .sort()
    .map(file => {
      const path = join(dir, file);
      return parseChange(path, readFileSync(path, 'utf8').replace(/^﻿/, ''));
    });
}

/** Today in the client's time zone, as YYYY-MM-DD. */
export function today(timezone: string, at = new Date()): string {
  return clientDate(at, timezone);
}

/**
 * Runs release.setup, starts the local server, makes the media, writes it
 * under `out`, stops the server. Returns the paths written. Setup runs here as
 * it does in `ayr release draft`, so a fresh worktree has what the serve
 * command needs. Its output goes to stderr.
 */
export async function mediaCommand(args: {
  config: ClientConfig;
  changes: Change[];
  out: string;
  date?: string;
  options?: MediaOptions;
  log?: (line: string) => void;
  cwd?: string; // the repo root, where release.setup runs
}): Promise<string[]> {
  const { config, changes, out, log = console.log, cwd = process.cwd() } = args;
  const release = config.release;
  if (!release) throw new Error(`${config.slug} has no release block in its config, so there is no local server to shoot.`);
  if (!changes.some(change => change.kind === 'item' && (change.picture || change.recording))) {
    log('No change file asks for a picture or a recording.');
    return [];
  }
  for (const command of release.setup) await shell(command, cwd);
  const server = await startServer(release.serve.command, release.serve.url);
  let made;
  try {
    made = await makeMedia(changes, { live: config.site, local: release.serve.url }, args.date ?? today(config.timezone), args.options);
  } finally {
    await server.stop();
  }
  const written: string[] = [];
  const save = (file: string, bytes: Uint8Array) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    written.push(file);
    log(`Wrote ${file}`);
  };
  for (const picture of made.pictures) save(join(out, basename(picture.file)), picture.bytes);
  if (made.video) save(join(out, made.video.name), made.video.bytes);
  return written;
}
