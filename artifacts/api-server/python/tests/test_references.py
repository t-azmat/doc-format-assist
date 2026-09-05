"""Tests for CSL-JSON references: citations, bibliography, BibTeX import.

`citation_style` on StyleSpec used to be a label — "numeric" or "author-date" —
that nothing acted on. These cover the behaviour behind it.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bibtex import bibtex_to_csl  # noqa: E402
from docclass import get_document_class  # noqa: E402
from export import render_docx  # noqa: E402
from references import (  # noqa: E402
    bibliography,
    citation_label,
    format_entry,
    numbering,
    order_references,
    parse_references,
)
from styles import get_style  # noqa: E402

ARTICLE = {
    "id": "smith2020",
    "type": "article-journal",
    "title": "Attention under a fixed budget",
    "author": [{"family": "Smith", "given": "John A."}],
    "container-title": "Journal of Computing",
    "volume": "12",
    "issue": "3",
    "page": "1--10",
    "issued": {"date-parts": [[2020]]},
    "DOI": "10.1000/abc",
}

BOOK = {
    "id": "doe2019",
    "type": "book",
    "title": "Foundations of Method",
    "author": [{"family": "Doe", "given": "Jane"}, {"family": "Roe", "given": "Bob"}],
    "publisher": "Academic Press",
    "edition": "2nd",
    "issued": {"date-parts": [[2019]]},
}

PAPER = {
    "id": "lee2021",
    "type": "paper-conference",
    "title": "Sparse patterns",
    "author": [{"family": "Lee", "given": "Carol"}],
    "container-title": "Proc. Conference on Things",
    "page": "20--25",
    "issued": {"date-parts": [[2021]]},
}

ALL = [ARTICLE, BOOK, PAPER]


def cite(*ids):
    return {"type": "citation", "attrs": {"ids": list(ids)}}


def para(*children):
    return {"type": "paragraph", "content": list(children)}


def text(value):
    return {"type": "text", "text": value}


def heading(value, level=1):
    return {"type": "heading", "attrs": {"level": level},
            "content": [{"type": "text", "text": value}]}


def doc(*nodes):
    return {"type": "doc", "content": list(nodes)}


def flat(spans):
    return "".join(s.text for s in spans)


def rendered(document):
    return "\n".join(p.text for p in document.paragraphs)


# --- parsing ----------------------------------------------------------------

def test_csl_json_is_read():
    [ref] = parse_references([ARTICLE])

    assert ref.id == "smith2020"
    assert ref.year == "2020"
    assert ref.authors[0].family == "Smith"
    assert ref.page == "1–10"  # normalised to an en dash


def test_items_without_an_id_are_skipped():
    """Nothing could cite them."""
    assert parse_references([{"title": "No id"}, ARTICLE]) == parse_references([ARTICLE])


def test_duplicate_ids_are_collapsed():
    assert len(parse_references([ARTICLE, dict(ARTICLE)])) == 1


def test_organisation_authors_survive_as_literals():
    [ref] = parse_references(
        [{"id": "x", "author": [{"literal": "The Tor Project"}], "title": "t"}]
    )

    assert ref.authors[0].literal == "The Tor Project"


def test_junk_input_does_not_crash():
    assert parse_references(["nonsense", None, 42]) == []
    assert parse_references(None) == []


# --- bibliography entries ---------------------------------------------------

def test_ieee_entry_shape():
    [ref] = parse_references([ARTICLE])

    entry = flat(format_entry(ref, "ieee"))

    assert entry.startswith("J. A. Smith,")          # initials before family
    assert '"Attention under a fixed budget,"' in entry
    assert "vol. 12" in entry and "no. 3" in entry and "pp. 1–10" in entry


def test_apa_entry_shape():
    [ref] = parse_references([ARTICLE])

    entry = flat(format_entry(ref, "apa"))

    assert entry.startswith("Smith, J. A. (2020).")  # inverted, year in parens
    assert "https://doi.org/10.1000/abc" in entry


def test_acm_entry_shape():
    [ref] = parse_references([ARTICLE])

    entry = flat(format_entry(ref, "acm"))

    assert entry.startswith("John A. Smith. 2020.")  # full names, year early


def test_journal_names_are_italic():
    """A journal name set upright is a different, wrong citation."""
    [ref] = parse_references([ARTICLE])

    italics = [s.text for s in format_entry(ref, "ieee") if s.italic]

    assert "Journal of Computing" in italics


def test_apa_italicises_the_volume_with_the_journal():
    [ref] = parse_references([ARTICLE])

    italics = [s.text for s in format_entry(ref, "apa") if s.italic]

    assert "Journal of Computing" in italics and "12" in italics


def test_book_titles_are_italic_not_quoted():
    [ref] = parse_references([BOOK])

    entry = format_entry(ref, "ieee")

    assert "Foundations of Method" in [s.text for s in entry if s.italic]
    assert '"' not in flat(entry)


def test_two_authors_join_correctly_per_style():
    [ref] = parse_references([BOOK])

    assert "J. Doe and B. Roe" in flat(format_entry(ref, "ieee"))
    assert "Doe, J., & Roe, B." in flat(format_entry(ref, "apa"))
    assert "Jane Doe and Bob Roe" in flat(format_entry(ref, "acm"))


def test_ieee_collapses_long_author_lists():
    many = dict(ARTICLE)
    many["author"] = [{"family": f"N{i}", "given": "A"} for i in range(8)]
    [ref] = parse_references([many])

    assert "et al." in flat(format_entry(ref, "ieee"))


def test_entries_do_not_end_in_whitespace():
    """Entries are assembled from parts that each carry a trailing separator."""
    for ref in parse_references(ALL):
        for family in ("ieee", "apa", "acm"):
            entry = flat(format_entry(ref, family))
            assert entry == entry.rstrip(), f"{family}: {entry!r}"


def test_a_missing_year_reads_as_no_date():
    [ref] = parse_references([{"id": "x", "title": "T", "author": [{"family": "A"}]}])

    assert "n.d." in flat(format_entry(ref, "apa"))


def test_an_unparsed_reference_is_shown_verbatim():
    """Extraction yields reference strings, not fields. Showing the string beats
    emitting an empty entry."""
    [ref] = parse_references([{"id": "raw1", "literal": "Some old reference, 1998."}])

    assert flat(format_entry(ref, "ieee")) == "Some old reference, 1998."


# --- ordering ---------------------------------------------------------------

def test_ieee_orders_by_first_citation():
    refs = parse_references(ALL)

    ordered = order_references(refs, ["lee2021", "smith2020"], "ieee")

    assert [r.id for r in ordered[:2]] == ["lee2021", "smith2020"]


def test_apa_and_acm_order_alphabetically():
    refs = parse_references(ALL)

    for family in ("apa", "acm"):
        ordered = order_references(refs, ["lee2021", "smith2020"], family)
        assert [r.id for r in ordered] == ["doe2019", "lee2021", "smith2020"]


def test_uncited_references_are_kept():
    """They are the user's data; dropping them silently would be worse than an
    over-long bibliography."""
    refs = parse_references(ALL)

    ordered = order_references(refs, ["smith2020"], "ieee")

    assert len(ordered) == 3


def test_numeric_styles_number_the_bibliography():
    refs = parse_references(ALL)

    entries = bibliography(refs, ["lee2021"], "ieee")

    assert [marker for marker, _ in entries][:2] == ["[1]", "[2]"]


def test_author_date_bibliography_has_no_markers():
    refs = parse_references(ALL)

    assert all(marker == "" for marker, _ in bibliography(refs, [], "apa"))


# --- in-text citations ------------------------------------------------------

def test_numeric_citation_label():
    refs = parse_references(ALL)
    numbers = numbering(refs, ["smith2020", "doe2019"], "ieee")

    assert citation_label(["smith2020"], refs, numbers, "ieee") == "[1]"
    assert citation_label(["smith2020", "doe2019"], refs, numbers, "ieee") == "[1], [2]"


def test_three_or_more_consecutive_numbers_collapse_to_a_range():
    refs = parse_references(ALL)
    numbers = numbering(refs, ["smith2020", "doe2019", "lee2021"], "ieee")

    assert citation_label(
        ["smith2020", "doe2019", "lee2021"], refs, numbers, "ieee"
    ) == "[1]–[3]"


@pytest.mark.parametrize(
    "ids,expected",
    [
        (["smith2020"], "(Smith, 2020)"),
        (["smith2020", "lee2021"], "(Smith, 2020; Lee, 2021)"),
    ],
)
def test_author_date_citation_label(ids, expected):
    refs = parse_references(ALL)

    assert citation_label(ids, refs, {}, "apa") == expected


def test_two_authors_use_an_ampersand_in_text():
    refs = parse_references([BOOK])

    assert citation_label(["doe2019"], refs, {}, "apa") == "(Doe & Roe, 2019)"


def test_three_authors_become_et_al_in_text():
    three = dict(ARTICLE)
    three["author"] = [{"family": f"N{i}", "given": "A"} for i in range(3)]
    refs = parse_references([three])

    assert "et al." in citation_label(["smith2020"], refs, {}, "apa")


def test_a_citation_of_a_missing_reference_is_visible():
    """A citation that silently vanishes is how a paper ships with a dangling
    claim."""
    refs = parse_references([ARTICLE])
    numbers = numbering(refs, ["smith2020"], "ieee")

    assert "?" in citation_label(["gone"], refs, numbers, "ieee")
    assert "?" in citation_label(["gone"], refs, {}, "apa")


# --- export -----------------------------------------------------------------

def test_citations_render_in_the_body():
    content = doc(
        para(text("As shown "), cite("smith2020"), text(" and "), cite("lee2021"), text(".")),
        heading("References"),
    )
    document = render_docx(
        content, "T", get_style("ieee"),
        doc_class=get_document_class("ieee-conference"), references=ALL,
    )

    assert "As shown [1] and [2]." in rendered(document)


def test_the_bibliography_replaces_the_references_section():
    content = doc(
        para(text("Body "), cite("smith2020")),
        heading("References"),
        para(text("stale hand-typed entry")),
    )
    document = render_docx(
        content, "T", get_style("ieee"),
        doc_class=get_document_class("ieee-conference"), references=ALL,
    )

    output = rendered(document)
    assert "stale hand-typed entry" not in output
    assert "Attention under a fixed budget" in output


def test_references_are_appended_when_there_is_no_section():
    """Unlike a contents page, references are user data — dropping them would
    lose something the user entered."""
    document = render_docx(
        doc(para(text("Body "), cite("smith2020"))), "T", get_style("ieee"),
        doc_class=get_document_class("ieee-conference"), references=ALL,
    )

    output = rendered(document)
    assert "References" in output
    assert "Attention under a fixed budget" in output


def test_no_references_leaves_the_document_alone():
    document = render_docx(
        doc(para(text("Body"))), "T", get_style("ieee"),
        doc_class=get_document_class("ieee-conference"), references=[],
    )

    assert "References" not in rendered(document)


def test_author_date_citations_render_for_apa():
    content = doc(para(text("As shown "), cite("smith2020"), text(".")), heading("References"))
    document = render_docx(
        content, "T", get_style("apa"),
        doc_class=get_document_class("apa-journal"), references=ALL,
    )

    assert "(Smith, 2020)" in rendered(document)


def test_citation_state_does_not_leak_between_renders():
    """The citation context is module-level; a stale one would number the next
    document from the previous document's bibliography."""
    content = doc(para(text("x "), cite("smith2020")), heading("References"))
    render_docx(content, "T", get_style("ieee"),
                doc_class=get_document_class("ieee-conference"), references=ALL)

    second = render_docx(content, "T", get_style("ieee"),
                         doc_class=get_document_class("ieee-conference"), references=[])

    assert "[1]" not in rendered(second)


