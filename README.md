# Editorial Desk · Doc Format Assist

Turn an academic draft into an editable, consistently formatted manuscript. Upload a PDF or DOCX, review the extracted content, apply submission guidelines, and export to Word or PDF.

Built with React, TipTap, Express, PostgreSQL, and a Python formatting engine.

## What you can do

- Explore an interactive sample before signing up: edit its abstract and see a real word-limit check update.
- Open a fictional sample in your private workspace to learn the editor, formatting review, and version recovery.
- Keep manuscripts in your own account with session-based authentication.
- Search manuscripts by title, filename, or style; filter by formatting status and confirm before deleting a draft.
- Edit text, tables, equations, authors, affiliations, citations, and references.
- Insert or edit rendered equations from LaTeX while preserving their source for editable Word export.
- Apply IEEE, APA, or ACM presets and document classes, or import your venue's guidelines.
- Import BibTeX references and export editable DOCX equations.
- See formatting issues and an estimated page budget while editing.
- Preview text and layout changes before applying formatting. The original draft is saved automatically and can be restored from Versions.
- Use **Export → Preview exported PDF** to inspect actual pages, navigate and zoom, then download the exact file shown. The preview saves pending edits first and identifies the rendered draft revision.
- Review evidence-based checks for section headings, citation links, and supported explicit abstract word limits. Unverified checks are labelled **Not checked**.
- Run optional AI compliance checks when the server has an OpenAI API key.

Formatting is an aid to submission preparation. Venue requirements vary; review the exported file against the actual submission instructions. The editor's page estimate is approximate, and complex PDFs may require manual corrections after extraction.

## Local development

Prerequisites: **Node.js 24**, npm 10+, **Python 3.11+**, PostgreSQL 16, and LibreOffice for PDF export. Python 3.12 is used in CI. PDF extraction downloads Docling models on first use and can require several GB of memory.

```sh
npm ci
```

Copy `.env.example` to `.env` and set `DATABASE_URL` to your local PostgreSQL database. In PowerShell use `Copy-Item .env.example .env`; on macOS/Linux use `cp .env.example .env`.

Install the locked Python environment with `uv sync --locked`. The API automatically finds the repository's `.venv`. If you use another Python environment, set `PYTHON_BIN` to its interpreter.

On Windows, select standalone Python explicitly so LibreOffice's bundled interpreter is not used:

```powershell
py -3.12 -m pip install uv
$projectPython = py -3.12 -c "import sys; print(sys.executable)"
py -3.12 -m uv sync --locked --python "$projectPython"
```

Keep standalone Python ahead of LibreOffice in `PATH`. If adding LibreOffice for PDF export, append its directory: `$env:PATH += ";C:\Program Files\LibreOffice\program"`.

```sh
npm run migrate
```

Start these in separate terminals:

```sh
npm run dev:api
npm run dev:web
```

Open **http://localhost:5173** and try the public sample, or create an account and open a sample manuscript in your workspace. Upload your own draft when you're ready. API changes require restarting `dev:api`; frontend changes reload automatically.

## Docker

Docker Compose runs PostgreSQL, applies migrations, and serves the built app on port 8080. Copy `.env.example` to `.env` first. For a **local HTTP preview only**, add `COOKIE_SECURE=false` to `.env`, then run:

```sh
docker compose up --build
```

Open **http://localhost:8080**. The port binds to the local machine by default. The first image build is large because it includes Docling, Python, and LibreOffice.

For an internet deployment, follow [the deployment guide](docs/DEPLOYMENT.md). Use HTTPS, secure cookies, a strong database password, and persistent volumes. GitHub hosts the source; GitHub Pages cannot run this backend.

## Verification

For the browser checks, install Chromium once with `npx playwright install chromium`. Build before running browser tests. Browser tests exercise the real public sample endpoint and use synthetic responses for authenticated workflows. PostgreSQL integration tests separately verify sample creation, ownership, concurrent edits, and version recovery in CI.

```sh
npm test
npm run build
npm run test:browser
uv run --locked python -m pytest artifacts/api-server/python/tests -q
```

`build` includes typechecking. JavaScript tests cover password verification, request security, guidelines parsing, and autosave ordering. Python tests cover formatting, document classes, authors, equations, references, and exports. GitHub Actions also checks migrations and generated API files.

## Project structure

The editor prototype is available at `/editor-lab` without an account. Switch templates while typing to try automatic typography; its temporary content is not saved. The real manuscript editor uses the same independent packages under `packages/editor-core` and `packages/editor-react`. See [the editor package guide](packages/editor-react/README.md) for embedding and current limitations.

| Path | Purpose |
| --- | --- |
| `artifacts/paper-formatter` | React interface and TipTap editor |
| `packages/editor-core` | Independent typography model and generated template presets |
| `packages/editor-react` | Reusable React manuscript editor and automatic style canvas |
| `artifacts/api-server/src` | Express API, authentication, document ownership |
| `artifacts/api-server/python` | Extraction, formatting, and DOCX/PDF rendering |
| `lib/db` | PostgreSQL schema and versioned migrations |
| `lib/api-spec/openapi.yaml` | API contract |
| `lib/api-client-react`, `lib/api-zod` | Generated client and validation schemas |

## Data and limitations

Manuscripts are stored in PostgreSQL and the configured storage directory. Treat both as private data and back them up together. Do not commit `.env`, uploads, exports, or real research manuscripts.

Core formatting works without an AI key. If enabled, AI compliance analysis sends manuscript text to OpenAI, and AI-assisted guideline parsing sends guideline text. Tell users before enabling these features for a shared deployment.

The current architecture targets one application instance with bounded Python concurrency. It does not include password recovery, email verification, collaborative editing, per-account storage quotas, or a durable background job queue. Those are release requirements to evaluate before operating an unrestricted public service. Saved versions retain copies of manuscript content until the manuscript is deleted; include them in storage and retention planning.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development changes and [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

MIT — see [LICENSE](LICENSE). Third-party dependencies retain their own licenses.
