#!/usr/bin/env python3
"""Export a TipTap document to a formatted DOCX (and optionally PDF via
LibreOffice) file honoring a conference style's typography/layout rules.

Usage: python3 export.py <output-docx-path> [--pdf <output-pdf-path>]
Reads a JSON object from stdin: {"editorContent": <tiptap doc>, "title": str, "conferenceStyle": "ieee"|"apa"|"acm"}
"""

import base64
import io
import json
import subprocess
import sys
import tempfile
import os
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT, WD_TAB_LEADER
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt

from authorblock import render_author_block
from docclass import DocumentClass, class_for_style, resolve_document_class
from docxfont import BLACK, apply_run_font as _apply_run_font, clear_theme_fonts as _clear_theme_fonts
from mathml import latex_to_omml
from references import (
    bibliography as build_bibliography,
    citation_label,
    is_numeric,
    numbering as reference_numbering,
    parse_references,
)
from styles import StyleSpec

# LibreOffice startup dominates conversion time for normal papers, but a
# 100-page manuscript with images legitimately takes a while. Overridable so a
# deployment can tune it without a code change.
PDF_TIMEOUT_SEC = 180


def _set_section_columns(section, columns: int) -> None:
    """Set the column count on one section.

    Per *section*, not per document. That distinction is the whole point: a
    two-column paper is a full-width section holding the title and author block
    followed by a two-column section holding the body. Setting columns on the
    document put the title inside the left column instead of across the page.
    """
    sect_pr = section._sectPr
    cols = sect_pr.find(qn("w:cols"))
    if cols is None:
        cols = sect_pr.makeelement(qn("w:cols"), {})
        sect_pr.append(cols)
    cols.set(qn("w:num"), str(max(1, columns)))
    cols.set(qn("w:space"), "288")  # 0.2in gutter


def _normalize_named_styles(document: Document, style: StyleSpec) -> None:
    """Rewrite the built-in Title/Heading styles to the conference typeface.

    Without this, python-docx's default template renders every heading in blue
    Calibri Light with a bottom border — nothing like a submission-ready paper,
    and not what the style spec asked for.
    """
    targets = [("Title", style.heading_sizes_pt.get(1, 14) + 2)]
    for level in (1, 2, 3):
        targets.append(
            (f"Heading {level}", style.heading_sizes_pt.get(level, style.body_size_pt))
        )

    for name, size_pt in targets:
        try:
            named = document.styles[name]
        except KeyError:
            continue
        named.font.name = style.heading_font
        named.font.size = Pt(size_pt)
        named.font.bold = True
        named.font.color.rgb = BLACK
        _clear_theme_fonts(named.element, style.heading_font)
        try:
            named.paragraph_format.space_before = Pt(6)
            named.paragraph_format.space_after = Pt(3)
            named.paragraph_format.line_spacing = 1.0
            named.paragraph_format.keep_with_next = True
        except Exception:
            pass
        # The Title style carries a decorative bottom border in the default
        # template; drop it.
        try:
            p_pr = named.element.get_or_add_pPr()
            for borders in p_pr.findall(qn("w:pBdr")):
                p_pr.remove(borders)
        except Exception:
            pass


def _apply_page_setup(document: Document, style: StyleSpec) -> None:
    section = document.sections[0]
    # Page size first: Word's default is US Letter, so an A4 source document
    # would otherwise silently reflow onto the wrong page — a desk-reject at
    # venues that check trim size.
    section.page_width = Inches(style.page_width_in)
    section.page_height = Inches(style.page_height_in)
    section.top_margin = Inches(style.margins_in["top"])
    section.bottom_margin = Inches(style.margins_in["bottom"])
    section.left_margin = Inches(style.margins_in["left"])
    section.right_margin = Inches(style.margins_in["right"])

    normal = document.styles["Normal"]
    normal.font.name = style.body_font
    normal.font.size = Pt(style.body_size_pt)
    normal.font.color.rgb = BLACK
    normal.paragraph_format.line_spacing = style.line_spacing
    # The default template adds 8pt after every paragraph, which fights the
    # spec's line spacing (double-spaced APA ends up unevenly spaced).
    normal.paragraph_format.space_after = Pt(0)
    normal.paragraph_format.space_before = Pt(0)
    _clear_theme_fonts(normal.element, style.body_font)

    _normalize_named_styles(document, style)
    # Columns are deliberately not set here. They belong to the body section,
    # which does not exist yet — see _begin_body_section.


