#!/usr/bin/env python3
"""Generate extension icons for Webpage Resource Downloader."""

from pathlib import Path

from PIL import Image, ImageDraw

PRIMARY = (37, 99, 235)
PRIMARY_DARK = (29, 78, 216)
ACCENT = (96, 165, 250)
WHITE = (255, 255, 255, 255)


def lerp(a, b, t):
    return int(a + (b - a) * t)


def create_gradient_background(size):
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gradient = Image.new("RGBA", (size, size))
    draw = ImageDraw.Draw(gradient)

    for y in range(size):
        t = y / max(size - 1, 1)
        color = (
            lerp(PRIMARY[0], PRIMARY_DARK[0], t),
            lerp(PRIMARY[1], PRIMARY_DARK[1], t),
            lerp(PRIMARY[2], PRIMARY_DARK[2], t),
            255,
        )
        draw.line([(0, y), (size, y)], fill=color)

    mask = Image.new("L", (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    padding = max(1, int(size * 0.06))
    radius = max(2, int(size * 0.22))
    mask_draw.rounded_rectangle(
        [padding, padding, size - padding, size - padding],
        radius=radius,
        fill=255,
    )

    image.paste(gradient, mask=mask)

    highlight = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    highlight_draw = ImageDraw.Draw(highlight)
    highlight_draw.ellipse(
        [
            int(size * 0.08),
            int(size * 0.02),
            int(size * 0.72),
            int(size * 0.42),
        ],
        fill=(255, 255, 255, 28),
    )
    image = Image.alpha_composite(image, highlight)
    return image


def draw_symbol(draw, size):
    unit = size / 24.0
    cx = size / 2
    cy = size / 2

    stroke = max(1, round(size * 0.075))
    line = max(1, round(size * 0.055))

    page_left = cx - 5.2 * unit
    page_top = cy - 7.0 * unit
    page_right = cx + 5.2 * unit
    page_bottom = cy + 0.8 * unit
    page_radius = max(1, round(1.4 * unit))

    draw.rounded_rectangle(
        [page_left, page_top, page_right, page_bottom],
        radius=page_radius,
        fill=(255, 255, 255, 38),
        outline=WHITE,
        width=max(1, round(1.1 * unit)),
    )

    bar_widths = [4.8, 3.8, 2.8]
    for index, width in enumerate(bar_widths):
        y = page_top + (2.0 + index * 1.8) * unit
        x1 = cx - (width * unit) / 2
        x2 = cx + (width * unit) / 2
        draw.line([(x1, y), (x2, y)], fill=WHITE, width=line)

    dot_radius = max(1, round(0.55 * unit))
    for x_offset in (-2.6, 0, 2.6):
        dot_x = cx + x_offset * unit
        dot_y = page_top + 1.35 * unit
        draw.ellipse(
            [
                dot_x - dot_radius,
                dot_y - dot_radius,
                dot_x + dot_radius,
                dot_y + dot_radius,
            ],
            fill=ACCENT + (255,),
        )

    stem_top = cy + 2.4 * unit
    stem_bottom = cy + 7.2 * unit
    draw.line([(cx, stem_top), (cx, stem_bottom)], fill=WHITE, width=stroke)

    head_width = 3.0 * unit
    head_height = 2.4 * unit
    draw.polygon(
        [
            (cx, stem_bottom + 1.6 * unit),
            (cx - head_width, stem_bottom - head_height),
            (cx + head_width, stem_bottom - head_height),
        ],
        fill=WHITE,
    )

    tray_y = cy + 9.2 * unit
    tray_half = 5.4 * unit
    draw.line(
        [(cx - tray_half, tray_y), (cx + tray_half, tray_y)],
        fill=WHITE,
        width=stroke,
    )


def create_icon(size):
    image = create_gradient_background(size)
    draw = ImageDraw.Draw(image)
    draw_symbol(draw, size)
    return image


def main():
    output_dir = Path(__file__).resolve().parents[1] / "icons"
    output_dir.mkdir(parents=True, exist_ok=True)

    for size in (16, 32, 48, 128):
        icon = create_icon(size)
        icon.save(output_dir / f"icon{size}.png", format="PNG")
        print(f"Wrote {output_dir / f'icon{size}.png'}")


if __name__ == "__main__":
    main()
