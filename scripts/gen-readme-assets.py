#!/usr/bin/env python3
"""Generate the README assets for dsh-rfq-compare.

Outputs (idempotent overwrite) under docs/assets/:

  dsh-rfq-compare-hero-{zh,en}-{light,dark}.webp   1440x576 raster hero
  dsh-rfq-compare-flow-v5-{light,dark}.svg         1100x660 vector diagram

The hero is drawn with Pillow: a supply-side quote scoreboard (mixed currencies
normalised to CNY cents, ranked per material, three advisory flags). The flow is
a hand-written SVG with the same data model as the quickstart golden:
CSV + JSON channels -> integer cents -> material x supplier score matrix ->
advisory boundary -> local CSV receipt with sha256. No invented values.

Run once:  python scripts/gen-readme-assets.py
Requires:  Pillow (the bundled runtime already has it), Microsoft YaHei,
           Consolas on Windows (probed, not silently substituted).
"""
from __future__ import annotations

import os
import sys
import xml.sax.saxutils as sax

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets")

W, H = 1440, 576
RADIUS = 22

FONT_REG = r"C:\Windows\Fonts\msyh.ttc"
FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_MONO = r"C:\Windows\Fonts\consola.ttf"
FONT_MONO_BOLD = r"C:\Windows\Fonts\consolab.ttf"

FONT_SANS = "Microsoft YaHei, Segoe UI, Noto Sans CJK SC, sans-serif"
FONT_CODE = "Consolas, SFMono-Regular, Menlo, Microsoft YaHei, monospace"


# ---------------------------------------------------------------------------
# palette
# ---------------------------------------------------------------------------
THEMES = {
    "light": dict(
        bg1="#f9f6fd", bg2="#e4eaf8",
        panel="#ffffff", panel_a=238,
        card="#ffffff", card2="#f6f8ff", card3="#eef2fb",
        text="#1b2133", sub="#5f6a84", faint="#8d97ad",
        border="#e2e7f4", border2="#d6ddf0",
        family="#4B67B4", family_soft="#edf1fc", family_deep="#334a91",
        green="#168a4a", green_soft="#eaf7ef",
        orange="#bc4c00", orange_soft="#fdf0e7",
        red="#c93c3c", red_soft="#fbecec",
        gold="#c9a24a", silver="#9aa6bd", bronze="#b07a4a",
        shadow="#1f2a4a", shadow_a=32, edge="#ffffff",
        dot="#4B67B4", dot_a=18, track="#e8ecf6",
    ),
    "dark": dict(
        bg1="#131a2a", bg2="#0c1016",
        panel="#1a2237", panel_a=244,
        card="#1a2237", card2="#151d30", card3="#222c46",
        text="#f2f5ff", sub="#a8b3d0", faint="#7f8ba8",
        border="#2b3654", border2="#39466c",
        family="#8496f5", family_soft="#22305a", family_deep="#aab9ff",
        green="#3fb950", green_soft="#16351f",
        orange="#d29922", orange_soft="#332712",
        red="#f85149", red_soft="#3a1d1d",
        gold="#dfb45e", silver="#aab5ca", bronze="#c08a5a",
        shadow="#000000", shadow_a=120, edge="#2b3654",
        dot="#8496f5", dot_a=24, track="#27324e",
    ),
}


def rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def rgba(value: str, alpha: int) -> tuple[int, int, int, int]:
    return (*rgb(value), alpha)


def mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))  # type: ignore[return-value]


def blend(fg: str, bg: str, alpha: float) -> str:
    """Opaque pre-blend; ImageDraw alpha fills would be flattened by putalpha()."""
    r, g, b = mix(rgb(bg), rgb(fg), alpha)
    return f"#{r:02x}{g:02x}{b:02x}"


_FONT_CACHE: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    key = (path, size)
    if key not in _FONT_CACHE:
        _FONT_CACHE[key] = ImageFont.truetype(path, size)
    return _FONT_CACHE[key]


def probe_fonts() -> None:
    missing = [p for p in (FONT_REG, FONT_BOLD, FONT_MONO, FONT_MONO_BOLD) if not os.path.exists(p)]
    if missing:
        sys.exit("FATAL: missing required font(s): " + ", ".join(missing))


def text_width(f: ImageFont.FreeTypeFont, value: str) -> float:
    return float(f.getlength(value))


def fit_common(lines: list[str], path: str, start: int, max_w: int, min_size: int) -> ImageFont.FreeTypeFont:
    size = start
    while size > min_size:
        f = font(path, size)
        if all(text_width(f, line) <= max_w for line in lines):
            return f
        size -= 1
    return font(path, min_size)


def draw_tracked(d: ImageDraw.ImageDraw, xy: tuple[float, float], value: str,
                 f: ImageFont.FreeTypeFont, fill: str, spacing: float) -> float:
    x, y = xy
    for ch in value:
        d.text((x, y), ch, font=f, fill=fill, anchor="ls")
        x += text_width(f, ch) + spacing
    return x