def _heading_text(node: dict) -> str:
    return "".join(
        child.get("text", "") for child in node.get("content", []) if child.get("type") == "text"
    ).strip()


def _collect_text(node: dict) -> str:
    if node.get("type") == "text":
        return node.get("text", "")
    return "".join(_collect_text(c) for c in node.get("content", []) or [])




def _add_math(paragraph, node: dict, style: StyleSpec, size_pt: float, display: bool) -> None:
    """Append an equation to `paragraph` as native OMML.

    OMML elements are appended to the paragraph's `w:p` directly rather than
    through a run, because an equation is a sibling of the runs, not one of
    them. That is only correct while the paragraph is still being built in
    reading order — which is how every caller here uses it.

    A LaTeX string Word cannot be given (unparseable, or latex2mathml absent)
    falls back to the source text in a monospace run. An equation that renders
    as its own source is poor, but it is recoverable; one that silently
    disappears is not.
    """
    latex = (node.get("attrs") or {}).get("latex", "")
    omml = latex_to_omml(latex, display=display, size_pt=size_pt)
    if omml is not None:
        paragraph._p.append(omml)
        return
    if latex:
        run = paragraph.add_run(latex)
        _apply_run_font(run, "Courier New", size_pt)


def _add_inline_runs(
    paragraph,
    node: dict,
    style: StyleSpec,
    *,
    bold: bool = False,
    italic: bool = False,
    font_name: str | None = None,
    size_pt: float | None = None,
) -> None:
    """Add runs for a block node's inline content, honoring marks and hard
    breaks so editor formatting survives export."""
    children = node.get("content", []) or []
    if not children:
        return

    face = font_name or style.body_font
    size = size_pt if size_pt is not None else style.body_size_pt

    for child in children:
        child_type = child.get("type")

        if child_type == "hardBreak":
            # A shift+enter break inside a paragraph; previously dropped
            # entirely, silently joining two lines.
            run = paragraph.add_run()
            run.add_break()
            continue

        if child_type in ("mathInline", "math_inline"):
            _add_math(paragraph, child, style, size, display=False)
            continue

        if child_type in ("citation", "cite"):
            label = _CITATION_CONTEXT.label(child)
            if label:
                _apply_run_font(paragraph.add_run(label), face, size)
            continue

        if child_type == "text":
            text = child.get("text", "")
        else:
            text = _collect_text(child)
        if not text:
            continue

        marks = {m.get("type") for m in child.get("marks", []) or []}
        run = paragraph.add_run(text)
        _apply_run_font(
            run,
            "Courier New" if "code" in marks else face,
            size,
            bold=bold or ("bold" in marks),
            italic=italic or ("italic" in marks),
            strike="strike" in marks,
            underline="underline" in marks or "link" in marks,
        )


def _add_paragraph(document: Document, style_name: str | None = None):
    """add_paragraph, tolerating templates that lack a named style."""
    if style_name:
        try:
            return document.add_paragraph(style=style_name)
        except KeyError:
            pass
    return document.add_paragraph()


def _add_image(document: Document, src: str, max_width_in: float = 5.5) -> None:
    if not isinstance(src, str) or not src.startswith("data:"):
        return
    try:
        _, b64 = src.split(",", 1)
        data = base64.b64decode(b64)
    except Exception:
        return
    try:
        from PIL import Image as PILImage

        probe = PILImage.open(io.BytesIO(data))
        w_px, h_px = probe.size
        dpi = (probe.info.get("dpi") or (96, 96))[0] or 96
        width = Inches(min(w_px / dpi, max_width_in))
    except Exception:
        width = Inches(min(4.0, max_width_in))
    try:
        document.add_picture(io.BytesIO(data), width=width)
        document.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    except Exception:
        pass


