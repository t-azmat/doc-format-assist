"""Infer what kind of document this is, from the document itself.

The complaint this answers: choosing "IEEE conference" means "I am writing a
four-to-six page paper". A ninety-page manuscript with chapters and a contents
page is not that, and the app used to accept the combination silently and
produce something plausible and wrong.

Two jobs, both deterministic — no model, no key, no network:

  suggest_class    on upload, propose a class from the manuscript's shape.
  check_class_fit  at format time, say so when the chosen class and the
                   manuscript disagree.

Both *suggest*. Neither switches anything. The user knows their venue and this
does not; a wrong auto-correction the day before a deadline is far worse than a
warning that can be ignored.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# Headings that only appear in book-length work. One is weak evidence; several
# together are not.
_CHAPTER = re.compile(r"^\s*chapter\b|^\s*chapter\s+(\d+|[ivxlcdm]+)\b", re.I)
_FRONT_MATTER = (
    "list of figures",
    "list of tables",
    "list of abbreviations",
    "acknowledgement",
    "acknowledgment",
    "dedication",
    "declaration",
    "preface",
    "glossary",
    "nomenclature",
)
_CONTENTS = ("contents", "table of contents", "toc")

_NUMERIC_CITATION = re.compile(r"\[\d+(?:\s*[,–-]\s*\d+)*\]")
# "(Smith, 2020)", "(Doe et al., 2019)", "(Smith and Jones, 2020)". "et al." is
# its own branch: it is followed by the year, not by a second name.
_AUTHOR_DATE_CITATION = re.compile(
    r"\([A-Z][A-Za-z'’-]+"
    r"(?:\s+et\s+al\.?|\s+(?:and|&)\s+[A-Z][A-Za-z'’-]+)?"
    r",?\s+\d{4}[a-z]?\)"
)

# A conference paper is short; a thesis is long. The middle is a journal
# article, which is why neither bound is treated as sharp.
_SHORT_PAGES = 12
_LONG_PAGES = 25
_SHORT_WORDS = 9000
_LONG_WORDS = 25000


@dataclass(frozen=True)
class Signals:
    page_count: int | None = None
    word_count: int = 0
    heading_count: int = 0
    chapter_headings: int = 0
    front_matter_headings: int = 0
    appendix_headings: int = 0
    has_contents: bool = False
    reference_count: int = 0
    columns: int = 1
    numeric_citations: int = 0
    author_date_citations: int = 0


@dataclass(frozen=True)
class ClassSuggestion:
    class_id: str
    confidence: str  # high | medium | low
    reasons: list = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "classId": self.class_id,
            "confidence": self.confidence,
            "reasons": list(self.reasons),
        }


def _iter_nodes(node):
    if isinstance(node, dict):
        yield node
        for child in node.get("content") or []:
            yield from _iter_nodes(child)
    elif isinstance(node, list):
        for child in node:
            yield from _iter_nodes(child)


def _node_text(node: dict) -> str:
    return "".join(
        child.get("text", "")
        for child in (node.get("content") or [])
        if isinstance(child, dict) and child.get("type") == "text"
    ).strip()


def infer_signals(editor_content: dict, extracted_content: dict | None = None) -> Signals:
    extracted = extracted_content or {}
    headings: list[str] = []
    words = 0
    body: list[str] = []

    for node in _iter_nodes(editor_content):
        node_type = node.get("type")
        if node_type == "heading":
            headings.append(_node_text(node).lower())
        elif node_type == "text":
            text = node.get("text", "") or ""
            words += len(text.split())
            body.append(text)

    joined = " ".join(body)

    chapters = sum(1 for h in headings if _CHAPTER.match(h))
    front = sum(1 for h in headings if any(f in h for f in _FRONT_MATTER))
    appendices = sum(1 for h in headings if h.startswith("appendix"))
    contents = any(h in _CONTENTS for h in headings)

    page_count = extracted.get("pageCount")
    try:
        page_count = int(page_count) if page_count else None
    except (TypeError, ValueError):
        page_count = None

    try:
        columns = int(extracted.get("detectedColumns") or 1)
    except (TypeError, ValueError):
        columns = 1

    references = extracted.get("references")
    reference_count = len(references) if isinstance(references, list) else 0

    return Signals(
        page_count=page_count,
        word_count=words,
        heading_count=len(headings),
        chapter_headings=chapters,
        front_matter_headings=front,
        appendix_headings=appendices,
        has_contents=contents,
        reference_count=reference_count,
        columns=columns,
        numeric_citations=len(_NUMERIC_CITATION.findall(joined)),
        author_date_citations=len(_AUTHOR_DATE_CITATION.findall(joined)),
    )


def _length_of(signals: Signals) -> str:
    """"short" | "long" | "medium" — page count when known, words otherwise."""
    if signals.page_count:
        if signals.page_count <= _SHORT_PAGES:
            return "short"
        if signals.page_count >= _LONG_PAGES:
            return "long"
        return "medium"
    if signals.word_count and signals.word_count <= _SHORT_WORDS:
        return "short"
    if signals.word_count >= _LONG_WORDS:
        return "long"
    return "medium"


def infer_genre(signals: Signals) -> tuple[str, list[str]]:
    reasons: list[str] = []
    length = _length_of(signals)

    # Book structure is the strongest evidence there is: nothing but a thesis or
    # a book has chapters, a contents page and appendices together.
    book_structure = 0
    if signals.chapter_headings >= 2:
        book_structure += 2
        reasons.append(f"{signals.chapter_headings} chapter headings")
    if signals.has_contents:
        book_structure += 1
        reasons.append("a contents page")
    if signals.front_matter_headings >= 1:
        book_structure += 1
        reasons.append(f"{signals.front_matter_headings} front-matter sections")
    if signals.appendix_headings >= 1:
        book_structure += 1
        reasons.append("appendices")

    if length == "long":
        book_structure += 1
        reasons.append(
            f"{signals.page_count} pages"
            if signals.page_count
            else f"about {signals.word_count:,} words"
        )

    if book_structure >= 3:
        return "thesis", reasons

    if length == "short":
        return "conference_paper", [
            f"{signals.page_count} pages"
            if signals.page_count
            else f"about {signals.word_count:,} words"
        ]

    return "journal_article", reasons or ["length between a paper and a thesis"]


def infer_family(signals: Signals) -> tuple[str, list[str]]:
    reasons: list[str] = []

    if signals.columns >= 2:
        reasons.append("a two-column source layout")
        # IEEE and ACM are both two-column and numeric; nothing in the text
        # separates them reliably, so this picks the more common one and says
        # so rather than pretending to know.
        return "ieee", reasons

    if signals.author_date_citations > signals.numeric_citations:
        reasons.append("author-date citations")
        return "apa", reasons
    if signals.numeric_citations > signals.author_date_citations:
        reasons.append("numeric citations")
        return "ieee", reasons

    reasons.append("a single-column source layout")
    return "apa", reasons


# family x genre -> class id. A thesis lands on the dissertation class whatever
# the family suggests: there is no IEEE or ACM thesis class, and a university
# submission is not a conference paper.
_CLASS_FOR = {
    ("ieee", "conference_paper"): "ieee-conference",
    ("ieee", "journal_article"): "ieee-journal",
    ("ieee", "thesis"): "apa-dissertation",
    ("acm", "conference_paper"): "acm-conference",
    ("acm", "journal_article"): "acm-conference",
    ("acm", "thesis"): "apa-dissertation",
    ("apa", "conference_paper"): "apa-journal",
    ("apa", "journal_article"): "apa-journal",
    ("apa", "thesis"): "apa-dissertation",
}


def suggest_class(signals: Signals) -> ClassSuggestion | None:
    """Propose a class, or None when the document is too thin to judge."""
    if signals.heading_count == 0 and signals.word_count < 200:
        return None

    genre, genre_reasons = infer_genre(signals)
    family, family_reasons = infer_family(signals)
    class_id = _CLASS_FOR.get((family, genre), "ieee-conference")

    # Confidence tracks how much evidence agreed, not how much there was.
    strong = signals.chapter_headings >= 2 or signals.page_count is not None
    corroborated = len(genre_reasons) + len(family_reasons) >= 3
    if strong and corroborated:
        confidence = "high"
    elif strong or corroborated:
        confidence = "medium"
    else:
        confidence = "low"

    return ClassSuggestion(class_id, confidence, genre_reasons + family_reasons)


def check_class_fit(doc_class, signals: Signals) -> list[str]:
    """Reasons the selected class looks wrong for this manuscript.

    Returns messages, not issues, so the caller decides severity. Empty means
    nothing contradicts the choice — which is not the same as agreement.
    """
    problems: list[str] = []
    genre, reasons = infer_genre(signals)

    if doc_class.genre != "thesis" and genre == "thesis":
        problems.append(
            f"This is set as {doc_class.name}, but the manuscript reads as a "
            f"thesis ({', '.join(reasons)}). Conference and journal classes "
            "carry page limits and no contents page."
        )
    elif doc_class.genre == "thesis" and genre == "conference_paper":
        problems.append(
            f"This is set as {doc_class.name}, but the manuscript is short "
            f"({', '.join(reasons)}). A dissertation class adds front matter "
            "and a required contents page."
        )

    budget = getattr(doc_class, "page_budget", None)
    if budget and signals.page_count and signals.page_count > budget.max_pages:
        over = signals.page_count - budget.max_pages
        problems.append(
            f"The source is {signals.page_count} pages, {over:g} over "
            f"{doc_class.name}'s limit of {budget.describe()}."
        )

    return problems
