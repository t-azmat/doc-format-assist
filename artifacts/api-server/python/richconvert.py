"""Convert a Docling document into TipTap/ProseMirror JSON while retaining
images, tables, and captions.

Unlike the Markdown round-trip (mdconvert), this walks the structured Docling
document in reading order so pictures (as base64 data-URI image nodes), tables
(as ProseMirror table nodes), and their captions survive into the editor.
"""

from __future__ import annotations

import base64
import io


def _text_node(text: str) -> dict:
    return {"type": "text", "text": text}


def _paragraph(text: str) -> dict:
    text = (text or "").strip()
    if not text:
        return {"type": "paragraph"}
    return {"type": "paragraph", "content": [_text_node(text)]}


def _caption_paragraph(text: str) -> dict:
    text = (text or "").strip()
    if not text:
        return {"type": "paragraph"}
    return {
        "type": "paragraph",
        "content": [{"type": "text", "text": text, "marks": [{"type": "italic"}]}],
    }


def _strip_math_delimiters(text: str) -> str:
    """Drop the surrounding $$…$$ / $…$ / \\[…\\] that Docling sometimes keeps.

    The node stores bare LaTeX; delimiters are the editor's and the exporter's
    business, and leaving them in makes them show up literally in the output.
    """
    s = (text or "").strip()
    for opening, closing in (("$$", "$$"), ("\\[", "\\]"), ("\\(", "\\)"), ("$", "$")):
        if len(s) > len(opening) + len(closing) and s.startswith(opening) and s.endswith(closing):
            return s[len(opening) : -len(closing)].strip()
    return s


def _heading(level: int, text: str) -> dict:
    node = {"type": "heading", "attrs": {"level": min(max(level, 1), 3)}}
    text = (text or "").strip()
    if text:
        node["content"] = [_text_node(text)]
    return node


def _label(item) -> str:
    label = getattr(item, "label", None)
    return str(getattr(label, "value", label) or "").lower()


def _picture_src(item, doc) -> str | None:
    image = getattr(item, "image", None)
    uri = getattr(image, "uri", None) if image is not None else None
    if uri:
        return str(uri)
    # Fallback: rasterize via PIL (e.g. PDFs with generate_picture_images).
    try:
        pil = item.get_image(doc)
        if pil is not None:
            buf = io.BytesIO()
            pil.save(buf, format="PNG")
            encoded = base64.b64encode(buf.getvalue()).decode("ascii")
            return f"data:image/png;base64,{encoded}"
    except Exception:
        pass
    return None


def _table_node(item) -> dict | None:
    data = getattr(item, "data", None)
    if data is None:
        return None
    num_rows = int(getattr(data, "num_rows", 0) or 0)
    num_cols = int(getattr(data, "num_cols", 0) or 0)
    cells = list(getattr(data, "table_cells", []) or [])
    if num_rows <= 0 or num_cols <= 0 or not cells:
        return None

    grid = [[None] * num_cols for _ in range(num_rows)]
    covered = [[False] * num_cols for _ in range(num_rows)]

    for cell in cells:
        r0 = int(getattr(cell, "start_row_offset_idx", 0) or 0)
        c0 = int(getattr(cell, "start_col_offset_idx", 0) or 0)
        r1 = int(getattr(cell, "end_row_offset_idx", r0 + 1) or r0 + 1)
        c1 = int(getattr(cell, "end_col_offset_idx", c0 + 1) or c0 + 1)
        if not (0 <= r0 < num_rows and 0 <= c0 < num_cols):
            continue
        grid[r0][c0] = cell
        for rr in range(r0, min(r1, num_rows)):
            for cc in range(c0, min(c1, num_cols)):
                if (rr, cc) != (r0, c0):
                    covered[rr][cc] = True

    rows = []
    for r in range(num_rows):
        row_cells = []
        for c in range(num_cols):
            if covered[r][c]:
                continue
            cell = grid[r][c]
            text = getattr(cell, "text", "") if cell else ""
            is_header = bool(getattr(cell, "column_header", False)) if cell else False
            col_span = int(getattr(cell, "col_span", 1) or 1) if cell else 1
            row_span = int(getattr(cell, "row_span", 1) or 1) if cell else 1
            attrs = {}
            if col_span > 1:
                attrs["colspan"] = col_span
            if row_span > 1:
                attrs["rowspan"] = row_span
            cell_node = {
                "type": "tableHeader" if is_header else "tableCell",
                "content": [_paragraph(text)],
            }
            if attrs:
                cell_node["attrs"] = attrs
            row_cells.append(cell_node)
        if row_cells:
            rows.append({"type": "tableRow", "content": row_cells})

    if not rows:
        return None
    return {"type": "table", "content": rows}


