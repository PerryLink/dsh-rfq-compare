import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { RfqError } from '../core/errors.js'
import {
  compareQuotes,
  ingestQuotes,
  listQuotes,
  MemoryQuoteTable,
  parseQuotesCsv,
  toComparisonCsv,
  type BudgetInput,
  type CostLineInput,
  type QuoteInput,
  type QuoteTable,
} from '../core/rfq.js'
import { safeExportPath } from '../core/safe-path.js'

export interface ToolDeps {
  /** Local write root; the plugin uses `$DSH_HOME/dsh-rfq-compare`. */
  baseDir: string
  /** Optional table injection for tests or a host store. */
  table?: QuoteTable
  /** Optional clock (YYYY-MM-DD) so a caller can make the expiry check deterministic. */
  today?: () => string
}

const text = (value: string) => [{ type: 'text' as const, text: value }]
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

const quoteSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    quote_id: { type: 'string', required: true },
    supplier: { type: 'string', required: true },
    material: { type: 'string', required: true },
    qty: { type: 'number', required: true },
    unit_price_cents: { type: 'number', required: true },
    currency: { type: 'string', required: true },
    lead_time_days: { type: 'number', required: true },
    valid_until: { type: 'string', required: true },
    note: { type: 'string', required: true },
  },
} as const

const quoteViewSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    quote_id: { type: 'string', required: true },
    supplier: { type: 'string', required: true },
    qty: { type: 'number', required: true },
    unit_price_cents: { type: 'number', required: true },
    currency: { type: 'string', required: true },
    unit_price_cny_cents: { type: 'number', required: true },
    total_cents: { type: 'number', required: true },
    total_cny_cents: { type: 'number', required: true },
    lead_time_days: { type: 'number', required: true },
    valid_until: { type: 'string', required: true },
    note: { type: 'string', required: true },
    rank: { type: 'number', required: true },
    expired: { type: 'boolean', required: true },
    below_cost: { type: 'boolean', required: true },
  },
} as const

const belowCostSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    quote_id: { type: 'string', required: true },
    supplier: { type: 'string', required: true },
    unit_price_cny_cents: { type: 'number', required: true },
    cost_cents: { type: 'number', required: true },
    gap_cents: { type: 'number', required: true },
  },
} as const

const expiredSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    quote_id: { type: 'string', required: true },
    supplier: { type: 'string', required: true },
    valid_until: { type: 'string', required: true },
  },
} as const

const overBudgetSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        budget_cents: { type: 'number', required: true },
        lowest_total_cents: { type: 'number', required: true },
        gap_cents: { type: 'number', required: true },
      },
    },
    { type: 'null' },
  ],
} as const

const materialSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    material: { type: 'string', required: true },
    quote_count: { type: 'number', required: true },
    supplier_count: { type: 'number', required: true },
    quotes: { type: 'array', required: true, items: quoteViewSchema },
    lowest: { oneOf: [quoteViewSchema, { type: 'null' }], required: true },
    second_lowest: { oneOf: [quoteViewSchema, { type: 'null' }], required: true },
    price_spread_cents: { oneOf: [{ type: 'number' }, { type: 'null' }], required: true },
    price_spread_bp: { oneOf: [{ type: 'number' }, { type: 'null' }], required: true },
    lead_time_days: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: { min: { type: 'number', required: true }, max: { type: 'number', required: true } },
        },
        { type: 'null' },
      ],
      required: true,
    },
    cost_line_cents: { oneOf: [{ type: 'number' }, { type: 'null' }], required: true },
    budget_cents: { oneOf: [{ type: 'number' }, { type: 'null' }], required: true },
    anomalies: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        below_cost: { type: 'array', required: true, items: belowCostSchema },
        over_budget: { ...overBudgetSchema, required: true },
        expired: { type: 'array', required: true, items: expiredSchema },
      },
    },
  },
} as const

const compareOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    as_of: { type: 'string', required: true },
    fx: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        source: { type: 'string', required: true },
        base: { type: 'string', required: true },
        rates_bp: {
          type: 'object',
          additionalProperties: false,
          required: true,
          properties: {
            CNY: { type: 'number', required: true },
            USD: { type: 'number', required: true },
            EUR: { type: 'number', required: true },
          },
        },
        overridden: { type: 'array', required: true, items: { type: 'string' } },
        note: { type: 'string', required: true },
      },
    },
    summary: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        materials: { type: 'number', required: true },
        quotes: { type: 'number', required: true },
        suppliers: { type: 'number', required: true },
        currencies: { type: 'array', required: true, items: { type: 'string' } },
        below_cost: { type: 'number', required: true },
        over_budget: { type: 'number', required: true },
        expired: { type: 'number', required: true },
      },
    },
    materials: { type: 'array', required: true, items: materialSchema },
  },
} as const

const compareParameters = {
  as_of: { type: 'string', description: 'YYYY-MM-DD used for the quote-expiry check; defaults to today (UTC).' },
  cost_lines: {
    type: 'array',
    description: 'Cost line per material, in CNY cents per unit. A quote below it is flagged.',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        material: { type: 'string', required: true },
        unit_price_cents: { type: 'number', required: true },
      },
    },
  },
  budgets: {
    type: 'array',
    description: 'Budget per material, in CNY cents for the quoted quantity. A cheapest offer above it is flagged.',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        material: { type: 'string', required: true },
        amount_cents: { type: 'number', required: true },
      },
    },
  },
  fx_rates: {
    type: 'object',
    additionalProperties: true,
    description: 'Optional CNY per unit override, e.g. {"USD": 7.25}. Defaults to a documented placeholder.',
  },
} as const

