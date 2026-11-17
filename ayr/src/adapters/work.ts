// The checkout on disk, behind WorkTree. Every path is
// relative to the repo root and may not leave it.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { WorkTree } from '../release.ts';

export function createWorkTree(root: string): WorkTree {
  const inside = (path: string): string => {
    const full = resolve(root, path);
    const rel = relative(root, full);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Refusing ${path}: it is not a file inside the repo.`);
    return full;
  };
  return {
    read(path) {
      try {
        return new Uint8Array(readFileSync(inside(path)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    write(path, bytes) {
      const full = inside(path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, bytes);
    },
    remove(path) {
      rmSync(inside(path), { force: true });
    },
  };
}
