"""Generate the synthetic specimen photographs used by the demo seed.

Everything here is drawn from scratch so the repo carries no third-party
imagery. The shapes are deliberately plain. The point is that a vision model
can count leaves and read roughly how much of the tissue is non-green, which is
exactly what the contract's rubric asks for.

    python scripts/make_specimens.py
"""

from __future__ import annotations

import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "specimens")
SIZE = (768, 768)

PAPER = (244, 241, 234)
POT = (176, 132, 104)
POT_DARK = (150, 108, 84)
SOIL = (74, 60, 50)
GREEN = (34, 102, 58)
GREEN_DEEP = (22, 74, 42)
CREAM = (243, 240, 224)
YELLOW = (226, 214, 140)
NECROTIC = (132, 106, 62)
ROT = (86, 66, 52)


def leaf_polygon(cx: float, cy: float, length: float, width: float, angle: float):
    """A monstera-ish ovate blade, described as a closed polygon."""
    pts = []
    steps = 44
    for i in range(steps + 1):
        t = i / steps
        # half-blade profile: narrow at petiole, widest at 45%, pointed tip
        w = math.sin(math.pi * (t ** 0.78)) * width * 0.5
        x = -length * 0.5 + t * length
        pts.append((x, -w))
    for i in range(steps, -1, -1):
        t = i / steps
        w = math.sin(math.pi * (t ** 0.78)) * width * 0.5
        x = -length * 0.5 + t * length
        pts.append((x, w))

    ca, sa = math.cos(angle), math.sin(angle)
    return [(cx + x * ca - y * sa, cy + x * sa + y * ca) for x, y in pts]


def draw_leaf(base, cx, cy, length, width, angle, varieg, rng, damage=0.0, rot=False):
    """Draw one blade. `varieg` is the target fraction of cream tissue (0..1).

    Everything is painted opaquely onto a scratch layer and then clipped to the
    blade outline in one pass, so cream sectors and necrosis stop at the leaf
    margin instead of washing over the whole frame.
    """
    ca, sa = math.cos(angle), math.sin(angle)
    poly = leaf_polygon(cx, cy, length, width, angle)

    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.polygon(poly, fill=GREEN + (255,))

    # variegation: irregular cream sectors, painted opaque
    if varieg > 0.02:
        n = max(2, int(varieg * 15))
        for _ in range(n):
            t = rng.uniform(0.10, 0.92)
            off = rng.uniform(-0.30, 0.30)
            px = cx + (t - 0.5) * length * ca - off * width * sa
            py = cy + (t - 0.5) * length * sa + off * width * ca
            r = rng.uniform(0.16, 0.34) * width * (0.6 + varieg)
            col = CREAM if rng.random() > 0.22 else YELLOW
            d.ellipse([px - r, py - r * 0.8, px + r, py + r * 0.8], fill=col + (255,))

    # necrosis / rot biting in from the margin
    if damage > 0.01:
        for _ in range(int(damage * 18) + 1):
            t = rng.uniform(0.05, 0.95)
            s = rng.choice([-1, 1])
            w = math.sin(math.pi * (t**0.78)) * width * 0.5
            px = cx + (t - 0.5) * length * ca - w * sa * s
            py = cy + (t - 0.5) * length * sa + w * ca * s
            r = rng.uniform(7, 10 + damage * 24)
            d.ellipse([px - r, py - r, px + r, py + r], fill=(ROT if rot else NECROTIC) + (255,))

    layer = layer.filter(ImageFilter.GaussianBlur(1.4))

    # midrib and short lateral veins, drawn after the blur so they stay crisp
    d = ImageDraw.Draw(layer)
    d.line(
        [
            (cx - length * 0.46 * ca, cy - length * 0.46 * sa),
            (cx + length * 0.44 * ca, cy + length * 0.44 * sa),
        ],
        fill=GREEN_DEEP + (170,),
        width=3,
    )
    for i in range(1, 7):
        t = i / 7.0
        bx = cx + (t - 0.5) * length * ca
        by = cy + (t - 0.5) * length * sa
        w = math.sin(math.pi * (t**0.78)) * width * 0.40
        for s in (-1, 1):
            d.line(
                [(bx, by), (bx - w * sa * s, by + w * ca * s)],
                fill=GREEN_DEEP + (90,),
                width=2,
            )

    # single clip: nothing survives outside the blade outline
    mask = Image.new("L", base.size, 0)
    ImageDraw.Draw(mask).polygon(poly, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(0.8))
    layer.putalpha(mask)

    base.alpha_composite(layer)


