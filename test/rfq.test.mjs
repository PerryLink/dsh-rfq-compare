import test from 'node:test'
import assert from 'node:assert/strict'
import {
  compareQuotes,
  ingestQuotes,
  MemoryQuoteTable,
  normalizeQuote,
  parseQuotesCsv,
  toComparisonCsv,
  toCnyCents,
} from '../lib/core/rfq.js'

const base = {
  material: 'MAT-1',
  qty: 10,
  unit_price_cents: 10000,
  currency: 'CNY',
  lead_time_days: 7,
  valid_until: '2026-12-31',
  note: '',
}

const view = (quote_id, supplier, unit_price_cents, extra = {}) => ({
  ...base,
  quote_id,
  supplier,
  unit_price_cents,
  ...extra,
})

test('normalizeQuote converts CSV strings into typed integer fields', () => {
  const quote = normalizeQuote({ ...base, supplier: ' DEMO-A ', qty: '10', unit_price_cents: '1234', currency: 'usd' })
  assert.deepEqual(quote, {
    supplier: 'DEMO-A',
    material: 'MAT-1',
    qty: 10,
    unit_price_cents: 1234,
    currency: 'USD',
    lead_time_days: 7,
    valid_until: '2026-12-31',
    note: '',
  })
})

test('an unsupported currency fails with E_RFQ_CURRENCY', () => {
  assert.throws(() => normalizeQuote({ ...base, supplier: 'A', currency: 'GBP' }), /E_RFQ_CURRENCY/)
})

test('qty must be a positive integer (E_RFQ_QTY)', () => {
  for (const qty of [0, -1, 1.5, '0', '', 'abc']) {
    assert.throws(() => normalizeQuote({ ...base, supplier: 'A', qty }), /E_RFQ_QTY/, `qty=${qty}`)
  }
})

test('an empty CSV or a header-only CSV fails with E_RFQ_EMPTY', () => {
  assert.throws(() => parseQuotesCsv(''), /E_RFQ_EMPTY/)
  assert.throws(() => parseQuotesCsv('supplier,material,qty,unit_price_cents,currency,lead_time_days,valid_until\n'), /E_RFQ_EMPTY/)
})

test('unit price must be positive integer cents; unit_price accepts at most two decimals', () => {
  for (const unit_price_cents of [0, -1, 12.5, 'abc']) {
    assert.throws(() => normalizeQuote({ ...base, supplier: 'A', unit_price_cents }), /E_RFQ_PRICE/, String(unit_price_cents))
  }
  const cents = parseQuotesCsv(
    'supplier,material,qty,unit_price,currency,lead_time_days,valid_until\nDEMO-A,MAT-1,10,12.34,CNY,7,2026-12-31\n',
  )
  assert.equal(cents[0].unit_price_cents, '1234')
  assert.throws(
    () => parseQuotesCsv('supplier,material,qty,unit_price,currency,lead_time_days,valid_until\nDEMO-A,MAT-1,10,12.345,CNY,7,2026-12-31\n'),
    /E_RFQ_PRICE/,
  )
})

test('valid_until must be a real calendar date (E_RFQ_DATE)', () => {
  assert.throws(() => normalizeQuote({ ...base, supplier: 'A', valid_until: '2026-02-30' }), /E_RFQ_DATE/)
  assert.throws(() => normalizeQuote({ ...base, supplier: 'A', valid_until: '2026/12/31' }), /E_RFQ_DATE/)
})

test('parseQuotesCsv is case-insensitive, honours quoted notes and keeps empty notes', () => {
  const rows = parseQuotesCsv(
    [
      'Supplier,Material,Qty,Unit_Price_Cents,Currency,Lead_Time_Days,Valid_Until,Note',
      'DEMO-A,MAT-1,10,1234,CNY,7,2026-12-31,"price, locked"',
      'DEMO-B,MAT-1,10,1200,usd,9,2026-12-30,',
    ].join('\n'),
  )
  assert.equal(rows.length, 2)
  assert.equal(rows[0].note, 'price, locked')
  assert.equal(rows[1].currency, 'usd')
  assert.equal(rows[1].note, '')
})

