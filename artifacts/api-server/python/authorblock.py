"""The author block — names, affiliations, and correspondence.

Authors are document *metadata*, not prose in the body. That is the whole point:
the same data renders three unrecognisably different ways, and the product's
promise is that switching venue reformats the paper. Anything typed into the
editor as a paragraph could not be re-rendered on a style change.

  IEEE   a borderless grid under the title, each cell holding one author's name
         over their department, organisation, city/country and email.
  APA    centred names carrying superscript affiliation markers, the numbered
         affiliations beneath, then an Author Note with ORCID iDs and the
         correspondence address.
  ACM    a grid like IEEE's, but with the affiliation set upright and the
         department folded into the organisation line.

Which block a style uses is derived from the style id here. It properly belongs
on the document class — a conference paper and a dissertation in the same family
differ — so this mapping is its temporary home, until DocumentClass exists.

Names are stored split into given/family and rendered whole ("John A. Smith").
The split is not for this block; it is for citations, where the same person is
"Smith, J. A.". A full name cannot be reliably split after the fact — particles,
double surnames, mononyms — so it is captured split and joined for display.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches

from docxfont import apply_run_font

# Style id -> author block layout. "custom" and anything unrecognised fall back
# to the centred generic block, which is right far more often than a grid.
_BLOCKS = {
    "ieee": "grid-italic",
    "acm": "grid-upright",
    "apa": "apa-title-page",
}

# IEEE and ACM templates both cap the author grid at three across; more than
# that and the cells are too narrow for an affiliation line.
_MAX_COLUMNS = 3


@dataclass(frozen=True)
class Affiliation:
    id: str
    organization: str = ""
    department: str = ""
    city: str = ""
    country: str = ""

    def place(self) -> str:
        return ", ".join(p for p in (self.city, self.country) if p)

    def one_line(self) -> str:
        """The whole affiliation on a single line, for compact layouts."""
        parts = [self.department, self.organization, self.place()]
        return ", ".join(p for p in parts if p)


@dataclass(frozen=True)
class Author:
    given: str = ""
    family: str = ""
    literal: str = ""
    suffix: str = ""
    affiliation_ids: tuple = ()
    email: str = ""
    orcid: str = ""
    corresponding: bool = False
    equal_contribution: bool = False

    def display_name(self) -> str:
        """`literal` wins: it exists for names that do not decompose — mononyms,
        and organisations credited as authors."""
        if self.literal.strip():
            return self.literal.strip()
        name = " ".join(p for p in (self.given.strip(), self.family.strip()) if p)
        if self.suffix.strip():
            name = f"{name}, {self.suffix.strip()}" if name else self.suffix.strip()
        return name


def _text(value) -> str:
    return str(value).strip() if value is not None else ""


def parse_authors(raw) -> list[Author]:
    """Normalise the JSON the API sends. Keys are camelCase, matching the rest
    of the payload (editorContent, formattingIssues) rather than StyleSpec's
    deliberate snake_case."""
    authors: list[Author] = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        author = Author(
            given=_text(item.get("given")),
            family=_text(item.get("family")),
            literal=_text(item.get("literal")),
            suffix=_text(item.get("suffix")),
            affiliation_ids=tuple(
                _text(a) for a in (item.get("affiliationIds") or []) if _text(a)
            ),
            email=_text(item.get("email")),
            orcid=_text(item.get("orcid")),
            corresponding=bool(item.get("corresponding")),
            equal_contribution=bool(item.get("equalContribution")),
        )
        # An author with no name at all is a half-filled form row, not a person.
        if author.display_name():
            authors.append(author)
    return authors


def parse_affiliations(raw) -> list[Affiliation]:
    out: list[Affiliation] = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        affiliation = Affiliation(
            id=_text(item.get("id")),
            organization=_text(item.get("organization")),
            department=_text(item.get("department")),
            city=_text(item.get("city")),
            country=_text(item.get("country")),
        )
        if affiliation.id and affiliation.one_line():
            out.append(affiliation)
    return out


def block_for(style_id: str) -> str:
    return _BLOCKS.get((style_id or "").lower(), "centred")


# ---------------------------------------------------------------------------
# Shared pieces
# ---------------------------------------------------------------------------


def _printable_width_in(style) -> float:
    return max(
        style.page_width_in - style.margins_in["left"] - style.margins_in["right"],
        1.0,
    )


def _line(paragraph, text: str, style, size_pt: float, *, italic=False, bold=False):
    run = paragraph.add_run(text)
    apply_run_font(run, style.body_font, size_pt, bold=bold, italic=italic)
    return run


def _affiliations_for(author: Author, by_id: dict) -> list[Affiliation]:
    return [by_id[a] for a in author.affiliation_ids if a in by_id]


def _grid_shape(count: int) -> tuple[int, int]:
    """Rows and columns for `count` authors, balanced rather than ragged.

    Four authors go 2x2, not 3+1 — a lone trailing cell reads as a mistake.
    """
    rows = max(1, math.ceil(count / _MAX_COLUMNS))
    return rows, max(1, math.ceil(count / rows))


# ---------------------------------------------------------------------------
# IEEE / ACM: the grid
# ---------------------------------------------------------------------------


def _render_grid(document, authors, by_id, style, *, italic_affiliation: bool) -> None:
    rows, columns = _grid_shape(len(authors))
    table = document.add_table(rows=rows, cols=columns)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False

    width = Inches(_printable_width_in(style) / columns)
    for column in table.columns:
        for cell in column.cells:
            cell.width = width

    name_size = style.body_size_pt + 1
    detail_size = style.body_size_pt

    for index, author in enumerate(authors):
        cell = table.cell(index // columns, index % columns)
        paragraph = cell.paragraphs[0]
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        paragraph.paragraph_format.space_after = Inches(0)
        _line(paragraph, author.display_name(), style, name_size)

        lines: list[str] = []
        for affiliation in _affiliations_for(author, by_id):
            if italic_affiliation:
                # The IEEE template keeps department and organisation apart.
                lines.extend(
                    p
                    for p in (
                        affiliation.department,
                        affiliation.organization,
                        affiliation.place(),
                    )
                    if p
                )
            else:
                lines.append(affiliation.one_line())
        if author.email:
            lines.append(author.email)

        for text in lines:
            detail = cell.add_paragraph()
            detail.alignment = WD_ALIGN_PARAGRAPH.CENTER
            detail.paragraph_format.space_after = Inches(0)
            _line(detail, text, style, detail_size, italic=italic_affiliation)

    # Blank trailing cells in a ragged final row would still draw their (empty)
    # paragraph; nothing to do, but they must not inherit body spacing.
    for row in table.rows:
        for cell in row.cells:
            for paragraph in cell.paragraphs:
                paragraph.paragraph_format.space_before = Inches(0)


# ---------------------------------------------------------------------------
# APA: title page
# ---------------------------------------------------------------------------


def _render_apa(document, authors, affiliations, by_id, style) -> None:
    size = style.body_size_pt
    # Number only the affiliations actually cited, in the order authors use
    # them, so the markers read 1, 2, 3 down the page.
    order: list[str] = []
    for author in authors:
        for aid in author.affiliation_ids:
            if aid in by_id and aid not in order:
                order.append(aid)
    number_of = {aid: i + 1 for i, aid in enumerate(order)}

    # A single shared affiliation needs no markers at all — APA only numbers
    # when authors differ.
    mark = len(order) > 1

    names = document.add_paragraph()
    names.alignment = WD_ALIGN_PARAGRAPH.CENTER
    names.paragraph_format.line_spacing = style.line_spacing
    for index, author in enumerate(authors):
        if index:
            separator = " and " if index == len(authors) - 1 and len(authors) == 2 else ", "
            if index == len(authors) - 1 and len(authors) > 2:
                separator = ", and "
            _line(names, separator, style, size)
        _line(names, author.display_name(), style, size)
        if mark:
            markers = ",".join(
                str(number_of[a]) for a in author.affiliation_ids if a in number_of
            )
            if markers:
                run = names.add_run(markers)
                apply_run_font(run, style.body_font, size, superscript=True)

    for aid in order:
        affiliation = by_id[aid]
        paragraph = document.add_paragraph()
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        paragraph.paragraph_format.line_spacing = style.line_spacing
        if mark:
            run = paragraph.add_run(str(number_of[aid]))
            apply_run_font(run, style.body_font, size, superscript=True)
        _line(paragraph, affiliation.one_line(), style, size)

    if not order and affiliations:
        # No author claimed an affiliation, but affiliations exist — show them
        # rather than dropping data the user entered.
        for affiliation in affiliations:
            paragraph = document.add_paragraph()
            paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
            paragraph.paragraph_format.line_spacing = style.line_spacing
            _line(paragraph, affiliation.one_line(), style, size)

    _render_author_note(document, authors, by_id, style)


def _render_author_note(document, authors, by_id, style) -> None:
    size = style.body_size_pt
    orcids = [a for a in authors if a.orcid]
    corresponding = [a for a in authors if a.corresponding]
    equal = [a for a in authors if a.equal_contribution]
    if not (orcids or corresponding or equal):
        return

    heading = document.add_paragraph()
    heading.alignment = WD_ALIGN_PARAGRAPH.CENTER
    heading.paragraph_format.line_spacing = style.line_spacing
    _line(heading, "Author Note", style, size, bold=True)

    for author in orcids:
        paragraph = document.add_paragraph()
        paragraph.paragraph_format.line_spacing = style.line_spacing
        _line(paragraph, f"{author.display_name()} {author.orcid}", style, size)

    if equal:
        paragraph = document.add_paragraph()
        paragraph.paragraph_format.line_spacing = style.line_spacing
        names = _join_names([a.display_name() for a in equal])
        _line(paragraph, f"{names} contributed equally to this work.", style, size)

    for author in corresponding:
        paragraph = document.add_paragraph()
        paragraph.paragraph_format.line_spacing = style.line_spacing
        where = ", ".join(
            a.one_line() for a in _affiliations_for(author, by_id)
        )
        address = f"{author.display_name()}"
        if where:
            address += f", {where}"
        sentence = (
            "Correspondence concerning this article should be addressed to "
            f"{address}."
        )
        if author.email:
            sentence += f" Email: {author.email}"
        _line(paragraph, sentence, style, size)


def _join_names(names: list[str]) -> str:
    if len(names) <= 1:
        return names[0] if names else ""
    if len(names) == 2:
        return f"{names[0]} and {names[1]}"
    return ", ".join(names[:-1]) + f", and {names[-1]}"


# ---------------------------------------------------------------------------
# Fallback
# ---------------------------------------------------------------------------


def _render_centred(document, authors, affiliations, by_id, style) -> None:
    """One centred line of names, one of affiliations. Used for custom styles,
    where guessing at a venue's author block would be worse than plain."""
    size = style.body_size_pt

    names = document.add_paragraph()
    names.alignment = WD_ALIGN_PARAGRAPH.CENTER
    names.paragraph_format.line_spacing = style.line_spacing
    _line(names, _join_names([a.display_name() for a in authors]), style, size)

    seen: list[str] = []
    for author in authors:
        for affiliation in _affiliations_for(author, by_id):
            if affiliation.one_line() not in seen:
                seen.append(affiliation.one_line())
    if not seen:
        seen = [a.one_line() for a in affiliations]

    for line in seen:
        paragraph = document.add_paragraph()
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        paragraph.paragraph_format.line_spacing = style.line_spacing
        _line(paragraph, line, style, size)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def render_author_block(
    document, raw_authors, raw_affiliations, style, layout: str | None = None
) -> bool:
    """Render the author block into `document`. Returns whether anything was
    written, so the caller can skip the spacing that follows it.

    Called from the exporter's front matter, before the section break — the
    block spans the page even when the body is two-column.

    `layout` comes from the document class. Falling back to the style id keeps
    callers that have only a StyleSpec working.
    """
    authors = parse_authors(raw_authors)
    affiliations = parse_affiliations(raw_affiliations)
    if not authors:
        return False

    by_id = {a.id: a for a in affiliations}
    layout = layout or block_for(getattr(style, "id", ""))

    if layout == "grid-italic":
        _render_grid(document, authors, by_id, style, italic_affiliation=True)
    elif layout == "grid-upright":
        _render_grid(document, authors, by_id, style, italic_affiliation=False)
    elif layout == "apa-title-page":
        _render_apa(document, authors, affiliations, by_id, style)
    else:
        _render_centred(document, authors, affiliations, by_id, style)

    return True
