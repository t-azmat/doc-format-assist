"""Run-level typography, shared by the exporter and the author block.

Lifted out of export.py so `authorblock` can set fonts the same way without
importing the exporter, which imports it back.
"""

from __future__ import annotations

from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

BLACK = RGBColor(0, 0, 0)


def clear_theme_fonts(font_element, font_name: str) -> None:
    """Pin a style/run to a real typeface.

    Word's default template references *theme* fonts (asciiTheme="minorHAnsi"),
    and a theme reference wins over an explicit w:ascii value — so setting
    font.name alone leaves headings in Calibri Light. Strip the theme
    attributes and set the East Asian face too, which python-docx never sets
    and which Word otherwise falls back to for any non-Latin character.
    """
    try:
        rpr = font_element.get_or_add_rPr()
        rfonts = rpr.find(qn("w:rFonts"))
        if rfonts is None:
            rfonts = rpr.makeelement(qn("w:rFonts"), {})
            rpr.insert(0, rfonts)
        for attr in ("asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme"):
            rfonts.attrib.pop(qn(f"w:{attr}"), None)
        for attr in ("ascii", "hAnsi", "eastAsia", "cs"):
            rfonts.set(qn(f"w:{attr}"), font_name)
    except Exception:
        pass


def apply_run_font(
    run,
    font_name: str,
    size_pt: float,
    *,
    bold: bool = False,
    italic: bool = False,
    strike: bool = False,
    underline: bool = False,
    superscript: bool = False,
) -> None:
    run.font.name = font_name
    run.font.size = Pt(size_pt)
    run.font.bold = bold
    run.font.italic = italic
    run.font.strike = strike
    run.font.underline = underline
    if superscript:
        run.font.superscript = True
    run.font.color.rgb = BLACK
    clear_theme_fonts(run._element, font_name)
