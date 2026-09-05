# Paper Formatter

An academic paper formatting assistant: upload a dissertation/paper draft, extract its structured content, edit it in a rich document editor, and check/reformat it against a conference style (IEEE, APA, ACM) before exporting a formatted DOCX/PDF. Multi-user: every document belongs to the account that uploaded it.

## Run & Operate

Uses npm workspaces. First-time setup, from the repo root:

```sh
npm install
cp .env.example .env       # DATABASE_URL is the only required value

# A database. Any Postgres 16 will do; this is the throwaway one:
docker run --name pf-db -d -p 5432:5432 \
  -e POSTGRES_USER=paper -e POSTGRES_PASSWORD=paper -e POSTGRES_DB=paper_formatter \
  postgres:16

npm run migrate            # creates users / sessions / documents
```

`.env` is read from the repo root by the API server, the migrator, and
drizzle-kit (each loads it explicitly — see `artifacts/api-server/src/lib/env.ts`).
Nothing reads it implicitly, so a new process that needs config has to load it
too.

Then start each side in its own terminal:

- `npm run dev:api` — API server on `http://localhost:8080` (alias for `npm run dev -w @workspace/api-server`). This is `build && start`, not a watcher: re-run it after changing server or Python code.
- `npm run dev:web` — frontend on `http://localhost:5173` (alias for `npm run dev -w @workspace/paper-formatter`). Vite HMR, so frontend edits appear immediately.

Open `http://localhost:5173` and create an account — the workspace is empty until you upload a paper.

The frontend calls the API with same-origin relative `/api/...` URLs; the Vite dev/preview server proxies `/api` to the backend, so no CORS or base-URL config is needed. Open `http://localhost:5173`, create an account, and upload a paper.

Other commands:

- `npm run typecheck` — full typecheck across all packages
- `npm test` — vitest unit tests (API server)
- `npm run test:python` — pytest suite for the formatting engine
- `npm run build` — typecheck + build all packages
- `npm run codegen -w @workspace/api-spec` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `npm run generate -w @workspace/db` — generate a migration after a schema change
- `npm run migrate` — apply pending migrations
- `npm run push -w @workspace/db` — direct schema push; **throwaway local databases only**, see `lib/db/migrations/README.md`

### Deployment

`docker compose up --build` runs Postgres, applies migrations as a one-shot service, and serves the API and the built frontend from a single container on port 8080. The image carries Python + Docling + LibreOffice because the formatting engine is a subprocess, not a service. Manuscripts and the Docling model cache live on named volumes.

Every setting is documented in `.env.example`. The ones that matter in production: `DATABASE_URL`, `TRUST_PROXY` (behind a reverse proxy), `CORS_ORIGINS` (only if the frontend is served from a different origin), and `PYTHON_MAX_CONCURRENCY` (memory ceiling).

## Stack

- npm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (`artifacts/api-server`) — helmet, CORS allowlist, rate limiting, cookie sessions
- Frontend: React + Vite + TipTap editor (`artifacts/paper-formatter`)
- DB: PostgreSQL + Drizzle ORM, versioned SQL migrations
- Validation: Zod, `drizzle-zod`
- API codegen: Orval (from `lib/api-spec/openapi.yaml`)
- Formatting engine: Python subprocesses invoked from Node (`artifacts/api-server/python/`) — Docling for extraction, python-docx + LibreOffice for DOCX/PDF export. No standalone Python service/workflow.
- Tests: vitest (`src/**/*.test.ts`), pytest (`python/tests/`), GitHub Actions CI

## Where things live

