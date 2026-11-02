import { RfqError } from './errors.js'

/** RFC 4180 field escaping: quote on comma, quote, CR or LF and double embedded quotes. */
const CSV_NEEDS_QUOTES = /[",\r\n]/

export function csvField(value: string): string {
  return CSV_NEEDS_QUOTES.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** Build a CRLF-free UTF-8 CSV body with a trailing newline; empty input yields an empty string. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  if (rows.length === 0) return ''
  return `${rows.map((row) => row.map(csvField).join(',')).join('\n')}\n`
}

/**
 * Parse an RFC 4180 CSV body into rows of cells.
 *
 * Handles quoted commas, doubled quotes, CRLF/LF and embedded newlines. A BOM is
 * stripped, blank rows are dropped, and an unterminated quote fails with
 * `E_RFQ_CSV` instead of silently truncating the file.
 */
export function parseCsvRows(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let index = 0

  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }

  while (index < source.length) {
    const character = source[index]!
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"'
          index += 2
          continue
        }
        quoted = false
        index += 1
        continue
      }
      field += character
      index += 1
      continue
    }
    if (character === '"') {
      if (field.trim() !== '') throw new RfqError('E_RFQ_CSV', `unexpected quote after ${JSON.stringify(field)}`)
      field = ''
      quoted = true
      index += 1
      continue
    }
    if (character === ',') {
      endField()
      index += 1
      continue
    }
    if (character === '\r' || character === '\n') {
      if (character === '\r' && source[index + 1] === '\n') index += 1
      endRow()
      index += 1
      continue
    }
    field += character
    index += 1
  }

  if (quoted) throw new RfqError('E_RFQ_CSV', 'unterminated quoted field')
  endField()
  rows.push(row)
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''))
}
