import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { safeExportPath } from '../lib/core/safe-path.js'

async function tempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-rfq-compare-path-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('a normal export filename resolves inside the base directory and is writable', async (t) => {
  const dir = await tempDir(t)
  const file = await safeExportPath(dir, 'rfq-compare.csv')
  assert.equal(file, path.join(await realpath(dir), 'rfq-compare.csv'))
  await writeFile(file, 'material,quote_count\nMAT-1,1\n')
  assert.equal(await readFile(file, 'utf8'), 'material,quote_count\nMAT-1,1\n')
})

test('parent traversal is rejected with E_RFQ_PATH_INVALID', async (t) => {
  const dir = await tempDir(t)
  await assert.rejects(() => safeExportPath(dir, '../evil.csv'), /E_RFQ_PATH_INVALID/)
  await assert.rejects(() => safeExportPath(dir, '..\\evil.csv'), /E_RFQ_PATH_INVALID/)
})

test('a separator or an absolute path in the filename is rejected', async (t) => {
  const dir = await tempDir(t)
  await assert.rejects(() => safeExportPath(dir, 'a/b.csv'), /E_RFQ_PATH_INVALID/)
  await assert.rejects(() => safeExportPath(dir, '/etc/passwd'), /E_RFQ_PATH_INVALID/)
  await assert.rejects(() => safeExportPath(dir, ''), /E_RFQ_PATH_INVALID/)
})

test('a dot-only filename is rejected by the resolved-prefix check', async (t) => {
  const dir = await tempDir(t)
  await assert.rejects(() => safeExportPath(dir, '..'), /E_RFQ_PATH_NOT_ALLOWED/)
  await assert.rejects(() => safeExportPath(dir, '.'), /E_RFQ_PATH_NOT_ALLOWED/)
})

test('a symlinked export directory is re-anchored on its realpath', async (t) => {
  const dir = await tempDir(t)
  const real = path.join(dir, 'real')
  const link = path.join(dir, 'link')
  await mkdir(real)
  await symlink(real, link, 'dir')
  const file = await safeExportPath(link, 'ok.csv')
  assert.ok(file.startsWith(`${await realpath(real)}${path.sep}`), file)
})

test('the filename regex accepts only safe single components', async (t) => {
  const dir = await tempDir(t)
  await assert.rejects(() => safeExportPath(dir, 'with space.csv'), /E_RFQ_PATH_INVALID/)
  await assert.rejects(() => safeExportPath(dir, '比价.csv'), /E_RFQ_PATH_INVALID/)
  await assert.rejects(() => safeExportPath(dir, `${'a'.repeat(121)}.csv`), /E_RFQ_PATH_INVALID/)
  const file = await safeExportPath(dir, 'A-Z_0-9.ok.csv')
  assert.equal(path.basename(file), 'A-Z_0-9.ok.csv')
})