def pill(d: ImageDraw.ImageDraw, x: float, y: float, text: str,
         f: ImageFont.FreeTypeFont, fg: str, bg: tuple[int, int, int, int],
         border: str | None = None, padx: int = 12, h: int = 30,
         right: bool = False) -> float:
    w = text_width(f, text) + 2 * padx
    if right:
        x -= w
    d.rounded_rectangle((x, y, x + w, y + h), radius=h / 2,
                        fill=bg, outline=border, width=1)
    d.text((x + padx, y + h / 2 + 1), text, font=f, fill=fg, anchor="lm")
    return w


def flag_pill(d: ImageDraw.ImageDraw, x: float, y: float, text: str,
              f: ImageFont.FreeTypeFont, color: str, base: str, border: str,
              muted: str, active: bool) -> float:
    w = text_width(f, text) + 30
    h = 32
    if active:
        fill = blend(color, base, 0.12)
        outline = color
        fg = color
    else:
        fill = base
        outline = border
        fg = muted
    d.rounded_rectangle((x, y, x + w, y + h), radius=h / 2,
                        fill=fill, outline=outline, width=1)
    d.ellipse((x + 11, y + h / 2 - 3, x + 17, y + h / 2 + 3), fill=color)
    d.text((x + 22, y + h / 2 + 1), text, font=f, fill=fg, anchor="lm")
    return w


def add_shadow(base: Image.Image, box: tuple[int, int, int, int], radius: int,
               color: str, alpha: int, dy: int, blur: int) -> None:
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = box
    d.rounded_rectangle((x0, y0 + dy, x1, y1 + dy), radius=radius,
                        fill=rgba(color, alpha))
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    base.alpha_composite(layer)


def background(skin: str) -> Image.Image:
    th = THEMES[skin]
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c0, c1 = rgb(th["bg1"]), rgb(th["bg2"])
    for y in range(H):
        d.line((0, y, W, y), fill=(*mix(c0, c1, y / (H - 1)), 255))

    # soft family glows
    glow = Image.new("L", (W, H), 0)
    gd = ImageDraw.Draw(glow)
    gd.ellipse((720, -220, 1560, 440), fill=130)
    gd.ellipse((-220, 300, 520, 820), fill=95)
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    tint = Image.new("RGBA", (W, H), (*rgb(th["family"]), 255))
    tint.putalpha(glow.point(lambda p: int(p * 0.26)))
    img.alpha_composite(tint)

    # dot grid
    dots = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dd = ImageDraw.Draw(dots)
    dot_rgb = rgb(th["dot"])
    for yy in range(18, H, 26):
        for xx in range(18, W, 26):
            dd.ellipse((xx, yy, xx + 2, yy + 2), fill=(*dot_rgb, th["dot_a"]))
    img.alpha_composite(dots)

    # faint orbital ring
    d.ellipse((1210, -100, 1550, 240), outline=rgba(th["family"], 26), width=1)
    return img


# ---------------------------------------------------------------------------
# hero
# ---------------------------------------------------------------------------
HERO_ROWS = [
    dict(rank=1, qid="Q002", supplier="DEMO-SUP-B", cur="USD",
         unit=17200, cny=123840, lead=21, flag="below cost"),
    dict(rank=2, qid="Q001", supplier="DEMO-SUP-A", cur="CNY",
         unit=125000, cny=125000, lead=14, flag=""),
    dict(rank=3, qid="Q003", supplier="DEMO-SUP-C", cur="CNY",
         unit=131000, cny=131000, lead=10, flag=""),
]


def money(cents: int) -> str:
    return f"¥{cents / 100:,.2f}"


def major(cents: int) -> str:
    return f"{cents / 100:,.2f}"