def _add_table(document: Document, node: dict, style: StyleSpec) -> None:
    rows = node.get("content", []) or []
    if not rows:
        return
    num_cols = 0
    for row in rows:
        span = sum(
            int(c.get("attrs", {}).get("colspan", 1) or 1)
            for c in row.get("content", []) or []
        )
        num_cols = max(num_cols, span)
    if num_cols == 0:
        return

    table = document.add_table(rows=len(rows), cols=num_cols)
    try:
        table.style = "Table Grid"
    except Exception:
        pass

    for ri, row in enumerate(rows):
        col = 0
        for cell in row.get("content", []) or []:
            if col >= num_cols:
                break
            docx_cell = table.cell(ri, col)
            docx_cell.text = ""
            is_header = cell.get("type") == "tableHeader"
            # Cell content is block-level. Reuse the cell's existing empty
            # paragraph for the first block, then append one paragraph per
            # further block instead of concatenating them all onto one line.
            blocks = [
                b for b in (cell.get("content", []) or [])
                if b.get("type") in ("paragraph", "heading")
            ]
            for bi, block in enumerate(blocks):
                paragraph = (
                    docx_cell.paragraphs[0] if bi == 0 else docx_cell.add_paragraph()
                )
                paragraph.paragraph_format.line_spacing = 1.0
                _add_inline_runs(paragraph, block, style, bold=is_header)
            col += max(1, int(cell.get("attrs", {}).get("colspan", 1) or 1))


# ---------------------------------------------------------------------------
# Table of contents
#
# A TOC is only useful if its entries are links. Word builds one from bookmarks
# it drops on each heading; nothing here did that, so an exported document's
# contents page was inert text — the complaint that started this.
#
# Every heading gets a bookmark, and a detected contents section is rebuilt from
# those bookmarks as real internal hyperlinks with PAGEREF page numbers.
# ---------------------------------------------------------------------------

# How each heading level is set apart. Sizes come from the style spec, but
# every preset collapses at the deepest level (IEEE level 3 is 10pt, the same as
# body), so weight/slant/alignment carry the hierarchy — the same device the
# printed styles themselves use.
_HEADING_EMPHASIS = {
    1: {"bold": True, "italic": False, "alignment": WD_ALIGN_PARAGRAPH.CENTER},
    2: {"bold": True, "italic": True, "alignment": WD_ALIGN_PARAGRAPH.LEFT},
    3: {"bold": False, "italic": True, "alignment": WD_ALIGN_PARAGRAPH.LEFT},
}

_TOC_TITLES = {
    "contents",
    "table of contents",
    "toc",
    "table of content",
}


def _set_xml_space_preserve(element) -> None:
    # The xml prefix is not in python-docx's nsmap, so qn() cannot build it.
    element.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")


def _add_bookmark(paragraph, name: str, bookmark_id: int) -> None:
    p = paragraph._p
    start = OxmlElement("w:bookmarkStart")
    start.set(qn("w:id"), str(bookmark_id))
    start.set(qn("w:name"), name)
    end = OxmlElement("w:bookmarkEnd")
    end.set(qn("w:id"), str(bookmark_id))

    # w:pPr has to stay the first child of w:p, so the bookmark goes after it.
    p_pr = p.find(qn("w:pPr"))
    if p_pr is not None:
        p_pr.addnext(start)
    else:
        p.insert(0, start)
    p.append(end)


def _add_internal_link(paragraph, anchor: str, text: str, style: StyleSpec, size_pt: float):
    """Append `text` as a hyperlink to a bookmark in this document.

    Renders as a real link in Word and survives LibreOffice's PDF conversion as
    an internal PDF destination, which is what makes a contents page clickable.
    """
    link = OxmlElement("w:hyperlink")
    link.set(qn("w:anchor"), anchor)

    run = paragraph.add_run(text)
    _apply_run_font(run, style.body_font, size_pt)
    paragraph._p.remove(run._r)
    link.append(run._r)
    paragraph._p.append(link)
    return run


def _add_pageref(paragraph, anchor: str, style: StyleSpec, size_pt: float) -> None:
    """A PAGEREF field, so the page number is computed by the reader.

    The cached "1" between `separate` and `end` is what a viewer shows before it
    updates fields; Word refreshes on print or F9, and LibreOffice resolves it
    during conversion.
    """
    def _wrap(child):
        r = OxmlElement("w:r")
        r.append(child)
        paragraph._p.append(r)

    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    _set_xml_space_preserve(instr)
    instr.text = f" PAGEREF {anchor} \\h "
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")

    _wrap(begin)
    _wrap(instr)
    _wrap(separate)
    placeholder = paragraph.add_run("1")
    _apply_run_font(placeholder, style.body_font, size_pt)
    _wrap(end)


