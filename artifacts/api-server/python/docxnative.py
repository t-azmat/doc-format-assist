"""Native DOCX extraction using python-docx.

Reads a Word document's ACTUAL authored structure — paragraph styles (headings,
lists, captions), real tables, inline run formatting (bold/italic), embedded
images, and the section column count — rather than inferring layout from
geometry the way Docling does. Used for .docx inputs; PDFs still go through
Docling because they carry no semantic structure.
"""

from __future__ import annotations

import base64
import re

from docx import Document
from docx.document import Document as _Document
from docx.oxml.ns import qn
from docx.table import Table as DocxTable
from docx.text.paragraph import Paragraph
from docx.text.run import Run


def _iter_block_items(parent):
    """Yield Paragraph and Table children of a document/cell in document order
    (python-docx has no built-in interleaved iterator)."""
    if isinstance(parent, _Document):
        parent_elm = parent.element.body
    else:
        parent_elm = parent._tc
    for child in parent_elm.iterchildren():
        if child.tag == qn("w:p"):
            yield Paragraph(child, parent)
        elif child.tag == qn("w:tbl"):
            yield DocxTable(child, parent)


def _level_from_name(style_name: str):
    """Read a heading level out of a style's name.

    `re.search`, not `re.match`: real documents rarely use the stock "Heading 1"
    name. This paper uses "IEEE Heading 1", and template-derived names like
    "Chapter Heading 2" or "Heading 1 Char" are just as common. Anchoring at the
    start meant every one of them extracted as a plain paragraph — no headings,
    so no outline, no compliance check, and nothing for a table of contents to
    link to.
    """
    s = (style_name or "").strip().lower()
    if not s:
        return None
    # "Heading 1 Char" and friends are *character* styles; they never mark a
    # heading paragraph, and treating them as one promotes stray inline text.
    if s.endswith(" char"):
        return None
    if "subtitle" in s:
        return None
    if "title" in s:
        return 1
    m = re.search(r"heading\s*(\d+)", s)
    if m:
        return min(max(int(m.group(1)), 1), 3)
    return None


def _outline_level(element):
    """Word's own `w:outlineLvl` — the semantic 'this is a heading at level N'.

    More reliable than a name when it is present, and it is what Word itself
    uses to build a table of contents. Zero-based in the XML.
    """
    try:
        p_pr = element.find(qn("w:pPr"))
        if p_pr is None:
            return None
        lvl = p_pr.find(qn("w:outlineLvl"))
        if lvl is None:
            return None
        val = lvl.get(qn("w:val"))
        if val is None:
            return None
        # 9 means "body text" in Word's scheme, not a tenth heading level.
        level = int(val)
        return None if level >= 9 else min(level + 1, 3)
    except Exception:
        return None


def _style_chain(style, limit: int = 8):
    """Yield a style and everything it is based on.

    A document that defines "My Section" as basedOn "Heading 2" should have its
    sections recognised even though the name says nothing.
    """
    seen = 0
    while style is not None and seen < limit:
        yield style
        seen += 1
        try:
            style = style.base_style
        except Exception:
            return


def _heading_level(paragraph: Paragraph):
    """Resolve a paragraph's heading level, or None for body text."""
    # 1. An explicit outline level on the paragraph wins over everything.
    direct = _outline_level(paragraph._p)
    if direct is not None:
        return direct

    style = paragraph.style if paragraph is not None else None
    for candidate in _style_chain(style):
        name = getattr(candidate, "name", "") or ""
        level = _level_from_name(name)
        if level is not None:
            return level
        try:
            level = _outline_level(candidate.element)
        except Exception:
            level = None
        if level is not None:
            return level

    return None


def _list_kind(style_name: str):
    s = (style_name or "").lower()
    if "list number" in s:
        return "ordered"
    if "list bullet" in s:
        return "bullet"
    return None


def _has_numbering(p: Paragraph) -> bool:
    ppr = p._p.pPr
    return ppr is not None and ppr.numPr is not None


def _iter_runs(p: Paragraph):
    """Yield a paragraph's runs *including* those nested inside hyperlinks.

    python-docx's `Paragraph.runs` is `self._p.r_lst` — direct `<w:r>` children
    only. Every run inside a `<w:hyperlink>` is therefore invisible to it, which
    silently drops cross-references and, most visibly, the entire body of a
    Word-generated table of contents (whose entries are all hyperlinks).
    """
    for child in p._p.iterchildren():
        if child.tag == qn("w:r"):
            yield Run(child, p)
        elif child.tag == qn("w:hyperlink"):
            for r in child.findall(qn("w:r")):
                yield Run(r, p)


def _inline_and_images(p: Paragraph, doc, *, italic: bool = False):
    """Return (inline text nodes with bold/italic marks, block image nodes) for
    a paragraph's runs."""
    inline: list[dict] = []
    images: list[dict] = []
    for run in _iter_runs(p):
        for blip in run.element.findall(".//" + qn("a:blip")):
            rid = blip.get(qn("r:embed"))
            if not rid:
                continue
            part = doc.part.related_parts.get(rid)
            if part is None:
                continue
            try:
                content_type = getattr(part, "content_type", "") or "image/png"
                encoded = base64.b64encode(part.blob).decode("ascii")
                images.append(
                    {"type": "image", "attrs": {"src": f"data:{content_type};base64,{encoded}"}}
                )
            except Exception:
                pass
        text = run.text
        if not text:
            continue
        marks = []
        if run.bold:
            marks.append({"type": "bold"})
        if run.italic or italic:
            marks.append({"type": "italic"})
        node = {"type": "text", "text": text}
        if marks:
            node["marks"] = marks
        inline.append(node)
    return inline, images