def draw_hero_left(d: ImageDraw.ImageDraw, th: dict, lang: str) -> None:
    zh = lang == "zh"
    d.rounded_rectangle((52, 74, 57, 178), radius=2.5, fill=th["family"])
    kicker = "DSH 插件 · 询价比价" if zh else "DSH PLUGIN · RFQ COMPARE"
    draw_tracked(d, (72, 94), kicker, font(FONT_BOLD, 19), th["family"], 2.2)

    title_parts = [("dsh-", th["text"]), ("rfq-compare", th["family"])]
    size = 84
    while size > 64:
        f = font(FONT_BOLD, size)
        if sum(text_width(f, part) for part, _ in title_parts) <= 700:
            break
        size -= 1
    tf = font(FONT_BOLD, size)
    x = 72
    for part, color in title_parts:
        d.text((x, 204), part, font=tf, fill=color, anchor="ls")
        x += text_width(tf, part)

    if zh:
        value_lines = ["谁最低、差多少、交期多久；", "哪条低于成本、超预算或已经过期。"]
        sub_lines = ["多币种报价折算为整数分、按物料排名，", "导出带 sha256 的复核 CSV；不联网、不调用模型。"]
        meta = ["R0 只读 · R1 本地写", "3 个工具", "整数分"]
        footer = "v0.1.0 · Apache-2.0 · 36 项测试 · DeepSeek Harness 插件"
    else:
        value_lines = ["Who is cheapest, by how much, how fast;",
                       "which quote is below cost, over budget or expired."]
        sub_lines = ["Integer cents, per-material ranking, a reviewable CSV —",
                     "no network, no model call, no upload."]
        meta = ["R0 read · R1 local write", "3 tools", "integer cents"]
        footer = "v0.1.0 · Apache-2.0 · 36 tests · DeepSeek Harness plugin"

    vf = fit_common(value_lines, FONT_REG, 30 if zh else 27, 704, 22)
    for i, line in enumerate(value_lines):
        d.text((72, 276 + i * 42), line, font=vf, fill=th["text"], anchor="ls")

    sf = fit_common(sub_lines, FONT_REG, 25, 704, 20)
    for i, line in enumerate(sub_lines):
        d.text((72, 366 + i * 31), line, font=sf, fill=th["sub"], anchor="ls")

    mf = font(FONT_REG, 20)
    mx = 72.0
    for i, label in enumerate(meta):
        if i == 0:
            w = pill(d, mx, 424, label, mf, th["family"], rgba(th["family_soft"], 255),
                     rgba(th["border2"], 255), padx=14, h=36)
        elif i == 1:
            w = pill(d, mx, 424, label, mf, th["sub"], th["card2"],
                     rgba(th["border"], 255), padx=14, h=36)
        else:
            w = pill(d, mx, 424, label, mf, th["sub"], rgba(th["card3"], 255),
                     rgba(th["border"], 255), padx=14, h=36)
        mx += w + 10

    d.line((72, 488, 720, 488), fill=rgba(th["border2"], 255), width=1)
    d.ellipse((72, 518, 79, 525), fill=th["green"])
    d.text((90, 528), footer, font=font(FONT_REG, 20), fill=th["sub"], anchor="ls")


