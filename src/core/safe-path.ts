import { mkdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { RfqError } from './errors.js'

/** A single export filename component: no separators, no whitespace, max 120 chars. */
export const SAFE_EXPORT_FILENAME = /^[A-Za-z0-9._-]{1,120}$/

/**
 * Resolve a caller-supplied export filename inside a base directory.
 *
 * 1. the filename must be one safe component (`[A-Za-z0-9._-]{1,120}`);
 * 2. the resolved path must stay below `resolve(baseDir) + sep`;
 * 3. the directory is created with `mkdir -p` and the path is re-anchored on
 *    `realpath(baseDir)` so a symlinked directory cannot redirect the write
 *    outside the canonical base.
 */
export async function safeExportPath(baseDir: string, filename: string): Promise<string> {
  if (typeof filename !== 'string' || !SAFE_EXPORT_FILENAME.test(filename)) {
    throw new RfqError('E_RFQ_PATH_INVALID', `unsafe export filename: ${JSON.stringify(filename)}`)
  }
  const base = path.resolve(baseDir)
  const candidate = path.resolve(base, filename)
  if (!candidate.startsWith(base + path.sep)) {
    throw new RfqError('E_RFQ_PATH_NOT_ALLOWED', `export path escapes base directory: ${JSON.stringify(filename)}`)
  }
  await mkdir(base, { recursive: true })
  const realBase = await realpath(base)
  const realCandidate = path.resolve(realBase, filename)
  if (!realCandidate.startsWith(realBase + path.sep)) {
    throw new RfqError('E_RFQ_PATH_NOT_ALLOWED', `export path escapes base directory after realpath: ${JSON.stringify(filename)}`)
  }
  return realCandidate
}