# --- BibTeX import ----------------------------------------------------------

BIB = r"""
@article{smith2020,
  author  = {Smith, John A. and Doe, Jane},
  title   = {Attention under a fixed budget},
  journal = {Journal of Computing},
  volume  = {12},
  number  = {3},
  pages   = {1--10},
  year    = {2020},
  doi     = {10.1000/abc}
}

@inproceedings{lee2021,
  author    = {Carol Lee},
  title     = {Sparse patterns},
  booktitle = {Proceedings of Things},
  year      = {2021}
}
"""


def test_bibtex_entries_convert():
    items = bibtex_to_csl(BIB)

    assert [i["id"] for i in items] == ["smith2020", "lee2021"]
    assert items[0]["type"] == "article-journal"
    assert items[1]["type"] == "paper-conference"


def test_bibtex_authors_split_both_ways():
    items = bibtex_to_csl(BIB)

    assert items[0]["author"][0] == {"family": "Smith", "given": "John A."}
    assert items[1]["author"][0] == {"family": "Lee", "given": "Carol"}


def test_bibtex_fields_map_to_csl_names():
    [article, paper] = bibtex_to_csl(BIB)

    assert article["container-title"] == "Journal of Computing"
    assert article["issue"] == "3"
    assert article["issued"] == {"date-parts": [[2020]]}
    assert paper["container-title"] == "Proceedings of Things"