def draw_hero_panel(img: Image.Image, d: ImageDraw.ImageDraw, th: dict, lang: str) -> None:
    zh = lang == "zh"
    px0, py0, px1, py1 = 792, 56, 1368, 520
    add_shadow(img, (px0, py0, px1, py1), RADIUS, th["shadow"], th["shadow_a"], 12, 28)
    d.rounded_rectangle((px0, py0, px1, py1), radius=RADIUS,
                        fill=th["panel"],
                        outline=th["border"], width=1)

    label = "报价记分台 · 合成样例" if zh else "QUOTE SCOREBOARD · SYNTHETIC SAMPLE"
    draw_tracked(d, (818, 90), label, font(FONT_BOLD, 13.5), th["family"], 1.2)

    asof = "as_of 2026-11-02"
    pill(d, 1342, 76, asof, font(FONT_MONO, 13.5), th["sub"],
         rgba(th["card3"], 255), rgba(th["border2"], 255), padx=11, h=28, right=True)

    d.text((818, 130), "MAT-1001", font=font(FONT_MONO_BOLD, 36),
           fill=th["text"], anchor="ls")
    sub = ("3 条报价 · CNY + USD · 占位汇率 7.20" if zh
           else "3 quotes · CNY + USD · FX placeholder 7.20")
    d.text((818, 152), sub, font=font(FONT_REG, 15.5), fill=th["sub"], anchor="ls")
    d.line((818, 164, 1342, 164), fill=rgba(th["border2"], 255), width=1)

    medals = {1: th["gold"], 2: th["silver"], 3: th["bronze"]}
    for i, row in enumerate(HERO_ROWS):
        y0 = 172 + i * 66
        is_first = row["rank"] == 1
        fill = th["family_soft"] if is_first else th["card2"]
        outline = blend(th["family"], th["panel"], 0.35) if is_first else th["border"]
        d.rounded_rectangle((818, y0, 1342, y0 + 56), radius=14,
                            fill=fill, outline=outline, width=1)

        cx, cy = 836, y0 + 28
        d.ellipse((cx - 12, cy - 12, cx + 12, cy + 12), fill=medals[row["rank"]])
        d.text((cx, cy - 1), str(row["rank"]), font=font(FONT_BOLD, 13),
               fill="#ffffff", anchor="mm")

        d.text((862, y0 + 24), row["supplier"], font=font(FONT_BOLD, 18),
               fill=th["text"], anchor="ls")
        d.text((862, y0 + 43),
               f'{row["qid"]} · {row["cur"]} {major(row["unit"])}',
               font=font(FONT_MONO, 13.5), fill=th["sub"], anchor="ls")

        tx0, tx1, ty = 1056, 1196, y0 + 27
        d.rounded_rectangle((tx0, ty, tx1, ty + 5), radius=2.5,
                            fill=rgba(th["track"], 255))
        ratio = (row["cny"] - 121000) / (132000 - 121000)
        ratio = max(0.08, min(1.0, ratio))
        end = tx0 + (tx1 - tx0) * ratio
        d.rounded_rectangle((tx0, ty, end, ty + 5), radius=2.5,
                            fill=th["family"] if is_first else th["sub"])
        d.ellipse((end - 3, ty - 1, end + 3, ty + 6),
                  fill=th["family"] if is_first else th["sub"])

        d.text((1332, y0 + 26), money(row["cny"]), font=font(FONT_BOLD, 21),
               fill=th["text"], anchor="rs")
        d.text((1332, y0 + 44), f'{row["cny"]:,} 分', font=font(FONT_MONO, 13.5),
               fill=th["sub"], anchor="rs")

    # spread strip
    d.rounded_rectangle((818, 372, 1342, 406), radius=12,
                        fill=rgba(th["family_soft"], 255),
                        outline=rgba(th["border2"], 255), width=1)
    d.text((832, 394), "价差" if zh else "spread", font=font(FONT_BOLD, 13.5),
           fill=th["family"], anchor="ls")
    d.text((888 if zh else 900, 394),
           "1,160 分 · 94 bp" if zh else "1,160 c · 94 bp",
           font=font(FONT_BOLD, 18), fill=th["text"], anchor="ls")
    d.text((1332, 394), "交期 10–21 天" if zh else "lead 10–21 d",
           font=font(FONT_REG, 13.5), fill=th["sub"], anchor="rs")

    # advisory flags
    d.text((832, 442), "异常" if zh else "FLAGS", font=font(FONT_BOLD, 13.5),
           fill=th["sub"], anchor="ls")
    labels = (["低于成本线 1", "超预算 0", "已过期 0"] if zh
              else ["below cost 1", "over budget 0", "expired 0"])
    colors = [th["orange"], th["family"], th["red"]]
    fx = 884.0
    for i, label in enumerate(labels):
        w = flag_pill(d, fx, 424, label, font(FONT_REG, 13.5), colors[i],
                      th["panel"], th["border2"], th["sub"], active=(i == 0))
        fx += w + 8
    d.text((1332, 442), "只标记 · 不淘汰" if zh else "advisory only",
           font=font(FONT_REG, 12.5), fill=th["sub"], anchor="rs")

    # local artifact receipt
    d.rounded_rectangle((818, 466, 1342, 506), radius=12,
                        fill=rgba(th["card3"], 255),
                        outline=rgba(th["border"], 255), width=1)
    d.rounded_rectangle((830, 476, 864, 500), radius=12, fill=th["green"])
    d.text((847, 489), "R1", font=font(FONT_MONO_BOLD, 11.5),
           fill="#ffffff", anchor="mm")
    d.text((874, 488), "rfq.export → exports/rfq-compare.csv",
           font=font(FONT_MONO, 12), fill=th["text"], anchor="ls")
    d.text((874, 502), "4 rows · 895 B · sha256 14862e9b…",
           font=font(FONT_MONO, 11.5), fill=th["sub"], anchor="ls")


def build_hero(skin: str, lang: str) -> Image.Image:
    th = THEMES[skin]
    img = background(skin)
    d = ImageDraw.Draw(img)
    draw_hero_left(d, th, lang)
    draw_hero_panel(img, d, th, lang)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((1, 1, W - 2, H - 2), radius=RADIUS,
                        outline=th["border"], width=1)

    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, W - 1, H - 1),
                                           radius=RADIUS, fill=255)
    img.putalpha(mask)
    return img


# ---------------------------------------------------------------------------
# flow SVG (hand-written, shared by all README languages)
# ---------------------------------------------------------------------------
FLOW_PAL = {
    "light": dict(
        bg1="#f9f6fd", bg2="#e4eaf8",
        panel="#ffffff", card="#ffffff", card2="#f4f7ff", card3="#eef2fb",
        text="#1b2133", sub="#5c6883", faint="#8b95ab",
        border="#dfe5f4", border2="#d3dbee", grid="#e5eaf6",
        family="#4B67B4", family_soft="#edf1fc", family_deep="#334a91",
        green="#168a4a", green_soft="#eaf7ef",
        orange="#bc4c00", orange_soft="#fdf0e7",
        red="#c93c3c", red_soft="#fbecec",
        dot="#4B67B4", dot_op=".14",
        shadow="#1f2a4a", shadow_op=".10",
    ),
    "dark": dict(
        bg1="#131a2a", bg2="#0c1016",
        panel="#151d2e", card="#182136", card2="#1e2942", card3="#222c46",
        text="#f2f5ff", sub="#a7b2cf", faint="#7e89a6",
        border="#2c3858", border2="#39466c", grid="#27324e",
        family="#8496f5", family_soft="#22305a", family_deep="#aab9ff",
        green="#3fb950", green_soft="#16351f",
        orange="#d29922", orange_soft="#332712",
        red="#f85149", red_soft="#3a1d1d",
        dot="#8496f5", dot_op=".18",
        shadow="#000000", shadow_op=".45",
    ),
}


