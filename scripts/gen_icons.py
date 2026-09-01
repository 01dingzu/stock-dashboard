"""生成 PWA 图标：深色底 + 红涨绿跌 K 线柱 + 均线折线。"""
from PIL import Image, ImageDraw

SIZE = 512
BG = (15, 20, 25, 255)
UP = (246, 70, 93, 255)      # 红涨
DOWN = (46, 189, 133, 255)   # 绿跌
LINE = (247, 201, 72, 255)   # 均线黄

img = Image.new("RGBA", (SIZE, SIZE), BG)
d = ImageDraw.Draw(img)

# 圆角底
mask = Image.new("L", (SIZE, SIZE), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([0, 0, SIZE, SIZE], radius=96, fill=255)
img.putalpha(mask)

margin = 70
top, bottom = 90, SIZE - 90
height = bottom - top

# K 线柱（红涨绿跌交替）
candles = [
    (0.14, 0.30, 0.62, UP),
    (0.30, 0.55, 0.38, DOWN),
    (0.46, 0.22, 0.78, UP),
    (0.62, 0.48, 0.28, DOWN),
    (0.78, 0.18, 0.90, UP),
]
width = (SIZE - 2 * margin) / 5
for i, (lo, hi, close, color) in enumerate(candles):
    x = margin + i * width
    cx = x + width / 2
    lw = max(6, width * 0.22)
    # 影线
    d.line([cx, top + lo * height, cx, top + hi * height], fill=color, width=6)
    # 实体
    body_top = top + min(close, hi) * height
    body_bot = top + max(close, lo) * height
    d.rounded_rectangle([cx - lw, body_top, cx + lw, body_bot], radius=4, fill=color)

# 均线折线
pts = []
for i, (lo, hi, close, _) in enumerate(candles):
    cx = margin + i * width + width / 2
    y = top + (lo + hi + close) / 3 * height
    pts.append((cx, y))
d.line(pts, fill=LINE, width=8, joint="curve")
for p in pts:
    r = 9
    d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=LINE)

for size in (192, 512):
    img.resize((size, size), Image.LANCZOS).save(f"icons/icon-{size}.png", "PNG")
print("icons generated")