def _collect_headings(nodes: list[dict], numbers: dict[int, str] | None = None) -> list[dict]:
    """Assign a stable bookmark to every heading, in document order."""
    headings = []
    numbers = numbers or {}
    for index, node in enumerate(nodes):
        if node.get("type") != "heading":
            continue
        text = _heading_text(node)
        if not text:
            continue
        # The contents page lists headings as they appear in the body, numbers
        # included; the two are computed from one map so they cannot drift.
        if numbers.get(index):
            text = f"{numbers[index]} {text}"
        level = node.get("attrs", {}).get("level", 1)
        try:
            level = max(1, min(int(level), 3))
        except (TypeError, ValueError):
            level = 1
        headings.append(
            # Word's own convention for TOC targets, so the names do not collide
            # with any bookmark the author already had.
            {"index": index, "level": level, "text": text, "anchor": f"_Toc{index:05d}"}
        )
    return headings


def _find_toc_region(nodes: list[dict]) -> tuple[int, int] | None:
    """Locate an existing contents section: (heading index, end of its entries).

    A TOC is a heading called "Contents" followed by entry paragraphs, up to the
    next heading. Returns None when the document has no such section — this
    never invents a contents page that the author did not already have.
    """
    for index, node in enumerate(nodes):
        if node.get("type") != "heading":
            continue
        title = _heading_text(node).strip().lower().rstrip(":.")
        if title not in _TOC_TITLES:
            continue
        end = index + 1
        while end < len(nodes) and nodes[end].get("type") != "heading":
            end += 1
        return index, end
    return None


def _add_toc(
    document: Document,
    entries: list[dict],
    style: StyleSpec,
    printable_width_in: float,
) -> None:
    for entry in entries:
        paragraph = _add_paragraph(document)
        fmt = paragraph.paragraph_format
        fmt.line_spacing = 1.0
        fmt.space_after = Pt(2)
        fmt.left_indent = Inches(0.25 * (entry["level"] - 1))
        # Right-aligned tab with a dot leader: the page number lines up at the
        # measure regardless of how long the heading is.
        try:
            fmt.tab_stops.add_tab_stop(
                Inches(printable_width_in),
                WD_TAB_ALIGNMENT.RIGHT,
                WD_TAB_LEADER.DOTS,
            )
        except Exception:
            pass

        _add_internal_link(paragraph, entry["anchor"], entry["text"], style, style.body_size_pt)
        tab = paragraph.add_run("\t")
        _apply_run_font(tab, style.body_font, style.body_size_pt)
        _add_pageref(paragraph, entry["anchor"], style, style.body_size_pt)


def _add_horizontal_rule(document: Document) -> None:
    paragraph = document.add_paragraph()
    try:
        p_pr = paragraph._p.get_or_add_pPr()
        borders = p_pr.makeelement(qn("w:pBdr"), {})
        bottom = borders.makeelement(qn("w:bottom"), {})
        bottom.set(qn("w:val"), "single")
        bottom.set(qn("w:sz"), "6")
        bottom.set(qn("w:space"), "1")
        bottom.set(qn("w:color"), "auto")
        borders.append(bottom)
        p_pr.append(borders)
    except Exception:
        pass


def _add_blockquote(document: Document, node: dict, style: StyleSpec) -> None:
    for block in node.get("content", []) or []:
        if block.get("type") in ("bulletList", "orderedList"):
            _add_list(document, block, style, indent_in=0.5)
            continue
        paragraph = _add_paragraph(document)
        paragraph.paragraph_format.left_indent = Inches(0.5)
        paragraph.paragraph_format.right_indent = Inches(0.5)
        paragraph.paragraph_format.line_spacing = style.line_spacing
        _add_inline_runs(paragraph, block, style, italic=True)


def _add_code_block(document: Document, node: dict, style: StyleSpec) -> None:
    text = _collect_text(node)
    paragraph = _add_paragraph(document)
    paragraph.paragraph_format.left_indent = Inches(0.3)
    paragraph.paragraph_format.line_spacing = 1.0
    # Code is whitespace-significant: emit real line breaks rather than letting
    # the newlines collapse into a single run of text.
    lines = text.split("\n")
    for i, line in enumerate(lines):
        run = paragraph.add_run(line)
        _apply_run_font(run, "Courier New", max(style.body_size_pt - 1, 7))
        if i < len(lines) - 1:
            run.add_break()


def _list_style_name(node_type: str, depth: int) -> str:
    base = "List Bullet" if node_type == "bulletList" else "List Number"
    return base if depth <= 1 else f"{base} {min(depth, 3)}"