def esc(value: str) -> str:
    return sax.escape(value, {"'": "&apos;", '"': "&quot;"})


def svg_text(x: float, y: float, value: str, size: float, fill: str,
             weight: int = 400, family: str = "sans", anchor: str = "start",
             spacing: float = 0, opacity: float = 1.0) -> str:
    fam = FONT_SANS if family == "sans" else FONT_CODE
    extra = f' letter-spacing="{spacing}"' if spacing else ""
    op = f' opacity="{opacity}"' if opacity != 1.0 else ""
    return (f'<text x="{x}" y="{y}" fill="{fill}" font-family="{fam}" '
            f'font-size="{size}" font-weight="{weight}" text-anchor="{anchor}"'
            f'{extra}{op}>{esc(value)}</text>')


def svg_rect(x: float, y: float, w: float, h: float, fill: str,
             stroke: str | None = None, rx: float = 18, sw: float = 1,
             opacity: float = 1.0, filt: str | None = None) -> str:
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}"']
    if stroke:
        out.append(f' stroke="{stroke}" stroke-width="{sw}"')
    if opacity != 1.0:
        out.append(f' opacity="{opacity}"')
    if filt:
        out.append(f' filter="url(#{filt})"')
    out.append("/>")
    return "".join(out)


def svg_line(x1: float, y1: float, x2: float, y2: float, color: str,
             width: float = 1, dash: str | None = None, opacity: float = 1.0) -> str:
    extra = f' stroke-dasharray="{dash}"' if dash else ""
    op = f' opacity="{opacity}"' if opacity != 1.0 else ""
    return (f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
            f'stroke="{color}" stroke-width="{width}"{extra}{op}/>')


def svg_path(d: str, color: str, width: float = 1.6,
             dash: str | None = None, arrow: bool = True,
             opacity: float = 1.0) -> str:
    extra = f' stroke-dasharray="{dash}"' if dash else ""
    mark = ' marker-end="url(#arrow)"' if arrow else ""
    op = f' opacity="{opacity}"' if opacity != 1.0 else ""
    return (f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}"'
            f' stroke-linecap="round" stroke-linejoin="round"{extra}{mark}{op}/>')


def svg_dot(x: float, y: float, r: float, color: str, opacity: float = 1.0) -> str:
    op = f' opacity="{opacity}"' if opacity != 1.0 else ""
    return f'<circle cx="{x}" cy="{y}" r="{r}" fill="{color}"{op}/>'


FLOW_ROWS = [
    dict(material="MAT-1001", quotes=3,
         cells=[("Q001", "CNY", 125000, 2), ("Q002", "USD", 123840, 1), ("Q003", "CNY", 131000, 3)],
         spread="1,160", bp="94 bp"),
    dict(material="MAT-1002", quotes=3,
         cells=[("Q004", "CNY", 8600, 2), ("Q005", "CNY", 8450, 1), ("Q006", "EUR", 87750, 3)],
         spread="150", bp="178 bp"),
    dict(material="MAT-1003", quotes=3,
         cells=[("Q007", "CNY", 248000, 2), ("Q008", "CNY", 255000, 3), ("Q009", "CNY", 241500, 1)],
         spread="6,500", bp="269 bp"),
    dict(material="MAT-1004", quotes=3,
         cells=[("Q010", "CNY", 33000, 1), ("Q011", "CNY", 34200, 3), ("Q012", "EUR", 33384, 2)],
         spread="384", bp="116 bp"),
]

FLOW_FLAGS = [
    ("MAT-1001", [("orange", "below cost")]),
    ("MAT-1002", [("red", "expired")]),
    ("MAT-1003", [("orange", "below cost"), ("family", "over budget")]),
    ("MAT-1004", [("family", "over budget"), ("red", "expired")]),
]