test('a header missing a required column fails with E_RFQ_CSV', () => {
  assert.throws(() => parseQuotesCsv('supplier,material,qty\nDEMO-A,MAT-1,10\n'), /E_RFQ_CSV/)
  assert.throws(() => parseQuotesCsv('supplier,material,qty,currency,lead_time_days,valid_until\nDEMO-A,MAT-1,10,CNY,7,2026-12-31\n'), /E_RFQ_CSV/)
})

test('ingest replaces the same supplier+material and keeps different suppliers', async () => {
  const table = new MemoryQuoteTable()
  const first = await ingestQuotes(table, [
    { ...base, supplier: 'DEMO-A', unit_price_cents: 10000 },
    { ...base, supplier: 'DEMO-B', unit_price_cents: 11000 },
    { ...base, supplier: 'DEMO-C', unit_price_cents: 12000 },
  ])
  assert.deepEqual({ added: first.added, updated: first.updated, total: first.total }, { added: 3, updated: 0, total: 3 })

  const second = await ingestQuotes(table, [{ ...base, supplier: 'DEMO-B', unit_price_cents: 9000 }])
  assert.deepEqual({ added: second.added, updated: second.updated, total: second.total }, { added: 0, updated: 1, total: 3 })
  const b = second.quotes.find((quote) => quote.supplier === 'DEMO-B')
  assert.equal(b.unit_price_cents, 9000)
  assert.equal(b.quote_id, 'Q002')
})

test('compare ranks quotes, computes the spread and the lead-time range', () => {
  const quotes = [
    view('Q001', 'DEMO-A', 125000, { lead_time_days: 14 }),
    view('Q002', 'DEMO-B', 123840, { lead_time_days: 21 }),
    view('Q003', 'DEMO-C', 131000, { lead_time_days: 10 }),
  ]
  const result = compareQuotes(quotes, { as_of: '2026-11-02' })
  const material = result.materials[0]
  assert.equal(material.lowest.quote_id, 'Q002')
  assert.equal(material.second_lowest.quote_id, 'Q001')
  assert.deepEqual(material.quotes.map((quote) => quote.rank), [1, 2, 3])
  assert.equal(material.price_spread_cents, 1160)
  assert.equal(material.price_spread_bp, 94)
  assert.deepEqual(material.lead_time_days, { min: 10, max: 21 })
  assert.equal(material.quote_count, 3)
  assert.equal(material.supplier_count, 3)
})

test('placeholder FX converts USD and EUR to CNY with rounded integer cents', () => {
  assert.equal(toCnyCents(17200, 'USD', { CNY: 10000, USD: 72000, EUR: 78000 }), 123840)
  assert.equal(toCnyCents(11250, 'EUR', { CNY: 10000, USD: 72000, EUR: 78000 }), 87750)
  const result = compareQuotes([
    view('Q001', 'DEMO-A', 100000, { currency: 'CNY' }),
    view('Q002', 'DEMO-B', 10000, { currency: 'USD' }),
    view('Q003', 'DEMO-C', 10000, { currency: 'EUR' }),
  ], { as_of: '2026-11-02' })
  assert.equal(result.materials[0].lowest.quote_id, 'Q002')
  assert.equal(result.materials[0].lowest.unit_price_cny_cents, 72000)
  assert.equal(result.materials[0].second_lowest.unit_price_cny_cents, 78000)
})

