"""Tests for document-class inference.

The case that motivated this: a ninety-page manuscript with chapters set as an
"IEEE conference paper" — a six-page class — and nothing said a word.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from docclass import get_document_class  # noqa: E402
from format import format_document  # noqa: E402
from infer import (  # noqa: E402
    check_class_fit,
    infer_family,
    infer_genre,
    infer_signals,
    suggest_class,
)
from styles import get_style  # noqa: E402


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


def words(count):
    return para(" ".join(["word"] * count))


def thesis_doc():
    return doc(
        heading("Contents"),
        heading("Acknowledgements"),
        heading("List of Figures"),
        heading("Chapter 1: Introduction"),
        para("Prior work (Smith, 2020) established the baseline."),
        heading("Chapter 2: Method"),
        heading("Chapter 3: Results"),
        heading("Appendix A"),
        words(400),
    )


def paper_doc():
    return doc(
        heading("Abstract"),
        heading("Introduction"),
        para("Prior work [1] established the baseline, extended by [2, 3]."),
        heading("Method"),
        heading("References"),
    )


# --- signals ----------------------------------------------------------------

def test_chapters_and_front_matter_are_counted():
    signals = infer_signals(thesis_doc())

    assert signals.chapter_headings == 3
    assert signals.has_contents
    assert signals.front_matter_headings == 2  # acknowledgements, list of figures
    assert signals.appendix_headings == 1


def test_citation_styles_are_distinguished():
    numeric = infer_signals(doc(para("As shown [1] and [2, 3].")))
    author_date = infer_signals(doc(para("As shown (Smith, 2020) and (Doe et al., 2019).")))

    assert numeric.numeric_citations == 2 and numeric.author_date_citations == 0
    assert author_date.author_date_citations == 2 and author_date.numeric_citations == 0


def test_page_count_and_columns_come_from_extraction():
    signals = infer_signals(doc(para("x")), {"pageCount": 47, "detectedColumns": 2})

    assert signals.page_count == 47
    assert signals.columns == 2


def test_junk_extraction_values_do_not_crash():
    signals = infer_signals(doc(para("x")), {"pageCount": "many", "detectedColumns": None})

    assert signals.page_count is None
    assert signals.columns == 1


def test_words_are_counted_for_documents_without_pagination():
    signals = infer_signals(doc(words(120)))

    assert signals.word_count == 120


# --- genre ------------------------------------------------------------------

def test_book_structure_reads_as_a_thesis():
    genre, reasons = infer_genre(infer_signals(thesis_doc()))

    assert genre == "thesis"
    assert any("chapter" in r for r in reasons)


def test_a_short_paper_reads_as_a_conference_paper():
    genre, _ = infer_genre(infer_signals(paper_doc(), {"pageCount": 6}))

    assert genre == "conference_paper"


def test_a_long_page_count_alone_is_not_a_thesis():
    """Length is evidence, not proof — a long journal article is not a thesis."""
    genre, _ = infer_genre(infer_signals(paper_doc(), {"pageCount": 30}))

    assert genre != "thesis"


def test_length_falls_back_to_words_without_a_page_count():
    genre, _ = infer_genre(infer_signals(doc(heading("Introduction"), words(500))))

    assert genre == "conference_paper"


# --- family -----------------------------------------------------------------

def test_two_columns_implies_a_two_column_family():
    family, reasons = infer_family(infer_signals(paper_doc(), {"detectedColumns": 2}))

    assert family == "ieee"
    assert any("two-column" in r for r in reasons)


def test_author_date_citations_imply_apa():
    family, _ = infer_family(infer_signals(doc(para("(Smith, 2020) and (Doe, 2019)"))))

    assert family == "apa"


def test_numeric_citations_in_one_column_imply_a_numeric_family():
    family, _ = infer_family(infer_signals(doc(para("As shown [1] and [2]."))))

    assert family == "ieee"


# --- the suggestion ---------------------------------------------------------

def test_a_thesis_is_suggested_the_dissertation_class():
    suggestion = suggest_class(infer_signals(thesis_doc(), {"pageCount": 90}))

    assert suggestion.class_id == "apa-dissertation"
    assert suggestion.confidence == "high"


def test_a_two_column_short_paper_is_suggested_a_conference_class():
    suggestion = suggest_class(infer_signals(paper_doc(), {"pageCount": 6, "detectedColumns": 2}))

    assert suggestion.class_id == "ieee-conference"


def test_an_apa_manuscript_is_suggested_the_journal_class():
    content = doc(heading("Abstract"), heading("Method"),
                  para("Prior work (Smith, 2020) and (Doe, 2019)."), words(300))
    suggestion = suggest_class(infer_signals(content, {"pageCount": 20, "detectedColumns": 1}))

    assert suggestion.class_id == "apa-journal"


def test_a_thesis_never_lands_on_a_conference_class():
    """There is no IEEE thesis class, and a university submission is not a
    conference paper."""
    content = thesis_doc()
    suggestion = suggest_class(infer_signals(content, {"pageCount": 90, "detectedColumns": 2}))

    assert get_document_class(suggestion.class_id).genre == "thesis"


def test_an_empty_document_yields_no_suggestion():
    assert suggest_class(infer_signals(doc())) is None
    assert suggest_class(infer_signals(doc(para("too short")))) is None


def test_the_suggestion_explains_itself():
    """A suggestion the user cannot evaluate is worse than none."""
    suggestion = suggest_class(infer_signals(thesis_doc(), {"pageCount": 90}))

    assert suggestion.reasons
    assert all(isinstance(r, str) and r for r in suggestion.reasons)


def test_the_suggestion_serialises():
    payload = suggest_class(infer_signals(thesis_doc(), {"pageCount": 90})).as_dict()

    assert set(payload) == {"classId", "confidence", "reasons"}


def test_confidence_drops_without_corroboration():
    thin = suggest_class(infer_signals(doc(heading("Introduction"), words(300))))

    assert thin.confidence in ("low", "medium")


# --- the fit check ----------------------------------------------------------

def test_a_thesis_in_a_conference_class_is_flagged():
    """The original complaint, in one test."""
    signals = infer_signals(thesis_doc(), {"pageCount": 90})

    problems = check_class_fit(get_document_class("ieee-conference"), signals)

    assert problems
    assert "thesis" in " ".join(problems)


def test_a_thesis_in_the_dissertation_class_is_not_flagged():
    signals = infer_signals(thesis_doc(), {"pageCount": 90})

    assert not check_class_fit(get_document_class("apa-dissertation"), signals)


def test_a_short_paper_in_a_dissertation_class_is_flagged():
    signals = infer_signals(paper_doc(), {"pageCount": 5})

    problems = check_class_fit(get_document_class("apa-dissertation"), signals)

    assert problems and "short" in " ".join(problems)


def test_a_paper_over_its_page_budget_is_flagged():
    signals = infer_signals(paper_doc(), {"pageCount": 11})

    problems = check_class_fit(get_document_class("ieee-conference"), signals)

    assert any("over" in p and "limit" in p for p in problems)


def test_a_paper_within_budget_is_not_flagged_for_length():
    signals = infer_signals(paper_doc(), {"pageCount": 5})

    problems = check_class_fit(get_document_class("ieee-conference"), signals)

    assert not any("over" in p for p in problems)


def test_no_page_count_means_no_budget_complaint():
    """A .docx has no pagination until it is laid out; do not invent one."""
    signals = infer_signals(paper_doc())

    assert not any("over" in p for p in check_class_fit(
        get_document_class("ieee-conference"), signals))


# --- integration through format.py ------------------------------------------

def test_format_surfaces_the_mismatch_as_a_warning():
    _updated, issues = format_document(
        thesis_doc(),
        get_style("ieee"),
        get_document_class("ieee-conference"),
        {"pageCount": 90},
    )

    warnings = [i["message"] for i in issues if i["severity"] == "warning"]
    assert any("thesis" in w for w in warnings)


def test_format_without_extraction_data_still_works():
    _updated, issues = format_document(
        paper_doc(), get_style("ieee"), get_document_class("ieee-conference")
    )

    assert isinstance(issues, list)


def test_a_matching_class_produces_no_fit_warning():
    _updated, issues = format_document(
        paper_doc(),
        get_style("ieee"),
        get_document_class("ieee-conference"),
        {"pageCount": 5, "detectedColumns": 2},
    )

    assert not [i for i in issues if "reads as" in i["message"]]
