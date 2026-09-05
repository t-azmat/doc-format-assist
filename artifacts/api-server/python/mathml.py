"""LaTeX → OMML (Office Math Markup Language), for equations in exported DOCX.

Word stores equations as OMML, not as images and not as LaTeX. Emitting OMML is
what makes an exported equation a real Word equation: editable in the equation
editor, reflowing with the text, honoring the document font, and surviving the
LibreOffice PDF step as vector output. Rendering equations to PNG instead — the
obvious shortcut — pins them to one resolution and makes them uneditable.

The path is LaTeX → MathML (latex2mathml) → OMML (this module). Office ships an
XSLT for the second leg (MML2OMML.XSL), but it is not redistributable and would
not exist in the Docker image, so the transform is implemented here.

Coverage is the subset that appears in papers: fractions, sub/superscripts,
radicals, delimiters, n-ary operators with limits, accents, and matrices.
Anything unrecognised degrades to upright text rather than vanishing, and a
LaTeX string that will not parse at all returns None so the caller can fall back
to showing the source.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET

from docx.oxml import OxmlElement
from docx.oxml.ns import qn

# Operators that take limits above/below rather than as plain sub/superscripts.
_NARY = {
    "∑",  # ∑
    "∏",  # ∏
    "∐",  # ∐
    "∫",  # ∫
    "∬",  # ∬
    "∭",  # ∭
    "∮",  # ∮
    "⋀",  # ⋀
    "⋁",  # ⋁
    "⋂",  # ⋂
    "⋃",  # ⋃
}

# Integrals put their limits at the corners; sums and products sit over/under.
_LIMIT_OVER_UNDER = _NARY - {"∫", "∬", "∭", "∮"}

_ACCENTS = {
    "¯": "̅",  # macron  → combining overline
    "→": "⃗",  # vector arrow
    "^": "̂",  # hat
    "ˆ": "̂",
    "~": "̃",  # tilde
    "˜": "̃",
    "˙": "̇",  # dot
    "¨": "̈",  # ddot
}

MATH_FONT = "Cambria Math"


def _el(tag: str, **attrs):
    element = OxmlElement(tag)
    for name, value in attrs.items():
        element.set(qn(name), value)
    return element


def _prop(parent, tag: str, value: str):
    """An OMML property element, which carries its value in m:val."""
    node = _el(tag)
    node.set(qn("m:val"), value)
    parent.append(node)
    return node


def _run(text: str, upright: bool, size_pt: float | None):
    """An m:r math run.

    Child order is fixed by the schema: m:rPr, then w:rPr, then m:t. Word is
    unforgiving about this — out-of-order children make the equation fail to
    load rather than render badly.
    """
    run = _el("m:r")

    if upright:
        # Without this, Word italicises everything in a math run, which is
        # correct for variables and wrong for digits, operators and words.
        rpr = _el("m:rPr")
        _prop(rpr, "m:sty", "p")
        run.append(rpr)

    wpr = _el("w:rPr")
    fonts = _el("w:rFonts")
    for attr in ("w:ascii", "w:hAnsi"):
        fonts.set(qn(attr), MATH_FONT)
    wpr.append(fonts)
    if size_pt:
        # Word measures in half-points.
        _prop(wpr, "w:sz", str(int(round(size_pt * 2))))
    run.append(wpr)

    t = _el("m:t")
    # Leading/trailing spaces are meaningful around operators.
    t.set(qn("xml:space"), "preserve")
    t.text = text
    run.append(t)
    return run


def _tag(node) -> str:
    return node.tag.split("}")[-1]


def _text_of(node) -> str:
    return (node.text or "").strip()


def _wrap(tag: str, children: list):
    node = _el(tag)
    for child in children:
        node.append(child)
    return node


def _is_nary(node) -> bool:
    return _tag(node) == "mo" and _text_of(node) in _NARY


class _Converter:
    def __init__(self, size_pt: float | None):
        self.size_pt = size_pt

    def run(self, text: str, upright: bool):
        return _run(text, upright, self.size_pt)

    # -- element dispatch ----------------------------------------------------

    def convert_children(self, node) -> list:
        """Convert a node's children, folding n-ary operators into the operand
        that follows them.

        MathML writes `∑` and its operand as siblings; OMML nests the operand
        inside the m:nary element. Without this the limits render detached from
        what they range over.
        """
        children = list(node)
        out: list = []
        index = 0
        while index < len(children):
            child = children[index]
            nary = self._nary_of(child)
            if nary is not None:
                operator, sub, sup = nary
                operand = children[index + 1] if index + 1 < len(children) else None
                out.append(self.nary(operator, sub, sup, operand))
                index += 2 if operand is not None else 1
                continue
            out.extend(self.convert(child))
            index += 1
        return out

    def _nary_of(self, node):
        """Decompose a scripted n-ary operator into (operator, sub, sup)."""
        tag = _tag(node)
        if tag in ("msubsup", "munderover"):
            parts = list(node)
            if len(parts) == 3 and _is_nary(parts[0]):
                return parts[0], parts[1], parts[2]
        elif tag in ("msub", "munder"):
            parts = list(node)
            if len(parts) == 2 and _is_nary(parts[0]):
                return parts[0], parts[1], None
        elif tag in ("msup", "mover"):
            parts = list(node)
            if len(parts) == 2 and _is_nary(parts[0]):
                return parts[0], None, parts[1]
        elif _is_nary(node):
            return node, None, None
        return None

    def convert(self, node) -> list:
        tag = _tag(node)
        handler = getattr(self, f"_{tag}", None)
        if handler is not None:
            return handler(node)
        # mstyle, mpadded, semantics and friends: transparent containers.
        if len(node):
            return self.convert_children(node)
        text = _text_of(node)
        return [self.run(text, upright=True)] if text else []

    def _element(self, node) -> list:
        """Children wrapped so a construct that needs exactly one child gets one."""
        return self.convert_children(node)

    def _arg(self, node):
        """Convert one MathML argument into an OMML m:e-style container body."""
        if node is None:
            return []
        return self.convert(node)

    # -- leaves --------------------------------------------------------------

    def _mi(self, node) -> list:
        text = _text_of(node)
        if not text:
            return []
        # Multi-character identifiers are function names (sin, log, max) and are
        # set upright; a single letter is a variable and stays italic.
        return [self.run(text, upright=len(text) > 1)]

    def _mn(self, node) -> list:
        text = _text_of(node)
        return [self.run(text, upright=True)] if text else []

    def _mo(self, node) -> list:
        text = _text_of(node)
        return [self.run(text, upright=True)] if text else []

    def _mtext(self, node) -> list:
        text = node.text or ""
        return [self.run(text, upright=True)] if text.strip() else []

    _ms = _mtext

    def _mspace(self, node) -> list:
        return []

    def _mphantom(self, node) -> list:
        return []

    def _mrow(self, node) -> list:
        return self.convert_children(node)

    # -- structures ----------------------------------------------------------

    def _mfrac(self, node) -> list:
        parts = list(node)
        if len(parts) != 2:
            return self.convert_children(node)
        frac = _el("m:f")
        frac.append(_wrap("m:num", self._arg(parts[0])))
        frac.append(_wrap("m:den", self._arg(parts[1])))
        return [frac]

    def _msup(self, node) -> list:
        parts = list(node)
        if len(parts) != 2:
            return self.convert_children(node)
        sup = _el("m:sSup")
        sup.append(_wrap("m:e", self._arg(parts[0])))
        sup.append(_wrap("m:sup", self._arg(parts[1])))
        return [sup]

    def _msub(self, node) -> list:
        parts = list(node)
        if len(parts) != 2:
            return self.convert_children(node)
        sub = _el("m:sSub")
        sub.append(_wrap("m:e", self._arg(parts[0])))
        sub.append(_wrap("m:sub", self._arg(parts[1])))
        return [sub]

    def _msubsup(self, node) -> list:
        parts = list(node)
        if len(parts) != 3:
            return self.convert_children(node)
        both = _el("m:sSubSup")
        both.append(_wrap("m:e", self._arg(parts[0])))
        both.append(_wrap("m:sub", self._arg(parts[1])))
        both.append(_wrap("m:sup", self._arg(parts[2])))
        return [both]

    def _msqrt(self, node) -> list:
        rad = _el("m:rad")
        pr = _el("m:radPr")
        _prop(pr, "m:degHide", "1")
        rad.append(pr)
        rad.append(_el("m:deg"))  # present but empty, as degHide requires
        rad.append(_wrap("m:e", self.convert_children(node)))
        return [rad]

    def _mroot(self, node) -> list:
        parts = list(node)
        if len(parts) != 2:
            return self._msqrt(node)
        rad = _el("m:rad")
        rad.append(_wrap("m:deg", self._arg(parts[1])))
        rad.append(_wrap("m:e", self._arg(parts[0])))
        return [rad]

    def _mfenced(self, node) -> list:
        delim = _el("m:d")
        pr = _el("m:dPr")
        _prop(pr, "m:begChr", node.get("open", "("))
        _prop(pr, "m:endChr", node.get("close", ")"))
        delim.append(pr)
        delim.append(_wrap("m:e", self.convert_children(node)))
        return [delim]

    def _munder(self, node) -> list:
        parts = list(node)
        if len(parts) != 2:
            return self.convert_children(node)
        low = _el("m:limLow")
        low.append(_wrap("m:e", self._arg(parts[0])))
        low.append(_wrap("m:lim", self._arg(parts[1])))
        return [low]

    def _mover(self, node) -> list:
        parts = list(node)
        if len(parts) != 2:
            return self.convert_children(node)

        # An accent (bar, hat, vector arrow) is an m:acc, not a limit.
        mark = _text_of(parts[1])
        if _tag(parts[1]) == "mo" and mark in _ACCENTS:
            acc = _el("m:acc")
            pr = _el("m:accPr")
            _prop(pr, "m:chr", _ACCENTS[mark])
            acc.append(pr)
            acc.append(_wrap("m:e", self._arg(parts[0])))
            return [acc]

        upp = _el("m:limUpp")
        upp.append(_wrap("m:e", self._arg(parts[0])))
        upp.append(_wrap("m:lim", self._arg(parts[1])))
        return [upp]

    def _munderover(self, node) -> list:
        parts = list(node)
        if len(parts) != 3:
            return self.convert_children(node)
        # Stack the two limits: lower limit on the base, upper on the result.
        low = _el("m:limLow")
        low.append(_wrap("m:e", self._arg(parts[0])))
        low.append(_wrap("m:lim", self._arg(parts[1])))
        upp = _el("m:limUpp")
        upp.append(_wrap("m:e", [low]))
        upp.append(_wrap("m:lim", self._arg(parts[2])))
        return [upp]

    def nary(self, operator, sub, sup, operand) -> object:
        char = _text_of(operator)
        node = _el("m:nary")
        pr = _el("m:naryPr")
        _prop(pr, "m:chr", char)
        _prop(
            pr,
            "m:limLoc",
            "undOvr" if char in _LIMIT_OVER_UNDER else "subSup",
        )
        _prop(pr, "m:subHide", "0" if sub is not None else "1")
        _prop(pr, "m:supHide", "0" if sup is not None else "1")
        node.append(pr)
        node.append(_wrap("m:sub", self._arg(sub)))
        node.append(_wrap("m:sup", self._arg(sup)))
        node.append(_wrap("m:e", self._arg(operand)))
        return node

    # -- matrices ------------------------------------------------------------

    def _mtable(self, node) -> list:
        rows = [child for child in node if _tag(child) == "mtr"]
        if not rows:
            return self.convert_children(node)
        matrix = _el("m:m")
        for row in rows:
            mr = _el("m:mr")
            for cell in row:
                mr.append(_wrap("m:e", self.convert_children(cell)))
            matrix.append(mr)
        return [matrix]


def latex_to_omml(latex: str, display: bool = False, size_pt: float | None = None):
    """Convert a LaTeX string to an OMML element, or None if it will not parse.

    Returns `m:oMathPara` for display equations (it centres the equation on its
    own line) and a bare `m:oMath` for inline ones. Both are appended to a
    paragraph's `w:p`.
    """
    source = (latex or "").strip()
    if not source:
        return None

    try:
        from latex2mathml.converter import convert as latex_to_mathml

        mathml = latex_to_mathml(source)
        root = ET.fromstring(mathml)
    except Exception:
        # Malformed LaTeX, or latex2mathml missing. The caller writes the
        # source text instead, so the content is never silently lost.
        return None

    converter = _Converter(size_pt)
    try:
        body = converter.convert_children(root)
    except Exception:
        return None
    if not body:
        return None

    omath = _wrap("m:oMath", body)
    if not display:
        return omath

    para = _el("m:oMathPara")
    pr = _el("m:oMathParaPr")
    _prop(pr, "m:jc", "center")
    para.append(pr)
    para.append(omath)
    return para