def test_braced_names_stay_literal():
    items = bibtex_to_csl("@misc{x, author = {{The Tor Project}}, title = {T}, year = {2020}}")

    assert items[0]["author"] == [{"literal": "The Tor Project"}]


def test_latex_accents_are_decoded():
    items = bibtex_to_csl(r"@article{x, author = {M\"uller, Hans}, title = {Caf\'e}, year={2020}}")

    assert items[0]["author"][0]["family"] == "Müller"
    assert items[0]["title"] == "Café"


def test_a_malformed_entry_does_not_cost_the_rest():
    """One bad record in a 200-item library must not reject the other 199."""
    items = bibtex_to_csl("@article{good, title = {T}, year = {2020}}\n@@@ junk\n")

    assert [i["id"] for i in items] == ["good"]


def test_commas_inside_braced_values_do_not_split_fields():
    items = bibtex_to_csl("@book{x, title = {A Title, With a Comma}, year = {2020}}")

    assert items[0]["title"] == "A Title, With a Comma"


def test_empty_input_yields_nothing():
    assert bibtex_to_csl("") == []
    assert bibtex_to_csl("not bibtex at all") == []


def test_imported_bibtex_renders():
    """The import path and the render path have to agree on shape."""
    items = bibtex_to_csl(BIB)
    refs = parse_references(items)

    assert "J. A. Smith and J. Doe" in flat(format_entry(refs[0], "ieee"))