- `lib/api-spec/openapi.yaml` — API contract (source of truth for routes/schemas)
- `lib/db/src/schema/users.ts` — `usersTable`, `sessionsTable`, registration/login schemas
- `lib/db/src/schema/documents.ts` — `documentsTable` (ownerId, title, status, conferenceStyle, guidelinesText, styleSpec, editorContent, extractedContent, formattingIssues)
- `lib/db/migrations/` — versioned SQL, plus a README on the baseline
- `artifacts/api-server/src/routes/auth.ts` — register/login/logout/me/password
- `artifacts/api-server/src/routes/documents.ts` — upload/list/get/patch/delete/guidelines/analyze/format/export, all owner-scoped
- `artifacts/api-server/src/middlewares/` — `auth` (session resolution + guard), `security` (CORS allowlist, CSRF origin guard), `rateLimit`, `errorHandler`
- `artifacts/api-server/src/lib/password.ts` — scrypt hashing; `session.ts` — session issue/resolve/revoke
- `artifacts/api-server/src/lib/pythonClient.ts` — Node↔Python subprocess bridge, timeouts and concurrency cap
- `artifacts/api-server/python/` — `extract.py` (Docling→TipTap JSON), `format.py` (style compliance + rewrite), `export.py` (TipTap JSON→DOCX/PDF), `styles.py` (IEEE/APA/ACM rules), `mdconvert.py` (Markdown↔TipTap), `mathml.py` (LaTeX→OMML equations), `authorblock.py` (per-venue author block), `docclass.py` (venue × genre: page budgets, TOC policy, numbering), `infer.py` (suggest a class from the manuscript; warn on mismatch), `references.py` (CSL-JSON → citations + bibliography), `bibtex.py` / `bibimport.py` (.bib → CSL-JSON), `docxfont.py` (shared run typography)
- `artifacts/paper-formatter/src/components/AuthorPanel.tsx` — authorship editor (authors, affiliations, order, corresponding)
- `artifacts/paper-formatter/src/lib/auth.tsx` — auth context; `src/pages/SignIn.tsx` — sign-in/register

## Architecture decisions

- Conference styles are scoped to IEEE, APA, ACM for the MVP.
- Auth is email + password with scrypt (a Node builtin — no native module to compile) and opaque session tokens in an httpOnly cookie. Only a SHA-256 of the token is stored, so a database leak yields no usable sessions. Sessions, not JWTs: revocation has to be immediate.
- Ownership is enforced in the `WHERE` clause of every document query, not as a check after loading the row — there is no code path that reads a document without filtering on `ownerId`. Another user's document returns 404, not 403, so ids cannot be enumerated.
- Formatting work stays synchronous, bounded by a subprocess timeout and a concurrency semaphore (503 with `Retry-After` when saturated) rather than moving to a job queue. Revisit if extraction routinely exceeds the request timeout or the app needs more than one instance.
- Real-time collaboration is still out of scope.
- Upload and export use plain `fetch`/`FormData` and `res.download`, not generated Orval mutation hooks — multipart bodies and binary responses aren't representable in the generated client. Auth endpoints are also hand-called because they set and clear a cookie.
- AI compliance analysis uses a user-supplied `OPENAI_API_KEY` directly via the OpenAI SDK. The rest of the app does not depend on this key.

## Product

