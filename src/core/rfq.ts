import { parseCsvRows, toCsv } from './csv.js'
import { RfqError } from './errors.js'

export const CURRENCIES = ['CNY', 'USD', 'EUR'] as const
export type Currency = (typeof CURRENCIES)[number]
const CURRENCY_SET = new Set<string>(CURRENCIES)

/**
 * Static conversion into CNY, in basis points (1 CNY = 10000 bp).
 *
 * This is a documented placeholder, not a live FX feed: the package never
 * fetches rates. Callers can override any currency through `fx_rates`.
 */
export const FX_PLACEHOLDER_BP: Record<Currency, number> = { CNY: 10000, USD: 72000, EUR: 78000 }
export const FX_NOTE =
  'Static placeholder rate (1 USD = 7.20 CNY, 1 EUR = 7.80 CNY), not live FX; override with fx_rates.'

/** A raw quote as supplied by the caller (CSV cells arrive as strings). */
export interface QuoteInput {
  supplier: string
  material: string
  qty: number | string
  unit_price_cents: number | string
  currency: string
  lead_time_days: number | string
  valid_until: string
  note?: string
}

export interface NormalizedQuote {
  supplier: string
  material: string
  qty: number
  unit_price_cents: number
  currency: Currency
  lead_time_days: number
  valid_until: string
  note: string
}

export interface Quote extends NormalizedQuote {
  quote_id: string
}

/** Minimal table contract so the plugin can run with an in-memory or host table. */
export interface QuoteTable {
  get(key: string): Quote | undefined
  entries(): IterableIterator<[string, Quote]>
  put(key: string, value: Quote): Promise<void> | void
  readonly size: number
}

export class MemoryQuoteTable implements QuoteTable {
  private readonly map = new Map<string, Quote>()
  get(key: string): Quote | undefined {
    return this.map.get(key)
  }
  entries(): IterableIterator<[string, Quote]> {
    return this.map.entries()
  }
  get size(): number {
    return this.map.size
  }
  put(key: string, value: Quote): void {
    this.map.set(key, value)
  }
}

export const quoteKey = (supplier: string, material: string): string => `${supplier}\u0000${material}`

const text = (value: unknown): string => {
  if (typeof value === 'string') return value.trim()
  if (value === undefined || value === null) return ''
  return String(value).trim()
}

function integer(value: unknown, code: 'E_RFQ_QTY' | 'E_RFQ_PRICE' | 'E_RFQ_LEAD_TIME', label: string): number {
  const candidate =
    typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value.trim()) : Number.NaN
  if (!Number.isInteger(candidate)) throw new RfqError(code, `${label}=${JSON.stringify(value)}`)
  return candidate
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** True only for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** Validate one quote and convert its strings to typed integer fields. */
export function normalizeQuote(raw: Partial<Record<keyof QuoteInput, unknown>>): NormalizedQuote {
  const supplier = text(raw.supplier)
  if (supplier === '') throw new RfqError('E_RFQ_ROW', 'supplier is empty')
  const material = text(raw.material)
  if (material === '') throw new RfqError('E_RFQ_MATERIAL', 'material is empty')

  const qty = integer(raw.qty, 'E_RFQ_QTY', 'qty')
  if (qty <= 0) throw new RfqError('E_RFQ_QTY', `qty=${qty}`)

  const unitPriceCents = integer(raw.unit_price_cents, 'E_RFQ_PRICE', 'unit_price_cents')
  if (unitPriceCents <= 0) throw new RfqError('E_RFQ_PRICE', `unit_price_cents=${unitPriceCents}`)

  const currency = text(raw.currency).toUpperCase()
  if (!CURRENCY_SET.has(currency)) throw new RfqError('E_RFQ_CURRENCY', `currency=${JSON.stringify(raw.currency)}`)

  const leadTimeDays = integer(raw.lead_time_days, 'E_RFQ_LEAD_TIME', 'lead_time_days')
  if (leadTimeDays < 0) throw new RfqError('E_RFQ_LEAD_TIME', `lead_time_days=${leadTimeDays}`)

  const validUntil = text(raw.valid_until)
  if (!isIsoDate(validUntil)) throw new RfqError('E_RFQ_DATE', `valid_until=${JSON.stringify(raw.valid_until)}`)

  return {
    supplier,
    material,
    qty,
    unit_price_cents: unitPriceCents,
    currency: currency as Currency,
    lead_time_days: leadTimeDays,
    valid_until: validUntil,
    note: text(raw.note),
  }
}

