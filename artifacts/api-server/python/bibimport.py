#!/usr/bin/env python3
"""Convert a .bib file to CSL-JSON.

Reads BibTeX source from stdin, writes {"references": [...]} to stdout.

A separate entry point rather than a flag on extract.py: this is a fast, pure
text transform with none of extract.py's model loading, and it should not queue
behind the extraction concurrency cap.
"""

import json
import sys

from bibtex import bibtex_to_csl


def main() -> None:
    source = sys.stdin.read()
    try:
        references = bibtex_to_csl(source)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": f"could not read that .bib file: {exc}"}), file=sys.stderr)
        sys.exit(1)

    print(json.dumps({"references": references}))


if __name__ == "__main__":
    main()