- Sign in / register; each account sees only its own manuscripts.
- Document list: upload a PDF/DOCX, see status/style/issue count, open or delete.
- Document workspace: TipTap editor bound to the document's content, paste or upload formatting guidelines, pick a conference style, run "Format" (rewrites structure/casing, flags missing sections) and "Analyze" (AI compliance check, optional), export as DOCX or PDF.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- The `/analyze` endpoint requires an `OPENAI_API_KEY`. It is implemented and works once a key is added — without one it returns a graceful 422 and the rest of the app is unaffected.
- **Inference suggests; it never applies.** `infer.py` proposes a class at upload and warns at format time when the chosen class contradicts the manuscript, but nothing switches a class automatically — the user knows their venue and the app does not. Both paths are wrapped so an inference failure can never fail an extraction or a format.
- **Guidelines are read deterministically first, by model second.** `guidelinesParser.ts` always runs; `guidelinesAi.ts` fills only the gaps, key-gated, and everything it returns is Zod-validated with hard bounds before use (a hallucinated 3pt body size is rejected, not clamped). No key, no network, or a malformed response all degrade to the deterministic result.
- Python subprocess paths in `pythonClient.ts` are computed relative to `import.meta.dirname`, which is `artifacts/api-server/dist` at runtime (bundled) — verify path math against the actual bundle location, not the `src` layout, when changing it. The same applies to `WEB_ROOT` in `app.ts`.
- `StyleSpec` is declared twice: the TS interface in `lib/db/src/schema/documents.ts`, the `@dataclass` in `python/styles.py`, plus the OpenAPI schema. The snake_case keys are load-bearing — the same JSON crosses the process boundary unchanged. Add a field to all three or it will be silently dropped by `spec_from_dict`.
- Migration `0000` is a baseline that assumes an empty database. A dev database predating auth must be recreated; see `lib/db/migrations/README.md`.
- **Docling is expensive and its defaults are worse.** Measured on a 16GB laptop: a 1.8MB PDF peaks at ~2.1GB RSS for ~70s. Docling ships with `do_ocr=True`, TableFormer in `ACCURATE` mode, and torch claiming half the cores; this app disables OCR, uses `FAST` tables, caps torch threads, runs one extraction at a time, and drops the subprocess to below-normal priority. Before that combination, two concurrent uploads exhausted memory and froze the desktop. All of it is env-tunable — see `.env.example`. OCR is the one to turn back on (`DOCLING_OCR=1`) if someone uploads an actual scan; extraction refuses with a clear message rather than returning an empty editor.
- Adding a query parameter to `openapi.yaml` can generate a `*Params` symbol in both `api-zod`'s schema and types output, which collide under that package's `export *` index. `/documents/{id}/export` documents `?format=` in prose for exactly this reason.
- **References are CSL-JSON, and citations in the body store *ids*, not markers.** "[1]" and "(Smith, 2020)" are functions of the style — IEEE numbers by order of first citation, APA writes author and year — so a marker baked into `editorContent` could not be re-rendered on a style change. `references.py` resolves ids at export time. BibTeX is an import path only (`bibtex.py`): `.bst` files are a BibTeX-only DSL and mean nothing off the LaTeX toolchain.
- **The bibliography renderer is hand-written for the three supported styles, not a CSL engine.** A general engine (citeproc-py) needs the CC BY-SA licensed CSL style XML vendored alongside it and only pays off past three styles. Everything *stored* is standard CSL-JSON, so replacing the renderer later touches no data.
- **A style is a family; a document class is family × genre.** `StyleSpec` is typography only. Structure — page budget, contents-page policy, required sections, heading numbering, author block — lives on `DocumentClass` in `docclass.py`. An IEEE conference paper (6 pages, no TOC) and an IEEE Transactions article share typography and disagree about everything else. `CLASSES` there is mirrored in `routes/styles.ts` and `documentClassValues` in the DB schema; adding a class means editing all three, exactly like `StyleSpec`.
- **`conferenceStyle` is legacy but still live.** Documents predating classes have only that column; `resolve_document_class` maps a family to its *shortest* genre (`_FAMILY_DEFAULT`) so an unstated genre never silently relaxes a page limit. Formatting records the resolved class, so a document stops being ambiguous once formatted.
- **Document semantics that must survive a style change live as metadata, never as prose in `editorContent`.** Authors and affiliations are `jsonb` columns rendered per venue by `authorblock.py` (IEEE grid, APA title page, ACM block) — the same data, three layouts. Anything typed into the body as a paragraph cannot be re-rendered when the user switches venue, which is the product's whole promise. Abstract, keywords and the document class belong here too and are not modelled yet.
- **Columns are a property of a Word *section*, not of the document.** A two-column paper is a full-width section (title, and in future the author block) followed by a continuous-break section holding the body — see `_begin_body_section` in `export.py`. Setting `w:cols` on `sections[0]` puts the title inside the left column. Anything that must span the page goes in `_render_front_matter`, before the break.
- **A node type the editor schema does not declare is destroyed on load, not preserved.** ProseMirror drops unknown nodes in `setContent`, and the next keystroke autosaves the stripped document over the original. Anything `extract.py` can emit must have a matching TipTap extension registered in `DocumentEditor.tsx` — this is why `mathNodes.ts` exists even though it does no typesetting.
- TipTap builds its `onUpdate` handler once. Anything it reads must come from a ref, and any debounce timer must be stored in a ref — a `setTimeout` created inside `onUpdate` cannot be cancelled by returning its cleanup, which is how autosave once fired on every keystroke.

## Pointers

- Workspace packages live under `artifacts/*` (apps) and `lib/*` (shared libs), wired via the `workspaces` array in the root `package.json`. Shared libs are consumed as TypeScript source (their `exports` point at `src/*.ts`), so there's no separate lib build step.
- CI (`.github/workflows/ci.yml`) runs typecheck, both test suites, and the build; it also fails if `openapi.yaml` changed without regenerating the client, or if the DB schema changed without a migration.