/**
 * Parse a quote CSV.
 *
 * Required header cells: `supplier,material,qty,currency,lead_time_days,valid_until`.
 * The unit price is read from `unit_price_cents` (integer cents, preferred) or
 * `unit_price` (major units, at most two decimals).
 */
export function parseQuotesCsv(csvText: string): QuoteInput[] {
  const rows = parseCsvRows(csvText)
  if (rows.length === 0) throw new RfqError('E_RFQ_EMPTY', 'the CSV is empty')
  if (rows.length < 2) throw new RfqError('E_RFQ_EMPTY', 'the CSV has a header but no data rows')

  const header = rows[0]!.map((cell) => cell.trim().toLowerCase())
  if (header.some((cell) => cell === '')) throw new RfqError('E_RFQ_CSV', 'empty column name in header')
  if (new Set(header).size !== header.length) throw new RfqError('E_RFQ_CSV', 'duplicate column name in header')

  const index = (name: string): number => header.indexOf(name)
  for (const required of ['supplier', 'material', 'qty', 'currency', 'lead_time_days', 'valid_until']) {
    if (index(required) < 0) throw new RfqError('E_RFQ_CSV', `missing required column: ${required}`)
  }
  const centsIndex = index('unit_price_cents')
  const majorIndex = index('unit_price')
  if (centsIndex < 0 && majorIndex < 0) {
    throw new RfqError('E_RFQ_CSV', 'missing required column: unit_price_cents (or unit_price)')
  }
  const noteIndex = index('note')

  const data = rows.slice(1).filter((cells) => cells.some((cell) => cell.trim() !== ''))
  if (data.length === 0) throw new RfqError('E_RFQ_EMPTY', 'the CSV has a header but no data rows')

  return data.map((cells, rowIndex) => {
    const line = rowIndex + 2
    if (cells.length > header.length) {
      throw new RfqError('E_RFQ_CSV', `row ${line} has ${cells.length} cells, the header has ${header.length}`)
    }
    const cell = (at: number): string => (at >= 0 ? (cells[at] ?? '').trim() : '')
    const unitPriceCents =
      centsIndex >= 0 ? cell(centsIndex) : majorToCents(cell(majorIndex), line)
    return {
      supplier: cell(index('supplier')),
      material: cell(index('material')),
      qty: cell(index('qty')),
      unit_price_cents: unitPriceCents,
      currency: cell(index('currency')),
      lead_time_days: cell(index('lead_time_days')),
      valid_until: cell(index('valid_until')),
      note: cell(noteIndex),
    }
  })
}

/** Convert a major-unit price (`12.34`) to integer cents (`"1234"`) without float rounding. */
function majorToCents(value: string, line: number): string {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim())
  if (!match) throw new RfqError('E_RFQ_PRICE', `row ${line} unit_price=${JSON.stringify(value)}`)
  const fraction = (match[2] ?? '').padEnd(2, '0')
  return String(Number(match[1]) * 100 + Number(fraction || '0'))
}

export interface IngestResult {
  added: number
  updated: number
  total: number
  quotes: Quote[]
}

/** Insert or replace quotes keyed by `supplier + material`. */
export async function ingestQuotes(table: QuoteTable, inputs: readonly QuoteInput[]): Promise<IngestResult> {
  if (!Array.isArray(inputs) || inputs.length === 0) throw new RfqError('E_RFQ_EMPTY', 'no quote rows to ingest')
  let added = 0
  let updated = 0
  let next = table.size + 1
  for (const raw of inputs) {
    const normalized = normalizeQuote(raw as Partial<Record<keyof QuoteInput, unknown>>)
    const key = quoteKey(normalized.supplier, normalized.material)
    const existing = table.get(key)
    const quote: Quote = { ...normalized, quote_id: existing?.quote_id ?? `Q${String(next).padStart(3, '0')}` }
    if (existing) updated += 1
    else {
      added += 1
      next += 1
    }
    await table.put(key, quote)
  }
  return { added, updated, total: table.size, quotes: listQuotes(table) }
}

