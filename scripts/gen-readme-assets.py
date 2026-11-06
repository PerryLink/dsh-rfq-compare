#!/usr/bin/env python3
"""Generate README image assets for dsh-rfq-compare (docs/assets/).

Outputs (idempotent overwrite):
  dsh-rfq-compare-flow-light.svg / dsh-rfq-compare-flow-dark.svg
      Hero pipeline diagram. Two hand-written SVG files (vector — never
      rasterized to webp). Text inside is command-surface tokens only
      (quotes.csv, rfq.ingest, rfq.compare, rfq.export, R0/R1, sha256), so
      all five README languages share the same pair.

No evidence chart: this repository has no benchmark/RESULTS.md — its public
evidence is fixture-backed acceptance rows (ACCEPTANCE.csv, samples/quickstart/)
plus the captured terminal output in docs/assets/quickstart.png, which is
not measured benchmark data, so the playbook's measured-data bar chart is
intentionally not produced here. Pillow and the CJK font probe stay wired so
that a raster asset can be added the day real measured data lands: the probe
aborts loudly instead of rendering Chinese as tofu boxes.

Run once:  python scripts/gen-readme-assets.py
Requires:  Pillow (bundled runtime already has it)
"""
from __future__ import annotations

import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets")

# --- palette: PerryLink family (accent) + GitHub page backgrounds ----------
FAMILY = "#4B67B4"   # family accent (badges labelColor family uses #2B3245)
GREEN = {"light": "#16a34a", "dark": "#3fb950"}
ORANGE = {"light": "#bc4c00", "dark": "#d29922"}
SKIN = {
    "light": dict(bg="#ffffff", box="#f6f8fa", border="#d0d7de",
                  text="#1f2328", sub="#57606a", track="#eaeef2"),
    "dark": dict(bg="#0d1117", box="#161b22", border="#30363d",
                 text="#f0f6fc", sub="#8b949e", track="#21262d"),
}
WEBP_QUALITY = 90  # family standard, kept for a future measured-data chart

# --- CJK font probe: Chinese must never render as tofu boxes ----------------
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",      # Microsoft YaHei
    r"C:\Windows\Fonts\simhei.ttf",    # SimHei
    r"C:\Windows\Fonts\Deng.ttf",      # DengXian
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/System/Library/Fonts/PingFang.ttc",
]
FONT_PATH = next((p for p in FONT_CANDIDATES if os.path.exists(p)), None)


def probe_cjk_font() -> str:
    """Hard requirement for any CJK raster text; abort instead of tofu."""
    if FONT_PATH is None:
        sys.exit("FATAL: no CJK font found (looked for msyh.ttc, simhei.ttf, "
                 "Deng.ttf, Noto Sans CJK, PingFang). Refusing to render "
                 "Chinese as tofu boxes; install one of the probed fonts and "
                 "re-run.")
    return FONT_PATH


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(probe_cjk_font(), size)


# ---------------------------------------------------------------------------
# Hero pipeline SVG (light + dark) — tokens only, no natural-language prose
# ---------------------------------------------------------------------------
FLOW_NODES = [
    ("quotes.csv", "supplier · material"),
    ("rfq.ingest", "integer cents · R0"),
    ("rfq.compare", "lowest / 2nd / spread"),
    ("rfq.export", "CSV + sha256 · R1"),
    ("exports/", "$DSH_HOME · local"),
]
NODE_ACCENT = ["border", "family", "family", "border", "green"]


def flow_svg(skin: str) -> str:
    s = SKIN[skin]
    w, h = 1200, 420
    nw, nh, gap = 180, 96, 45
    y0 = 150
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
        f'viewBox="0 0 {w} {h}" role="img" '
        f'aria-label="dsh-rfq-compare pipeline">',
        '<title>dsh-rfq-compare pipeline</title>',
        f'<rect width="{w}" height="{h}" rx="18" fill="{s["bg"]}"/>',
        f'<text x="60" y="62" fill="{s["text"]}" font-family="ui-sans-serif,'
        f'system-ui,sans-serif" font-size="30" font-weight="700">'
        f'dsh-rfq-compare</text>',
        f'<text x="60" y="94" fill="{s["sub"]}" font-family="ui-monospace,'
        f'monospace" font-size="16">quotes in → integer cents → per-material '
        f'compare → CSV out</text>',
        f'<line x1="60" y1="116" x2="1140" y2="116" stroke="{s["border"]}"/>',
    ]
    for i, (label, sub) in enumerate(FLOW_NODES):
        x = 60 + i * (nw + gap)
        kind = NODE_ACCENT[i]
        accent = {"border": s["border"], "family": FAMILY,
                  "green": GREEN[skin]}[kind]
        parts.append(
            f'<rect x="{x}" y="{y0}" width="{nw}" height="{nh}" rx="14" '
            f'fill="{s["box"]}" stroke="{accent}" stroke-width="2"/>')
        parts.append(
            f'<text x="{x + nw // 2}" y="{y0 + 40}" fill="{s["text"]}" '
            f'text-anchor="middle" font-family="ui-monospace,monospace" '
            f'font-size="16" font-weight="700">{label}</text>')
        parts.append(
            f'<text x="{x + nw // 2}" y="{y0 + 68}" fill="{s["sub"]}" '
            f'text-anchor="middle" font-family="ui-monospace,monospace" '
            f'font-size="12">{sub}</text>')
        if i < len(FLOW_NODES) - 1:
            ax = x + nw + 6
            ay = y0 + nh // 2
            parts.append(
                f'<path d="M{ax} {ay}h{gap - 12}" stroke="{s["sub"]}" '
                f'stroke-width="3"/>')
            parts.append(
                f'<path d="M{ax + gap - 14} {ay - 7}l10 7-10 7" fill="none" '
                f'stroke="{s["sub"]}" stroke-width="3" '
                f'stroke-linecap="round" stroke-linejoin="round"/>')
    # anomaly flags band under the compare node
    bx, bw, by, bh = 285, 630, 285, 52
    cx = 60 + 2 * (nw + gap) + nw // 2
    parts.append(
        f'<path d="M{cx} {y0 + nh}v{by - y0 - nh}" '
        f'stroke="{ORANGE[skin]}" stroke-width="2" stroke-dasharray="5 5"/>')
    parts.append(
        f'<rect x="{bx}" y="{by}" width="{bw}" height="{bh}" rx="12" '
        f'fill="{s["box"]}" stroke="{ORANGE[skin]}" stroke-width="2"/>')
    parts.append(
        f'<text x="{bx + bw // 2}" y="{by + 33}" fill="{s["text"]}" '
        f'text-anchor="middle" font-family="ui-monospace,monospace" '
        f'font-size="14">anomalies: below cost · over budget · expired · '
        f'advisory only</text>')
    parts.append(
        f'<text x="60" y="378" fill="{s["sub"]}" font-family="ui-monospace,'
        f'monospace" font-size="13">no network · no model call · FX rates = '
        f'documented placeholder · input file stays read-only</text>')
    parts.append('</svg>')
    return "\n".join(parts) + "\n"


def main() -> None:
    probe_cjk_font()
    os.makedirs(OUT, exist_ok=True)
    for skin in ("light", "dark"):
        with open(os.path.join(OUT, f"dsh-rfq-compare-flow-{skin}.svg"),
                  "w", encoding="utf-8", newline="\n") as fh:
            fh.write(flow_svg(skin))
    print("wrote 2 SVG assets to docs/assets/ (no evidence chart: no "
          "benchmark data in this repo)")


if __name__ == "__main__":
    main()
