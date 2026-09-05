"""Tests for document classes — the venue x genre axis.

The gap these close: "IEEE" is a family, not a format. A six-page conference
paper and a hundred-page dissertation were previously the same kind of thing to
this app, so choosing IEEE for a thesis produced something plausible and wrong.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from docclass import (  # noqa: E402
    CLASSES,
    TOC_FORBIDDEN,
    TOC_REQUIRED,
    class_for_style,
    custom_class,
    default_class_for,
    get_document_class,
    list_document_classes,
    resolve_document_class,
)
from export import _heading_numbers, render_docx  # noqa: E402
from format import format_document  # noqa: E402
from styles import get_style, spec_from_dict  # noqa: E402


def heading(text, level=1):
    return {
        "type": "heading",
        "attrs": {"level": level},
        "content": [{"type": "text", "text": text}],
    }


def para(text):
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def doc(*nodes):
    return {"type": "doc", "content": list(nodes)}


def severities(issues, severity):
    return [i for i in issues if i["severity"] == severity]


def messages(issues):
    return " ".join(i["message"] for i in issues)


# --- the model --------------------------------------------------------------

def test_both_axes_are_represented():
    """The point of the model: one family, two genres, different rules."""
    conference = get_document_class("ieee-conference")
    journal = get_document_class("ieee-journal")

    assert conference.family == journal.family == "ieee"
    assert conference.genre != journal.genre
    assert conference.page_budget.max_pages < journal.page_budget.max_pages


def test_a_thesis_and_a_paper_disagree_about_contents_pages():
    assert get_document_class("apa-dissertation").toc == TOC_REQUIRED
    assert get_document_class("ieee-conference").toc == TOC_FORBIDDEN


def test_a_thesis_has_no_page_budget():
    assert get_document_class("apa-dissertation").page_budget is None


def test_page_budget_records_whether_references_count():
    """"8 pages including references" and "excluding" differ by real work."""
    assert get_document_class("ieee-conference").page_budget.includes_references
    assert not get_document_class("acm-conference").page_budget.includes_references


def test_budget_description_states_the_scope():
    assert "including references" in get_document_class("ieee-conference").page_budget.describe()
    assert "excluding references" in get_document_class("acm-conference").page_budget.describe()


def test_unknown_class_is_rejected():
    with pytest.raises(ValueError):
        get_document_class("ieee-poster")


def test_every_class_carries_typography_naming_itself():
    for class_id, doc_class in CLASSES.items():
        assert doc_class.typography.id == class_id
        assert doc_class.typography.name == doc_class.name


def test_listing_is_serialisable():
    listed = list_document_classes()

    assert {c["id"] for c in listed} == set(CLASSES)
    budget = next(c for c in listed if c["id"] == "ieee-conference")["pageBudget"]
    assert budget == {"maxPages": 6, "includesReferences": True}
    assert next(c for c in listed if c["id"] == "apa-dissertation")["pageBudget"] is None


# --- resolution -------------------------------------------------------------

def test_explicit_class_wins():
    assert resolve_document_class({"documentClass": "apa-dissertation"}).id == "apa-dissertation"


@pytest.mark.parametrize(
    "family,expected",
    [("ieee", "ieee-conference"), ("acm", "acm-conference"), ("apa", "apa-journal")],
)
def test_legacy_conference_style_maps_to_a_default_class(family, expected):
    """Existing documents store only conferenceStyle; they must keep working."""
    assert resolve_document_class({"conferenceStyle": family}).id == expected


def test_family_default_is_the_shorter_genre():
    """An unstated genre must not silently relax a page limit the user is
    actually bound by."""
    assert default_class_for("ieee").page_budget is not None


def test_guidelines_spec_becomes_a_custom_class():
    resolved = resolve_document_class({"styleSpec": {"id": "custom", "body_size_pt": 11}})

    assert resolved.family == "custom"
    assert resolved.typography.body_size_pt == 11
    # Structure checks stay off: the guidelines said nothing about genre.
    assert resolved.toc != TOC_REQUIRED


def test_guidelines_override_a_class_typography():
    resolved = resolve_document_class(
        {"documentClass": "ieee-conference", "styleSpec": {"body_size_pt": 11}}
    )

    assert resolved.id == "ieee-conference"
    assert resolved.typography.body_size_pt == 11
    assert resolved.toc == TOC_FORBIDDEN


def test_nothing_supplied_is_an_error():
    with pytest.raises(ValueError):
        resolve_document_class({})


def test_class_for_a_bare_legacy_style():
    assert class_for_style(get_style("ieee")).id == "ieee-conference"


def test_class_for_an_unknown_spec_is_custom():
    assert class_for_style(spec_from_dict({"id": "whatever"})).family == "custom"


def test_custom_class_keeps_the_specs_required_sections():
    spec = spec_from_dict({"id": "custom", "required_sections": ["abstract", "methods"]})

    assert custom_class(spec).required_sections == ("abstract", "methods")


# --- structure checks -------------------------------------------------------

def test_a_dissertation_without_contents_is_an_error():
    content = doc(heading("Introduction"), para("body"), heading("References"))

    _updated, issues = format_document(
        content, get_style("apa"), get_document_class("apa-dissertation")
    )

    assert severities(issues, "error")
    assert "table of contents" in messages(issues)


def test_a_dissertation_with_contents_is_not_flagged():
    content = doc(heading("Contents"), heading("Introduction"), heading("References"))

    _updated, issues = format_document(
        content, get_style("apa"), get_document_class("apa-dissertation")
    )

    assert not [i for i in severities(issues, "error") if "contents" in i["message"].lower()]


def test_a_conference_paper_with_contents_is_flagged():
    content = doc(heading("Contents"), heading("Introduction"))

    _updated, issues = format_document(
        content, get_style("ieee"), get_document_class("ieee-conference")
    )

    warnings = messages(severities(issues, "warning"))
    assert "a table of contents does not belong here" in warnings


def test_a_conference_paper_without_contents_is_fine():
    content = doc(heading("Abstract"), heading("Introduction"), heading("References"))

    _updated, issues = format_document(
        content, get_style("ieee"), get_document_class("ieee-conference")
    )

    assert "table of contents" not in messages(issues)


def test_required_sections_come_from_the_class():
    content = doc(heading("Introduction"))

    _updated, issues = format_document(
        content, get_style("apa"), get_document_class("apa-dissertation")
    )

    assert "Abstract" in messages(issues)
    assert "References" in messages(issues)


def test_the_page_budget_is_not_reported_as_an_issue():
    """It applies to every document in the class, so it would be pure noise in
    a list meant for what is wrong."""
    content = doc(heading("Abstract"), heading("Introduction"), heading("References"))

    _updated, issues = format_document(
        content, get_style("ieee"), get_document_class("ieee-conference")
    )

    assert "pages" not in messages(issues)


# --- heading numbering ------------------------------------------------------

def test_roman_numbering_follows_the_ieee_convention():
    nodes = [heading("One"), heading("Sub", 2), heading("Deep", 3), heading("Two")]

    numbers = _heading_numbers(nodes, "roman-upper")

    assert [numbers[i] for i in range(4)] == ["I.", "A.", "1)", "II."]


def test_decimal_numbering_nests():
    nodes = [heading("One"), heading("Sub", 2), heading("Deeper", 3), heading("Two")]

    numbers = _heading_numbers(nodes, "decimal")

    assert [numbers[i] for i in range(4)] == ["1", "1.1", "1.1.1", "2"]


def test_subsection_counters_reset_between_sections():
    nodes = [heading("One"), heading("A", 2), heading("Two"), heading("B", 2)]

    numbers = _heading_numbers(nodes, "roman-upper")

    assert numbers[1] == "A." and numbers[3] == "A."


def test_no_numbering_scheme_produces_no_prefixes():
    assert _heading_numbers([heading("One")], "none") == {}


def test_a_contents_heading_is_not_numbered():
    """"I. CONTENTS" is not a section of the paper."""
    nodes = [heading("Contents"), heading("Introduction")]

    numbers = _heading_numbers(nodes, "roman-upper")

    assert 0 not in numbers
    assert numbers[1] == "I."


def test_numbers_reach_the_rendered_headings():
    document = render_docx(
        doc(heading("Introduction"), para("b")),
        "T",
        get_style("ieee"),
        doc_class=get_document_class("ieee-conference"),
    )

    assert any("I. INTRODUCTION" in p.text or "I. Introduction" in p.text
               for p in document.paragraphs)


def test_apa_headings_are_not_numbered():
    document = render_docx(
        doc(heading("Introduction")), "T", get_style("apa"),
        doc_class=get_document_class("apa-dissertation"),
    )

    assert not any(p.text.strip().startswith("I.") for p in document.paragraphs)


def test_contents_entries_carry_the_same_numbers_as_the_headings():
    """A contents page numbered differently from its sections is worse than an
    unnumbered one."""
    content = doc(
        heading("Contents"), para("stale"),
        heading("Introduction"), para("b"), heading("Method"),
    )
    document = render_docx(
        content, "T", get_style("ieee"),
        doc_class=get_document_class("ieee-conference"),
    )

    text = "\n".join(p.text for p in document.paragraphs)
    assert "I. INTRODUCTION" in text.upper()
    assert "II. METHOD" in text.upper()
    # Once in the contents, once as the heading itself.
    assert text.upper().count("I. INTRODUCTION") == 2
