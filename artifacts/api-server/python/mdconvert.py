"""Markdown -> TipTap/ProseMirror JSON conversion and structural analysis.

Docling exports extracted documents as Markdown. We convert that Markdown
into a TipTap-compatible ProseMirror JSON document (the editor's source of
truth) and, separately, extract a lightweight structural summary (sections,
detected references) that downstream formatting/export logic can reason
about without re-parsing Markdown.
"""

import re

HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
LIST_ITEM_RE = re.compile(r"^\s*[-*]\s+(.*)$")
ORDERED_ITEM_RE = re.compile(r"^\s*\d+[.)]\s+(.*)$")
REFERENCE_LINE_RE = re.compile(r"^\s*(\[\d+\]|\d+[.)])\s*(.*)$")


def _text_node(text: str) -> dict:
    return {"type": "text", "text": text}


def _paragraph(text: str) -> dict:
    text = text.strip()
    if not text:
        return {"type": "paragraph"}
    return {"type": "paragraph", "content": [_text_node(text)]}


def _heading(level: int, text: str) -> dict:
    text = text.strip()
    node = {"type": "heading", "attrs": {"level": min(max(level, 1), 3)}}
    if text:
        node["content"] = [_text_node(text)]
    return node


def markdown_to_tiptap(markdown: str) -> dict:
    """Convert Markdown text into a TipTap ProseMirror `doc` JSON node."""
    content: list[dict] = []
    list_buffer: list[str] = []
    list_type: str | None = None

    def flush_list():
        nonlocal list_buffer, list_type
        if list_buffer:
            content.append(
                {
                    "type": "bulletList" if list_type == "bullet" else "orderedList",
                    "content": [
                        {"type": "listItem", "content": [_paragraph(item)]}
                        for item in list_buffer
                    ],
                }
            )
        list_buffer = []
        list_type = None

    for raw_line in markdown.splitlines():
        line = raw_line.rstrip()
        if not line.strip():
            flush_list()
            continue

        heading_match = HEADING_RE.match(line)
        if heading_match:
            flush_list()
            level = len(heading_match.group(1))
            content.append(_heading(level, heading_match.group(2)))
            continue

        bullet_match = LIST_ITEM_RE.match(line)
        if bullet_match:
            if list_type != "bullet":
                flush_list()
            list_type = "bullet"
            list_buffer.append(bullet_match.group(1))
            continue

        ordered_match = ORDERED_ITEM_RE.match(line)
        if ordered_match:
            if list_type != "ordered":
                flush_list()
            list_type = "ordered"
            list_buffer.append(ordered_match.group(1))
            continue

        flush_list()
        content.append(_paragraph(line))

    flush_list()

    if not content:
        content = [{"type": "paragraph"}]

    return {"type": "doc", "content": content}


def extract_structure(markdown: str) -> dict:
    """Extract a lightweight structural summary from Markdown: the section
    outline and any detected bibliography/reference entries.
    """
    sections: list[dict] = []
    references: list[str] = []
    in_references = False

    for raw_line in markdown.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        heading_match = HEADING_RE.match(line)
        if heading_match:
            title = heading_match.group(2).strip()
            level = len(heading_match.group(1))
            sections.append({"level": level, "title": title})
            in_references = title.lower().strip(" :") in (
                "references",
                "bibliography",
                "works cited",
            )
            continue

        if in_references:
            ref_match = REFERENCE_LINE_RE.match(line)
            references.append(ref_match.group(2).strip() if ref_match else line)

    return {"sections": sections, "references": references}
