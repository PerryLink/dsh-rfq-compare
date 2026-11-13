#!/usr/bin/env node
/**
 * dsh-rfq-compare quickstart — ingests the bundled 3 x 4 synthetic quotes,
 * compares them per material, then exports the comparison CSV.
 *
 *   node samples/quickstart/run.mjs            # human-readable summary
 *   node samples/quickstart/run.mjs --json     # the golden result on stdout
 *   node samples/quickstart/run.mjs --check    # recompute and diff against the golden file
 *
 * The golden file `expected/result.json` is the stdout of `--json`; it is a real
 * run over the committed CSV, not hand-written output.
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTools } from '../../lib/plugin/tools.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const samplePath = path.join(here, 'input', 'quotes.csv')
const assumptionsPath = path.join(here, 'input', 'assumptions.json')
const expectedPath = path.join(here, 'expected', 'result.json')
const mode = process.argv.includes('--check') ? 'check' : process.argv.includes('--json') ? 'json' : 'summary'

const money = (cents) => (cents / 100).toFixed(2)

async function run() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-rfq-compare-quickstart-'))
  const realTemp = await realpath(tempDir)
  try {
    const assumptions = JSON.parse(await readFile(assumptionsPath, 'utf8'))
    const options = {
      as_of: assumptions.as_of,
      cost_lines: assumptions.cost_lines,
      budgets: assumptions.budgets,
    }
    const tools = Object.fromEntries(createTools({ baseDir: tempDir }).map((tool) => [tool.name, tool]))
    const exec = { callId: 'quickstart' }

    const ingested = await tools['rfq_ingest'].execute({ csv_text: await readFile(samplePath, 'utf8') }, exec)
    const compared = await tools['rfq_compare'].execute(options, exec)
    const exported = await tools['rfq_export'].execute({ ...options, filename: 'rfq-compare.csv' }, exec)
    const csvText = await readFile(exported.path, 'utf8')

    return {
      sample: 'samples/quickstart/input/quotes.csv',
      assumptions: 'samples/quickstart/input/assumptions.json',
      ingest: { added: ingested.added, updated: ingested.updated, total: ingested.total },
      compare: compared,
      csv: {
        path: path.relative(realTemp, exported.path).split(path.sep).join('/'),
        sha256: exported.sha256,
        bytes: exported.bytes,
        rows: exported.rows,
        text: csvText,
      },
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

function printSummary(result) {
  const compare = result.compare
  console.log('dsh-rfq-compare quickstart - synthetic quotes, 3 suppliers x 4 materials (no customer data)')
  console.log(
    `ingested ${result.ingest.added} quote(s), ${result.ingest.updated} updated, ${result.ingest.total} total; as_of ${compare.as_of}`,
  )
  console.log(
    `FX placeholder: CNY 1.00 | USD 7.20 | EUR 7.80 -> CNY (static, not live; override with fx_rates)`,
  )
  for (const material of compare.materials) {
    const lowest = material.lowest
    const second = material.second_lowest
    const spread = material.price_spread_cents === null ? 'n/a' : `${money(material.price_spread_cents)} CNY (${material.price_spread_bp} bp)`
    console.log(
      `${material.material}  lowest ${lowest.supplier} ${money(lowest.unit_price_cents)} ${lowest.currency} -> ${money(lowest.unit_price_cny_cents)} CNY  lead ${material.lead_time_days.min}-${material.lead_time_days.max} d`,
    )
    console.log(
      `           second ${second ? `${second.supplier} ${money(second.unit_price_cents)} ${second.currency}` : 'n/a'}  spread ${spread}`,
    )
    console.log(
      `           anomalies: below-cost ${material.anomalies.below_cost.length}, over-budget ${material.anomalies.over_budget ? 'yes' : 'no'}, expired ${material.anomalies.expired.length}`,
    )
  }
  console.log(
    `summary: ${compare.summary.materials} material(s), ${compare.summary.quotes} quote(s), ${compare.summary.suppliers} supplier(s); below-cost ${compare.summary.below_cost} / over-budget ${compare.summary.over_budget} / expired ${compare.summary.expired}`,
  )
  console.log(`CSV ${result.csv.path}: ${result.csv.rows} rows, ${result.csv.bytes} bytes, sha256 ${result.csv.sha256.slice(0, 12)}...`)
}

const result = await run()

if (mode === 'json') {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} else if (mode === 'check') {
  const expected = JSON.parse(await readFile(expectedPath, 'utf8'))
  assert.deepEqual(result, expected)
  printSummary(result)
  console.log('golden samples/quickstart/expected/result.json matches')
  console.log('quickstart ok')
} else {
  printSummary(result)
  console.log('run with --check to compare against expected/result.json')
}
