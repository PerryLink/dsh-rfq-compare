#!/usr/bin/env node
/**
 * Acceptance checks over public/synthetic fixtures. Writes ACCEPTANCE.csv and
 * evidence/<run_id>/result.json. No network, no customer data.
 *
 *   node scripts/acceptance.mjs
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTools } from '../lib/plugin/tools.js'
import { safeExportPath } from '../lib/core/safe-path.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const errors = []

async function errorCode(promise) {
  try {
    await promise
    return 'NO_ERROR'
  } catch (error) {
    return error?.code ?? error?.name ?? 'UNKNOWN'
  }
}

async function main() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'dsh-rfq-compare-acceptance-'))
  const baseDir = path.join(tempDir, 'store')
  try {
    const tools = Object.fromEntries(createTools({ baseDir }).map((tool) => [tool.name, tool]))
    const exec = { callId: 'acceptance' }
    const sample = readFileSync(path.join(root, 'samples', 'quickstart', 'input', 'quotes.csv'), 'utf8')
    const assumptions = JSON.parse(readFileSync(path.join(root, 'samples', 'quickstart', 'input', 'assumptions.json'), 'utf8'))
    const options = { as_of: assumptions.as_of, cost_lines: assumptions.cost_lines, budgets: assumptions.budgets }

    const ingested = await tools['rfq_ingest'].execute({ csv_text: sample }, exec)
    const compared = await tools['rfq_compare'].execute(options, exec)
    const exported = await tools['rfq_export'].execute({ ...options, filename: 'acceptance.csv' }, exec)
    const csvText = readFileSync(exported.path, 'utf8')
    const first = compared.materials.find((material) => material.material === 'MAT-1001')
    const currencyCode = await errorCode(
      tools['rfq_ingest'].execute({ quotes: [{ supplier: 'A', material: 'MAT-1', qty: 1, unit_price_cents: 1, currency: 'GBP', lead_time_days: 1, valid_until: '2026-12-31' }] }, exec),
    )
    const qtyCode = await errorCode(
      tools['rfq_ingest'].execute({ quotes: [{ supplier: 'A', material: 'MAT-1', qty: 0, unit_price_cents: 1, currency: 'CNY', lead_time_days: 1, valid_until: '2026-12-31' }] }, exec),
    )
    const emptyCode = await errorCode(tools['rfq_ingest'].execute({}, exec))
    const csvCode = await errorCode(tools['rfq_ingest'].execute({ csv_text: 'supplier,material,qty\nA,B,1\n' }, exec))
    const priceCode = await errorCode(
      tools['rfq_ingest'].execute({ quotes: [{ supplier: 'A', material: 'MAT-1', qty: 1, unit_price_cents: 12.5, currency: 'CNY', lead_time_days: 1, valid_until: '2026-12-31' }] }, exec),
    )
    const dateCode = await errorCode(
      tools['rfq_ingest'].execute({ quotes: [{ supplier: 'A', material: 'MAT-1', qty: 1, unit_price_cents: 1, currency: 'CNY', lead_time_days: 1, valid_until: '2026-02-30' }] }, exec),
    )
    const pathCode = await errorCode(safeExportPath(path.join(baseDir, 'exports'), '../evil.csv'))
    const csvOk =
      csvText.startsWith('material,quote_count,supplier_count,') &&
      csvText.trim().split('\n').length === 5 &&
      csvText.includes('MAT-1001,3,3,Q002,DEMO-SUP-B,17200,USD,123840')

    // ACCEPTANCE.csv uses a simple comma-split schema: keep every field free of commas.
    const metrics = [
      { req_id: 'RFQ-A01', metric: 'ingest 12 quotes', threshold: 'added=12 total=12', actual: `added=${ingested.added} total=${ingested.total}`, pass: ingested.added === 12 && ingested.total === 12 },
      { req_id: 'RFQ-A02', metric: 'compare 4 materials', threshold: '4/12/3', actual: `${compared.summary.materials}/${compared.summary.quotes}/${compared.summary.suppliers}`, pass: compared.summary.materials === 4 && compared.summary.quotes === 12 && compared.summary.suppliers === 3 },
      { req_id: 'RFQ-A03', metric: 'lowest/second/spread', threshold: 'Q002/Q001/1160', actual: `${first?.lowest?.quote_id}/${first?.second_lowest?.quote_id}/${first?.price_spread_cents}`, pass: first?.lowest?.quote_id === 'Q002' && first?.second_lowest?.quote_id === 'Q001' && first?.price_spread_cents === 1160 && first?.price_spread_bp === 94 },
      { req_id: 'RFQ-A04', metric: 'placeholder FX', threshold: 'USD 17200 -> 123840', actual: `USD17200=${first?.lowest?.unit_price_cny_cents}`, pass: first?.lowest?.unit_price_cny_cents === 123840 },
      { req_id: 'RFQ-A05', metric: 'below cost line', threshold: '2', actual: `${compared.summary.below_cost}`, pass: compared.summary.below_cost === 2 },
      { req_id: 'RFQ-A06', metric: 'over budget', threshold: '2', actual: `${compared.summary.over_budget}`, pass: compared.summary.over_budget === 2 },
      { req_id: 'RFQ-A07', metric: 'expired quotes', threshold: '2', actual: `${compared.summary.expired}`, pass: compared.summary.expired === 2 },
      { req_id: 'RFQ-A08', metric: 'bad currency', threshold: 'E_RFQ_CURRENCY', actual: currencyCode, pass: currencyCode === 'E_RFQ_CURRENCY' },
      { req_id: 'RFQ-A09', metric: 'zero qty', threshold: 'E_RFQ_QTY', actual: qtyCode, pass: qtyCode === 'E_RFQ_QTY' },
      { req_id: 'RFQ-A10', metric: 'empty quote table', threshold: 'E_RFQ_EMPTY', actual: emptyCode, pass: emptyCode === 'E_RFQ_EMPTY' },
      { req_id: 'RFQ-A11', metric: 'bad CSV header', threshold: 'E_RFQ_CSV', actual: csvCode, pass: csvCode === 'E_RFQ_CSV' },
      { req_id: 'RFQ-A12', metric: 'fractional cents', threshold: 'E_RFQ_PRICE', actual: priceCode, pass: priceCode === 'E_RFQ_PRICE' },
      { req_id: 'RFQ-A13', metric: 'invalid date', threshold: 'E_RFQ_DATE', actual: dateCode, pass: dateCode === 'E_RFQ_DATE' },
      { req_id: 'RFQ-A14', metric: 'CSV export', threshold: '4 rows + sha256', actual: `${exported.rows} rows/${exported.sha256.slice(0, 12)}`, pass: exported.rows === 4 && exported.sha256 === sha256(csvText) && exported.bytes === Buffer.byteLength(csvText, 'utf8') && csvOk },
      { req_id: 'RFQ-A15', metric: 'export path safety', threshold: 'traversal rejected', actual: pathCode, pass: pathCode === 'E_RFQ_PATH_INVALID' },
    ]

    let quickstartPass = true
    try {
      execFileSync(process.execPath, ['samples/quickstart/run.mjs', '--check'], { cwd: root, stdio: 'ignore' })
    } catch {
      quickstartPass = false
    }
    const quickstartHash = sha256(readFileSync(path.join(root, 'samples', 'quickstart', 'expected', 'result.json')))
    const quickstart = { req_id: 'PS1-QS01', metric: 'quickstart golden', threshold: '1/1', actual: quickstartPass ? '1' : '0', pass: quickstartPass, evidence_sha256: quickstartHash }

    const failures = metrics.filter((item) => !item.pass)
    for (const failure of failures) errors.push(`${failure.req_id} ${failure.metric}: ${failure.actual}`)
    if (!quickstartPass) errors.push('PS1-QS01 quickstart golden failed')

    const runId = `rfq-compare-${Date.now()}`
    const evidence = {
      run_id: runId,
      scope: 'RFQ-COMPARE-S1',
      status: failures.length === 0 && quickstartPass ? 'pass' : 'fail',
      counted: false,
      note: 'synthetic quotes only; no customer data, no network, FX is a documented placeholder',
      metrics,
      pass: failures.length === 0 && quickstartPass,
    }
    const evidenceDir = path.join(root, 'evidence', runId)
    mkdirSync(evidenceDir, { recursive: true })
    const evidenceJson = `${JSON.stringify(evidence, null, 2)}\n`
    writeFileSync(path.join(evidenceDir, 'result.json'), evidenceJson)
    const evidenceHash = sha256(evidenceJson)

    const rows = [
      ...metrics.map((item) => `${item.req_id},${item.metric},${item.threshold},${item.actual},scripts/acceptance.mjs,${evidenceHash},${item.pass},public/synthetic,false`),
      `${quickstart.req_id},${quickstart.metric},${quickstart.threshold},${quickstart.actual},samples/quickstart/run.mjs,${quickstart.evidence_sha256},${quickstart.pass},synthetic/quickstart,true`,
    ]
    writeFileSync(
      path.join(root, 'ACCEPTANCE.csv'),
      `req_id,metric,threshold,actual,script,evidence_sha256,pass,source,counted\n${rows.join('\n')}\n`,
    )

    if (errors.length > 0) {
      for (const error of errors) console.error(`acceptance: ${error}`)
      process.exit(1)
    }
    console.log(`acceptance ok: ${metrics.length + 1} checks`)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

await main()
