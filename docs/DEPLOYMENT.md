# Deployment and operations

Run one application instance initially. Its Python concurrency limit, request limits, and filesystem storage are local to that instance. Add a durable job queue and shared storage before scaling horizontally.

## Configuration

1. Copy `.env.example` to `.env`. Choose a long random URL-safe `POSTGRES_PASSWORD` before the first Compose startup. Changing this variable later does not rotate an existing database's password.
2. Set `COOKIE_SECURE=true`. Terminate HTTPS at a reverse proxy on the same host and forward to `127.0.0.1:8080`.
3. Set `TRUST_PROXY` to the actual number of trusted proxy hops, typically `1`. The proxy must replace client-supplied forwarding headers. The default is `0` for direct access.
4. Keep frontend and API on one origin. Leave `CORS_ORIGINS` empty unless a separate frontend origin is required.
5. Start with `PYTHON_MAX_CONCURRENCY=1`. Measure memory and extraction latency before increasing it. Allow the proxy enough response time for the configured Python timeout plus queue wait.
6. Run `docker compose up --build -d` and inspect `docker compose logs migrate api`.

The application container runs as a non-root user. PostgreSQL is only exposed inside the Compose network. Database, manuscript storage, and model downloads use named volumes. Never run `docker compose down -v` against data you intend to retain.

The Docker image installs Python dependencies declared in `pyproject.toml`; this install currently resolves version ranges. Local development uses `uv.lock`. Build and retain a tested image for each release rather than rebuilding an old release and expecting identical dependencies.

## Release checks

The review-and-restore release adds migration `0005`: a document revision counter and a `document_versions` table. Apply migrations before starting the new server (`npm run migrate`, or the Compose migration service). Versions are retained until their manuscript is deleted and are included in database backups.

- Require green GitHub Actions checks before merging.
- Validate the container on the actual host: register, sign in, upload a synthetic DOCX and PDF, edit, refresh, format, and download DOCX/PDF.
- Confirm a second account cannot access the first account's documents.
- Test an interrupted network save and retry before trusting the editor with important work.
- Check equation rendering and font substitutions in the exported PDF.
- Confirm HTTPS, secure session cookies, and private API responses (`Cache-Control: no-store`).

`GET /api/healthz` reports process liveness. `GET /api/readyz` checks PostgreSQL and reports engine load; it does not prove that Docling model downloads or LibreOffice conversion work. Monitor HTTP errors, Python timeouts, disk usage, memory, and backup completion.

## Backups and recovery

Back up PostgreSQL with `pg_dump` and the `storage` volume together during a maintenance window so source-file references remain consistent. Encrypt backups and restrict access: they contain unpublished manuscripts and account data. The `models` volume is a cache and can be downloaded again.

Before each release, take a backup and record the running image tag. Test restoration into a separate database and storage volume; verify sign-in, a manuscript, and an export. Roll back to the previous image only when its schema remains compatible. Otherwise restore the matching database and storage backup together.

## Public service roadmap

Before unrestricted signup, add per-account storage/processing quotas, account recovery, email verification, and a documented retention/deletion policy. Validate the system under expected simultaneous uploads. For multi-instance operation, move processing into durable jobs, store files in shared/object storage, and use a shared rate-limit store.

The product priority is reliable manuscript preservation and export fidelity. Validate that workflow with a small group of researchers and representative documents before adding more style families or AI features.