def _paragraph_node(inline: list[dict]) -> dict:
    return {"type": "paragraph", "content": inline} if inline else {"type": "paragraph"}


def _table_node(tbl: DocxTable, doc) -> dict | None:
    rows = []
    for ri, row in enumerate(tbl.rows):
        cells = []
        for cell in row.cells:
            blocks = []
            for p in cell.paragraphs:
                inline, _imgs = _inline_and_images(p, doc)
                blocks.append(_paragraph_node(inline))
            if not blocks:
                blocks = [{"type": "paragraph"}]
            cells.append(
                {"type": "tableHeader" if ri == 0 else "tableCell", "content": blocks}
            )
        if cells:
            rows.append({"type": "tableRow", "content": cells})
    return {"type": "table", "content": rows} if rows else None


def _columns(doc) -> int:
    try:
        cols = doc.sections[0]._sectPr.find(qn("w:cols"))
        if cols is not None:
            num = cols.get(qn("w:num"))
            return int(num) if num else 1
    except Exception:
        pass
    return 1


def _style_font(doc, name: str):
    try:
        st = doc.styles[name]
        size = st.font.size.pt if st.font.size else None
        return st.font.name, (round(size) if size else None)
    except Exception:
        return None, None


def _in(length):
    try:
        return round(length.inches, 3)
    except Exception:
        return None


def extract_design(doc) -> dict:
    """Read the document's actual design — page size, margins, columns, and the
    base/heading typography — from the section and named styles, so the editor
    renders the real layout instead of assumed defaults."""
    sect = doc.sections[0]
    design: dict = {
        "id": "source",
        "name": "Original layout",
        "columns": _columns(doc),
    }
    pw, ph = _in(sect.page_width), _in(sect.page_height)
    if pw:
        design["page_width_in"] = pw
    if ph:
        design["page_height_in"] = ph

    margins = {
        "top": _in(sect.top_margin),
        "bottom": _in(sect.bottom_margin),
        "left": _in(sect.left_margin),
        "right": _in(sect.right_margin),
    }
    margins = {k: v for k, v in margins.items() if v is not None}
    if margins:
        design["margins_in"] = margins

    body_font, body_size = _style_font(doc, "Normal")
    if body_font:
        design["body_font"] = body_font
        design["heading_font"] = body_font
    if body_size:
        design["body_size_pt"] = body_size

    try:
        ls = doc.styles["Normal"].paragraph_format.line_spacing
        if ls:
            design["line_spacing"] = float(ls)
    except Exception:
        pass

    heading_sizes = {}
    for level, name in ((1, "Heading 1"), (2, "Heading 2"), (3, "Heading 3")):
        _f, size = _style_font(doc, name)
        if size:
            heading_sizes[str(level)] = size
    if heading_sizes:
        design["heading_sizes_pt"] = heading_sizes

    return design


def extract_docx(path: str) -> dict:
    doc = Document(path)
    content: list[dict] = []
    list_buffer: list[dict] = []
    list_kind: str | None = None
    sections: list[dict] = []
    references: list[str] = []
    in_refs = False
    pic_count = 0

    def flush_list():
        nonlocal list_buffer, list_kind
        if list_buffer:
            content.append(
                {
                    "type": "orderedList" if list_kind == "ordered" else "bulletList",
                    "content": [
                        {"type": "listItem", "content": [item]} for item in list_buffer
                    ],
                }
            )
        list_buffer = []
        list_kind = None

    for block in _iter_block_items(doc):
        if isinstance(block, DocxTable):
            flush_list()
            table_node = _table_node(block, doc)
            if table_node:
                content.append(table_node)
            continue

        p = block
        style = p.style.name if p.style else ""
        text = (p.text or "").strip()
        level = _heading_level(p)
        kind = _list_kind(style)
        is_caption = style.strip().lower() == "caption"
        inline, images = _inline_and_images(p, doc, italic=is_caption)

        if level is not None:
            flush_list()
            in_refs = text.lower().startswith(("references", "bibliography", "works cited"))
            sections.append({"level": level, "title": text})
            node = {"type": "heading", "attrs": {"level": level}}
            if inline:
                node["content"] = inline
            content.append(node)
        elif kind or (style.strip().lower() == "list paragraph" and _has_numbering(p)):
            k = kind or "bullet"
            if list_kind and list_kind != k:
                flush_list()
            list_kind = k
            list_buffer.append(_paragraph_node(inline))
        else:
            flush_list()
            if inline:
                content.append(_paragraph_node(inline))
            if in_refs and text:
                references.append(text)

        for img in images:
            flush_list()
            content.append(img)
            pic_count += 1

    flush_list()
    if not content:
        content = [{"type": "paragraph"}]

    return {
        "editorContent": {"type": "doc", "content": content},
        "sections": sections,
        "references": references,
        "tableCount": len(doc.tables),
        "pictureCount": pic_count,
        "columns": _columns(doc),
        "design": extract_design(doc),
    }