def _add_list(
    document: Document,
    node: dict,
    style: StyleSpec,
    depth: int = 1,
    indent_in: float = 0.0,
) -> None:
    """Render a list, recursing into nested lists.

    TipTap nests a child list *inside* the parent's listItem; the previous
    renderer only looked one level down, so nested items disappeared.
    """
    node_type = node.get("type")
    style_name = _list_style_name(node_type, depth)

    for item in node.get("content", []) or []:
        if item.get("type") != "listItem":
            continue
        for block in item.get("content", []) or []:
            block_type = block.get("type")
            if block_type in ("bulletList", "orderedList"):
                _add_list(document, block, style, depth + 1, indent_in)
            elif block_type == "paragraph":
                paragraph = _add_paragraph(document, style_name)
                paragraph.paragraph_format.line_spacing = style.line_spacing
                if indent_in:
                    paragraph.paragraph_format.left_indent = Inches(
                        indent_in + 0.25 * (depth - 1)
                    )
                _add_inline_runs(paragraph, block, style)
            else:
                _render_block(document, block, style)


def _render_block(
    document: Document,
    node: dict,
    style: StyleSpec,
    anchor: str | None = None,
    bookmark_id: int | None = None,
    number: str = "",
) -> None:
    node_type = node.get("type")

    if node_type == "heading":
        level = node.get("attrs", {}).get("level", 1)
        try:
            level = max(1, min(int(level), 3))
        except (TypeError, ValueError):
            level = 1
        heading = document.add_heading(level=level)
        if anchor and bookmark_id is not None:
            # Bookmark every heading, whether or not this document has a
            # contents page: it is what any TOC — ours, Word's, or one the
            # author adds later — needs to link to.
            _add_bookmark(heading, anchor, bookmark_id)
        size = style.heading_sizes_pt.get(level, style.body_size_pt)

        # Distinguish levels by weight, slant and alignment, not size. Every
        # preset in styles.py sets the deepest heading to the body size (IEEE:
        # 10pt body, 10pt level 3), so a size-only hierarchy makes a level-3
        # heading indistinguishable from a paragraph.
        emphasis = _HEADING_EMPHASIS.get(level, _HEADING_EMPHASIS[3])
        heading.alignment = emphasis["alignment"]
        if number:
            prefix = heading.add_run(f"{number} ")
            _apply_run_font(
                prefix,
                style.heading_font,
                size,
                bold=emphasis["bold"],
                italic=emphasis["italic"],
            )
        _add_inline_runs(
            heading,
            node,
            style,
            bold=emphasis["bold"],
            italic=emphasis["italic"],
            font_name=style.heading_font,
            size_pt=size,
        )
        if not heading.runs:
            # An empty heading node still needs its text; fall back to the
            # flattened form.
            run = heading.add_run(_heading_text(node))
            _apply_run_font(
                run,
                style.heading_font,
                size,
                bold=emphasis["bold"],
                italic=emphasis["italic"],
            )
    elif node_type == "paragraph":
        paragraph = document.add_paragraph()
        paragraph.paragraph_format.line_spacing = style.line_spacing
        _add_inline_runs(paragraph, node, style)
    elif node_type in ("mathBlock", "math_block"):
        # A display equation sits on its own centred line, the convention in
        # every style this app targets.
        paragraph = document.add_paragraph()
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        paragraph.paragraph_format.line_spacing = style.line_spacing
        _add_math(paragraph, node, style, style.body_size_pt, display=True)
    elif node_type == "image":
        _add_image(document, node.get("attrs", {}).get("src", ""))
    elif node_type == "table":
        _add_table(document, node, style)
    elif node_type in ("bulletList", "orderedList"):
        _add_list(document, node, style)
    elif node_type == "blockquote":
        _add_blockquote(document, node, style)
    elif node_type in ("codeBlock", "code_block"):
        _add_code_block(document, node, style)
    elif node_type in ("horizontalRule", "horizontal_rule"):
        _add_horizontal_rule(document)
    elif node.get("content"):
        # Unknown container (a custom node, or a schema change): render its
        # children rather than dropping the subtree silently.
        for child in node.get("content", []) or []:
            _render_block(document, child, style)


# ---------------------------------------------------------------------------
# References
# ---------------------------------------------------------------------------

_REFERENCE_TITLES = {"references", "bibliography", "works cited", "reference list"}


