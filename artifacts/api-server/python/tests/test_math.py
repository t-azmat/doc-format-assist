"""Tests for equation handling: LaTeX in, native Word equations out.

The failure these guard against is silent loss. An equation that Word cannot
parse must still leave its source in the document, and an equation node must
never be dropped on the way through the exporter.
"""

import io
import re
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from export import render_docx  # noqa: E402
from mathml import latex_to_omml  # noqa: E402
from richconvert import _strip_math_delimiters  # noqa: E402
from styles import get_style  # noqa: E402

M = "{http://schemas.openxmlformats.org/officeDocument/2006/math}"


def math_block(latex):
    return {"type": "mathBlock", "attrs": {"latex": latex}}


def math_inline(latex):
    return {"type": "mathInline", "attrs": {"latex": latex}}


def para(*children):
    return {"type": "paragraph", "content": list(children)}


def text(value):
    return {"type": "text", "text": value}


def document_xml(document) -> str:
    buffer = io.BytesIO()
    document.save(buffer)
    buffer.seek(0)
    with zipfile.ZipFile(buffer) as archive:
        return archive.read("word/document.xml").decode("utf8")


def tags(element):
    return {child.tag.replace(M, "") for child in element.iter()}


# --- LaTeX → OMML -----------------------------------------------------------

def test_simple_expression_becomes_omml():
    omml = latex_to_omml("E = mc^2")

    assert omml is not None
    assert omml.tag == f"{M}oMath"
    assert f"{M}sSup" in {child.tag for child in omml.iter()}


@pytest.mark.parametrize(
    "latex,expected",
    [
        (r"\frac{a+b}{c}", "f"),        # fraction
        (r"x^2", "sSup"),               # superscript
        (r"x_i", "sSub"),               # subscript
        (r"x_i^2", "sSubSup"),          # both
        (r"\sqrt{2}", "rad"),           # square root
        (r"\sqrt[3]{x}", "rad"),        # nth root
        (r"\sum_{i=1}^{n} x_i", "nary"),  # n-ary operator with limits
        (r"\int_0^1 f(x)", "nary"),
        (r"\begin{matrix} a & b \\ c & d \end{matrix}", "m"),
    ],
)
def test_constructs_map_to_their_omml_elements(latex, expected):
    omml = latex_to_omml(latex)

    assert omml is not None, f"{latex} did not convert"
    assert expected in tags(omml), f"{latex} produced {tags(omml)}"


def test_nary_operator_absorbs_the_following_operand():
    """MathML makes the operand a sibling of the operator; OMML nests it. If
    this regresses, the limits render detached from what they range over."""
    omml = latex_to_omml(r"\sum_{i=1}^{n} x_i")

    nary = omml.find(f".//{M}nary")
    assert nary is not None
    body = nary.find(f"{M}e")
    assert body is not None and len(body), "n-ary operand is empty"


def test_display_math_is_wrapped_in_a_paragraph_element():
    inline = latex_to_omml("x", display=False)
    display = latex_to_omml("x", display=True)

    assert inline.tag == f"{M}oMath"
    assert display.tag == f"{M}oMathPara"


def test_digits_and_operators_are_upright():
    """Word italicises math runs by default, which is right for variables and
    wrong for everything else."""
    omml = latex_to_omml("2")

    styles = [el.get(f"{M}val") for el in omml.iter(f"{M}sty")]
    assert "p" in styles


def test_unparseable_latex_returns_none():
    assert latex_to_omml(r"\frac{") is None


def test_empty_latex_returns_none():
    assert latex_to_omml("") is None
    assert latex_to_omml("   ") is None


# --- delimiter stripping ----------------------------------------------------

@pytest.mark.parametrize(
    "raw,expected",
    [
        ("$$x + y$$", "x + y"),
        ("$x + y$", "x + y"),
        (r"\[x + y\]", "x + y"),
        (r"\(x + y\)", "x + y"),
        ("x + y", "x + y"),
        ("  x + y  ", "x + y"),
        # Not delimiters — a lone $ is a dollar sign, and stripping it would
        # corrupt the expression.
        ("$", "$"),
        ("", ""),
    ],
)
def test_math_delimiters_are_stripped(raw, expected):
    assert _strip_math_delimiters(raw) == expected


# --- export -----------------------------------------------------------------

def test_block_equation_reaches_the_document_as_omml():
    doc = {"type": "doc", "content": [math_block("E = mc^2")]}

    xml = document_xml(render_docx(doc, "T", get_style("apa")))

    assert "oMathPara" in xml


def test_inline_equation_reaches_the_document_as_omml():
    doc = {"type": "doc", "content": [para(text("where "), math_inline("x^2"), text(" holds"))]}

    xml = document_xml(render_docx(doc, "T", get_style("apa")))

    assert "oMath" in xml
    assert "where " in xml and " holds" in xml


def test_inline_equation_keeps_its_place_in_the_sentence():
    """OMML is appended to the paragraph, not to a run. If that ordering breaks,
    the equation jumps to the end of the sentence."""
    doc = {"type": "doc", "content": [para(text("before "), math_inline("x"), text(" after"))]}

    xml = document_xml(render_docx(doc, "T", get_style("apa")))

    body = xml[xml.index("<w:body>") :]
    assert body.index("before ") < body.index("oMath") < body.index(" after")


def test_unparseable_equation_falls_back_to_its_source():
    """Never silently drop an equation: a broken one shows its LaTeX."""
    doc = {"type": "doc", "content": [math_block(r"\frac{")]}

    document = render_docx(doc, "T", get_style("apa"))

    assert r"\frac{" in "\n".join(p.text for p in document.paragraphs)


def test_equation_does_not_disturb_surrounding_content():
    doc = {
        "type": "doc",
        "content": [
            {"type": "heading", "attrs": {"level": 1}, "content": [text("Method")]},
            math_block(r"\sum_{i=1}^{n} x_i"),
            para(text("body")),
        ],
    }

    document = render_docx(doc, "T", get_style("apa"))
    rendered = "\n".join(p.text for p in document.paragraphs)

    assert "Method" in rendered
    assert "body" in rendered


def test_math_runs_use_the_math_font():
    xml = document_xml(render_docx({"type": "doc", "content": [math_block("x")]}, "T", get_style("apa")))

    assert "Cambria Math" in xml


def test_display_equation_is_centred():
    document = render_docx({"type": "doc", "content": [math_block("x")]}, "T", get_style("apa"))

    equation_paragraphs = [p for p in document.paragraphs if p._p.findall(f".//{M}oMath")]
    assert equation_paragraphs
    assert equation_paragraphs[0].alignment is not None


def test_greek_and_symbols_survive():
    omml = latex_to_omml(r"\alpha + \beta \leq \gamma")

    assert omml is not None
    rendered = "".join(t.text or "" for t in omml.iter(f"{M}t"))
    assert "α" in rendered and "β" in rendered


def test_a_document_of_only_equations_still_renders():
    doc = {"type": "doc", "content": [math_block("x^2"), math_block("y^2")]}

    xml = document_xml(render_docx(doc, "T", get_style("apa")))

    assert len(re.findall(r"oMathPara", xml)) >= 2
