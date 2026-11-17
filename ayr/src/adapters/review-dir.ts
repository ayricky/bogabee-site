// The review directory on disk. A write lands under a temporary name and is
// renamed into place, so the page never reads half a status.json.

import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReviewDir } from '../release.ts';
import { REVIEW_FILE, STATUS_FILE } from '../review.ts';

const TAG = /^prod-\d{4}-\d{2}-\d{2}-[0-9a-f]{7}$/;

/** A review.json or status.json this kit wrote: version 1 and a release tag. A file that merely has the name proves nothing. */
function isOurs(path: string): boolean {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown; tag?: unknown } | null;
    return value?.version === 1 && typeof value.tag === 'string' && TAG.test(value.tag);
  } catch {
    return false;
  }
}

export function createReviewDir(root: string): ReviewDir {
  const inside = (name: string): string => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error(`Refusing ${name}: a review file is a plain file name.`);
    return join(root, name);
  };
  return {
    path: root,
    read(name) {
      try {
        return new Uint8Array(readFileSync(inside(name)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    write(name, bytes) {
      const full = inside(name);
      mkdirSync(root, { recursive: true });
      const temporary = join(root, `.${name}.${process.pid}.tmp`);
      writeFileSync(temporary, bytes);
      renameSync(temporary, full);
    },
    remove(name) {
      rmSync(inside(name), { force: true });
    },
    clear() {
      mkdirSync(root, { recursive: true });
      // --review-dir pointed at a folder of something else must not empty it. A review is flat, so
      // only files ever go, and only from a folder that holds a review this kit wrote.
      const entries = readdirSync(root, { withFileTypes: true });
      const other = entries.find(entry => !entry.isFile());
      if (other) throw new Error(`Refusing to empty ${root}: ${other.name} in it is not a file, and a review holds only files. Pass an empty folder as --review-dir.`);
      if (entries.length > 0 && !isOurs(join(root, REVIEW_FILE)) && !isOurs(join(root, STATUS_FILE))) {
        throw new Error(`Refusing to empty ${root}: it holds files, and neither ${REVIEW_FILE} nor ${STATUS_FILE} in it is a review this kit wrote. Pass an empty folder as --review-dir.`);
      }
      for (const entry of entries) rmSync(join(root, entry.name), { force: true });
    },
  };
}