def _safe_caption(item, doc) -> str:
    try:
        text = item.caption_text(doc)
        return (text or "").strip()
    except Exception:
        return ""


def _caption_refs(doc) -> set[str]:
    """Collect self-refs of caption items linked to tables/pictures so we don't
    also render them again as loose text when walking in reading order."""
    refs: set[str] = set()
    for item in list(getattr(doc, "tables", []) or []) + list(
        getattr(doc, "pictures", []) or []
    ):
        for cap in getattr(item, "captions", []) or []:
            cref = getattr(cap, "cref", None) or getattr(cap, "$ref", None)
            if cref:
                refs.add(cref)
    return refs


def detect_columns(doc) -> int:
    """Best-effort detection of the source page column count (1 or 2) from text
    block geometry. Narrow text blocks whose horizontal center sits in the left
    vs. right half of the page are counted; a meaningful right-half share means
    a two-column layout. Full-width blocks (titles/banners) are ignored. Returns
    1 when geometry is unavailable (e.g. DOCX has no bounding boxes)."""
    try:
        pages = getattr(doc, "pages", {}) or {}
        left = right = 0
        for item, _level in doc.iterate_items():
            if type(item).__name__ not in ("TextItem", "SectionHeaderItem"):
                continue
            prov = getattr(item, "prov", None)
            if not prov:
                continue
            bbox = getattr(prov[0], "bbox", None)
            page = pages.get(getattr(prov[0], "page_no", None))
            width = getattr(getattr(page, "size", None), "width", None)
            if bbox is None or not width:
                continue
            l = float(getattr(bbox, "l", 0.0))
            r = float(getattr(bbox, "r", 0.0))
            if (r - l) >= width * 0.55:  # spans most of the page → not a column
                continue
            if (l + r) / 2.0 < width * 0.5:
                left += 1
            else:
                right += 1
        total = left + right
        if total < 8:
            return 1
        return 2 if min(left, right) >= total * 0.25 else 1
    except Exception:
        return 1


def docling_to_tiptap(doc) -> dict:
    """Walk a DoclingDocument in reading order and build a TipTap doc that
    keeps headings, paragraphs, lists, images, tables, and captions."""
    content: list[dict] = []
    caption_refs = _caption_refs(doc)
    list_buffer: list[str] = []

    def flush_list():
        if list_buffer:
            content.append(
                {
                    "type": "bulletList",
                    "content": [
                        {"type": "listItem", "content": [_paragraph(t)]}
                        for t in list_buffer
                    ],
                }
            )
            list_buffer.clear()

    for item, _level in doc.iterate_items():
        # Skip caption items already attached to their table/figure below.
        if getattr(item, "self_ref", None) in caption_refs:
            continue

        cls = type(item).__name__
        label = _label(item)

        if cls == "SectionHeaderItem" or label in ("section_header", "title"):
            flush_list()
            content.append(_heading(int(getattr(item, "level", 1) or 1), getattr(item, "text", "")))
        elif cls == "TableItem":
            flush_list()
            caption = _safe_caption(item, doc)
            if caption:
                content.append(_caption_paragraph(caption))
            table_node = _table_node(item)
            if table_node:
                content.append(table_node)
        elif cls == "PictureItem":
            flush_list()
            src = _picture_src(item, doc)
            caption = _safe_caption(item, doc)
            if src:
                attrs = {"src": src}
                if caption:
                    attrs["alt"] = caption
                content.append({"type": "image", "attrs": attrs})
            if caption:
                content.append(_caption_paragraph(caption))
        elif label == "formula":
            # With DOCLING_FORMULAS=1 this text is LaTeX; without it, it is the
            # raw glyph soup the layout model read off the page. Either way it
            # belongs in a math node — as a paragraph it renders as literal
            # backslashes in the editor and in the exported DOCX.
            flush_list()
            latex = _strip_math_delimiters(getattr(item, "text", ""))
            if latex:
                content.append({"type": "mathBlock", "attrs": {"latex": latex}})
        elif label == "list_item":
            list_buffer.append(getattr(item, "text", ""))
        elif label == "caption":
            flush_list()
            content.append(_caption_paragraph(getattr(item, "text", "")))
        elif cls == "TextItem":
            flush_list()
            text = getattr(item, "text", "")
            if text and text.strip():
                content.append(_paragraph(text))

    flush_list()

    if not content:
        content = [{"type": "paragraph"}]
    return {"type": "doc", "content": content}
