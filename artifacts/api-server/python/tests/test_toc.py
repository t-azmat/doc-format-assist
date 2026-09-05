"""Tests for heading detection and the linked table of contents.

The bug these guard: an exported contents page was inert text. Its entries were
not links, because nothing bookmarked the headings — and for documents using a
derived heading style there were no headings at all.
"""

import io
import re
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from docxnative import _level_from_name  # noqa: E402
from export import render_docx  # noqa: E402
from styles import get_style  # noqa: E402


def heading(text, level=1):
    return {
        "type": "heading",
        "attrs": {"level": level},
        "content": [{"type": "text", "text": text}],
    }


def para(text):
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def document_xml(document) -> str:
    buffer = io.BytesIO()
    document.save(buffer)
    buffer.seek(0)
    with zipfile.ZipFile(buffer) as archive:
        return archive.read("word/document.xml").decode("utf8")


def bookmarks(xml):
    return set(re.findall(r'w:bookmarkStart[^>]*w:name="([^"]+)"', xml))


def links(xml):
    return re.findall(r'<w:hyperlink w:anchor="([^"]+)"', xml)


# --- heading detection ------------------------------------------------------

@pytest.mark.parametrize(
    "style_name,expected",
    [
        ("Heading 1", 1),
        ("Heading 2", 2),
        ("heading 3", 3),
        # The case that broke this document: a derived style. `re.match`
        # anchored at the start, so none of these were ever headings.
        ("IEEE Heading 1", 1),
        ("Chapter Heading 2", 2),
        ("Heading1", 1),
        ("Title", 1),
        ("IEEE Title", 1),
        # Deeper than the schema supports clamps rather than disappearing.
        ("Heading 7", 3),
    ],
)
def test_derived_heading_styles_are_recognised(style_name, expected):
    assert _level_from_name(style_name) == expected


@pytest.mark.parametrize(
    "style_name",
    ["Normal", "List Paragraph", "Body Text", "Caption", "", None, "Subtitle"],
)
def test_body_styles_are_not_headings(style_name):
    assert _level_from_name(style_name) is None


def test_character_styles_are_not_headings():
    """"Heading 1 Char" styles a run, never a heading paragraph."""
    assert _level_from_name("Heading 1 Char") is None


# --- bookmarks --------------------------------------------------------------

def test_every_heading_is_bookmarked():
    doc = {
        "type": "doc",
        "content": [heading("Introduction"), para("body"), heading("Method")],
    }

    xml = document_xml(render_docx(doc, "T", get_style("apa")))

    assert len(bookmarks(xml)) == 2


def test_bookmarks_are_added_without_a_contents_page():
    """A document with no TOC still needs anchors — Word's own inserted TOC,
    and any the author adds later, link to these."""
    doc = {"type": "doc", "content": [heading("Introduction"), para("body")]}

    xml = document_xml(render_docx(doc, "T", get_style("apa")))

    assert bookmarks(xml)
    assert not links(xml)


# --- the contents page ------------------------------------------------------

def toc_document():
    return {
        "type": "doc",
        "content": [
            heading("Table of Contents"),
            para("Introduction ..... 1"),
            para("Method ..... 2"),
            heading("Introduction"),
            para("body"),
            heading("Method"),
            heading("Participants", level=2),
            heading("References"),
        ],
    }


def test_contents_entries_link_to_headings():
    xml = document_xml(render_docx(toc_document(), "T", get_style("apa")))

    assert set(links(xml)) <= bookmarks(xml), "a contents entry points at nothing"
    assert len(links(xml)) == 4


def test_first_section_is_not_dropped_from_contents():
    """Off-by-one guard: the region end is the index of the next heading, which
    is the first real section and must be listed."""
    document = render_docx(toc_document(), "T", get_style("apa"))

    text = "\n".join(p.text for p in document.paragraphs)
    assert "Introduction" in text
    for name in ("Method", "Participants", "References"):
        assert name in text


def test_stale_contents_entries_are_replaced():
    xml = document_xml(render_docx(toc_document(), "T", get_style("apa")))

    assert "..... 1" not in xml


def test_contents_entries_carry_page_number_fields():
    xml = document_xml(render_docx(toc_document(), "T", get_style("apa")))

    assert len(re.findall(r"PAGEREF", xml)) == 4


def test_contents_page_is_not_invented():
    """A document without a contents section must not gain one."""
    doc = {"type": "doc", "content": [heading("Introduction"), para("body")]}

    document = render_docx(doc, "T", get_style("apa"))

    assert "Contents" not in "\n".join(p.text for p in document.paragraphs)


def test_contents_survives_having_no_following_headings():
    """Rather than emit an empty contents page, keep what the author wrote."""
    doc = {
        "type": "doc",
        "content": [heading("Contents"), para("nothing follows this")],
    }

    document = render_docx(doc, "T", get_style("apa"))

    assert "nothing follows this" in "\n".join(p.text for p in document.paragraphs)


@pytest.mark.parametrize("title", ["Contents", "Table of Contents", "TOC", "CONTENTS"])
def test_contents_heading_variants_are_detected(title):
    doc = {
        "type": "doc",
        "content": [heading(title), para("stale"), heading("Introduction")],
    }

    xml = document_xml(render_docx(doc, "T", get_style("apa")))

    assert len(links(xml)) == 1
