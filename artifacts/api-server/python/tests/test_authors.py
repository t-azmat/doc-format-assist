"""Tests for the author block.

Authors are metadata, and the point of that is re-rendering: the same data has
to come out as an IEEE grid, an APA title page, or an ACM block depending only
on the style. These check each layout, and that the block lands on the
full-width side of the section break.
"""

import sys
from pathlib import Path

import pytest
from docx.oxml.ns import qn

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from authorblock import (  # noqa: E402
    _grid_shape,
    block_for,
    parse_affiliations,
    parse_authors,
)
from export import render_docx  # noqa: E402
from styles import get_style  # noqa: E402

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def author(given, family, **kw):
    return {"given": given, "family": family, **kw}


def affiliation(id_, organization, **kw):
    return {"id": id_, "organization": organization, **kw}


def doc(*nodes):
    return {"type": "doc", "content": list(nodes) or [{"type": "paragraph"}]}


def para(text):
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


AUTHORS = [
    author("Ada", "Lovelace", affiliationIds=["a1"], email="ada@example.edu",
           orcid="0000-0001", corresponding=True),
    author("Alan", "Turing", affiliationIds=["a2"], email="alan@example.edu"),
]

AFFILIATIONS = [
    affiliation("a1", "Analytical Engine Institute", department="Computing",
                city="London", country="UK"),
    affiliation("a2", "National Physical Laboratory", city="Teddington", country="UK"),
]


def render(style_id, authors=AUTHORS, affiliations=AFFILIATIONS, content=None):
    return render_docx(
        content or doc(para("body")),
        "A Paper",
        get_style(style_id),
        authors,
        affiliations,
    )


def all_text(document) -> str:
    parts = [p.text for p in document.paragraphs]
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                parts.extend(p.text for p in cell.paragraphs)
    return "\n".join(parts)


# --- parsing ----------------------------------------------------------------

def test_camelcase_keys_are_read():
    [parsed] = parse_authors([author("Ada", "Lovelace", affiliationIds=["x"],
                                     equalContribution=True)])

    assert parsed.affiliation_ids == ("x",)
    assert parsed.equal_contribution is True


def test_nameless_authors_are_dropped():
    """A half-filled form row is not a person."""
    parsed = parse_authors([author("", ""), author("Ada", "Lovelace"), {}, "junk"])

    assert len(parsed) == 1


def test_literal_name_wins():
    [parsed] = parse_authors([{"given": "ignored", "family": "also",
                               "literal": "The Tor Project"}])

    assert parsed.display_name() == "The Tor Project"


def test_suffix_is_appended():
    [parsed] = parse_authors([author("John", "Smith", suffix="Jr.")])

    assert parsed.display_name() == "John Smith, Jr."


def test_affiliations_need_an_id_and_content():
    parsed = parse_affiliations([
        affiliation("a1", "Somewhere"),
        affiliation("", "No id"),
        affiliation("a3", ""),
    ])

    assert [a.id for a in parsed] == ["a1"]


@pytest.mark.parametrize(
    "style_id,expected",
    [("ieee", "grid-italic"), ("acm", "grid-upright"), ("apa", "apa-title-page"),
     ("custom", "centred"), ("", "centred")],
)
def test_block_selection(style_id, expected):
    assert block_for(style_id) == expected


@pytest.mark.parametrize(
    "count,shape",
    [(1, (1, 1)), (2, (1, 2)), (3, (1, 3)),
     # Four balances to 2x2 rather than leaving a lone trailing cell.
     (4, (2, 2)), (5, (2, 3)), (6, (2, 3)), (7, (3, 3)), (9, (3, 3))],
)
def test_grid_is_balanced(count, shape):
    assert _grid_shape(count) == shape


# --- IEEE / ACM grid --------------------------------------------------------

@pytest.mark.parametrize("style_id", ["ieee", "acm"])
def test_grid_styles_render_a_table(style_id):
    document = render(style_id)

    assert len(document.tables) == 1
    assert len(document.tables[0].columns) == 2


@pytest.mark.parametrize("style_id", ["ieee", "acm"])
def test_grid_carries_names_and_affiliations(style_id):
    text = all_text(render(style_id))

    for expected in ("Ada Lovelace", "Alan Turing",
                     "Analytical Engine Institute", "ada@example.edu"):
        assert expected in text


def test_ieee_splits_department_from_organisation():
    """The IEEE template keeps them on separate lines."""
    cell = render("ieee").tables[0].cell(0, 0)
    lines = [p.text for p in cell.paragraphs if p.text]

    assert "Computing" in lines
    assert "Analytical Engine Institute" in lines
    assert "London, UK" in lines


