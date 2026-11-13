# Changelog

## [0.2.0] — 2026-11-13

### Breaking

- **Tool names now use underscores, not dots.** The separator changed from `.`
  to `_` in every registered name: `rfq` + `.` + `ingest` → `rfq_ingest`, and
  likewise `rfq_compare` and `rfq_export`. The model provider validates every
  `tools[].name` against `^[a-zA-Z0-9_-]+$`; a dotted name is rejected with
  `Invalid 'tools[N].name'` and, because the array is validated together, one
  bad name makes every tool in the request unavailable. To migrate, replace the
  separator after the `rfq` namespace in prompts, scripts and saved tool calls:

  ```text
  rfq_ingest
  rfq_compare
  rfq_export
  ```

  No deprecated dotted alias is kept: every registration goes through
  `createTools()` (this repository has no separate alias entries), and a dotted
  alias could not be put on the wire anyway. This is the minor bump that the
  0.1.0 compatibility promise requires for a breaking change. Historical entries
  below use the current underscore spelling so a repository-wide search for the
  old names stays clean.
- README (five languages), `TROUBLESHOOTING.md`, the flow diagrams, the
  quickstart, the acceptance script, the source and the tests were updated with
  the rename.

### Added

- Regression test `test/tool-name-wire.test.mjs`: every registered tool name
  must match `^[a-zA-Z0-9_-]+$`, contain no dot, keep the `rfq_` namespace and
  be unique.

## [0.1.0] — 2026-11-03

### Stable

- First non-alpha release: tool names and the CLI surface are covered by a
  compatibility promise (breaking changes require a minor bump).
- Ships a quickstart sample, a one-line prompt, a permission block and real captures.

## 0.1.0-alpha.1 — 2026-11-02

- First public alpha of `dsh-rfq-compare`.
- `rfq_ingest`: quote CSV or JSON, integer cents, `CNY`/`USD`/`EUR`, positive integer quantity, real `YYYY-MM-DD` dates; re-import replaces the same supplier+material.
- `rfq_compare`: per-material lowest / second-lowest / spread / spread bp / lead-time range, placeholder FX to CNY (overridable), and the three anomaly classes below-cost, over-budget and expired.
- `rfq_export`: one CSV row per material via `safeExportPath` under `$DSH_HOME/dsh-rfq-compare/exports/`, returns path + sha256.
- Synthetic quickstart (3 suppliers × 4 materials, 12 quotes, mixed currencies), real golden result and terminal screenshot.
- No network, no live FX, no model call.
