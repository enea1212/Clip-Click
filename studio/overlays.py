"""Story overlays drawn in code (the image model can't write text): badge, sign, money, flash, emoji."""
import math
import os

from PIL import Image, ImageDraw, ImageFont

FONT_DIR = os.path.join(os.environ.get("WINDIR", "C:\\Windows"), "Fonts")
_fonts = {}


def font(size, name="arialbd.ttf"):
    key = (name, size)
    if key not in _fonts:
        try:
            _fonts[key] = ImageFont.truetype(os.path.join(FONT_DIR, name), size)
        except OSError:
            _fonts[key] = None if name == "seguiemj.ttf" else ImageFont.load_default(size)
    return _fonts[key]


def _pop(local_t):
    """Scale for a short 'pop in' during the first 0.2 s."""
    if local_t >= 0.2:
        return 1.0
    p = local_t / 0.2
    return 0.6 + 0.4 * (1 - (1 - p) ** 3)


def _badge(image, text, local_t):
    width, height = image.size
    size = int(width * 0.09 * _pop(local_t))
    f = font(size)
    draw = ImageDraw.Draw(image)
    box = draw.textbbox((0, 0), text, font=f)
    tw, th = box[2] - box[0], box[3] - box[1]
    pad = size * 0.35
    cx, cy = width / 2, height * 0.13
    rect = [cx - tw / 2 - pad, cy - th / 2 - pad, cx + tw / 2 + pad, cy + th / 2 + pad]
    draw.rounded_rectangle(rect, radius=size * 0.25, fill=(18, 28, 44), outline=(90, 210, 240), width=max(2, size // 14))
    color = (70, 220, 110) if text.strip().startswith(("+", "✓")) else (240, 60, 50)
    draw.text((cx - tw / 2 - box[0], cy - th / 2 - box[1]), text, font=f, fill=color)


def _sign(image, text, local_t):
    width, height = image.size
    size = int(width * 0.065 * _pop(local_t))
    f = font(size)
    draw = ImageDraw.Draw(image)
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if line and draw.textlength(trial, font=f) > width * 0.6:
            lines.append(line)
            line = word
        else:
            line = trial
    lines.append(line)
    line_h = size * 1.2
    block_w = max(draw.textlength(item, font=f) for item in lines)
    cx, cy = width / 2, height * 0.25
    pad = size * 0.5
    rect = [cx - block_w / 2 - pad, cy - len(lines) * line_h / 2 - pad, cx + block_w / 2 + pad, cy + len(lines) * line_h / 2 + pad]
    draw.rounded_rectangle(rect, radius=size * 0.2, fill=(250, 250, 245), outline=(30, 30, 30), width=max(3, size // 10))
    for i, item in enumerate(lines):
        draw.text((cx - draw.textlength(item, font=f) / 2, cy - len(lines) * line_h / 2 + i * line_h), item, font=f, fill=(20, 20, 20))


def _bill(width):
    w, h = int(width * 0.16), int(width * 0.075)
    bill = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(bill)
    draw.rounded_rectangle([1, 1, w - 2, h - 2], radius=h // 6, fill=(120, 190, 110), outline=(40, 90, 40), width=max(2, h // 18))
    draw.ellipse([w / 2 - h * 0.3, h * 0.2, w / 2 + h * 0.3, h * 0.8], fill=(160, 215, 150), outline=(40, 90, 40), width=max(1, h // 25))
    f = font(int(h * 0.45))
    draw.text((w / 2, h / 2), "$", font=f, fill=(30, 80, 30), anchor="mm")
    return bill


def _money(image, local_t, rng):
    width, height = image.size
    bill = _bill(width)
    for _ in range(12):
        x0, delay, speed, spin, angle0 = rng.random(), rng.random() * 0.6, 0.35 + rng.random() * 0.3, rng.uniform(-200, 200), rng.uniform(0, 360)
        t = local_t - delay
        if t < 0:
            continue
        y = -0.1 * height + t * speed * height
        if y > height:
            continue
        x = x0 * width + math.sin(t * 3 + x0 * 6) * width * 0.04
        rotated = bill.rotate(angle0 + spin * t, expand=True, resample=Image.BICUBIC)
        image.paste(rotated, (int(x - rotated.width / 2), int(y - rotated.height / 2)), rotated)


def _flash(image, local_t):
    if local_t >= 0.25:
        return
    alpha = 1 - local_t / 0.25
    white = Image.new("RGB", image.size, (255, 255, 255))
    image.paste(Image.blend(image.convert("RGB"), white, alpha))


def _emoji(image, text, local_t):
    width, height = image.size
    f = font(109, "seguiemj.ttf")  # Segoe UI Emoji only renders at its native size; scaled after
    if f is None or not text.strip():
        return
    layer = Image.new("RGBA", (160, 160), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((80, 80), text.strip()[:2], font=f, embedded_color=True, anchor="mm")
    size = int(width * 0.22 * _pop(local_t))
    layer = layer.resize((size, size), Image.LANCZOS)
    image.paste(layer, (int(width * 0.72 - size / 2), int(height * 0.2 - size / 2)), layer)


def draw_overlay(image, overlay, local_t, rng):
    """Draws the scene's overlay at local_t seconds into the scene (rng: seeded per scene)."""
    kind, text = overlay["type"], overlay.get("text", "")
    if kind == "badge":
        _badge(image, text, local_t)
    elif kind == "sign":
        _sign(image, text, local_t)
    elif kind == "money":
        _money(image, local_t, rng)
    elif kind == "flash":
        _flash(image, local_t)
    elif kind == "emoji":
        _emoji(image, text, local_t)
    else:
        raise ValueError(f"element grafic necunoscut: {kind}")
