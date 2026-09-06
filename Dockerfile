# Paper Formatter — API server + built frontend in one image.
#
# The runtime needs three things that do not usually share a container: Node
# (the API), Python with Docling and python-docx (the formatting engine), and
# LibreOffice (DOCX -> PDF). They are colocated deliberately: the engine is
# invoked as a subprocess over stdin/stdout, not as a network service.

# ---- Stage 1: build the JS -------------------------------------------------
FROM node:24-bookworm-slim AS build

WORKDIR /app

# Copy every workspace manifest before the sources so `npm ci` is cached until
# a dependency actually changes.
COPY package.json package-lock.json ./
COPY packages/editor-core/package.json ./packages/editor-core/
COPY packages/editor-react/package.json ./packages/editor-react/
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/mockup-sandbox/package.json ./artifacts/mockup-sandbox/
COPY artifacts/paper-formatter/package.json ./artifacts/paper-formatter/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/db/package.json ./lib/db/
COPY scripts/package.json ./scripts/

RUN npm ci

COPY . .

RUN npm run build

# ---- Stage 2: runtime ------------------------------------------------------
FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUTF8=1 \
    # Docling caches its layout models here; the volume keeps a container
    # restart from re-downloading hundreds of megabytes.
    HF_HOME=/var/lib/paper-formatter/models \
    STORAGE_DIR=/var/lib/paper-formatter/storage \
    PYTHON_BIN=/opt/venv/bin/python \
    HOST=0.0.0.0 \
    PORT=8080

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        python3-venv \
        libreoffice-writer \
        fonts-liberation \
        ca-certificates \
        tini \
    && rm -rf /var/lib/apt/lists/*

# fonts-liberation supplies metric-compatible substitutes for Times New Roman
# and Arial. Without them LibreOffice silently falls back to another face and
# the PDF's line breaks stop matching the DOCX.

WORKDIR /app

COPY pyproject.toml ./
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
    && python3 -c "import tomllib; from pathlib import Path; p=tomllib.loads(Path('pyproject.toml').read_text()); Path('/tmp/requirements.txt').write_text('\n'.join(p['project']['dependencies']))" \
    && /opt/venv/bin/pip install --no-cache-dir \
        -r /tmp/requirements.txt

# Runtime JS: the bundled server, its production node_modules, the built
# frontend, and the engine scripts.
COPY --from=build /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=build /app/artifacts/paper-formatter/dist ./artifacts/paper-formatter/dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/lib ./lib
COPY artifacts/api-server/python ./artifacts/api-server/python
COPY package.json ./

# Storage holds users' manuscripts; mount a volume over it so uploads survive
# a redeploy and never live in the image layer.
RUN mkdir -p "$STORAGE_DIR/uploads" "$STORAGE_DIR/exports" "$HF_HOME" \
    && chown -R node:node /var/lib/paper-formatter /app

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini reaps the Python and LibreOffice subprocesses; without an init, killed
# converters accumulate as zombies.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
