#!/usr/bin/env python3
"""Compliance-check and reformat a TipTap document against a conference
style's structural rules (headings present, casing, required sections).

Reads a JSON object from stdin: {"editorContent": <tiptap doc>, "conferenceStyle": "ieee"|"apa"|"acm"}
Writes a JSON object to stdout: {"editorContent": <possibly-rewritten tiptap doc>, "formattingIssues": [...]}
"""

import json
import sys
import uuid
from dataclasses import asdict

from docclass import (
    TOC_FORBIDDEN,
    TOC_REQUIRED,
    DocumentClass,
    class_for_style,
    resolve_document_class,
)
from styles import StyleSpec

# Heading titles that mean "this is the contents page".
_TOC_TITLES = {"contents", "table of contents", "toc"}


def _heading_text(node: dict) -> str:
    return "".join(
        child.get("text", "") for child in node.get("content", []) if child.get("type") == "text"
    ).strip()


def _apply_heading_case(text: str, case: str) -> str:
    if not text:
        return text
    if case == "upper":
        return text.upper()
    if case == "title":
        return " ".join(word.capitalize() for word in text.split(" "))
    if case == "sentence":
        return text[0].upper() + text[1:] if len(text) > 1 else text.upper()
    return text


def _issue(severity: str, message: str, location: str | None = None) -> dict:
    return {"id": str(uuid.uuid4()), "severity": severity, "message": message, "location": location}


def _rewrite_heading_case(node: dict, case: str) -> tuple[str, str] | None:
    """Recase a heading in place, spreading the result back over its original
    text runs.

    A heading is often several runs ("The " + bold "Fast" + " Path"). Writing
    the whole recased string into the first run would duplicate the rest of the
    text, so map the new string back onto the runs by character offset. Casing
    transforms preserve length for every practical input; when one doesn't
    (e.g. "ß" -> "SS") the runs can't be aligned, so collapse into the first
    run rather than emit duplicated text.

    Returns (old_text, new_text), or None when nothing changed.
    """
    children = node.get("content") or []
    text_nodes = [c for c in children if c.get("type") == "text"]
    if not text_nodes:
        return None

    raw = "".join(c.get("text", "") for c in text_nodes)
    stripped = raw.strip()
    if not stripped:
        return None

    recased = _apply_heading_case(stripped, case)
    if recased == stripped:
        return None

    lead = raw[: len(raw) - len(raw.lstrip())]
    trail = raw[len(raw.rstrip()) :]
    new_raw = lead + recased + trail

    if len(new_raw) == len(raw):
        offset = 0
        for child in text_nodes:
            length = len(child.get("text", ""))
            child["text"] = new_raw[offset : offset + length]
            offset += length
    else:
        text_nodes[0]["text"] = new_raw
        for child in text_nodes[1:]:
            child["text"] = ""
        # ProseMirror rejects empty text nodes, so drop the emptied runs.
        node["content"] = [
            c for c in children if c.get("type") != "text" or c.get("text")
        ]

    return stripped, recased


def _check_structure(
    headings: list[str], doc_class: DocumentClass, issues: list[dict]
) -> None:
    """Check the document's shape against its class.

    This is the part a typography sheet could never do. "IEEE" says nothing
    about whether a contents page belongs; "IEEE conference paper" says it does
    not, and "APA dissertation" says it is required.
    """
    has_toc = any(heading in _TOC_TITLES for heading in headings)

    # Phrased with the class name leading, which also sidesteps "a"/"an" —
    # "A IEEE Conference Paper" is the kind of thing users notice.
    if doc_class.toc == TOC_REQUIRED and not has_toc:
        issues.append(
            _issue(
                "error",
                f"{doc_class.name}: a table of contents is required. Add a "
                f'"Contents" heading and the exporter will build it, linked, '
                f"to depth {doc_class.toc_depth}.",
                "contents",
            )
        )
    elif doc_class.toc == TOC_FORBIDDEN and has_toc:
        issues.append(
            _issue(
                "warning",
                f"{doc_class.name}: a table of contents does not belong here. "
                "Remove it, or switch to a class that expects one.",
                "contents",
            )
        )

    # The page budget deliberately does *not* raise an issue here. It applies to
    # every document in the class, so reporting it each run is noise in a list
    # meant for things that are wrong — and this engine cannot measure pages
    # anyway. It travels on the format response instead, for the page meter.


