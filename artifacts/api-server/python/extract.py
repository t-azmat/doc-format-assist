#!/usr/bin/env python3
"""Extract structured content from an uploaded dissertation/paper (PDF or
DOCX) using Docling, and convert it into:

- `editorContent`: a TipTap/ProseMirror JSON document (editable source of truth)
- `extractedContent`: a lightweight structural summary (sections, references,
  table/figure counts) derived from the same Docling conversion

Usage: python3 extract.py <input-file-path>
Prints a single JSON object to stdout: {"editorContent": ..., "extractedContent": ...}
"""

import json
import os
import sys
from pathlib import Path

from mdconvert import extract_structure
from richconvert import docling_to_tiptap, detect_columns


def _env_flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: float) -> float:
    try:
        value = float(os.environ.get(name, ""))
    except ValueError:
        return default
    return value if value > 0 else default


def _build_converter():
    """Build a PDF converter tuned to not take the machine down with it.

    Docling's defaults are built for accuracy on arbitrary scanned input, and on
    a developer laptop they are brutal: OCR on by default, TableFormer in
    ACCURATE mode, and torch claiming half the cores. A single half-megabyte PDF
    peaked at ~2GB of RSS and 36s of wall clock, and two concurrent uploads were
    enough to exhaust memory and freeze the desktop.

    The defaults here assume what this product actually receives — papers
    exported from LaTeX or Word, which carry a real text layer:

    - OCR off. Running it on a text PDF buys nothing and costs an OCR model.
      Set DOCLING_OCR=1 for genuinely scanned documents.
    - TableFormer FAST rather than ACCURATE.
    - Page images at 1x rather than 2x — 2x is four times the pixels.

    Two options are opt-in rather than tuned down:

    - DOCLING_FORMULAS=1 turns on formula enrichment, which recognises
      equations and returns them as LaTeX instead of the garbled inline text a
      layout model reads off a rendered equation. It loads a further vision
      model, so it is off by default on the same memory argument as the rest.
    - DOCLING_TIMEOUT_SEC caps a single document. Docling then returns what it
      finished rather than running until the Node-side subprocess timeout kills
      it, which yields a partial document instead of nothing at all.

    Falls back to the stock converter if a Docling version exposes these
    differently.
    """
    from docling.document_converter import DocumentConverter

    try:
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        from docling.document_converter import PdfFormatOption

        pipeline_options = PdfPipelineOptions()
        pipeline_options.do_ocr = _env_flag("DOCLING_OCR", False)
        pipeline_options.generate_picture_images = _env_flag("DOCLING_PICTURES", True)
        pipeline_options.images_scale = _env_float("DOCLING_IMAGE_SCALE", 1.0)
        pipeline_options.do_formula_enrichment = _env_flag("DOCLING_FORMULAS", False)

        timeout = _env_float("DOCLING_TIMEOUT_SEC", 0.0)
        if timeout > 0:
            pipeline_options.document_timeout = timeout

        if _env_flag("DOCLING_ACCURATE_TABLES", False):
            pass  # leave Docling's ACCURATE default in place
        else:
            try:
                from docling.datamodel.pipeline_options import TableFormerMode

                pipeline_options.table_structure_options.mode = TableFormerMode.FAST
            except Exception:
                pass

        return DocumentConverter(
            format_options={
                InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)
            }
        )
    except Exception:
        return DocumentConverter()


def _attach_suggestion(editor_content: dict, extracted_content: dict) -> None:
    """Record which document class the manuscript looks like.

    A suggestion, never an application — nothing downstream reads this as a
    selection. Extraction must not fail because inference did, so this is
    best-effort.
    """
    try:
        from infer import infer_signals, suggest_class

        suggestion = suggest_class(infer_signals(editor_content, extracted_content))
        if suggestion:
            extracted_content["suggestedClass"] = suggestion.as_dict()
    except Exception:  # noqa: BLE001
        pass


def main() -> None:
    if len(sys.argv) != 2:
        print(json.dumps({"error": "usage: extract.py <input-file-path>"}), file=sys.stderr)
        sys.exit(1)

    input_path = Path(sys.argv[1])
    if not input_path.exists():
        print(json.dumps({"error": f"file not found: {input_path}"}), file=sys.stderr)
        sys.exit(1)

    # .docx carries its real structure in the file — read it natively rather than
    # inferring layout. PDFs (and legacy .doc) have no semantic structure, so
    # they go through Docling's layout inference.
    if input_path.suffix.lower() == ".docx":
        try:
            from docxnative import extract_docx

            native = extract_docx(str(input_path))
        except Exception as exc:  # noqa: BLE001
            print(json.dumps({"error": f"extraction failed: {exc}"}), file=sys.stderr)
            sys.exit(1)

        extracted_content = {
            "sections": native["sections"],
            "references": native["references"],
            "tableCount": native["tableCount"],
            "pictureCount": native["pictureCount"],
            "detectedColumns": native["columns"],
            # A .docx has no fixed pagination until it is laid out, so page
            # count is unknown here; inference falls back to word count.
            "pageCount": None,
            "design": native["design"],
            "sourceFilename": input_path.name,
        }
        _attach_suggestion(native["editorContent"], extracted_content)
        print(
            json.dumps(
                {"editorContent": native["editorContent"], "extractedContent": extracted_content}
            )
        )
        return

    try:
        converter = _build_converter()
        result = converter.convert(str(input_path))
        document = result.document
        # Structured walk retains images/tables/captions; Markdown is used only
        # for the lightweight section/reference summary.
        editor_content = docling_to_tiptap(document)
        markdown = document.export_to_markdown()
        num_tables = len(getattr(document, "tables", []) or [])
        num_pictures = len(getattr(document, "pictures", []) or [])
        detected_columns = detect_columns(document)
    except Exception as exc:  # noqa: BLE001 - surface extraction failures to the caller
        print(json.dumps({"error": f"extraction failed: {exc}"}), file=sys.stderr)
        sys.exit(1)

    # With OCR off, a scanned PDF converts successfully but yields almost
    # nothing. Say so plainly instead of handing back an empty editor.
    if len(markdown.strip()) < 40 and not _env_flag("DOCLING_OCR", False):
        print(
            json.dumps(
                {
                    "error": (
                        "No text could be read from that PDF. It looks like a scan "
                        "rather than an exported document. Set DOCLING_OCR=1 on the "
                        "server to enable optical character recognition, which is "
                        "much slower and needs considerably more memory."
                    )
                }
            ),
            file=sys.stderr,
        )
        sys.exit(1)

    structure = extract_structure(markdown)

    # Minimal design for PDFs: real page size (points -> inches) + detected
    # columns. Fonts aren't reliably recoverable from PDF layout.
    design = {"id": "source", "name": "Original layout", "columns": detected_columns}
    try:
        first_page = next(iter(document.pages.values()))
        size = getattr(first_page, "size", None)
        if size and getattr(size, "width", None) and getattr(size, "height", None):
            design["page_width_in"] = round(size.width / 72.0, 3)
            design["page_height_in"] = round(size.height / 72.0, 3)
    except Exception:
        pass

    extracted_content = {
        "sections": structure["sections"],
        "references": structure["references"],
        "tableCount": num_tables,
        "pictureCount": num_pictures,
        "detectedColumns": detected_columns,
        "pageCount": len(getattr(document, "pages", {}) or {}) or None,
        "design": design,
        "sourceFilename": input_path.name,
    }
    _attach_suggestion(editor_content, extracted_content)

    print(json.dumps({"editorContent": editor_content, "extractedContent": extracted_content}))


if __name__ == "__main__":
    main()