export function createTools(deps: ToolDeps) {
  const table = deps.table ?? new MemoryQuoteTable()
  const today = deps.today ?? (() => new Date().toISOString().slice(0, 10))

  const ingest = defineTool({
    name: 'rfq.ingest',
    description:
      'Import supplier quotes from a CSV body and/or a JSON array. One material may have several suppliers; re-importing the same supplier+material replaces it. Amounts are integer cents; currency is CNY/USD/EUR; quantity must be a positive integer.',
    parameters: {
      csv_text: {
        type: 'string',
        description:
          'CSV with supplier,material,qty,unit_price_cents (or unit_price),currency,lead_time_days,valid_until[,note].',
      },
      quotes: {
        type: 'array',
        description: 'Quote objects; same fields as the CSV columns.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            supplier: { type: 'string', required: true },
            material: { type: 'string', required: true },
            qty: { type: 'number', required: true },
            unit_price_cents: { type: 'number', required: true },
            currency: { type: 'string', required: true },
            lead_time_days: { type: 'number', required: true },
            valid_until: { type: 'string', required: true },
            note: { type: 'string' },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          added: { type: 'number', required: true },
          updated: { type: 'number', required: true },
          total: { type: 'number', required: true },
          quotes: { type: 'array', required: true, items: quoteSchema },
        },
      },
      render: (_args, value) => text(`RFQ ingest: ${value.added} added, ${value.updated} updated, ${value.total} quote(s)`),
    },
    async execute(args) {
      const inputs: QuoteInput[] = []
      if (typeof args.csv_text === 'string' && args.csv_text.trim() !== '') inputs.push(...parseQuotesCsv(args.csv_text))
      if (Array.isArray(args.quotes)) inputs.push(...(args.quotes as QuoteInput[]))
      if (inputs.length === 0) throw new RfqError('E_RFQ_EMPTY', 'provide csv_text or quotes')
      return ingestQuotes(table, inputs)
    },
  })

  const compare = defineTool({
    name: 'rfq.compare',
    description:
      'Compare all stored quotes per material: lowest and second-lowest normalized unit price, spread, lead time, and three anomaly classes (below cost line, over budget, quote expired). FX uses a documented placeholder and can be overridden.',
    parameters: compareParameters,
    output: {
      schema: compareOutputSchema,
      render: (_args, value) =>
        text(
          `RFQ compare: ${value.summary.materials} material(s), ${value.summary.quotes} quote(s); anomalies below-cost ${value.summary.below_cost} / over-budget ${value.summary.over_budget} / expired ${value.summary.expired}`,
        ),
    },
    async execute(args) {
      const quotes = listQuotes(table)
      return compareQuotes(quotes, {
        as_of: args.as_of ?? today(),
        cost_lines: args.cost_lines as CostLineInput[] | undefined,
        budgets: args.budgets as BudgetInput[] | undefined,
        fx_rates: args.fx_rates as Record<string, number | string> | undefined,
      })
    },
  })

  const exportCsv = defineTool({
    name: 'rfq.export',
    description:
      'Export the per-material comparison as one CSV under $DSH_HOME/dsh-rfq-compare/exports; returns path, sha256, row/byte counts and the anomaly summary. Same options as rfq.compare.',
    parameters: {
      ...compareParameters,
      filename: { type: 'string', description: 'Safe single filename; defaults to rfq-compare-YYYYMMDD.csv.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          sha256: { type: 'string', required: true },
          rows: { type: 'number', required: true },
          bytes: { type: 'number', required: true },
          as_of: { type: 'string', required: true },
          materials: { type: 'number', required: true },
          below_cost: { type: 'number', required: true },
          over_budget: { type: 'number', required: true },
          expired: { type: 'number', required: true },
        },
      },
      render: (_args, value) => text(`CSV ${value.materials} material(s) -> ${value.path}`),
    },
    async execute(args) {
      const result = compareQuotes(listQuotes(table), {
        as_of: args.as_of ?? today(),
        cost_lines: args.cost_lines as CostLineInput[] | undefined,
        budgets: args.budgets as BudgetInput[] | undefined,
        fx_rates: args.fx_rates as Record<string, number | string> | undefined,
      })
      const csv = toComparisonCsv(result)
      const filename = args.filename ?? `rfq-compare-${result.as_of.replace(/-/g, '')}.csv`
      let filePath: string
      try {
        filePath = await safeExportPath(path.join(deps.baseDir, 'exports'), filename)
      } catch (error) {
        if (error instanceof RfqError) throw error
        throw new RfqError('E_RFQ_EXPORT_FAILED', String(error))
      }
      try {
        await writeFile(filePath, csv, 'utf8')
      } catch (error) {
        throw new RfqError('E_RFQ_EXPORT_FAILED', String(error))
      }
      return {
        path: filePath,
        sha256: sha256(csv),
        rows: result.materials.length,
        bytes: Buffer.byteLength(csv, 'utf8'),
        as_of: result.as_of,
        materials: result.summary.materials,
        below_cost: result.summary.below_cost,
        over_budget: result.summary.over_budget,
        expired: result.summary.expired,
      }
    },
  })

  return [ingest, compare, exportCsv]
}
