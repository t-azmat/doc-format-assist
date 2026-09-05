"""Conference formatting style rules — the single source of truth for how
each conference style affects layout, typography, and structural
requirements. Used by both the compliance checker (format.py) and the
document exporter (export.py).
"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class StyleSpec:
    id: str
    name: str
    description: str
    body_font: str
    heading_font: str
    body_size_pt: int
    heading_sizes_pt: dict  # heading level (1-3) -> point size
    line_spacing: float
    margins_in: dict  # top/bottom/left/right in inches
    columns: int
    heading_case: str  # "title" | "upper" | "sentence"
    citation_style: str  # "numeric" | "author-date"
    required_sections: list = field(default_factory=list)
    # Page size in inches. Defaults to US Letter; extraction overrides these
    # with the source document's real dimensions (e.g. 8.27x11.69 for A4) so an
    # exported paper keeps the page size the venue expects.
    page_width_in: float = 8.5
    page_height_in: float = 11.0


STYLES: dict[str, StyleSpec] = {
    "ieee": StyleSpec(
        id="ieee",
        name="IEEE Conference",
        description="Two-column IEEE conference paper format (Times New Roman, numeric citations).",
        body_font="Times New Roman",
        heading_font="Times New Roman",
        body_size_pt=10,
        heading_sizes_pt={1: 14, 2: 11, 3: 10},
        line_spacing=1.0,
        margins_in={"top": 0.75, "bottom": 1.0, "left": 0.625, "right": 0.625},
        columns=2,
        heading_case="upper",
        citation_style="numeric",
        required_sections=["abstract", "introduction", "references"],
    ),
    "apa": StyleSpec(
        id="apa",
        name="APA 7th Edition",
        description="Single-column APA manuscript format (Times New Roman 12pt, double-spaced, author-date citations).",
        body_font="Times New Roman",
        heading_font="Times New Roman",
        body_size_pt=12,
        heading_sizes_pt={1: 12, 2: 12, 3: 12},
        line_spacing=2.0,
        margins_in={"top": 1.0, "bottom": 1.0, "left": 1.0, "right": 1.0},
        columns=1,
        heading_case="title",
        citation_style="author-date",
        required_sections=["abstract", "references"],
    ),
    "acm": StyleSpec(
        id="acm",
        name="ACM Conference",
        description="Two-column ACM conference proceedings format (Libertine/Times, numeric citations).",
        body_font="Times New Roman",
        heading_font="Times New Roman",
        body_size_pt=9,
        heading_sizes_pt={1: 14, 2: 11, 3: 10},
        line_spacing=1.0,
        margins_in={"top": 0.75, "bottom": 1.0, "left": 0.75, "right": 0.75},
        columns=2,
        heading_case="sentence",
        citation_style="numeric",
        required_sections=["abstract", "references"],
    ),
}


def get_style(style_id: str) -> StyleSpec:
    try:
        return STYLES[style_id]
    except KeyError as exc:
        raise ValueError(f"Unknown conference style: {style_id}") from exc


# Sensible academic default used as the base when building a StyleSpec from
# user guidelines — any fields the guidelines don't specify inherit from here.
BASE_SPEC = StyleSpec(
    id="custom",
    name="Custom",
    description="Custom style derived from user-supplied guidelines.",
    body_font="Times New Roman",
    heading_font="Times New Roman",
    body_size_pt=12,
    heading_sizes_pt={1: 14, 2: 12, 3: 12},
    line_spacing=2.0,
    margins_in={"top": 1.0, "bottom": 1.0, "left": 1.0, "right": 1.0},
    columns=1,
    heading_case="title",
    citation_style="numeric",
    required_sections=["abstract", "introduction", "references"],
)


def spec_from_dict(data: dict, base: StyleSpec = BASE_SPEC) -> StyleSpec:
    """Build a StyleSpec from a (possibly partial) dict, inheriting any missing
    field from `base`. JSON object keys arrive as strings, so heading-size keys
    are coerced back to ints."""
    heading_sizes = dict(base.heading_sizes_pt)
    for k, v in (data.get("heading_sizes_pt") or {}).items():
        heading_sizes[int(k)] = int(v)

    margins = {**base.margins_in, **(data.get("margins_in") or {})}

    def _positive_float(key: str, fallback: float) -> float:
        """Page dimensions arrive from extraction/guidelines and are used
        directly as Word page geometry, so reject junk rather than writing a
        zero-width section."""
        raw = data.get(key)
        if raw is None:
            return fallback
        try:
            value = float(raw)
        except (TypeError, ValueError):
            return fallback
        return value if 1.0 <= value <= 48.0 else fallback

    return StyleSpec(
        id=data.get("id", base.id),
        name=data.get("name", base.name),
        description=data.get("description", base.description),
        body_font=data.get("body_font", base.body_font),
        heading_font=data.get("heading_font", base.heading_font),
        body_size_pt=int(data.get("body_size_pt", base.body_size_pt)),
        heading_sizes_pt=heading_sizes,
        line_spacing=float(data.get("line_spacing", base.line_spacing)),
        margins_in=margins,
        columns=int(data.get("columns", base.columns)),
        heading_case=data.get("heading_case", base.heading_case),
        citation_style=data.get("citation_style", base.citation_style),
        required_sections=list(
            data.get("required_sections", base.required_sections)
        ),
        page_width_in=_positive_float("page_width_in", base.page_width_in),
        page_height_in=_positive_float("page_height_in", base.page_height_in),
    )


def resolve_style(payload: dict) -> StyleSpec:
    """Pick the style for a format/export request: an explicit `styleSpec`
    object (custom, from guidelines) takes precedence over a `conferenceStyle`
    preset id."""
    spec = payload.get("styleSpec")
    if spec:
        return spec_from_dict(spec)
    style_id = payload.get("conferenceStyle")
    if style_id:
        return get_style(style_id)
    raise ValueError(
        "No style provided: supply either a styleSpec or a conferenceStyle."
    )


def list_styles() -> list[dict]:
    return [
        {"id": s.id, "name": s.name, "description": s.description}
        for s in STYLES.values()
    ]
