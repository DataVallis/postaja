# Generates TinySans.ttf: a minimal but complete TrueType font (box glyphs) used by tests that need a real font
# (WOFF2 encoder/decoder). Self-made, no third-party glyphs. Run: python3 tests/fixtures/fonts/make_tiny_sans.py
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
import os

chars = "abcčšžćđČŠŽĆĐ"
names = [".notdef"] + [f"uni{ord(c):04X}" for c in chars]

def box():
    pen = TTGlyphPen(None)
    pen.moveTo((50, 0)); pen.lineTo((50, 700)); pen.lineTo((450, 700)); pen.lineTo((450, 0)); pen.closePath()
    return pen.glyph()

fb = FontBuilder(1000, isTTF=True)
fb.setupGlyphOrder(names)
fb.setupCharacterMap({ord(c): f"uni{ord(c):04X}" for c in chars})
fb.setupGlyf({n: box() for n in names})
fb.setupHorizontalMetrics({n: (500, 50) for n in names})
fb.setupHorizontalHeader(ascent=800, descent=-200)
fb.setupNameTable({"familyName": "Tiny Sans", "styleName": "Regular"})
fb.setupOS2()
fb.setupPost()
fb.save(os.path.join(os.path.dirname(__file__), "TinySans.ttf"))