def test_acm_folds_the_affiliation_onto_one_line():
    cell = render("acm").tables[0].cell(0, 0)
    lines = [p.text for p in cell.paragraphs if p.text]

    assert "Computing, Analytical Engine Institute, London, UK" in lines


def test_ieee_sets_the_affiliation_in_italic():
    cell = render("ieee").tables[0].cell(0, 0)
    detail = [p for p in cell.paragraphs if p.text == "Computing"][0]

    assert detail.runs[0].font.italic is True


def test_acm_affiliation_is_upright():
    cell = render("acm").tables[0].cell(0, 0)
    detail = [p for p in cell.paragraphs if "Analytical" in p.text][0]

    assert detail.runs[0].font.italic is not True


# --- APA title page ---------------------------------------------------------

def test_apa_does_not_use_a_table():
    assert render("apa").tables == []


def test_apa_names_share_one_line():
    text = "\n".join(p.text for p in render("apa").paragraphs)

    assert "Ada Lovelace" in text and "Alan Turing" in text


def test_apa_numbers_differing_affiliations():
    document = render("apa")
    superscripts = [
        run.text
        for p in document.paragraphs
        for run in p.runs
        if run.font.superscript
    ]

    assert "1" in superscripts and "2" in superscripts


def test_apa_omits_markers_when_everyone_shares_an_affiliation():
    """APA only numbers affiliations when authors differ."""
    shared = [author("Ada", "Lovelace", affiliationIds=["a1"]),
              author("Alan", "Turing", affiliationIds=["a1"])]
    document = render("apa", authors=shared)

    assert not [r for p in document.paragraphs for r in p.runs if r.font.superscript]


def test_apa_writes_an_author_note_with_correspondence():
    text = "\n".join(p.text for p in render("apa").paragraphs)

    assert "Author Note" in text
    assert "Correspondence concerning this article" in text
    assert "ada@example.edu" in text


def test_apa_author_note_lists_orcid():
    text = "\n".join(p.text for p in render("apa").paragraphs)

    assert "0000-0001" in text


def test_apa_records_equal_contribution():
    equal = [author("Ada", "Lovelace", equalContribution=True),
             author("Alan", "Turing", equalContribution=True)]
    text = "\n".join(p.text for p in render("apa", authors=equal).paragraphs)

    assert "contributed equally" in text


def test_apa_skips_the_note_when_there_is_nothing_to_say():
    plain = [author("Ada", "Lovelace"), author("Alan", "Turing")]
    text = "\n".join(p.text for p in render("apa", authors=plain).paragraphs)

    assert "Author Note" not in text


# --- placement --------------------------------------------------------------

def test_the_grid_stays_in_the_full_width_section():
    """The regression that matters: if the section break folds past the table,
    the author grid ends up in the two-column body."""
    document = render("ieee")
    body = document.element.body

    children = list(body)
    table_index = next(i for i, c in enumerate(children) if c.tag == f"{W}tbl")
    break_index = next(
        i
        for i, c in enumerate(children)
        if c.tag == f"{W}p" and c.find(f"{W}pPr/{W}sectPr") is not None
    )

    assert table_index < break_index


def test_the_body_is_still_two_column_with_authors():
    document = render("ieee")
    cols = document.sections[-1]._sectPr.find(qn("w:cols"))

    assert cols.get(qn("w:num")) == "2"
    assert len(document.sections) == 2


# --- degenerate input -------------------------------------------------------

def test_no_authors_renders_nothing_extra():
    with_authors = render("ieee", authors=[])
    text = "\n".join(p.text for p in with_authors.paragraphs)

    assert with_authors.tables == []
    assert "A Paper" in text


def test_authors_without_affiliations_still_render():
    document = render("ieee", authors=[author("Ada", "Lovelace")], affiliations=[])

    assert "Ada Lovelace" in all_text(document)


def test_dangling_affiliation_id_is_ignored():
    """Deleting an affiliation must not break export for authors still citing
    it."""
    document = render("ieee", authors=[author("Ada", "Lovelace",
                                              affiliationIds=["gone"])],
                      affiliations=[])

    assert "Ada Lovelace" in all_text(document)


@pytest.mark.parametrize("style_id", ["ieee", "apa", "acm"])
def test_body_content_survives(style_id):
    document = render(style_id, content=doc(para("body text here")))

    assert "body text here" in all_text(document)


def test_many_authors_wrap_into_rows():
    many = [author(f"A{i}", f"Name{i}") for i in range(7)]
    table = render("ieee", authors=many).tables[0]

    assert len(table.rows) == 3
    assert len(table.columns) == 3
