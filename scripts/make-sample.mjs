#!/usr/bin/env node
/**
 * Generate the synthetic quickstart quote CSV and its cost/budget assumptions.
 *
 * The sample is exactly 3 suppliers x 4 materials (12 quotes). It is intentionally
 * mixed-currency so the placeholder FX conversion and the three anomaly classes are
 * all exercised by a real run; no customer data is involved.
 *
 *   node scripts/make-sample.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { toCsv } from '../lib/core/csv.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(here, '..')
const inputDir = path.join(packageRoot, 'samples', 'quickstart', 'input')

/** All quotes: [supplier, material, qty, unit_price_cents, currency, lead_time_days, valid_until, note]. */
export const QUOTES = [
  ['DEMO-SUP-A', 'MAT-1001', 100, 125000, 'CNY', 14, '2026-12-31', 'annual frame price, CNY'],
  ['DEMO-SUP-B', 'MAT-1001', 100, 17200, 'USD', 21, '2026-12-15', 'USD quote, locked Q4'],
  ['DEMO-SUP-C', 'MAT-1001', 100, 131000, 'CNY', 10, '2026-11-30', 'stock available'],
  ['DEMO-SUP-A', 'MAT-1002', 20, 8600, 'CNY', 18, '2026-12-20', ''],
  ['DEMO-SUP-B', 'MAT-1002', 20, 8450, 'CNY', 25, '2026-10-25', 'expired price list'],
  ['DEMO-SUP-C', 'MAT-1002', 20, 11250, 'EUR', 30, '2026-12-10', 'EUR quote'],
  ['DEMO-SUP-A', 'MAT-1003', 2, 248000, 'CNY', 45, '2026-12-31', ''],
  ['DEMO-SUP-B', 'MAT-1003', 2, 255000, 'CNY', 40, '2026-12-31', 'includes commissioning'],
  ['DEMO-SUP-C', 'MAT-1003', 2, 241500, 'CNY', 60, '2026-11-15', 'below cost line'],
  ['DEMO-SUP-A', 'MAT-1004', 50, 33000, 'CNY', 12, '2026-12-31', ''],
  ['DEMO-SUP-B', 'MAT-1004', 50, 34200, 'CNY', 9, '2026-12-31', 'fast delivery'],
  ['DEMO-SUP-C', 'MAT-1004', 50, 4280, 'EUR', 20, '2026-10-15', 'expired EUR quote'],
]

/** Cost line and budget inputs used by the quickstart compare (CNY cents). */
export const ASSUMPTIONS = {
  note: 'Synthetic cost lines and budgets for the quickstart only; CNY cents, not customer data.',
  as_of: '2026-11-02',
  cost_lines: [
    { material: 'MAT-1001', unit_price_cents: 124000 },
    { material: 'MAT-1002', unit_price_cents: 8000 },
    { material: 'MAT-1003', unit_price_cents: 242000 },
    { material: 'MAT-1004', unit_price_cents: 32000 },
  ],
  budgets: [
    { material: 'MAT-1001', amount_cents: 12500000 },
    { material: 'MAT-1002', amount_cents: 180000 },
    { material: 'MAT-1003', amount_cents: 470000 },
    { material: 'MAT-1004', amount_cents: 1600000 },
  ],
}

const csv = toCsv([
  ['supplier', 'material', 'qty', 'unit_price_cents', 'currency', 'lead_time_days', 'valid_until', 'note'],
  ...QUOTES.map((row) => row.map(String)),
])

await mkdir(inputDir, { recursive: true })
await writeFile(path.join(inputDir, 'quotes.csv'), csv, 'utf8')
await writeFile(path.join(inputDir, 'assumptions.json'), `${JSON.stringify(ASSUMPTIONS, null, 2)}\n`, 'utf8')
console.log(`wrote samples/quickstart/input/quotes.csv (${QUOTES.length} quotes)`)
console.log('wrote samples/quickstart/input/assumptions.json')
