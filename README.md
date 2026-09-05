# Editorial Desk · Doc Format Assist

Turn an academic draft into an editable, consistently formatted manuscript. Upload a PDF or DOCX, review the extracted content, apply submission guidelines, and export to Word or PDF.

Built with React, TipTap, Express, PostgreSQL, and a Python formatting engine.

## What you can do

- Keep manuscripts in your own account with session-based authentication.
- Edit text, tables, equations, authors, affiliations, citations, and references.
- Apply IEEE, APA, or ACM presets and document classes, or import your venue's guidelines.
- Import BibTeX references and export editable DOCX equations.
- See formatting issues and an estimated page budget while editing.
- Run optional AI compliance checks when the server has an OpenAI API key.

Formatting is an aid to submission preparation. Venue requirements vary; review the exported file against the actual submission instructions. The editor's page estimate is approximate, and complex PDFs may require manual corrections after extraction.

## Local development

Prerequisites: **Node.js 24**, npm 10+, **Python 3.11+**, PostgreSQL 16, and LibreOffice for PDF export. Python 3.12 is used in CI. PDF extraction downloads Docling models on first use and can require several GB of memory.

```sh
npm ci
```

Copy `.env.example` to `.env` and set `DATABASE_URL` to your local PostgreSQL database. In PowerShell use `Copy-Item .env.example .env`; on macOS/Linux use `cp .env.example .env`.

Install the locked Python environment with `uv sync --locked`. The API automatically finds the repository's `.venv`. If you use another Python environment, set `PYTHON_BIN` to its interpreter.

```sh
npm run migrate
```

Start these in separate terminals:

```sh
npm run dev:api
npm run dev:web
```

Open **http://localhost:5173**, create an account, and upload a manuscript. API changes require restarting `dev:api`; frontend changes reload automatically.

## Docker

Docker Compose runs PostgreSQL, applies migrations, and serves the built app on port 8080. Copy `.env.example` to `.env` first. For a **local HTTP preview only**, add `COOKIE_SECURE=false` to `.env`, then run:

```sh
docker compose up --build
```

Open **http://localhost:8080**. The port binds to the local machine by default. The first image build is large because it includes Docling, Python, and LibreOffice.

For an internet deployment, follow [the deployment guide](docs/DEPLOYMENT.md). Use HTTPS, secure cookies, a strong database password, and persistent volumes. GitHub hosts the source; GitHub Pages cannot run this backend.

## Verification

```sh
npm test
npm run build
uv run --locked python -m pytest artifacts/api-server/python/tests -q
```

`build` includes typechecking. JavaScript tests cover password verification, request security, guidelines parsing, and autosave ordering. Python tests cover formatting, document classes, authors, equations, references, and exports. GitHub Actions also checks migrations and generated API files.

## Project structure

| Path | Purpose |
| --- | --- |
| `artifacts/paper-formatter` | React interface and TipTap editor |
| `artifacts/api-server/src` | Express API, authentication, document ownership |
| `artifacts/api-server/python` | Extraction, formatting, and DOCX/PDF rendering |
| `lib/db` | PostgreSQL schema and versioned migrations |
| `lib/api-spec/openapi.yaml` | API contract |
| `lib/api-client-react`, `lib/api-zod` | Generated client and validation schemas |

## Data and limitations

Manuscripts are stored in PostgreSQL and the configured storage directory. Treat both as private data and back them up together. Do not commit `.env`, uploads, exports, or real research manuscripts.

Core formatting works without an AI key. If enabled, AI compliance analysis sends manuscript text to OpenAI, and AI-assisted guideline parsing sends guideline text. Tell users before enabling these features for a shared deployment.

The current architecture targets one application instance with bounded Python concurrency. It does not include password recovery, email verification, collaborative editing, per-account storage quotas, or a durable background job queue. Those are release requirements to evaluate before operating an unrestricted public service.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development changes and [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

MIT — see [LICENSE](LICENSE). Third-party dependencies retain their own licenses.