test('compare flags below-cost, over-budget and expired quotes', () => {
  const result = compareQuotes(
    [
      view('Q001', 'DEMO-A', 10000, { valid_until: '2026-01-01' }),
      view('Q002', 'DEMO-B', 12000),
      view('Q003', 'DEMO-C', 9000, { qty: 1 }),
    ],
    {
      as_of: '2026-11-02',
      cost_lines: [{ material: 'MAT-1', unit_price_cents: 9500 }],
      budgets: [{ material: 'MAT-1', amount_cents: 8000 }],
    },
  )
  const material = result.materials[0]
  assert.equal(material.cost_line_cents, 9500)
  assert.equal(material.budget_cents, 8000)
  assert.deepEqual(material.anomalies.below_cost.map((item) => item.quote_id), ['Q003'])
  assert.equal(material.anomalies.below_cost[0].gap_cents, 500)
  assert.deepEqual(material.anomalies.expired.map((item) => item.quote_id), ['Q001'])
  assert.deepEqual(material.anomalies.over_budget, { budget_cents: 8000, lowest_total_cents: 9000, gap_cents: 1000 })
  assert.equal(result.summary.below_cost, 1)
  assert.equal(result.summary.over_budget, 1)
  assert.equal(result.summary.expired, 1)
})

test('a quote expiring exactly on as_of is not expired', () => {
  const result = compareQuotes([view('Q001', 'DEMO-A', 10000, { valid_until: '2026-11-02' })], { as_of: '2026-11-02' })
  assert.deepEqual(result.materials[0].anomalies.expired, [])
})

test('fx_rates can override the placeholder and invalid rates fail', () => {
  const result = compareQuotes([view('Q001', 'DEMO-A', 10000, { currency: 'USD' })], {
    as_of: '2026-11-02',
    fx_rates: { USD: 7.25 },
  })
  assert.equal(result.materials[0].lowest.unit_price_cny_cents, 72500)
  assert.deepEqual(result.fx.overridden, ['USD'])
  assert.throws(() => compareQuotes([view('Q001', 'A', 10000)], { fx_rates: { USD: 0 } }), /E_RFQ_FX/)
  assert.throws(() => compareQuotes([view('Q001', 'A', 10000)], { fx_rates: { GBP: 9 } }), /E_RFQ_CURRENCY/)
})

test('compare fails with E_RFQ_EMPTY when nothing was ingested', () => {
  assert.throws(() => compareQuotes([], { as_of: '2026-11-02' }), /E_RFQ_EMPTY/)
})

test('cost lines and budgets must reference a material', () => {
  assert.throws(() => compareQuotes([view('Q001', 'A', 10000)], { cost_lines: [{ material: '', unit_price_cents: 1 }] }), /E_RFQ_MATERIAL/)
  assert.throws(() => compareQuotes([view('Q001', 'A', 10000)], { budgets: [{ material: '', amount_cents: 1 }] }), /E_RFQ_MATERIAL/)
})

test('toComparisonCsv writes one row per material with blank nullable columns', () => {
  const result = compareQuotes([view('Q001', 'DEMO-A', 10000)], { as_of: '2026-11-02' })
  const csv = toComparisonCsv(result)
  const lines = csv.trim().split('\n')
  assert.equal(lines.length, 2)
  assert.match(lines[0], /^material,quote_count,supplier_count,lowest_quote_id/)
  const cells = lines[1].split(',')
  assert.equal(cells.length, 23)
  assert.deepEqual(cells.slice(0, 9), ['MAT-1', '1', '1', 'Q001', 'DEMO-A', '10000', 'CNY', '10000', '100000'])
  assert.deepEqual(cells.slice(9, 16), ['', '', '', '', '', '', ''])
  assert.deepEqual(cells.slice(16, 18), ['7', '7'])
  assert.equal(cells[18], '')
  assert.equal(cells[19], '0')
  assert.equal(cells[20], '')
  assert.equal(cells[21], 'false')
  assert.equal(cells[22], '0')
})

test('toCnyCents rounds half away from zero on a fractional cent', () => {
  assert.equal(toCnyCents(1, 'USD', { CNY: 10000, USD: 72000, EUR: 78000 }), 7)
  assert.equal(toCnyCents(5, 'USD', { CNY: 10000, USD: 72000, EUR: 78000 }), 36)
})