class _CitationContext:
    """Citation state for the document currently being rendered.

    Module-level rather than a parameter because `_add_inline_runs` is reached
    from headings, paragraphs, lists, blockquotes and table cells — threading
    references through every one of them for a single inline node type would be
    worse than this. Safe because export.py renders one document per process and
    `render_docx` resets it on entry, so nothing ever renders two at once.
    """

    def __init__(self):
        self.reset()

    def reset(self, refs=None, numbers=None, family: str = "apa") -> None:
        self.refs = refs or []
        self.numbers = numbers or {}
        self.family = family

    def label(self, node: dict) -> str:
        ids = [
            str(i)
            for i in ((node.get("attrs") or {}).get("ids") or [])
            if str(i).strip()
        ]
        if not ids:
            return ""
        return citation_label(ids, self.refs, self.numbers, self.family)


_CITATION_CONTEXT = _CitationContext()


def _cited_ids_in_order(nodes) -> list[str]:
    """Reference ids in the order the document first cites them.

    IEEE numbers by first citation, so this order is the bibliography's order —
    it has to come from a walk of the body, not from the reference list.
    """
    order: list[str] = []
    seen: set[str] = set()

    def walk(node):
        if isinstance(node, list):
            for child in node:
                walk(child)
            return
        if not isinstance(node, dict):
            return
        if node.get("type") in ("citation", "cite"):
            for ref_id in (node.get("attrs") or {}).get("ids") or []:
                ref_id = str(ref_id)
                if ref_id and ref_id not in seen:
                    seen.add(ref_id)
                    order.append(ref_id)
        walk(node.get("content") or [])

    walk(nodes)
    return order


def _find_reference_region(nodes: list[dict]) -> tuple[int, int] | None:
    """(heading index, index just past its entries) for an existing References
    section, or None."""
    for index, node in enumerate(nodes):
        if node.get("type") != "heading":
            continue
        if _heading_text(node).strip().lower().lstrip("0123456789. ivx") in _REFERENCE_TITLES:
            end = index + 1
            while end < len(nodes) and nodes[end].get("type") != "heading":
                end += 1
            return index, end
    return None


def _add_bibliography(document: Document, entries, style: StyleSpec) -> None:
    for marker, spans in entries:
        paragraph = _add_paragraph(document)
        fmt = paragraph.paragraph_format
        fmt.line_spacing = style.line_spacing
        fmt.space_after = Pt(2)
        if marker:
            _apply_run_font(
                paragraph.add_run(f"{marker} "), style.body_font, style.body_size_pt
            )
        else:
            # Author-date bibliographies use a hanging indent instead of a
            # marker, which is what makes the alphabetical list scannable.
            fmt.left_indent = Inches(0.5)
            fmt.first_line_indent = Inches(-0.5)
        for span in spans:
            run = paragraph.add_run(span.text)
            _apply_run_font(
                run, style.body_font, style.body_size_pt, italic=span.italic
            )


# ---------------------------------------------------------------------------
# Heading numbers
# ---------------------------------------------------------------------------