/** All stored quotes in stable quote-id order. */
export function listQuotes(table: QuoteTable): Quote[] {
  return [...table.entries()].map(([, quote]) => quote).sort((left, right) => left.quote_id.localeCompare(right.quote_id))
}

export interface CostLineInput {
  material: string
  unit_price_cents: number | string
}

export interface BudgetInput {
  material: string
  amount_cents: number | string
}

export interface CompareOptions {
  /** YYYY-MM-DD used for the expiry check; defaults to today (UTC). */
  as_of?: string
  /** Cost line per material, in CNY cents per unit. */
  cost_lines?: CostLineInput[]
  /** Budget per material, in CNY cents for the quoted quantity. */
  budgets?: BudgetInput[]
  /** CNY per one unit of the currency, overriding the placeholder. */
  fx_rates?: Record<string, number | string>
}

export interface QuoteView {
  quote_id: string
  supplier: string
  qty: number
  unit_price_cents: number
  currency: Currency
  unit_price_cny_cents: number
  total_cents: number
  total_cny_cents: number
  lead_time_days: number
  valid_until: string
  note: string
  rank: number
  expired: boolean
  below_cost: boolean
}

export interface BelowCostAnomaly {
  quote_id: string
  supplier: string
  unit_price_cny_cents: number
  cost_cents: number
  gap_cents: number
}

export interface OverBudgetAnomaly {
  budget_cents: number
  lowest_total_cents: number
  gap_cents: number
}

export interface ExpiredAnomaly {
  quote_id: string
  supplier: string
  valid_until: string
}

export interface MaterialComparison {
  material: string
  quote_count: number
  supplier_count: number
  quotes: QuoteView[]
  lowest: QuoteView | null
  second_lowest: QuoteView | null
  price_spread_cents: number | null
  price_spread_bp: number | null
  lead_time_days: { min: number; max: number } | null
  cost_line_cents: number | null
  budget_cents: number | null
  anomalies: {
    below_cost: BelowCostAnomaly[]
    over_budget: OverBudgetAnomaly | null
    expired: ExpiredAnomaly[]
  }
}

export interface FxInfo {
  source: 'placeholder'
  base: 'CNY'
  rates_bp: Record<Currency, number>
  overridden: Currency[]
  note: string
}

export interface CompareSummary {
  materials: number
  quotes: number
  suppliers: number
  currencies: Currency[]
  below_cost: number
  over_budget: number
  expired: number
}

export interface CompareResult {
  as_of: string
  fx: FxInfo
  summary: CompareSummary
  materials: MaterialComparison[]
}

function normalizeCostLines(input: CostLineInput[] | undefined): Map<string, number> {
  const lines = new Map<string, number>()
  if (input === undefined) return lines
  if (!Array.isArray(input)) throw new RfqError('E_RFQ_PRICE', 'cost_lines must be an array')
  for (const [index, raw] of input.entries()) {
    const material = text(raw?.material)
    if (material === '') throw new RfqError('E_RFQ_MATERIAL', `cost_lines[${index}].material is empty`)
    const cents = integer(raw?.unit_price_cents, 'E_RFQ_PRICE', `cost_lines[${index}].unit_price_cents`)
    if (cents <= 0) throw new RfqError('E_RFQ_PRICE', `cost_lines[${index}].unit_price_cents=${cents}`)
    lines.set(material, cents)
  }
  return lines
}

function normalizeBudgets(input: BudgetInput[] | undefined): Map<string, number> {
  const budgets = new Map<string, number>()
  if (input === undefined) return budgets
  if (!Array.isArray(input)) throw new RfqError('E_RFQ_PRICE', 'budgets must be an array')
  for (const [index, raw] of input.entries()) {
    const material = text(raw?.material)
    if (material === '') throw new RfqError('E_RFQ_MATERIAL', `budgets[${index}].material is empty`)
    const cents = integer(raw?.amount_cents, 'E_RFQ_PRICE', `budgets[${index}].amount_cents`)
    if (cents < 0) throw new RfqError('E_RFQ_PRICE', `budgets[${index}].amount_cents=${cents}`)
    budgets.set(material, cents)
  }
  return budgets
}

