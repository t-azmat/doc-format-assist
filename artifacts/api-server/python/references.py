"""References: CSL-JSON in, formatted citations and a bibliography out.

Why CSL-JSON and not BibTeX: LaTeX does not format bibliographies — BibTeX does,
at compile time, using `.bst` files that only the BibTeX binary interprets. Off
that toolchain they are inert. CSL-JSON is the interchange format the rest of
the world uses (Zotero, Mendeley, pandoc all read and write it), so a reference
library exported from a manager drops straight in.

The *renderer* here is hand-written for the three styles this app supports
rather than being a general CSL engine. A general engine (citeproc-py) needs the
CSL style XML vendored alongside it — CC BY-SA licensed, ~150KB for these three
— and only starts paying off past three styles. Everything below consumes
CSL-JSON, so swapping the renderer later touches nothing that is stored.

Author names reuse the same given/family split as `authorblock`, which is why
that split exists: "Smith, J. A." and "J. A. Smith" are the same person under
different styles, and a full name cannot be reliably split after the fact.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

EN_DASH = "–"


@dataclass(frozen=True)
class Span:
    """A run of bibliography text. Italics carry meaning — a journal name set
    upright is a different (wrong) citation — so entries are built as spans
    rather than one string."""

    text: str
    italic: bool = False


@dataclass(frozen=True)
class Name:
    family: str = ""
    given: str = ""
    literal: str = ""

    def initials(self) -> str:
        parts = [p for p in re.split(r"[\s.]+", self.given) if p]
        return " ".join(f"{p[0].upper()}." for p in parts)


@dataclass(frozen=True)
class Reference:
    id: str
    type: str = "article-journal"
    title: str = ""
    authors: tuple = ()
    container: str = ""  # journal or proceedings title
    publisher: str = ""
    volume: str = ""
    issue: str = ""
    page: str = ""
    year: str = ""
    edition: str = ""
    doi: str = ""
    url: str = ""
    note: str = ""
    # Kept when a reference could not be parsed into fields — a raw string from
    # extraction, say. Rendered verbatim rather than dropped.
    literal: str = ""

    def sort_key(self) -> tuple:
        first = self.authors[0] if self.authors else Name()
        return (
            (first.family or first.literal or self.title).lower(),
            self.year,
            self.title.lower(),
        )


def _text(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _parse_name(raw) -> Name | None:
    if isinstance(raw, str):
        return Name(literal=raw.strip()) if raw.strip() else None
    if not isinstance(raw, dict):
        return None
    literal = _text(raw.get("literal"))
    family = _text(raw.get("family"))
    given = _text(raw.get("given"))
    if not (literal or family or given):
        return None
    return Name(family=family, given=given, literal=literal)


def _parse_year(raw) -> str:
    """CSL dates are {"date-parts": [[2020, 5, 1]]}; only the year is used."""
    if isinstance(raw, dict):
        parts = raw.get("date-parts")
        if isinstance(parts, list) and parts and isinstance(parts[0], list) and parts[0]:
            return _text(parts[0][0])
        return _text(raw.get("literal"))[:4]
    return _text(raw)[:4]


def parse_references(raw) -> list[Reference]:
    """Normalise CSL-JSON. Unknown fields are ignored; an item with no id is
    skipped, because nothing could cite it."""
    out: list[Reference] = []
    seen: set[str] = set()
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        ref_id = _text(item.get("id"))
        if not ref_id or ref_id in seen:
            continue
        seen.add(ref_id)

        authors = tuple(
            name
            for name in (_parse_name(a) for a in (item.get("author") or []))
            if name is not None
        )
        out.append(
            Reference(
                id=ref_id,
                type=_text(item.get("type")) or "article-journal",
                title=_text(item.get("title")),
                authors=authors,
                container=_text(item.get("container-title")),
                publisher=_text(item.get("publisher")),
                volume=_text(item.get("volume")),
                issue=_text(item.get("issue")),
                page=_text(item.get("page")).replace("--", EN_DASH).replace("-", EN_DASH),
                year=_parse_year(item.get("issued")),
                edition=_text(item.get("edition")),
                doi=_text(item.get("DOI") or item.get("doi")),
                url=_text(item.get("URL") or item.get("url")),
                note=_text(item.get("note")),
                literal=_text(item.get("literal")),
            )
        )
    return out


# ---------------------------------------------------------------------------
# Name rendering
# ---------------------------------------------------------------------------


def _join(parts: list[str], conjunction: str, serial_comma: bool = False) -> str:
    """`serial_comma` covers the two-author case, where the styles disagree:
    APA writes "Doe, J., & Roe, B."; IEEE writes "J. Doe and B. Roe"."""
    parts = [p for p in parts if p]
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0]
    if len(parts) == 2:
        return f"{parts[0]}{',' if serial_comma else ''} {conjunction} {parts[1]}"
    return ", ".join(parts[:-1]) + f", {conjunction} {parts[-1]}"


def _ieee_names(authors: tuple) -> str:
    """Initials first: "J. A. Smith". Six or more collapses to et al."""
    if not authors:
        return ""
    rendered = [
        a.literal or " ".join(p for p in (a.initials(), a.family) if p) for a in authors
    ]
    if len(rendered) > 6:
        return f"{rendered[0]} et al."
    return _join(rendered, "and")


def _apa_names(authors: tuple) -> str:
    """Every author inverted: "Smith, J. A., & Jones, B." """
    if not authors:
        return ""
    rendered = []
    for a in authors:
        if a.literal:
            rendered.append(a.literal)
        elif a.family and a.initials():
            rendered.append(f"{a.family}, {a.initials()}")
        else:
            rendered.append(a.family or a.given)
    if len(rendered) > 20:
        # APA 7: first 19, an ellipsis, then the final author.
        return ", ".join(rendered[:19]) + f", ... {rendered[-1]}"
    return _join(rendered, "&", serial_comma=True)


def _acm_names(authors: tuple) -> str:
    """Full given names: "John A. Smith"."""
    if not authors:
        return ""
    rendered = [
        a.literal or " ".join(p for p in (a.given, a.family) if p) for a in authors
    ]
    return _join(rendered, "and")


# ---------------------------------------------------------------------------
# Bibliography entries
# ---------------------------------------------------------------------------


def _pages(ref: Reference, prefix: str = "pp. ") -> str:
    return f"{prefix}{ref.page}" if ref.page else ""


def _doi_or_url(ref: Reference) -> str:
    if ref.doi:
        return f"https://doi.org/{ref.doi}" if not ref.doi.startswith("http") else ref.doi
    return ref.url


def _ieee_entry(ref: Reference) -> list[Span]:
    spans: list[Span] = []
    names = _ieee_names(ref.authors)
    if names:
        spans.append(Span(f"{names}, "))
    if ref.title:
        # IEEE quotes article titles and italicises the container.
        if ref.type in ("book", "thesis", "report"):
            spans.append(Span(ref.title, italic=True))
            spans.append(Span(", "))
        else:
            spans.append(Span(f'"{ref.title}," '))
    if ref.container:
        spans.append(Span("in " if ref.type == "paper-conference" else ""))
        spans.append(Span(ref.container, italic=True))
        spans.append(Span(", "))
    tail = [
        f"{ref.edition} ed." if ref.edition else "",
        ref.publisher if ref.type in ("book", "thesis", "report") else "",
        f"vol. {ref.volume}" if ref.volume else "",
        f"no. {ref.issue}" if ref.issue else "",
        _pages(ref),
        ref.year,
    ]
    spans.append(Span(", ".join(p for p in tail if p) + "."))
    return spans


def _apa_entry(ref: Reference) -> list[Span]:
    spans: list[Span] = []
    names = _apa_names(ref.authors)
    if names:
        spans.append(Span(f"{names} "))
    spans.append(Span(f"({ref.year or 'n.d.'}). "))
    if ref.title:
        if ref.type in ("book", "thesis", "report"):
            spans.append(Span(ref.title, italic=True))
            if ref.edition:
                spans.append(Span(f" ({ref.edition} ed.)"))
            spans.append(Span(". "))
        else:
            spans.append(Span(f"{ref.title}. "))
    if ref.container:
        spans.append(Span("In " if ref.type == "paper-conference" else ""))
        spans.append(Span(ref.container, italic=True))
        if ref.volume:
            spans.append(Span(", "))
            # APA italicises the volume number with the journal name.
            spans.append(Span(ref.volume, italic=True))
            if ref.issue:
                spans.append(Span(f"({ref.issue})"))
        if ref.page:
            spans.append(Span(f", {ref.page}"))
        spans.append(Span(". "))
    if ref.publisher and ref.type in ("book", "thesis", "report", "chapter"):
        spans.append(Span(f"{ref.publisher}. "))
    link = _doi_or_url(ref)
    if link:
        spans.append(Span(link))
    return spans


def _acm_entry(ref: Reference) -> list[Span]:
    spans: list[Span] = []
    names = _acm_names(ref.authors)
    if names:
        spans.append(Span(f"{names}. "))
    # ACM puts the year immediately after the authors.
    spans.append(Span(f"{ref.year or 'n.d.'}. "))
    if ref.title:
        spans.append(Span(f"{ref.title}. "))
    if ref.container:
        spans.append(Span("In " if ref.type == "paper-conference" else ""))
        spans.append(Span(ref.container, italic=True))
        detail = ", ".join(
            p for p in (ref.volume, ref.issue) if p
        )
        if detail:
            spans.append(Span(f" {detail}"))
        if ref.year:
            spans.append(Span(f" ({ref.year})"))
        if ref.page:
            spans.append(Span(f", {ref.page}"))
        spans.append(Span("."))
    elif ref.publisher:
        spans.append(Span(f"{ref.publisher}."))
    return spans


_ENTRY_FORMATTERS = {
    "ieee": _ieee_entry,
    "acm": _acm_entry,
    "apa": _apa_entry,
}


def format_entry(ref: Reference, family: str) -> list[Span]:
    """Render one bibliography entry as spans."""
    if ref.literal:
        # Unparsed source text: show it rather than emitting an empty entry.
        return [Span(ref.literal)]
    formatter = _ENTRY_FORMATTERS.get(family, _apa_entry)
    spans = [s for s in formatter(ref) if s.text]
    if spans:
        # Entries are assembled from parts that each carry their own trailing
        # separator; the last one leaves a space hanging off the end.
        tail = spans[-1]
        spans[-1] = Span(tail.text.rstrip(), tail.italic)
    return [s for s in spans if s.text]


# ---------------------------------------------------------------------------
# Ordering and in-text citations
# ---------------------------------------------------------------------------


def is_numeric(family: str) -> bool:
    return family in ("ieee", "acm")


def order_references(
    refs: list[Reference], cited_order: list[str], family: str
) -> list[Reference]:
    """Bibliography order.

    IEEE numbers in order of first citation. ACM and APA sort alphabetically —
    ACM then numbers that order, APA leaves it unnumbered. Uncited references
    are kept, after the cited ones, rather than being dropped: they are the
    user's data.
    """
    by_id = {r.id: r for r in refs}
    if family == "ieee":
        ordered = [by_id[i] for i in cited_order if i in by_id]
        rest = sorted((r for r in refs if r.id not in set(cited_order)), key=Reference.sort_key)
        return ordered + rest
    return sorted(refs, key=Reference.sort_key)


def _collapse(numbers: list[int]) -> str:
    """[1,2,3,5] -> "1"-"3", "5". Runs of three or more become a range."""
    numbers = sorted(set(numbers))
    if not numbers:
        return ""
    groups: list[list[int]] = [[numbers[0]]]
    for value in numbers[1:]:
        if value == groups[-1][-1] + 1:
            groups[-1].append(value)
        else:
            groups.append([value])
    parts = []
    for group in groups:
        if len(group) >= 3:
            parts.append(f"[{group[0]}]{EN_DASH}[{group[-1]}]")
        else:
            parts.extend(f"[{n}]" for n in group)
    return ", ".join(parts)


def _author_date_label(refs: list[Reference]) -> str:
    parts = []
    for ref in refs:
        if not ref.authors:
            name = ref.title[:20] or ref.id
        elif len(ref.authors) == 1:
            name = ref.authors[0].family or ref.authors[0].literal
        elif len(ref.authors) == 2:
            a, b = ref.authors[:2]
            name = f"{a.family or a.literal} & {b.family or b.literal}"
        else:
            name = f"{ref.authors[0].family or ref.authors[0].literal} et al."
        parts.append(f"{name}, {ref.year}" if ref.year else name)
    return f"({'; '.join(parts)})"


def citation_label(
    ids: list[str], refs: list[Reference], numbers: dict, family: str
) -> str:
    """The in-text marker for a citation node.

    An id with no matching reference renders as "[?]" rather than vanishing —
    a citation that silently disappears is how a paper ships with a dangling
    claim.
    """
    if is_numeric(family):
        known = [numbers[i] for i in ids if i in numbers]
        missing = [i for i in ids if i not in numbers]
        label = _collapse(known) if known else ""
        if missing:
            label = f"{label}, [?]" if label else "[?]"
        return label

    by_id = {r.id: r for r in refs}
    known = [by_id[i] for i in ids if i in by_id]
    if not known:
        return "(?)"
    return _author_date_label(known)


def bibliography(
    refs: list[Reference], cited_order: list[str], family: str
) -> list[tuple[str, list[Span]]]:
    """(marker, spans) per entry — marker is "[1]" for numeric styles, "" for
    author-date, where the entry begins with the author name instead."""
    ordered = order_references(refs, cited_order, family)
    if is_numeric(family):
        return [
            (f"[{index}]", format_entry(ref, family))
            for index, ref in enumerate(ordered, start=1)
        ]
    return [("", format_entry(ref, family)) for ref in ordered]


def numbering(refs: list[Reference], cited_order: list[str], family: str) -> dict:
    """Reference id -> its bibliography number, for numeric styles."""
    if not is_numeric(family):
        return {}
    ordered = order_references(refs, cited_order, family)
    return {ref.id: index for index, ref in enumerate(ordered, start=1)}
