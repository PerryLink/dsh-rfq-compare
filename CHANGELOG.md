# Changelog

## [0.1.0] — 2026-11-03

### Stable

- First non-alpha release: tool names and the CLI surface are covered by a
  compatibility promise (breaking changes require a minor bump).
- Ships a quickstart sample, a one-line prompt, a permission block and real captures.

## 0.1.0-alpha.1 — 2026-11-02

- First public alpha of `dsh-rfq-compare`.
- `rfq.ingest`: quote CSV or JSON, integer cents, `CNY`/`USD`/`EUR`, positive integer quantity, real `YYYY-MM-DD` dates; re-import replaces the same supplier+material.
- `rfq.compare`: per-material lowest / second-lowest / spread / spread bp / lead-time range, placeholder FX to CNY (overridable), and the three anomaly classes below-cost, over-budget and expired.
- `rfq.export`: one CSV row per material via `safeExportPath` under `$DSH_HOME/dsh-rfq-compare/exports/`, returns path + sha256.
- Synthetic quickstart (3 suppliers × 4 materials, 12 quotes, mixed currencies), real golden result and terminal screenshot.
- No network, no live FX, no model call.