def _check_class_fit(
    editor_content: dict,
    extracted_content: dict | None,
    doc_class: DocumentClass,
    issues: list[dict],
) -> None:
    """Warn when the chosen class and the manuscript disagree.

    Picking "IEEE conference" means "I am writing a six-page paper". A
    ninety-page manuscript with chapters is not that, and accepting the
    combination silently is how a thesis ends up formatted as a conference
    submission. This warns; it never switches the class.
    """
    try:
        from infer import check_class_fit, infer_signals

        signals = infer_signals(editor_content, extracted_content)
        for problem in check_class_fit(doc_class, signals):
            issues.append(_issue("warning", problem, None))
    except Exception:  # noqa: BLE001
        # Inference is advisory; a failure here must not fail the format.
        pass


def _cited_ids(node) -> set:
    """Every reference id cited anywhere in the document."""
    found: set = set()
    if isinstance(node, list):
        for child in node:
            found |= _cited_ids(child)
        return found
    if not isinstance(node, dict):
        return found
    if node.get("type") in ("citation", "cite"):
        for ref_id in (node.get("attrs") or {}).get("ids") or []:
            if str(ref_id).strip():
                found.add(str(ref_id))
    return found | _cited_ids(node.get("content") or [])


def _check_references(
    editor_content: dict,
    references,
    doc_class: DocumentClass,
    issues: list[dict],
) -> None:
    """Check citations against the reference library.

    Both directions matter and they are different problems: a citation with no
    reference is a dangling claim in the text, and a reference nothing cites is
    padding a reviewer will notice.
    """
    library = {
        str(r.get("id")) for r in (references or []) if isinstance(r, dict) and r.get("id")
    }
    cited = _cited_ids(editor_content.get("content") or [])

    dangling = sorted(cited - library)
    if dangling:
        shown = ", ".join(dangling[:5])
        more = f" and {len(dangling) - 5} more" if len(dangling) > 5 else ""
        issues.append(
            _issue(
                "error",
                f"{len(dangling)} citation(s) point at references that are not in "
                f"the library: {shown}{more}. They export as a visible '?'.",
                dangling[0],
            )
        )

    uncited = sorted(library - cited)
    if uncited and cited:
        # Only worth saying once the author has started citing — a library
        # loaded before any citations exist is not yet a problem.
        shown = ", ".join(uncited[:5])
        more = f" and {len(uncited) - 5} more" if len(uncited) > 5 else ""
        issues.append(
            _issue(
                "info",
                f"{len(uncited)} reference(s) are never cited: {shown}{more}. "
                "They are still listed in the bibliography.",
                None,
            )
        )


def format_document(
    editor_content: dict,
    style: StyleSpec,
    doc_class: DocumentClass | None = None,
    extracted_content: dict | None = None,
    references=None,
) -> tuple[dict, list[dict]]:
    doc_class = doc_class or class_for_style(style)
    issues: list[dict] = []
    headings: list[str] = []

    content = editor_content.get("content", [])
    for node in content:
        if node.get("type") == "heading":
            text = _heading_text(node)
            headings.append(text.lower())
            changed = _rewrite_heading_case(node, style.heading_case)
            if changed:
                before, after = changed
                issues.append(
                    _issue(
                        "info",
                        f'Reformatted heading casing to match {style.name} style: "{before}" -> "{after}"',
                        before,
                    )
                )

    # The class's requirements win over the typography sheet's: required
    # sections are a property of the genre, not the typeface.
    required = doc_class.required_sections or tuple(style.required_sections)
    for section in required:
        if not any(section in heading for heading in headings):
            issues.append(
                _issue(
                    "warning",
                    f'Missing required "{section.title()}" section for {doc_class.name}.',
                    section,
                )
            )

    if not headings:
        issues.append(_issue("error", "No section headings were found in the document.", None))

    _check_structure(headings, doc_class, issues)
    _check_class_fit(editor_content, extracted_content, doc_class, issues)
    _check_references(editor_content, references, doc_class, issues)

    return editor_content, issues


def main() -> None:
    payload = json.loads(sys.stdin.read())
    editor_content = payload["editorContent"]

    try:
        doc_class = resolve_document_class(payload)
        updated_content, issues = format_document(
            editor_content,
            doc_class.typography,
            doc_class,
            payload.get("extractedContent"),
            payload.get("references"),
        )
    except ValueError as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)

    print(
        json.dumps(
            {
                "editorContent": updated_content,
                "formattingIssues": issues,
                "styleSpec": asdict(doc_class.typography),
                "documentClass": doc_class.id,
                "pageBudget": (
                    {
                        "maxPages": doc_class.page_budget.max_pages,
                        "includesReferences": doc_class.page_budget.includes_references,
                    }
                    if doc_class.page_budget
                    else None
                ),
            }
        )
    )


if __name__ == "__main__":
    main()