def specimen(
    path: str,
    leaves: int,
    varieg: float,
    damage: float = 0.0,
    rot: bool = False,
    wilt: float = 0.0,
    seed: int = 7,
    boxed: bool = False,
):
    rng = random.Random(seed)
    img = Image.new("RGBA", SIZE, PAPER + (255,))
    d = ImageDraw.Draw(img)

    if boxed:
        # shot on the corrugated flap of a shipping box instead of a studio sweep
        d.rectangle([0, 0, SIZE[0], SIZE[1]], fill=(206, 180, 146, 255))
        for x in range(0, SIZE[0], 26):
            d.line([(x, 0), (x, SIZE[1])], fill=(196, 170, 138, 255), width=9)

    cx, cy = SIZE[0] / 2, SIZE[1] * 0.62

    # pot
    d.polygon(
        [(cx - 124, cy + 40), (cx + 124, cy + 40), (cx + 96, cy + 196), (cx - 96, cy + 196)],
        fill=POT + (255,),
    )
    d.ellipse([cx - 124, cy + 12, cx + 124, cy + 70], fill=POT_DARK + (255,))
    d.ellipse([cx - 108, cy + 22, cx + 108, cy + 60], fill=SOIL + (255,))

    spread = math.radians(34 + wilt * 34)
    for i in range(leaves):
        frac = (i / max(1, leaves - 1)) - 0.5 if leaves > 1 else 0.0
        angle = -math.pi / 2 + frac * spread * 2 + wilt * 0.55
        length = 250 - abs(frac) * 46 - wilt * 34
        width = 148 - abs(frac) * 22
        lx = cx + math.cos(angle) * length * 0.5
        ly = cy + 26 + math.sin(angle) * length * 0.5
        draw_leaf(
            img,
            lx,
            ly,
            length,
            width,
            angle,
            varieg * rng.uniform(0.75, 1.25),
            rng,
            damage=damage * rng.uniform(0.6, 1.4),
            rot=rot,
        )

    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.convert("RGB").save(path, "JPEG", quality=72, optimize=True)
    print(f"{os.path.basename(path):32s} {os.path.getsize(path):>7,} bytes")


if __name__ == "__main__":
    out = os.path.abspath(OUT)

    # 1. Honest sale: arrives as described, one bruised leaf from the trip.
    specimen(f"{out}/albo-before.jpg", leaves=4, varieg=0.42, seed=11)
    specimen(f"{out}/albo-after.jpg", leaves=4, varieg=0.40, damage=0.14, wilt=0.16, seed=11, boxed=True)

    # 2. Variegation was oversold and a leaf did not survive the box.
    specimen(f"{out}/thai-before.jpg", leaves=5, varieg=0.58, seed=23)
    specimen(f"{out}/thai-after.jpg", leaves=3, varieg=0.16, damage=0.34, wilt=0.42, seed=23, boxed=True)

    # 3. Shipped rotten: the failure the escrow exists for.
    specimen(f"{out}/spiritus-before.jpg", leaves=3, varieg=0.06, seed=41)
    specimen(f"{out}/spiritus-after.jpg", leaves=2, varieg=0.05, damage=0.85, rot=True, wilt=0.75, seed=41, boxed=True)

    print(f"\nwritten to {out}")
