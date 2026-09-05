"""Regression tests for the compliance/reformat pass."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from format import format_document  # noqa: E402
from styles import get_style, spec_from_dict  # noqa: E402


def heading(*runs):
    """Build a heading node from (text, *marks) tuples."""
    content = []
    for run in runs:
        node = {"type": "text", "text": run[0]}
        if len(run) > 1:
            node["marks"] = [{"type": m} for m in run[1:]]
        content.append(node)
    return {"type": "heading", "attrs": {"level": 1}, "content": content}


def texts(node):
    return [c["text"] for c in node["content"] if c["type"] == "text"]


def test_multi_run_heading_is_not_duplicated():
    """The bug this guards: writing the whole recased string into the first
    run left the remaining runs untouched, so "The Fast Path" exported as
    "THE FAST PATHFast Path"."""
    doc = {"type": "doc", "content": [heading(("The ",), ("Fast", "bold"), (" Path",))]}

    updated, _issues = format_document(doc, get_style("ieee"))

    assert texts(updated["content"][0]) == ["THE ", "FAST", " PATH"]
    assert "".join(texts(updated["content"][0])) == "THE FAST PATH"


def test_marks_survive_recasing():
    doc = {"type": "doc", "content": [heading(("plain ",), ("bold", "bold"))]}

    updated, _issues = format_document(doc, get_style("ieee"))

    marked = updated["content"][0]["content"][1]
    assert marked["marks"] == [{"type": "bold"}]


def test_single_run_heading_still_recases():
    doc = {"type": "doc", "content": [heading(("introduction",))]}

    updated, issues = format_document(doc, get_style("apa"))

    assert texts(updated["content"][0]) == ["Introduction"]
    assert any(i["severity"] == "info" for i in issues)


def test_already_correct_heading_reports_no_issue():
    doc = {"type": "doc", "content": [heading(("INTRODUCTION",))]}

    _updated, issues = format_document(doc, get_style("ieee"))

    assert not [i for i in issues if i["severity"] == "info"]


def test_surrounding_whitespace_is_preserved():
    doc = {"type": "doc", "content": [heading(("  spaced heading  ",))]}

    updated, _issues = format_document(doc, get_style("ieee"))

    assert texts(updated["content"][0]) == ["  SPACED HEADING  "]


def test_empty_heading_is_left_alone():
    """A heading with no runs has nothing to recase; it must not gain a
    content array or an "info" issue claiming it was rewritten."""
    doc = {"type": "doc", "content": [{"type": "heading", "attrs": {"level": 1}}]}

    updated, issues = format_document(doc, get_style("ieee"))

    assert updated["content"][0] == {"type": "heading", "attrs": {"level": 1}}
    assert not [i for i in issues if i["severity"] == "info"]


def test_document_without_headings_is_an_error():
    doc = {"type": "doc", "content": [{"type": "paragraph"}]}

    _updated, issues = format_document(doc, get_style("ieee"))

    assert any(i["severity"] == "error" for i in issues)


def test_missing_required_sections_are_flagged():
    doc = {"type": "doc", "content": [heading(("Introduction",))]}

    _updated, issues = format_document(doc, get_style("ieee"))

    missing = {i["location"] for i in issues if i["severity"] == "warning"}
    assert "abstract" in missing
    assert "references" in missing


@pytest.mark.parametrize(
    "case,text,expected",
    [
        ("upper", "hello world", "HELLO WORLD"),
        ("title", "hello world", "Hello World"),
        ("sentence", "hello world", "Hello world"),
        ("none", "hello world", "hello world"),
    ],
)
def test_heading_case_variants(case, text, expected):
    style = spec_from_dict({"heading_case": case, "required_sections": []})
    doc = {"type": "doc", "content": [heading((text,))]}

    updated, _issues = format_document(doc, style)

    assert texts(updated["content"][0]) == [expected]
