# Generates cgp.pdf: a two-page PDF with Slovenian text (DejaVu Sans embedded, Bitstream Vera licence) used to test
# PDF text extraction for "CGP from a document". Run: python3 tests/fixtures/docs/make_cgp_pdf.py
import os
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

pdfmetrics.registerFont(TTFont("DejaVu", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
out = os.path.join(os.path.dirname(__file__), "cgp.pdf")
c = canvas.Canvas(out)
c.setFont("DejaVu", 14)
c.drawString(72, 760, "CGP Inženirji")
c.setFont("DejaVu", 11)
c.drawString(72, 730, "Pišemo strokovno, toplo in brez žargona.")
c.drawString(72, 712, "Ciljna publika: inženirji in študenti.")
c.showPage()
c.setFont("DejaVu", 11)
c.drawString(72, 760, "Česa ne delamo: obljub brez dokazov.")
c.save()
