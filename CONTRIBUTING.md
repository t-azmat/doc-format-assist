# Contributing

Use Node.js 24 and the setup in [README.md](README.md). Keep changes focused and use synthetic manuscripts in tests; never attach unpublished research or credentials to issues or pull requests.

Before opening a pull request, run `npm test`, `npm run build`, and `uv run --locked python -m pytest artifacts/api-server/python/tests -q`.

If you change the API contract, edit `lib/api-spec/openapi.yaml`, then run `npm run codegen -w @workspace/api-spec` and commit the generated files. If you change the database schema, run `npm run generate -w @workspace/db` and commit the migration. Never use schema push on a production database.

Explain the user-visible problem, the resulting behavior, and how you verified it. Add regression tests for bugs involving document loss, ownership, parsing, or rendering.
