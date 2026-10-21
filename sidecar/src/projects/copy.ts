import { cp, lstat, readdir } from "node:fs/promises";
import { basename, join } from "node:path";

/** Folders and files that are state or build output, never part of a project's content. */
const SKIP_NAMES: Record<string, true> = {
  node_modules: true,
  ".git": true,
  renders: true,
  ".memotion": true,
  ".hyperframes": true,
  ".DS_Store": true,
  "memotion.json": true,
};

export interface CopyLimits {
  /** Refuse (before copying anything) when the copy would hold more files than this. */
  maxFiles: number;
  /** Refuse when the copy would hold more bytes than this. */
  maxBytes: number;
}

export const DEFAULT_LIMITS: CopyLimits = { maxFiles: 5000, maxBytes: 1_500_000_000 };

/**
 * Measure what `copyProjectTree` would copy. Symlinks are skipped, not followed: a project from elsewhere
 * must not be able to pull files from outside itself into ours.
 */
export async function measureTree(src: string, extraSkip: Record<string, true> = {}): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (SKIP_NAMES[entry.name] || extraSkip[entry.name] || entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        files++;
        bytes += (await lstat(full)).size;
      }
    }
  }
  await walk(src);
  return { files, bytes };
}

export async function copyProjectTree(
  src: string,
  dest: string,
  opts: { limits?: CopyLimits; extraSkip?: Record<string, true> } = {},
): Promise<{ files: number; bytes: number }> {
  const limits = opts.limits ?? DEFAULT_LIMITS;
  const extraSkip = opts.extraSkip ?? {};
  const size = await measureTree(src, extraSkip);
  if (size.files > limits.maxFiles) throw new Error(`Too many files (${size.files} > ${limits.maxFiles}).`);
  if (size.bytes > limits.maxBytes) throw new Error(`Too large (${Math.round(size.bytes / 1e6)} MB > ${Math.round(limits.maxBytes / 1e6)} MB).`);
  await cp(src, dest, {
    recursive: true,
    dereference: false,
    filter: async (from) => {
      const name = basename(from);
      if (from === src) return true;
      if (SKIP_NAMES[name] || extraSkip[name]) return false;
      return !(await lstat(from)).isSymbolicLink();
    },
  });
  return size;
}