function normalizeFx(input: CompareOptions['fx_rates']): { rates: Record<Currency, number>; overridden: Currency[] } {
  const rates: Record<Currency, number> = { ...FX_PLACEHOLDER_BP }
  const overridden: Currency[] = []
  if (input === undefined) return { rates, overridden }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new RfqError('E_RFQ_FX', 'fx_rates must be an object keyed by currency')
  }
  for (const [key, value] of Object.entries(input)) {
    const currency = text(key).toUpperCase()
    if (!CURRENCY_SET.has(currency)) throw new RfqError('E_RFQ_CURRENCY', `fx_rates.${key}`)
    const rate = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
    if (!Number.isFinite(rate) || rate <= 0) throw new RfqError('E_RFQ_FX', `fx_rates.${key}=${JSON.stringify(value)}`)
    rates[currency as Currency] = Math.round(rate * 10000)
    if (!overridden.includes(currency as Currency)) overridden.push(currency as Currency)
  }
  overridden.sort()
  return { rates, overridden }
}

/** Convert an amount in `currency` cents to CNY cents using basis-point rates. */
export function toCnyCents(amountCents: number, currency: Currency, ratesBp: Record<Currency, number>): number {
  return Math.round((amountCents * ratesBp[currency]) / 10000)
}

/** Compare all quotes per material and flag below-cost, over-budget and expired quotes. */
export function compareQuotes(quotes: readonly Quote[], options: CompareOptions = {}): CompareResult {
  if (!Array.isArray(quotes) || quotes.length === 0) throw new RfqError('E_RFQ_EMPTY', 'no quotes stored')
  const asOf = text(options.as_of) || new Date().toISOString().slice(0, 10)
  if (!isIsoDate(asOf)) throw new RfqError('E_RFQ_DATE', `as_of=${JSON.stringify(options.as_of)}`)
  const costLines = normalizeCostLines(options.cost_lines)
  const budgets = normalizeBudgets(options.budgets)
  const fx = normalizeFx(options.fx_rates)

  const byMaterial = new Map<string, Quote[]>()
  for (const quote of quotes) {
    const list = byMaterial.get(quote.material) ?? []
    list.push(quote)
    byMaterial.set(quote.material, list)
  }

  const materials: MaterialComparison[] = []
  for (const material of [...byMaterial.keys()].sort((left, right) => left.localeCompare(right))) {
    const cost = costLines.get(material)
    const budget = budgets.get(material)
    const views: QuoteView[] = byMaterial
      .get(material)!
      .map((quote) => {
        const unitPriceCny = toCnyCents(quote.unit_price_cents, quote.currency, fx.rates)
        return {
          quote_id: quote.quote_id,
          supplier: quote.supplier,
          qty: quote.qty,
          unit_price_cents: quote.unit_price_cents,
          currency: quote.currency,
          unit_price_cny_cents: unitPriceCny,
          total_cents: quote.qty * quote.unit_price_cents,
          total_cny_cents: quote.qty * unitPriceCny,
          lead_time_days: quote.lead_time_days,
          valid_until: quote.valid_until,
          note: quote.note,
          rank: 0,
          expired: quote.valid_until < asOf,
          below_cost: cost !== undefined && unitPriceCny < cost,
        }
      })
      .sort(
        (left, right) =>
          left.unit_price_cny_cents - right.unit_price_cny_cents ||
          left.lead_time_days - right.lead_time_days ||
          left.supplier.localeCompare(right.supplier) ||
          left.quote_id.localeCompare(right.quote_id),
      )
    views.forEach((view, index) => {
      view.rank = index + 1
    })

    const lowest = views[0] ?? null
    const second = views[1] ?? null
    const spread = lowest && second ? second.unit_price_cny_cents - lowest.unit_price_cny_cents : null
    const leadTimes = views.map((view) => view.lead_time_days)
    const belowCost = views
      .filter((view) => view.below_cost)
      .map((view) => ({
        quote_id: view.quote_id,
        supplier: view.supplier,
        unit_price_cny_cents: view.unit_price_cny_cents,
        cost_cents: cost!,
        gap_cents: cost! - view.unit_price_cny_cents,
      }))
    const expired = views
      .filter((view) => view.expired)
      .map((view) => ({ quote_id: view.quote_id, supplier: view.supplier, valid_until: view.valid_until }))
    const overBudget =
      budget !== undefined && lowest !== null && lowest.total_cny_cents > budget
        ? { budget_cents: budget, lowest_total_cents: lowest.total_cny_cents, gap_cents: lowest.total_cny_cents - budget }
        : null

    materials.push({
      material,
      quote_count: views.length,
      supplier_count: new Set(views.map((view) => view.supplier)).size,
      quotes: views,
      lowest,
      second_lowest: second,
      price_spread_cents: spread,
      price_spread_bp: spread !== null && lowest ? Math.round((spread * 10000) / lowest.unit_price_cny_cents) : null,
      lead_time_days: leadTimes.length > 0 ? { min: Math.min(...leadTimes), max: Math.max(...leadTimes) } : null,
      cost_line_cents: cost ?? null,
      budget_cents: budget ?? null,
      anomalies: { below_cost: belowCost, over_budget: overBudget, expired },
    })
  }

  const suppliers = new Set(quotes.map((quote) => quote.supplier))
  const currencies = [...new Set(quotes.map((quote) => quote.currency))].sort() as Currency[]
  return {
    as_of: asOf,
    fx: { source: 'placeholder', base: 'CNY', rates_bp: fx.rates, overridden: fx.overridden, note: FX_NOTE },
    summary: {
      materials: materials.length,
      quotes: quotes.length,
      suppliers: suppliers.size,
      currencies,
      below_cost: materials.reduce((total, item) => total + item.anomalies.below_cost.length, 0),
      over_budget: materials.filter((item) => item.anomalies.over_budget !== null).length,
      expired: materials.reduce((total, item) => total + item.anomalies.expired.length, 0),
    },
    materials,
  }
}