_ROMAN = [
    (1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"),
    (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I"),
]


def _roman(value: int) -> str:
    out = []
    for amount, numeral in _ROMAN:
        while value >= amount:
            out.append(numeral)
            value -= amount
    return "".join(out)


def _heading_numbers(nodes: list[dict], scheme: str) -> dict[int, str]:
    """Map node index -> the prefix its heading should carry.

    Computed once over the whole document so the body and the contents page
    agree; a contents page numbered differently from the sections it points at
    is worse than no numbering.

    Contents pages are skipped — "I. CONTENTS" is not a section of the paper.
    """
    if scheme not in ("roman-upper", "decimal"):
        return {}

    counters = [0, 0, 0]
    numbers: dict[int, str] = {}
    for index, node in enumerate(nodes):
        if node.get("type") != "heading":
            continue
        if _heading_text(node).strip().lower() in _TOC_TITLES:
            continue
        try:
            level = max(1, min(int(node.get("attrs", {}).get("level", 1)), 3))
        except (TypeError, ValueError):
            level = 1

        counters[level - 1] += 1
        for deeper in range(level, 3):
            counters[deeper] = 0

        if scheme == "roman-upper":
            # The IEEE convention: I. / A. / 1)
            if level == 1:
                numbers[index] = f"{_roman(counters[0])}."
            elif level == 2:
                numbers[index] = f"{chr(ord('A') + counters[1] - 1)}."
            else:
                numbers[index] = f"{counters[2]})"
        else:
            numbers[index] = ".".join(str(c) for c in counters[:level])

    return numbers


# ---------------------------------------------------------------------------
# Front matter
# ---------------------------------------------------------------------------
# The matter that spans the page even when the body is set in columns: the
# title, and — once there is an author model — the author block and its
# affiliations. Word expresses "full width above, two columns below" as two
# sections, so this is rendered before the section break rather than as part of
# the body flow.


def _render_front_matter(
    document: Document,
    title: str,
    style: StyleSpec,
    authors=None,
    affiliations=None,
    doc_class: DocumentClass | None = None,
) -> None:
    title_paragraph = document.add_heading(title, level=0)
    for run in title_paragraph.runs:
        _apply_run_font(
            run, style.heading_font, style.heading_sizes_pt.get(1, 14) + 2, bold=True
        )
    title_paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    # Explicit, because _apply_page_setup zeroes Normal's space_after and the
    # blank paragraph that used to separate title from body is gone.
    title_paragraph.paragraph_format.space_after = Pt(style.body_size_pt)

    render_author_block(
        document,
        authors,
        affiliations,
        style,
        layout=doc_class.author_block if doc_class else None,
    )


def _collapse_section_break(document: Document) -> None:
    """Fold the section break onto the preceding paragraph.

    `add_section` parks the front matter's sectPr in a *new empty paragraph*,
    which renders as a blank line of body height. Moving the sectPr onto the
    paragraph before it keeps the break and drops the blank line, so the gap
    above the body stays under this module's control rather than being whatever
    the Normal style happens to be.
    """
    body = document.element.body
    paragraphs = body.findall(qn("w:p"))
    if len(paragraphs) < 2:
        return

    carrier = paragraphs[-1]
    p_pr = carrier.find(qn("w:pPr"))
    sect_pr = p_pr.find(qn("w:sectPr")) if p_pr is not None else None
    if sect_pr is None:
        return
    # Only fold an empty carrier. If it somehow holds content, removing it would
    # delete text — leave the blank line rather than lose a paragraph.
    if carrier.findall(qn("w:r")):
        return

    # The break must move to the element immediately before it, not merely to
    # the previous paragraph. When an author grid ends the front matter the
    # carrier's predecessor is the table, and folding past it would leave the
    # table on the body side of the break — set in two columns. Keep the
    # carrier in that case; it is also the paragraph Word requires after a
    # table, and it supplies the gap above the body.
    previous = carrier.getprevious()
    if previous is None or previous.tag != qn("w:p"):
        return

    p_pr.remove(sect_pr)
    previous.set_sectPr(sect_pr)
    body.remove(carrier)


def _begin_body_section(document: Document, style: StyleSpec) -> None:
    """Close the full-width front matter and open the body's column layout."""
    if style.columns <= 1:
        _set_section_columns(document.sections[0], 1)
        return

    body_section = document.add_section(WD_SECTION.CONTINUOUS)
    _collapse_section_break(document)
    # sections[0] is now the front matter, terminated by the break.
    _set_section_columns(document.sections[0], 1)
    _set_section_columns(body_section, style.columns)


def render_docx(
    editor_content: dict,
    title: str,
    style: StyleSpec,
    authors=None,
    affiliations=None,
    doc_class: DocumentClass | None = None,
    references=None,
) -> Document:
    # Callers that only have a StyleSpec (most tests, and any legacy path) get
    # the class their style implies, so numbering and the author block are
    # never silently skipped.
    doc_class = doc_class or class_for_style(style)

    document = Document()
    _apply_page_setup(document, style)

    _render_front_matter(document, title, style, authors, affiliations, doc_class)
    _begin_body_section(document, style)

    nodes = editor_content.get("content", []) or []
    numbers = _heading_numbers(nodes, doc_class.heading_numbering)

    # References have to be resolved before any body text is written: an IEEE
    # citation renders as "[3]", and the 3 comes from the bibliography order.
    refs = parse_references(references)
    cited_order = _cited_ids_in_order(nodes)
    reference_numbers = reference_numbering(refs, cited_order, doc_class.family)
    _CITATION_CONTEXT.reset(refs, reference_numbers, doc_class.family)
    reference_region = _find_reference_region(nodes) if refs else None

    # Two passes: bookmarks have to be known before the contents page is
    # written, and the contents page comes before nearly all of the headings it
    # points at.
    headings = _collect_headings(nodes, numbers)
    anchors = {h["index"]: h for h in headings}
    toc_region = _find_toc_region(nodes)

    printable_width_in = max(
        style.page_width_in - style.margins_in["left"] - style.margins_in["right"],
        1.0,
    )
    if style.columns > 1:
        printable_width_in = (printable_width_in - 0.3 * (style.columns - 1)) / style.columns

    skip_until = -1
    for index, node in enumerate(nodes):
        if index < skip_until:
            continue

        entry = anchors.get(index)
        _render_block(
            document,
            node,
            style,
            anchor=entry["anchor"] if entry else None,
            bookmark_id=index + 1 if entry else None,
            number=numbers.get(index, ""),
        )

        if toc_region and index == toc_region[0]:
            # Rebuild the contents section from the bookmarks, dropping the
            # stale text entries that followed it. `toc_region[1]` is the index
            # of the *next* heading — the first real section — so it is included.
            listed = [h for h in headings if h["index"] >= toc_region[1]]
            if listed:
                _add_toc(document, listed, style, printable_width_in)
                skip_until = toc_region[1]
            # With nothing to list, leave the author's own text alone rather
            # than replacing it with an empty contents page.

        if reference_region and index == reference_region[0]:
            # Replace whatever prose followed the References heading with the
            # formatted bibliography. Unlike the contents page, the entries are
            # the user's own data rather than something derived, so they are
            # rendered from the reference list, not recovered from the text.
            _add_bibliography(
                document, build_bibliography(refs, cited_order, doc_class.family), style
            )
            skip_until = reference_region[1]

    if refs and not reference_region:
        # References exist but the manuscript has no References section. A
        # contents page is never invented, because it is derived and its absence
        # is a choice — but dropping the reference list would discard data the
        # user entered, so this appends one.
        _render_block(
            document,
            {
                "type": "heading",
                "attrs": {"level": 1},
                "content": [{"type": "text", "text": "References"}],
            },
            style,
        )
        _add_bibliography(
            document, build_bibliography(refs, cited_order, doc_class.family), style
        )

    return document


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: export.py <output-docx-path> [--pdf <output-pdf-path>]"}), file=sys.stderr)
        sys.exit(1)

    docx_output_path = Path(sys.argv[1])
    pdf_output_path: Path | None = None
    if "--pdf" in sys.argv:
        pdf_output_path = Path(sys.argv[sys.argv.index("--pdf") + 1])

    payload = json.loads(sys.stdin.read())
    editor_content = payload["editorContent"]
    title = payload.get("title") or "Untitled Document"

    try:
        doc_class = resolve_document_class(payload)
    except ValueError as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)

    document = render_docx(
        editor_content,
        title,
        doc_class.typography,
        payload.get("authors"),
        payload.get("affiliations"),
        doc_class,
        payload.get("references"),
    )
    docx_output_path.parent.mkdir(parents=True, exist_ok=True)
    document.save(str(docx_output_path))

    if pdf_output_path is not None:
        pdf_output_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            # Isolated profiles prevent another conversion or a desktop instance
            # from absorbing this request and omitting its output.
            with tempfile.TemporaryDirectory(prefix="editorial-desk-lo-") as profile:
                result = subprocess.run(
                    [
                        "soffice",
                        f"-env:UserInstallation={Path(profile).as_uri()}",
                        "--headless",
                        "--convert-to",
                        "pdf",
                        "--outdir",
                        str(pdf_output_path.parent),
                        str(docx_output_path),
                    ],
                    capture_output=True,
                    text=True,
                    timeout=PDF_TIMEOUT_SEC,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                )
        except FileNotFoundError:
            print(
                json.dumps(
                    {
                        "error": "PDF export needs LibreOffice: the 'soffice' command was not found on PATH."
                    }
                ),
                file=sys.stderr,
            )
            sys.exit(1)
        except subprocess.TimeoutExpired:
            print(
                json.dumps(
                    {"error": f"PDF conversion timed out after {PDF_TIMEOUT_SEC}s."}
                ),
                file=sys.stderr,
            )
            sys.exit(1)

        converted_name = docx_output_path.with_suffix(".pdf").name
        converted_path = pdf_output_path.parent / converted_name
        if result.returncode != 0 or not converted_path.exists():
            print(
                json.dumps({"error": f"PDF conversion failed: {result.stderr.strip()}"}),
                file=sys.stderr,
            )
            sys.exit(1)
        if converted_path != pdf_output_path:
            converted_path.replace(pdf_output_path)

    print(json.dumps({"ok": True}))


if __name__ == "__main__":
    main()
