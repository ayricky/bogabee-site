// Starts config.release.serve for pictures and recordings, the way the smoke
// job already does: run the command, wait until the url answers, and stop the
// whole process group afterwards (wrangler starts children of its own).

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

export const SERVE_TIMEOUT_MS = 90_000; // npx may download wrangler first

export interface Server {
  stop(): Promise<void>;
}

/**
 * Runs `command` in a shell in its own process group and resolves once `url`
 * answers any HTTP status below 500. Rejects, with the end of the command's
 * output, if the command exits first or the url stays silent past timeoutMs.
 *
 * Refuses to start when the url's port is taken. Another preview holding it
 * would be photographed in place of this checkout.
 */
export async function startServer(command: string, url: string, { timeoutMs = SERVE_TIMEOUT_MS } = {}): Promise<Server> {
  const taken = `Something is already listening on ${url}. Stop it, or change release.serve, then run this again.`;
  // Binding is the test a listener can't dodge by staying silent. The HTTP probe after it catches one
  // on the other address family when the host is a name such as localhost.
  const bind = await bindError(url);
  if (bind) throw new Error(bind === 'EADDRINUSE' ? taken : `Nothing can listen on ${url} (${bind}). Change release.serve, then run this again.`);
  if ((await statusOf(url)) !== null) throw new Error(taken);
  const child = spawn('sh', ['-c', command], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const keep = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-4000); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);

  let exited: string | null = null;
  const done = new Promise<void>(resolve => {
    child.on('error', error => { exited = error.message; resolve(); });
    child.on('exit', (code, signal) => { exited = signal ? `stopped by ${signal}` : `exited with ${code}`; resolve(); });
  });

  let stopping: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      if (child.pid === undefined) return;
      signalGroup(child.pid, 'SIGTERM');
      const timer = setTimeout(() => signalGroup(child.pid as number, 'SIGKILL'), 5000);
      await done;
      clearTimeout(timer);
      signalGroup(child.pid, 'SIGKILL'); // anything in the group that outlived the shell
    })();
    return stopping;
  };

  const tail = () => (output.trim() ? `\n${output.trim().split('\n').slice(-15).join('\n')}` : '');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited !== null) {
      await stop();
      throw new Error(`The serve command ${exited} before ${url} answered: ${command}${tail()}`);
    }
    const status = await statusOf(url);
    // Asked again after the answer: a command that died meanwhile did not give it.
    if (status !== null && status < 500 && exited === null) return { stop };
    await Promise.race([done, new Promise(resolve => setTimeout(resolve, 250))]);
  }
  await stop();
  throw new Error(`${url} did not answer within ${Math.round(timeoutMs / 1000)} s of starting: ${command}${tail()}`);
}

/** Tries to listen on the url's own host and port, then lets go. Null when that worked, else the error's code. */
function bindError(url: string): Promise<string | null> {
  const { hostname, port, protocol } = new URL(url);
  return new Promise(resolve => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? error.message));
    server.listen(Number(port) || (protocol === 'https:' ? 443 : 80), hostname.replace(/^\[|\]$/g, ''), () => server.close(() => resolve(null)));
  });
}

/** The HTTP status `url` answers with, or null when nothing answers. */
async function statusOf(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, { headers: { 'cache-control': 'no-store' }, redirect: 'manual', signal: AbortSignal.timeout(2000) });
    await response.body?.cancel();
    return response.status;
  } catch {
    return null;
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // the group is already gone
  }
}
