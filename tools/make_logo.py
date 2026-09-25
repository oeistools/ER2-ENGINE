"""Generate the ER2-ENGINE logo into assets/: logo, logo-dark and logo-mark.

    uvx --with cairosvg python tools/make_logo.py

The composition is PARI-GP-ENGINE's — a source document with a folded
corner, a line of the language inside it, and Quarto's Q over the corner —
so the two sibling extensions read as a family. The colours are ER2's own
(its tools/make_logo.py): ink for the drawing, rust for the accent. In the
wordmark the 2 is rust, as the ^2 tile is in ER2's logo.

The PNGs are what the README and the site use; the SVGs are kept as the
editable source. Text is rendered with IBM Plex Sans and Mono, so run this
where those fonts are installed, and look at the PNGs before committing.
"""

from pathlib import Path

import cairosvg

INK = "#100D0B"
RUST = "#9E2F10"
RUST_LIGHT = "#D9774F"
# The dark variant, for GitHub's dark mode: ER2's paper colour for the ink,
# and a lighter rust, because #9E2F10 is too dark to read on a dark page.
PAPER = "#FAF6F3"
RUST_ON_DARK = "#E0643A"

ASSETS = Path(__file__).resolve().parent.parent / "assets"

SANS = "IBM Plex Sans, Lato, DejaVu Sans, sans-serif"
MONO = "IBM Plex Mono, DejaVu Sans Mono, monospace"

# Quarto's Q is geometry, not a glyph: a ring and a tail, as in
# PARI-GP-ENGINE's mark. The document outline stops short of it on both
# edges, so there is a gap around the Q without a mask (cairosvg does not
# honour a mask made of text) and the background stays transparent.
QX, QY, QR, STROKE, GAP = 232, 206, 38, 16, 10
_KNOCK = QR + STROKE / 2 + GAP  # radius the outline must stay out of
_DOC_BOTTOM, _DOC_RIGHT = 236, 262
_BOTTOM_END = QX - (_KNOCK**2 - (_DOC_BOTTOM - QY) ** 2) ** 0.5
_RIGHT_END = QY - (_KNOCK**2 - (_DOC_RIGHT - QX) ** 2) ** 0.5


def mark(ink, rust):
    """Return the document and the Q, in the given colours."""
    return f"""
  <path d="M {_BOTTOM_END:.1f} 236 H 90 Q 70 236 70 216 V 56 Q 70 36 90 36
           H 194 M 262 106 V {_RIGHT_END:.1f}"
        fill="none" stroke="{ink}" stroke-width="14"
        stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M 208 36 L 262 90 H 220 Q 208 90 208 78 Z" fill="{RUST_LIGHT}"/>
  <text x="94" y="98" font-family="{MONO}" font-weight="700"
        font-size="32" fill="{ink}">sym x</text>
  <text x="94" y="146" font-family="{MONO}" font-weight="700"
        font-size="32" fill="{ink}">(x+1)<tspan
        fill="{rust}">^</tspan>2</text>
  <circle cx="{QX}" cy="{QY}" r="{QR}" fill="none" stroke="{rust}"
          stroke-width="{STROKE}"/>
  <path d="M {QX + 14} {QY + 22} L {QX + 42} {QY + 54}" stroke="{rust}"
        stroke-width="{STROKE}" stroke-linecap="round"/>
"""


# The drawing spans x = 63 (outer edge of the outline) to 282 (end of the
# Q's tail); the wordmark is centred on it. "ER" and "2" are placed by hand
# from their advance widths in IBM Plex Sans Bold at 76 px (97.4 and 45.6,
# measured with fontTools): cairosvg misplaces a <tspan> under
# text-anchor="middle", which left a gap in "ER 2" and pushed it off centre.
CENTRE = 172.5
_ER, _TWO = 97.4, 45.6
_START = CENTRE - (_ER + _TWO) / 2


def wordmark(ink, rust):
    """Return ER2 and QUARTO ENGINE, centred under the mark."""
    return f"""
  <text x="{_START:.1f}" y="332" font-family="{SANS}" font-weight="700"
        font-size="76" fill="{ink}">ER</text>
  <text x="{_START + _ER:.1f}" y="332" font-family="{SANS}" font-weight="700"
        font-size="76" fill="{rust}">2</text>
  <text x="{CENTRE}" y="366" text-anchor="middle" font-family="{SANS}"
        font-weight="500" font-size="22" letter-spacing="5"
        fill="{rust}">QUARTO ENGINE</text>
"""


def svg(view_box, width, height, body, label):
    """Return an SVG document."""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_box}" '
        f'width="{width}" height="{height}" role="img" '
        f'aria-label="{label}">{body}</svg>\n'
    )


def main():
    """Write the SVG sources and render the PNGs."""
    logo_box, mark_box = "12.5 16 320 364", "46 18 256 256"
    light = (INK, RUST)
    dark = (PAPER, RUST_ON_DARK)
    label = "ER2-ENGINE: a Quarto engine for ER2"
    files = {  # name: (svg, width in CSS pixels)
        "logo": (
            svg(logo_box, 320, 364, mark(*light) + wordmark(*light), label),
            320,
        ),
        "logo-dark": (
            svg(logo_box, 320, 364, mark(*dark) + wordmark(*dark), label),
            320,
        ),
        "logo-mark": (svg(mark_box, 256, 256, mark(*light), label), 256),
    }
    ASSETS.mkdir(exist_ok=True)
    for name, (text, width) in files.items():
        (ASSETS / f"{name}.svg").write_text(text, encoding="utf-8")
        cairosvg.svg2png(
            bytestring=text.encode(),
            write_to=str(ASSETS / f"{name}.png"),
            output_width=2 * width,  # sharp on high-density screens
        )
        print(f"wrote assets/{name}.svg and assets/{name}.png")


if __name__ == "__main__":
    main()
