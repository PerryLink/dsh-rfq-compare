import test from 'node:test'
import assert from 'node:assert/strict'
import { csvField, parseCsvRows, toCsv } from '../lib/core/csv.js'

test('csvField leaves plain fields alone and quotes commas, quotes and newlines', () => {
  assert.equal(csvField('plain'), 'plain')
  assert.equal(csvField('DEMO-SUP-A'), 'DEMO-SUP-A')
  assert.equal(csvField('price, locked'), '"price, locked"')
  assert.equal(csvField('Q1 "units"'), '"Q1 ""units"""')
  assert.equal(csvField('line1\nline2'), '"line1\nline2"')
  assert.equal(csvField('a\r\nb'), '"a\r\nb"')
})

test('toCsv joins rows with newlines and keeps a trailing newline', () => {
  assert.equal(toCsv([]), '')
  assert.equal(toCsv([['a', 'b'], ['price, locked', 'Q1 "units"']]), 'a,b\n"price, locked","Q1 ""units"""\n')
})

test('parseCsvRows handles quoted commas, doubled quotes, CRLF and embedded newlines', () => {
  const rows = parseCsvRows('a,b\r\n"price, locked","Q1 ""units"""\r\n"line1\nline2",tail\r\n')
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['price, locked', 'Q1 "units"'],
    ['line1\nline2', 'tail'],
  ])
})

test('parseCsvRows strips a BOM and drops blank rows', () => {
  const rows = parseCsvRows('\uFEFFsupplier,material\n\nDEMO-A,MAT-1\n,\n')
  assert.deepEqual(rows, [
    ['supplier', 'material'],
    ['DEMO-A', 'MAT-1'],
  ])
})

test('parseCsvRows rejects an unterminated quote with E_RFQ_CSV', () => {
  assert.throws(() => parseCsvRows('a,b\n"unterminated,2\n'), /E_RFQ_CSV/)
})
