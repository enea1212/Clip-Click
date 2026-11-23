"""Story characters drawn in code: big round head, simple face, block body, stick legs.

Being drawn from a few parameters (look + expression), a character looks the same in every
scene. Sprites are drawn 3x larger and scaled down (smooth edges), and cached.
"""
from functools import lru_cache

from PIL import Image, ImageDraw

SUPER = 3
WIDTH = 0.7     # sprite width, as a share of the character height
TOP = 1.06      # sprite top above the feet (hair and cap stick out above the head)
INK = (20, 20, 20, 255)


def _rgb(color):
    color = color.lstrip("#")
    return tuple(int(color[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


def _geometry(h):
    """Key points relative to the feet (0, 0), y up is negative."""
    r = 0.22 * h
    cy = -h + r
    return {"r": r, "cy": cy, "eye_dx": 0.38 * r, "eye_y": cy - 0.05 * r, "brow_y": cy - 0.33 * r, "mouth_y": cy + 0.45 * r}


def face_regions(x, y, height):
    """Boxes (left, top, right, bottom) of the eyes and the mouth, in image coordinates."""
    g = _geometry(height)
    r, cy = g["r"], g["cy"]
    return {
        "eyes": (x - 0.6 * r, y + cy - 0.5 * r, x + 0.6 * r, y + cy + 0.15 * r),
        "mouth": (x - 0.45 * r, y + cy + 0.25 * r, x + 0.45 * r, y + cy + 0.75 * r),
    }


def _brows(draw, g, expression, p, w):
    dx, y, half = g["eye_dx"], g["brow_y"], 0.15 * g["r"]
    tilt = {"angry": 0.12, "sad": -0.1, "surprised": 0.0, "smug": 0.0}.get(expression, 0.0) * g["r"]
    lift = -0.1 * g["r"] if expression == "surprised" else 0.0
    for side in (-1, 1):
        cx = side * dx
        inner, outer = cx - side * half, cx + side * half
        # angry: inner ends low (frown); sad: inner ends high
        inner_y, outer_y = y + tilt + lift, y - tilt + lift
        if expression == "smug" and side == 1:
            inner_y, outer_y = y - 0.12 * g["r"], y - 0.12 * g["r"]
        draw.line([p(inner, inner_y), p(outer, outer_y)], fill=INK, width=w)


def _eyes(draw, g, blink, p, w):
    rx, ry = 0.08 * g["r"], 0.12 * g["r"]
    for side in (-1, 1):
        cx, cy = side * g["eye_dx"], g["eye_y"]
        if blink:
            draw.line([p(cx - rx * 1.4, cy), p(cx + rx * 1.4, cy)], fill=INK, width=w)
        else:
            draw.ellipse([p(cx - rx, cy - ry), p(cx + rx, cy + ry)], fill=INK)


def _mouth(draw, g, expression, mouth, p, w):
    r, my = g["r"], g["mouth_y"]
    half = 0.22 * r
    if mouth > 0.15:  # talking: an open mouth, its height follows the voice
        open_h = (0.06 + 0.16 * min(1.0, mouth)) * r
        draw.ellipse([p(-half * 0.8, my - open_h), p(half * 0.8, my + open_h)], fill=(110, 30, 30, 255), outline=INK, width=w)
        return
    if expression == "happy":
        draw.arc([p(-half, my - 0.25 * r), p(half, my + 0.12 * r)], 20, 160, fill=INK, width=w)
    elif expression == "sad":
        draw.arc([p(-half, my), p(half, my + 0.3 * r)], 200, 340, fill=INK, width=w)
    elif expression == "angry":
        draw.line([p(-half, my + 0.05 * r), p(half, my + 0.05 * r)], fill=INK, width=int(w * 1.6))
    elif expression == "surprised":
        draw.ellipse([p(-0.09 * r, my - 0.1 * r), p(0.09 * r, my + 0.12 * r)], fill=(110, 30, 30, 255), outline=INK, width=w)
    elif expression == "smug":
        draw.line([p(-half, my + 0.04 * r), p(half * 0.2, my + 0.04 * r), p(half, my - 0.1 * r)], fill=INK, width=w, joint="curve")
    else:
        draw.line([p(-half * 0.7, my), p(half * 0.7, my)], fill=INK, width=w)


def _hair(draw, g, look, p, w):
    r, cy = g["r"], g["cy"]
    hair = (60, 40, 25, 255)
    # Hair and cap end above the brows (cy - 0.33 r), so the face stays visible.
    if look["hair"] == "short":
        draw.chord([p(-r * 1.02, cy - r * 1.04), p(r * 1.02, cy + r * 0.12)], 180, 360, fill=hair, outline=INK, width=w)
    elif look["hair"] == "long":
        draw.rounded_rectangle([p(-r * 1.08, cy - r * 1.02), p(r * 1.08, cy + r * 0.9)], radius=r * 0.6, fill=hair, outline=INK, width=w)
    elif look["hair"] == "cap":
        cap = _rgb(look["shirt"])
        draw.chord([p(-r * 1.02, cy - r * 1.06), p(r * 1.02, cy + r * 0.1)], 180, 360, fill=cap, outline=INK, width=w)
        draw.rounded_rectangle([p(-r * 0.3, cy - 0.52 * r), p(r * 1.35, cy - 0.4 * r)], radius=0.05 * r, fill=cap, outline=INK, width=w)


@lru_cache(maxsize=256)
def _sprite(skin, hair, shirt, expression, height, blink, mouth_level):
    look = {"skin": skin, "hair": hair, "shirt": shirt}
    h = height * SUPER
    width, top = int(WIDTH * h), int(TOP * h)
    image = Image.new("RGBA", (width, top + 2 * SUPER), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    ox, oy = width / 2, top

    def p(x, y):
        return (ox + x, oy + y)

    g = _geometry(h)
    r, cy = g["r"], g["cy"]
    w = max(2, int(0.012 * h))
    # legs, body, head (back to front)
    for side in (-1, 1):
        draw.line([p(side * 0.07 * h, -0.31 * h), p(side * 0.08 * h, -0.005 * h)], fill=INK, width=int(0.028 * h))
    draw.rounded_rectangle([p(-0.17 * h, cy + r * 0.85), p(0.17 * h, -0.3 * h)], radius=0.05 * h, fill=_rgb(shirt), outline=INK, width=w)
    if hair == "long":
        _hair(draw, g, look, p, w)
    draw.ellipse([p(-r, cy - r), p(r, cy + r)], fill=_rgb(skin), outline=INK, width=w)
    if hair in ("short", "cap"):
        _hair(draw, g, look, p, w)
    _brows(draw, g, expression, p, w)
    _eyes(draw, g, blink, p, w)
    _mouth(draw, g, expression, mouth_level / 4, p, w)
    return image.resize((width // SUPER, image.height // SUPER), Image.LANCZOS)


def draw_character(image, look, expression, x, y, height, blink=False, mouth=0.0):
    """Draws the character with its feet at (x, y); returns the box it was drawn in."""
    mouth_level = int(round(min(1.0, max(0.0, mouth)) * 4))
    sprite = _sprite(look["skin"], look["hair"], look["shirt"], expression, int(height), bool(blink), mouth_level)
    left, top = int(round(x - sprite.width / 2)), int(round(y - TOP * int(height)))
    image.paste(sprite, (left, top), sprite)
    return (left, top, left + sprite.width, top + sprite.height)
