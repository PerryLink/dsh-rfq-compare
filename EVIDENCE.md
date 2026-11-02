# Evidence — dsh-rfq-compare 0.1.0-alpha.1

All runs are local, over synthetic quotes. No customer data, no network call, no model call.
No `git commit` and no `npm publish` were performed.

## Environment

- Node `v24.22.1`
- pnpm `11.28.5`
- TypeScript `7.0.2` (NodeNext, strict)
- Runtime dependencies: none (host-provided `@deepseek-ai/dsh-tools` / `@deepseek-ai/cordis`)
- Date: 2026-11-02 (Asia/Shanghai)

## Commands and results

| Command | Result |
|---|---|
| `pnpm build` | exit 0, `tsc -p tsconfig.json` emits `lib/` |
| `pnpm typecheck` | exit 0 |
| `node --test test/*.test.mjs` | 36 tests, 36 pass, 0 fail |
| `node samples/quickstart/run.mjs --check` | golden `expected/result.json` matches |
| `node scripts/gate.mjs` | lint ok, acceptance ok, 16/16 acceptance rows pass |
| `npm pack --dry-run --json` | 32 files, no publish |

## Local Package Standard v1 score

The package is intentionally **not** added to `04-build/dsh-plugins/family.json` (not in the
committed roster yet, so the roster does not count it). To verify the standard locally, the
official `04-build/dsh-plugins/scripts/score-packages.mjs` was copied to a temporary root with a
one-item family entry, pointed at the real `04-build` build tree, and run:

```
PS1 scores: 1 packages | green 1 / yellow 0 / red 0
domain packages: 1, avg 10.0
  10 green  dsh-rfq-compare
page=1 sample=2 prompt=1 expected=1 permissions=2 errors=1 evidence=2  total=10
gate 8: ok
```

Every scored category is non-zero; the score is 10/10 against the same rules the family uses.

## Screenshot / golden hashes

| Artifact | SHA-256 |
|---|---|
| `docs/assets/quickstart.png` | `f6f55d41cc492e14c40f638d600379c6285ee1b69a57203e9643e8402b98a32c` |
| `docs/assets/quickstart.log` | `756d7a8f910e8ac2042fece61bdc42ee466167f99def5f597a1ca751953a94e6` |
| `samples/quickstart/expected/result.json` | `4bb1bae8eabf94582fa1908c087fbe1a9dd9ca552567c54b733375d3a977fd0f` |
| `ACCEPTANCE.csv` quickstart row | uses the `expected/result.json` hash above |

The screenshot was rendered by `04-build/dsh-plugins/scripts/render-capture.py` from the real
captured terminal output in `docs/assets/quickstart.log`; no output text was invented.

## Error-path coverage

- `E_RFQ_EMPTY` — empty CSV, header-only CSV, or compare/export on an empty quote table.
- `E_RFQ_CSV` — missing/duplicate header, extra cells, unterminated quote.
- `E_RFQ_ROW` / `E_RFQ_MATERIAL` — empty supplier or material.
- `E_RFQ_QTY` — zero, negative, fractional or non-numeric quantity.
- `E_RFQ_PRICE` — zero/negative/fractional cents, or more than two decimals in `unit_price`.
- `E_RFQ_CURRENCY` — anything other than `CNY` / `USD` / `EUR` (including `fx_rates` keys).
- `E_RFQ_LEAD_TIME` — negative or fractional lead time.
- `E_RFQ_DATE` — impossible or non-`YYYY-MM-DD` date (`as_of` too).
- `E_RFQ_FX` — non-positive or non-numeric FX override.
- `E_RFQ_PATH_INVALID` / `E_RFQ_PATH_NOT_ALLOWED` — unsafe export filename or path escape.
- `E_RFQ_EXPORT_FAILED` — local CSV write failure.
