"""BibTeX in, CSL-JSON out.

BibTeX is the format users *have* — every reference manager exports it and every
LaTeX author already keeps one. It is not the format this app stores: `.bst`
style files are a BibTeX-only DSL and are inert off that toolchain. So `.bib` is
an import path, converted at the door, and everything downstream sees CSL-JSON.

Hand-rolled rather than pulling in a parser: the subset that matters is small,
and the failure mode that matters is partial — one malformed entry in a 200-item
library must not reject the other 199.
"""

from __future__ import annotations

import re

# BibTeX entry types -> CSL types.
_TYPE_MAP = {
    "article": "article-journal",
    "inproceedings": "paper-conference",
    "conference": "paper-conference",
    "proceedings": "book",
    "incollection": "chapter",
    "inbook": "chapter",
    "book": "book",
    "booklet": "book",
    "phdthesis": "thesis",
    "mastersthesis": "thesis",
    "techreport": "report",
    "manual": "report",
    "misc": "document",
    "unpublished": "manuscript",
    "online": "webpage",
}

_FIELD_MAP = {
    "title": "title",
    "journal": "container-title",
    "booktitle": "container-title",
    "publisher": "publisher",
    "school": "publisher",
    "institution": "publisher",
    "volume": "volume",
    "number": "issue",
    "pages": "page",
    "edition": "edition",
    "doi": "DOI",
    "url": "URL",
    "note": "note",
}

# LaTeX escapes that appear in real .bib files. Not exhaustive — a general
# LaTeX-to-text converter is a different project — but these cover the ones
# that would otherwise show up literally in a rendered bibliography.
_ACCENTS = {
    r"\\'a": "á", r'\\"a': "ä", r"\\`a": "à", r"\\\^a": "â", r"\\~a": "ã",
    r"\\'e": "é", r'\\"e': "ë", r"\\`e": "è", r"\\\^e": "ê",
    r"\\'i": "í", r'\\"i': "ï", r"\\`i": "ì", r"\\\^i": "î",
    r"\\'o": "ó", r'\\"o': "ö", r"\\`o": "ò", r"\\\^o": "ô", r"\\~o": "õ",
    r"\\'u": "ú", r'\\"u': "ü", r"\\`u": "ù", r"\\\^u": "û",
    r"\\'c": "ć", r"\\c\{c\}": "ç", r"\\ss": "ß", r"\\o": "ø", r"\\aa": "å",
}

_ENTRY_START = re.compile(r"@(\w+)\s*[{(]\s*([^,\s]+)\s*,", re.I)


def _clean(value: str) -> str:
    """Strip LaTeX braces and the commonest escapes."""
    text = value.strip()
    for pattern, replacement in _ACCENTS.items():
        text = re.sub(pattern, replacement, text)
    text = re.sub(r"\\[a-zA-Z]+\s*", "", text)  # remaining commands
    text = text.replace("{", "").replace("}", "")
    text = text.replace("--", "–").replace("\\&", "&")
    return re.sub(r"\s+", " ", text).strip()


def _split_authors(raw: str) -> list[dict]:
    """BibTeX separates authors with " and ", and may invert as "Family, Given".

    A brace-wrapped name ("{The Tor Project}") is a literal — an organisation,
    not a person — and must not be split into given/family.
    """
    names: list[dict] = []
    for chunk in re.split(r"\s+and\s+", raw.strip(), flags=re.I):
        chunk = chunk.strip()
        if not chunk:
            continue
        if chunk.startswith("{") and chunk.endswith("}"):
            names.append({"literal": _clean(chunk)})
            continue
        if "," in chunk:
            family, _, given = chunk.partition(",")
            names.append({"family": _clean(family), "given": _clean(given)})
        else:
            parts = _clean(chunk).split()
            if len(parts) == 1:
                names.append({"literal": parts[0]})
            else:
                names.append({"family": parts[-1], "given": " ".join(parts[:-1])})
    return names


def _read_fields(body: str) -> dict:
    """Read `key = {value}` / `key = "value"` / `key = value` pairs.

    Brace depth is tracked so a value containing commas or nested braces is not
    cut in half.
    """
    fields: dict[str, str] = {}
    index = 0
    length = len(body)
    while index < length:
        match = re.compile(r"([A-Za-z_-]+)\s*=\s*").match(body, index)
        if not match:
            index += 1
            continue
        key = match.group(1).lower()
        index = match.end()
        if index >= length:
            break

        if body[index] == "{":
            depth = 0
            start = index + 1
            while index < length:
                if body[index] == "{":
                    depth += 1
                elif body[index] == "}":
                    depth -= 1
                    if depth == 0:
                        break
                index += 1
            fields[key] = body[start:index]
            index += 1
        elif body[index] == '"':
            start = index + 1
            index += 1
            while index < length and body[index] != '"':
                index += 1
            fields[key] = body[start:index]
            index += 1
        else:
            start = index
            while index < length and body[index] not in ",\n":
                index += 1
            fields[key] = body[start:index]
    return fields


def _entry_body(text: str, start: int) -> tuple[str, int]:
    """The text between an entry's opening and matching closing brace."""
    depth = 0
    index = start
    while index < len(text):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1
            if depth == 0:
                return text[start + 1 : index], index + 1
        index += 1
    return text[start + 1 :], len(text)


def bibtex_to_csl(source: str) -> list[dict]:
    """Convert a .bib file to CSL-JSON items.

    Entries that cannot be read are skipped, not raised: one malformed record
    must not cost the user the rest of their library.
    """
    items: list[dict] = []
    position = 0
    text = source or ""

    while True:
        match = _ENTRY_START.search(text, position)
        if not match:
            break
        entry_type = match.group(1).lower()
        cite_key = match.group(2).strip()

        brace = text.rfind("{", match.start(), match.end())
        if brace == -1:
            position = match.end()
            continue
        body, position = _entry_body(text, brace)

        if entry_type in ("comment", "preamble", "string"):
            continue

        try:
            fields = _read_fields(body)
            item: dict = {
                "id": cite_key,
                "type": _TYPE_MAP.get(entry_type, "document"),
            }
            for key, target in _FIELD_MAP.items():
                if fields.get(key):
                    item[target] = _clean(fields[key])
            if fields.get("author"):
                item["author"] = _split_authors(fields["author"])
            year = fields.get("year", "")
            year_match = re.search(r"\d{4}", year)
            if year_match:
                item["issued"] = {"date-parts": [[int(year_match.group(0))]]}
            items.append(item)
        except Exception:  # noqa: BLE001
            continue

    return items