def flow_svg(skin: str) -> str:
    p = FLOW_PAL[skin]
    parts: list[str] = []
    parts.append('<?xml version="1.0" encoding="UTF-8"?>')
    parts.append(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="660" '
        'viewBox="0 0 1100 660" role="img" '
        'aria-label="dsh-rfq-compare comparison chain">')
    parts.append('<title>dsh-rfq-compare comparison chain</title>')
    parts.append(
        '<desc>CSV and JSON quotes enter rfq.ingest, normalize to integer cents, '
        'rank into a material by supplier score matrix, carry three advisory '
        'anomaly flags, then rfq.export writes a local CSV with sha256.</desc>')
    parts.append('<defs>')
    parts.append(
        f'<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{p["bg1"]}"/>'
        f'<stop offset="1" stop-color="{p["bg2"]}"/></linearGradient>')
    parts.append(
        f'<radialGradient id="glow" cx="85%" cy="8%" r="75%">'
        f'<stop offset="0" stop-color="{p["family"]}" stop-opacity=".16"/>'
        f'<stop offset="1" stop-color="{p["family"]}" stop-opacity="0"/>'
        f'</radialGradient>')
    parts.append(
        f'<pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse">'
        f'<circle cx="1.4" cy="1.4" r="1.2" fill="{p["dot"]}" opacity="{p["dot_op"]}"/>'
        f'</pattern>')
    parts.append(
        f'<filter id="soft" x="-25%" y="-25%" width="150%" height="160%">'
        f'<feDropShadow dx="0" dy="7" stdDeviation="11" flood-color="{p["shadow"]}" '
        f'flood-opacity="{p["shadow_op"]}"/></filter>')
    parts.append(
        f'<marker id="arrow" viewBox="0 0 10 10" refX="8.5" refY="5" '
        f'markerWidth="7" markerHeight="7" orient="auto">'
        f'<path d="M0 0 L10 5 L0 10 z" fill="{p["sub"]}"/></marker>')
    parts.append('</defs>')

    # background
    parts.append('<rect width="1100" height="660" rx="22" fill="url(#bg)"/>')
    parts.append('<rect width="1100" height="660" rx="22" fill="url(#glow)"/>')
    parts.append('<rect width="1100" height="660" rx="22" fill="url(#dots)"/>')

    # header
    parts.append(svg_text(44, 42, "DSH PLUGIN · RFQ COMPARE", 11.5,
                          p["family"], 700, spacing=1.7))
    parts.append(
        f'<text x="44" y="82" fill="{p["text"]}" font-family="{FONT_CODE}" '
        f'font-size="28" font-weight="700">dsh-<tspan fill="{p["family"]}">'
        f'rfq-compare</tspan></text>')
    parts.append(svg_text(
        44, 108,
        "quotes CSV / JSON  →  integer cents  →  material score matrix  →  local CSV receipt",
        13, p["sub"]))
    # header pills
    parts.append(svg_rect(820, 24, 104, 24, p["card"], p["border"], rx=12, sw=1))
    parts.append(svg_dot(832, 36, 3, p["green"]))
    parts.append(svg_text(841, 40, "NO NETWORK", 11, p["green"], 700, "mono"))
    parts.append(svg_rect(932, 24, 124, 24, p["card"], p["border"], rx=12, sw=1))
    parts.append(svg_dot(944, 36, 3, p["family"]))
    parts.append(svg_text(953, 40, "FX PLACEHOLDER", 11, p["family"], 700, "mono"))
    parts.append(svg_line(44, 124, 1056, 124, p["border2"]))

    # section labels
    parts.append(svg_text(44, 166, "INPUT", 11, p["family"], 700, spacing=1.2))
    parts.append(svg_text(318, 166, "TOOLS", 11, p["family"], 700, spacing=1.2))
    parts.append(svg_text(858, 166, "OUTPUT", 11, p["family"], 700, spacing=1.2))

    # input channels
    parts.append(svg_rect(44, 178, 256, 106, p["card"], p["border"], rx=18, sw=1))
    parts.append(svg_text(62, 212, "quotes.csv", 16, p["text"], 700, "mono"))
    parts.append(svg_text(62, 234, "supplier · material · qty", 11.5, p["sub"]))
    parts.append(svg_text(62, 252, "unit_price_cents | unit_price", 11.5, p["sub"]))
    parts.append(svg_text(62, 270, "currency · lead_time · valid_until", 11, p["sub"]))
    parts.append(
        f'<rect x="266" y="192" width="22" height="28" rx="5" fill="{p["card2"]}" '
        f'stroke="{p["border2"]}"/>')
    parts.append(
        f'<path d="M272 200h10M272 206h10M272 212h6" '
        f'stroke="{p["family"]}" stroke-width="1.4" stroke-linecap="round"/>')

    parts.append(svg_rect(44, 296, 256, 106, p["card"], p["border"], rx=18, sw=1))
    parts.append(svg_text(62, 330, "quotes[]", 16, p["text"], 700, "mono"))
    parts.append(svg_text(62, 352, "same fields as CSV", 11.5, p["sub"]))
    parts.append(svg_text(62, 370, "supplier + material = key", 11.5, p["sub"]))
    parts.append(svg_text(62, 388, "re-import replaces that row", 11.5, p["sub"]))
    parts.append(svg_text(276, 216, "{ }", 17, p["family"], 700, "mono", "middle"))

    parts.append(svg_rect(44, 414, 256, 120, p["card2"], p["border"], rx=18, sw=1))
    parts.append(svg_text(62, 442, "assumptions", 15, p["text"], 700, "mono"))
    parts.append(svg_text(62, 460, "optional · feeds compare", 11.5, p["sub"]))
    chips = [("cost_lines", 60, 470, 86), ("budgets", 154, 470, 68),
             ("fx_rates", 60, 500, 74), ("as_of", 142, 500, 56)]
    for label, cx, cy, cw in chips:
        parts.append(svg_rect(cx, cy, cw, 24, p["card"], p["border2"], rx=8, sw=1))
        parts.append(svg_text(cx + 8, cy + 17, label, 11.5, p["text"], 400, "mono"))

    parts.append(svg_rect(44, 548, 120, 26, p["family_soft"], p["border2"], rx=13, sw=1))
    parts.append(svg_text(56, 565, "R0 · READ-ONLY", 11, p["family"], 700, "mono"))

    # tool spine
    parts.append(svg_rect(318, 180, 112, 98, p["card"], p["border"], rx=18,
                          sw=1, filt="soft"))
    parts.append(svg_text(332, 208, "rfq.ingest", 13.5, p["family"], 700, "mono"))
    parts.append(svg_text(332, 230, "validate fields", 11.5, p["sub"]))
    parts.append(svg_text(332, 248, "integer cents", 11.5, p["sub"]))
    parts.append(svg_text(332, 266, "Q001… · R0", 11.5, p["sub"]))

    parts.append(svg_rect(318, 286, 112, 84, p["card"], p["border"], rx=18, sw=1))
    parts.append(svg_text(332, 312, "quote table", 13.5, p["text"], 700, "mono"))
    parts.append(svg_text(332, 332, "in-memory Map", 11.5, p["sub"]))
    parts.append(svg_text(332, 350, "Q001…Q012", 11.5, p["sub"]))
    parts.append(svg_text(332, 366, "replace on key", 11.5, p["sub"]))

    parts.append(svg_rect(318, 384, 112, 110, p["card"], p["border"], rx=18,
                          sw=1, filt="soft"))
    parts.append(svg_text(332, 412, "rfq.compare", 13.5, p["family"], 700, "mono"))
    parts.append(svg_text(332, 434, "group by material", 11.5, p["sub"]))
    parts.append(svg_text(332, 452, "× FX bp → CNY", 11.5, p["sub"]))
    parts.append(svg_text(332, 470, "sort · rank 1/2/3", 11.5, p["sub"]))
    parts.append(svg_text(332, 488, "3 anomaly classes", 11.5, p["sub"]))

    # connectors into the tool spine
    parts.append(svg_path("M300 231 H312", p["sub"], 1.6))
    parts.append(svg_path("M300 349 C310 349 310 255 318 255", p["sub"], 1.6))
    parts.append(svg_path("M300 474 H318", p["sub"], 1.4, dash="4 5"))
    parts.append(svg_path("M374 278 V286", p["sub"], 1.6))
    parts.append(svg_path("M374 370 V384", p["sub"], 1.6))
    parts.append(svg_path("M430 439 H450", p["sub"], 1.6))

    # score matrix
    parts.append(svg_rect(450, 150, 384, 422, p["panel"], p["border"], rx=18,
                          sw=1, filt="soft"))
    parts.append(
        f'<path d="M450 168 Q450 150 468 150 H816 Q834 150 834 168 V236 H450 Z" '
        f'fill="{p["family_soft"]}" opacity=".55"/>')
    parts.append(svg_text(468, 176, "MATERIAL × SUPPLIER MATRIX", 14.5,
                          p["text"], 700))
    parts.append(svg_text(468, 195, "normalized CNY cents · rank per material",
                          11, p["sub"]))

    parts.append(svg_text(462, 224, "MATERIAL", 11, p["faint"], 700, spacing=.7))
    for cx, label in ((569, "SUP-A"), (639, "SUP-B"), (709, "SUP-C")):
        parts.append(svg_text(cx, 224, label, 11, p["faint"], 700, anchor="middle"))
    parts.append(svg_text(824, 224, "SPREAD", 11, p["faint"], 700, anchor="end",
                          spacing=.7))

    # grid
    parts.append(svg_line(450, 236, 834, 236, p["border2"]))
    for x in (534, 604, 674, 744):
        parts.append(svg_line(x, 208, x, 572, p["grid"]))
    for y in (320, 404, 488):
        parts.append(svg_line(450, y, 834, y, p["grid"]))

    # rank-one cell tints
    tints = [(604, 236), (604, 320), (674, 404), (534, 488)]
    for x, y in tints:
        parts.append(svg_rect(x, y, 70, 84, p["family_soft"], rx=0, opacity=.72))

    cell_centers = (569, 639, 709)
    rank_labels = {1: "1st", 2: "2nd", 3: "3rd"}
    for i, row in enumerate(FLOW_ROWS):
        y0 = 236 + i * 84
        parts.append(svg_text(462, y0 + 30, row["material"], 13, p["text"], 700, "mono"))
        parts.append(svg_text(462, y0 + 50, f'{row["quotes"]} quotes', 11, p["sub"]))
        for j, (qid, cur, cny, rank) in enumerate(row["cells"]):
            cx = cell_centers[j]
            prime = rank == 1
            parts.append(svg_text(cx, y0 + 28, f"{cny:,}", 13.5,
                                  p["family"] if prime else p["text"],
                                  700 if prime else 400, "mono", "middle"))
            parts.append(svg_text(cx, y0 + 46, f"{qid} · {cur}", 11, p["sub"],
                                  anchor="middle"))
            parts.append(svg_text(cx, y0 + 64, rank_labels[rank], 11,
                                  p["family"] if prime else p["sub"],
                                  700 if prime else 400, anchor="middle"))
        parts.append(svg_text(824, y0 + 30, row["spread"], 13, p["text"], 700,
                              "mono", "end"))
        parts.append(svg_text(824, y0 + 50, row["bp"], 11, p["sub"], anchor="end"))

    # advisory boundary card
    parts.append(svg_rect(858, 178, 198, 222, p["card"], p["border"], rx=18,
                          sw=1, filt="soft"))
    parts.append(svg_text(874, 200, "ADVISORY BOUNDARY", 13, p["family"],
                          700, spacing=.8))
    parts.append(svg_text(874, 216, "flags, not disqualification", 11, p["sub"]))
    for i, (material, flags) in enumerate(FLOW_FLAGS):
        y0 = 232 + i * 40
        parts.append(svg_text(874, y0 + 14, material, 11.5, p["text"], 700, "mono"))
        fx = 874.0
        for color_key, label in flags:
            color = p[color_key]
            parts.append(svg_dot(fx + 3, y0 + 27, 3, color))
            parts.append(svg_text(fx + 10, y0 + 31, label, 11,
                                  color, 600, "mono"))
            fx += 10 + 5.9 * len(label) + 12

    # local artifact card
    parts.append(svg_rect(858, 414, 198, 158, p["card"], p["border"], rx=18,
                          sw=1, filt="soft"))
    parts.append(svg_text(874, 438, "LOCAL CSV", 13, p["family"],
                          700, spacing=.8))
    parts.append(svg_rect(990, 422, 48, 22, p["green"], rx=11, sw=0))
    parts.append(svg_text(1014, 437, "R1", 11, "#ffffff", 700, "mono", "middle"))
    parts.append(svg_text(874, 462, "rfq.export", 15, p["text"], 700, "mono"))
    parts.append(svg_text(874, 482, "$DSH_HOME/…/exports/", 11, p["sub"], 400, "mono"))
    parts.append(svg_text(874, 502, "rfq-compare.csv", 12.5, p["text"], 700, "mono"))
    parts.append(svg_text(874, 522, "4 rows · 895 B", 11.5, p["sub"]))
    parts.append(svg_text(874, 540, "sha256 14862e9b…", 11.5, p["sub"], 400, "mono"))
    parts.append(svg_text(874, 558, "input read-only", 11, p["sub"]))

    # matrix -> boundary / artifact
    parts.append(svg_path("M834 300 H858", p["family"], 1.4, dash="4 5"))
    parts.append(svg_path("M834 480 H858", p["sub"], 1.6))

    # footer
    parts.append(svg_line(44, 596, 1056, 596, p["border2"]))
    parts.append(svg_text(
        44, 622,
        "no network · no model call · FX = documented placeholder · input files stay read-only",
        11.5, p["sub"]))
    parts.append(svg_text(1056, 622, "3 tools · 4 materials · 12 quotes", 11.5,
                          p["family"], 600, anchor="end"))
    parts.append('</svg>')
    return "\n".join(parts) + "\n"


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main() -> None:
    probe_fonts()
    os.makedirs(OUT, exist_ok=True)

    for lang in ("zh", "en"):
        for skin in ("light", "dark"):
            image = build_hero(skin, lang)
            path = os.path.join(OUT, f"dsh-rfq-compare-hero-{lang}-{skin}.webp")
            image.save(path, "WEBP", quality=92, method=6)
            print(f"wrote {os.path.relpath(path, ROOT)}")

    for skin in ("light", "dark"):
        path = os.path.join(OUT, f"dsh-rfq-compare-flow-v5-{skin}.svg")
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(flow_svg(skin))
        print(f"wrote {os.path.relpath(path, ROOT)}")


if __name__ == "__main__":
    main()
