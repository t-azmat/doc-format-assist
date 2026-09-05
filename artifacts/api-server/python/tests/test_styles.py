"""Tests for style resolution — the layer that decides what formatting the
engine actually applies."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from styles import BASE_SPEC, get_style, list_styles, resolve_style, spec_from_dict  # noqa: E402


def test_page_size_round_trips():
    spec = spec_from_dict({"page_width_in": 8.27, "page_height_in": 11.69})

    assert spec.page_width_in == 8.27
    assert spec.page_height_in == 11.69


def test_page_size_falls_back_to_base_when_absent():
    spec = spec_from_dict({})

    assert spec.page_width_in == BASE_SPEC.page_width_in
    assert spec.page_height_in == BASE_SPEC.page_height_in


@pytest.mark.parametrize("bad", ["nonsense", None, 0, -3, 1000, ""])
def test_absurd_page_sizes_fall_back(bad):
    """These values reach us from extraction and user guidelines; a zero-width
    page would produce a corrupt DOCX rather than an error."""
    spec = spec_from_dict({"page_width_in": bad})

    assert spec.page_width_in == BASE_SPEC.page_width_in


def test_partial_spec_inherits_the_rest():
    spec = spec_from_dict({"body_font": "Arial"})

    assert spec.body_font == "Arial"
    assert spec.body_size_pt == BASE_SPEC.body_size_pt
    assert spec.line_spacing == BASE_SPEC.line_spacing


def test_heading_size_keys_are_coerced_to_ints():
    """JSON object keys arrive as strings; export.py looks them up by int."""
    spec = spec_from_dict({"heading_sizes_pt": {"1": 18, "2": 14}})

    assert spec.heading_sizes_pt[1] == 18
    assert spec.heading_sizes_pt[2] == 14


def test_margins_merge_rather_than_replace():
    spec = spec_from_dict({"margins_in": {"top": 2.0}})

    assert spec.margins_in["top"] == 2.0
    assert spec.margins_in["left"] == BASE_SPEC.margins_in["left"]


def test_style_spec_wins_over_preset():
    resolved = resolve_style(
        {"conferenceStyle": "ieee", "styleSpec": {"body_font": "Arial"}}
    )

    assert resolved.body_font == "Arial"


def test_preset_used_when_no_custom_spec():
    assert resolve_style({"conferenceStyle": "apa"}).id == "apa"


def test_no_style_is_an_error():
    with pytest.raises(ValueError):
        resolve_style({})


def test_unknown_preset_is_an_error():
    with pytest.raises(ValueError):
        get_style("nonexistent")


def test_catalog_lists_every_preset():
    ids = {s["id"] for s in list_styles()}

    assert ids == {"ieee", "apa", "acm"}