export const COMPARISON_CSV_HEADER = [
  'material',
  'quote_count',
  'supplier_count',
  'lowest_quote_id',
  'lowest_supplier',
  'lowest_unit_price_cents',
  'lowest_currency',
  'lowest_unit_price_cny_cents',
  'lowest_total_cny_cents',
  'second_quote_id',
  'second_supplier',
  'second_unit_price_cents',
  'second_currency',
  'second_unit_price_cny_cents',
  'price_spread_cents',
  'price_spread_bp',
  'lead_time_min_days',
  'lead_time_max_days',
  'cost_line_cents',
  'below_cost_count',
  'budget_cents',
  'over_budget',
  'expired_count',
] as const

/** One CSV row per material; all money columns are integer cents in CNY unless a currency column says otherwise. */
export function toComparisonCsv(result: CompareResult): string {
  const rows = result.materials.map((item) => {
    const lowest = item.lowest!
    const second = item.second_lowest
    return [
      item.material,
      String(item.quote_count),
      String(item.supplier_count),
      lowest.quote_id,
      lowest.supplier,
      String(lowest.unit_price_cents),
      lowest.currency,
      String(lowest.unit_price_cny_cents),
      String(lowest.total_cny_cents),
      second?.quote_id ?? '',
      second?.supplier ?? '',
      second ? String(second.unit_price_cents) : '',
      second?.currency ?? '',
      second ? String(second.unit_price_cny_cents) : '',
      item.price_spread_cents === null ? '' : String(item.price_spread_cents),
      item.price_spread_bp === null ? '' : String(item.price_spread_bp),
      item.lead_time_days ? String(item.lead_time_days.min) : '',
      item.lead_time_days ? String(item.lead_time_days.max) : '',
      item.cost_line_cents === null ? '' : String(item.cost_line_cents),
      String(item.anomalies.below_cost.length),
      item.budget_cents === null ? '' : String(item.budget_cents),
      item.anomalies.over_budget ? 'true' : 'false',
      String(item.anomalies.expired.length),
    ]
  })
  return toCsv([[...COMPARISON_CSV_HEADER], ...rows])
}
