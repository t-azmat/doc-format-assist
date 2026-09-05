"""Document classes — what kind of document this is, not just how it is set.

A style like "IEEE" is a family, not a format. What actually determines a
document's shape is family x genre: an IEEE conference paper is six pages, two
columns and must not carry a table of contents; an APA dissertation is a hundred
pages, one column, and must. Both were previously "a style", which is why
picking IEEE for a thesis produced something plausible and wrong.

StyleSpec stays what it is — a typography sheet. This adds the structural axis
beside it: page budget, table-of-contents policy, required sections, heading
numbering, and which author block to use.

Deliberately not modelled yet, to avoid fields nothing reads: ordered front and
back matter (list of figures, appendices, biographies) and running heads. They
belong here when something renders them.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from styles import STYLES, StyleSpec, spec_from_dict

TOC_REQUIRED = "required"
TOC_OPTIONAL = "optional"
TOC_FORBIDDEN = "forbidden"


@dataclass(frozen=True)
class PageBudget:
    """A venue's page limit.

    `includes_references` is load-bearing, not decoration: calls for papers say
    "8 pages including references" and "10 pages excluding references" and the
    difference is routinely two pages of work.
    """

    max_pages: float
    includes_references: bool = True

    def describe(self) -> str:
        scope = "including references" if self.includes_references else "excluding references"
        return f"{self.max_pages:g} pages {scope}"


@dataclass(frozen=True)
class DocumentClass:
    id: str
    name: str
    description: str
    family: str  # ieee | apa | acm | custom
    genre: str  # conference_paper | journal_article | thesis
    typography: StyleSpec
    toc: str = TOC_OPTIONAL
    toc_depth: int = 3
    page_budget: PageBudget | None = None
    # Layout key consumed by authorblock.render_author_block.
    author_block: str = "centred"
    # none | roman-upper (I. / A. / 1)) | decimal (1 / 1.1 / 1.1.1)
    heading_numbering: str = "none"
    required_sections: tuple = ()


def _with_id(spec: StyleSpec, style_id: str, name: str) -> StyleSpec:
    """A class's typography keeps the class's identity, so anything downstream
    that reports "which style is this" names the class, not the family."""
    return replace(spec, id=style_id, name=name)


CLASSES: dict[str, DocumentClass] = {
    "ieee-conference": DocumentClass(
        id="ieee-conference",
        name="IEEE Conference Paper",
        description="Two-column IEEE conference paper. Six pages, no contents page.",
        family="ieee",
        genre="conference_paper",
        typography=_with_id(STYLES["ieee"], "ieee-conference", "IEEE Conference Paper"),
        toc=TOC_FORBIDDEN,
        page_budget=PageBudget(6, includes_references=True),
        author_block="grid-italic",
        heading_numbering="roman-upper",
        required_sections=("abstract", "introduction", "references"),
    ),
    "ieee-journal": DocumentClass(
        id="ieee-journal",
        name="IEEE Transactions Article",
        description="Two-column IEEE journal article. Longer than a conference paper, no contents page.",
        family="ieee",
        genre="journal_article",
        typography=_with_id(STYLES["ieee"], "ieee-journal", "IEEE Transactions Article"),
        toc=TOC_FORBIDDEN,
        page_budget=PageBudget(14, includes_references=True),
        author_block="grid-italic",
        heading_numbering="roman-upper",
        required_sections=("abstract", "introduction", "references"),
    ),
    "acm-conference": DocumentClass(
        id="acm-conference",
        name="ACM Conference Paper",
        description="Two-column ACM proceedings paper. Numbered sections, no contents page.",
        family="acm",
        genre="conference_paper",
        typography=_with_id(STYLES["acm"], "acm-conference", "ACM Conference Paper"),
        toc=TOC_FORBIDDEN,
        page_budget=PageBudget(10, includes_references=False),
        author_block="grid-upright",
        heading_numbering="decimal",
        required_sections=("abstract", "references"),
    ),
    "apa-journal": DocumentClass(
        id="apa-journal",
        name="APA Journal Manuscript",
        description="Single-column APA 7 manuscript for journal submission. No contents page.",
        family="apa",
        genre="journal_article",
        typography=_with_id(STYLES["apa"], "apa-journal", "APA Journal Manuscript"),
        toc=TOC_FORBIDDEN,
        page_budget=None,
        author_block="apa-title-page",
        required_sections=("abstract", "references"),
    ),
    "apa-dissertation": DocumentClass(
        id="apa-dissertation",
        name="APA Dissertation",
        description="Single-column APA 7 dissertation or thesis. Contents page required, no page limit.",
        family="apa",
        genre="thesis",
        typography=_with_id(STYLES["apa"], "apa-dissertation", "APA Dissertation"),
        toc=TOC_REQUIRED,
        toc_depth=3,
        page_budget=None,
        author_block="apa-title-page",
        required_sections=("abstract", "introduction", "references"),
    ),
}

# A family's default when only a legacy `conferenceStyle` is given. Conference
# paper for the conference families, journal manuscript for APA — the shortest
# document in each, so an unstated genre never silently relaxes a page limit
# the user is actually bound by.
_FAMILY_DEFAULT = {
    "ieee": "ieee-conference",
    "acm": "acm-conference",
    "apa": "apa-journal",
}


def custom_class(spec: StyleSpec) -> DocumentClass:
    """A class around a guidelines-derived spec. Structure is left open: the
    guidelines said nothing about genre, and guessing would be worse than
    leaving the checks off."""
    return DocumentClass(
        id="custom",
        name=spec.name or "Custom",
        description=spec.description or "Custom style derived from user-supplied guidelines.",
        family="custom",
        genre="journal_article",
        typography=spec,
        toc=TOC_OPTIONAL,
        page_budget=None,
        author_block="centred",
        required_sections=tuple(spec.required_sections or ()),
    )


def get_document_class(class_id: str) -> DocumentClass:
    try:
        return CLASSES[class_id]
    except KeyError as exc:
        raise ValueError(f"Unknown document class: {class_id}") from exc


def default_class_for(family: str) -> DocumentClass:
    return CLASSES[_FAMILY_DEFAULT.get((family or "").lower(), "ieee-conference")]


def resolve_document_class(payload: dict) -> DocumentClass:
    """Pick the class for a format/export request.

    Precedence: an explicit documentClass, then a custom styleSpec from
    guidelines, then a legacy conferenceStyle mapped to its family's default.
    """
    class_id = payload.get("documentClass")
    if class_id:
        base = get_document_class(class_id)
        # Guidelines still override typography when both are present: the user
        # pasted a specific call for papers, and it is more specific than the
        # class preset.
        spec = payload.get("styleSpec")
        if spec:
            merged = spec_from_dict(spec, base.typography)
            return replace(base, typography=merged)
        return base

    spec = payload.get("styleSpec")
    if spec:
        return custom_class(spec_from_dict(spec))

    style_id = payload.get("conferenceStyle")
    if style_id:
        return default_class_for(style_id)

    raise ValueError(
        "No style provided: supply a documentClass, a styleSpec, or a conferenceStyle."
    )


def class_for_style(spec: StyleSpec) -> DocumentClass:
    """Best-effort class for a bare StyleSpec, for callers that only have one.

    Matches on the spec id — which is a class id for a preset class, and a
    family id for the legacy presets.
    """
    style_id = (getattr(spec, "id", "") or "").lower()
    if style_id in CLASSES:
        return CLASSES[style_id]
    if style_id in _FAMILY_DEFAULT:
        return replace(default_class_for(style_id), typography=spec)
    return custom_class(spec)


def list_document_classes() -> list[dict]:
    return [
        {
            "id": c.id,
            "name": c.name,
            "description": c.description,
            "family": c.family,
            "genre": c.genre,
            "toc": c.toc,
            "pageBudget": (
                {
                    "maxPages": c.page_budget.max_pages,
                    "includesReferences": c.page_budget.includes_references,
                }
                if c.page_budget
                else None
            ),
        }
        for c in CLASSES.values()
    ]
