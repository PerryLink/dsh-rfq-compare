import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('the bundled quickstart CSV carries 3 suppliers x 4 materials', async () => {
  const text = await readFile(path.join(packageRoot, 'samples', 'quickstart', 'input', 'quotes.csv'), 'utf8')
  const lines = text.trim().split('\n')
  assert.equal(lines[0], 'supplier,material,qty,unit_price_cents,currency,lead_time_days,valid_until,note')
  assert.equal(lines.length, 13)
  const rows = lines.slice(1).map((line) => line.split(',', 3))
  assert.deepEqual([...new Set(rows.map((row) => row[0]))].sort(), ['DEMO-SUP-A', 'DEMO-SUP-B', 'DEMO-SUP-C'])
  assert.deepEqual([...new Set(rows.map((row) => row[1]))].sort(), ['MAT-1001', 'MAT-1002', 'MAT-1003', 'MAT-1004'])
})

test('quickstart --check reproduces the committed golden result', () => {
  const result = spawnSync(process.execPath, ['samples/quickstart/run.mjs', '--check'], { cwd: packageRoot, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /summary: 4 material\(s\), 12 quote\(s\), 3 supplier\(s\)/)
  assert.match(result.stdout, /below-cost 2 \/ over-budget 2 \/ expired 2/)
  assert.match(result.stdout, /golden samples\/quickstart\/expected\/result\.json matches/)
  assert.match(result.stdout, /quickstart ok/)
})

test('the golden result is a real --json run and leaks no temporary path', async () => {
  const stdout = spawnSync(process.execPath, ['samples/quickstart/run.mjs', '--json'], {
    cwd: packageRoot,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  })
  assert.equal(stdout.status, 0, stdout.stderr)
  const expected = JSON.parse(await readFile(path.join(packageRoot, 'samples', 'quickstart', 'expected', 'result.json'), 'utf8'))
  assert.deepEqual(JSON.parse(stdout.stdout), expected)
  assert.equal(expected.csv.path, 'exports/rfq-compare.csv')
  assert.equal(expected.compare.summary.below_cost, 2)
  assert.equal(expected.compare.summary.over_budget, 2)
  assert.equal(expected.compare.summary.expired, 2)
  assert.doesNotMatch(stdout.stdout, /\/tmp\/|\/var\/folders\/|[A-Za-z]:\\Users\\/)
})
