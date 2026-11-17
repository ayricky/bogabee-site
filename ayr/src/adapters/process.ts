// Child processes for the adapters: one that captures output, one that runs a
// client's own command with its output on stderr.

import { spawn } from 'node:child_process';

export interface Ran {
  code: number;
  stdout: Buffer;
  stderr: string;
}

export type Exec = (file: string, args: string[], options?: { cwd?: string; env?: Record<string, string>; input?: Uint8Array }) => Promise<Ran>;

/** Runs a program without a shell. `env` is added to this process's environment. Never rejects on a non-zero exit. */
export const exec: Exec = (file, args, { cwd, env, input } = {}) => new Promise((resolve, reject) => {
  const child = spawn(file, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  const out: Buffer[] = [];
  let err = '';
  child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => {
    err += chunk.toString();
  });
  child.stdin.on('error', () => {}); // a program that exits without reading its input
  child.on('error', reject);
  child.on('close', code => resolve({ code: code ?? 1, stdout: Buffer.concat(out), stderr: err }));
  child.stdin.end(input);
});

/** A command from the client config, through bash, in `cwd`. All its output goes to stderr, so stdout stays the caller's one JSON line. Rejects on a non-zero exit. */
export function shell(command: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', command], { cwd, stdio: ['ignore', 2, 2] });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`\`${command}\` exited ${code ?? 'on a signal'}.`))));
  });
}

/** The last lines of a program's output, for an error message. */
export function tail(text: string, lines = 15): string {
  return text.trimEnd().split('\n').slice(-lines).join('\n');
}
