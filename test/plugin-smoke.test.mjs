import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as plugin from '../lib/plugin/index.js'
import { createTools } from '../lib/plugin/tools.js'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const samplePath = path.join(packageRoot, 'samples', 'quickstart', 'input', 'quotes.csv')

test('createTools exposes the three rfq_* tools with unique names', () => {
  const tools = createTools({ baseDir: path.join(os.tmpdir(), 'dsh-rfq-compare-smoke') })
  assert.deepEqual(tools.map((tool) => tool.name), ['rfq_ingest', 'rfq_compare', 'rfq_export'])
  assert.equal(new Set(tools.map((tool) => tool.name)).size, 3)
  for (const tool of tools) {
    assert.ok(tool.name.startsWith('rfq_'))
    assert.ok(tool.description.length > 0)
    assert.equal(typeof tool.execute, 'function')
    assert.equal(typeof tool.output.render, 'function')
  }
})

test('resolveBaseDir defaults to $DSH_HOME/dsh-rfq-compare and honors the explicit override', () => {
  assert.equal(plugin.resolveBaseDir({ DSH_HOME: '/tmp/dsh-home' }), path.join('/tmp/dsh-home', 'dsh-rfq-compare'))
  assert.equal(
    plugin.resolveBaseDir({ DSH_HOME: '/tmp/dsh-home', DSH_RFQ_COMPARE_HOME: '/tmp/rfq-home' }),
    '/tmp/rfq-home',
  )
})

test('apply() registers the tools and wires the documented write root', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-rfq-compare-apply-'))
  const previous = process.env.DSH_RFQ_COMPARE_HOME
  process.env.DSH_RFQ_COMPARE_HOME = dir
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_RFQ_COMPARE_HOME
    else process.env.DSH_RFQ_COMPARE_HOME = previous
    await rm(dir, { recursive: true, force: true })
  })

  const registered = []
  await plugin.apply({ tools: { register(tool) { registered.push(tool) } } })
  assert.equal(plugin.name, 'dsh-rfq-compare')
  assert.deepEqual(plugin.inject, ['tools'])
  assert.equal(registered.length, 3)

  const byName = Object.fromEntries(registered.map((tool) => [tool.name, tool]))
  const exec = { callId: 'apply' }
  await byName['rfq_ingest'].execute({ csv_text: await readFile(samplePath, 'utf8') }, exec)
  const compared = await byName['rfq_compare'].execute({ as_of: '2026-11-02' }, exec)
  assert.equal(compared.summary.quotes, 12)
  const exported = await byName['rfq_export'].execute({ as_of: '2026-11-02', filename: 'apply.csv' }, exec)
  assert.ok(exported.path.startsWith(`${dir}${path.sep}exports${path.sep}`), exported.path)
  assert.equal(exported.rows, 4)
  assert.match(await readFile(exported.path, 'utf8'), /^material,quote_count/)
})

test('rfq_export rejects a traversal filename without writing outside exports', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-rfq-compare-export-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const tools = Object.fromEntries(createTools({ baseDir: path.join(dir, 'store') }).map((tool) => [tool.name, tool]))
  const exec = { callId: 'export' }
  await tools['rfq_ingest'].execute({ csv_text: await readFile(samplePath, 'utf8') }, exec)
  await assert.rejects(() => tools['rfq_export'].execute({ filename: '../evil.csv' }, exec), /E_RFQ_PATH_INVALID/)
  await assert.rejects(() => tools['rfq_export'].execute({ filename: '/tmp/evil.csv' }, exec), /E_RFQ_PATH_INVALID/)
})
