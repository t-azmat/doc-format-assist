import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { Router, type IRouter } from "express";
import multer from "multer";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  documentsTable,
  documentVersionsTable,
  documentSnapshot,
  documentClassValues,
  type DocumentClassId,
  type FormattingIssue,
  type StyleSpec,
} from "@workspace/db";
import { UpdateDocumentBody } from "@workspace/api-zod";
import type { ErrorResponse } from "@workspace/api-zod";
import {
  extractDocument,
  formatDocument,
  exportDocument,
  importBibtex,
  PythonEngineError,
  PythonTimeoutError,
  PythonBusyError,
  type StyleSelector,
} from "../lib/pythonClient";
import { resolveGuidelines } from "../lib/guidelines";
import { sampleDocumentValues } from "../lib/sampleDocument";
import { currentUserId, requireAuth } from "../middlewares/auth";
import { aiRateLimit, heavyRateLimit } from "../middlewares/rateLimit";

function errorResponse(error: string): ErrorResponse {
  return { error };
}

/**
 * Translate a Python engine failure into the right status code.
 *
 * A timeout and an overloaded queue are not the caller's fault, so they must
 * not be reported as 422 "your document is invalid" — the client needs to know
 * that retrying is the correct response. Returns true when it has replied.
 */
function respondToEngineError(
  err: unknown,
  req: import("express").Request,
  res: import("express").Response,
  operation: string,
): boolean {
  if (err instanceof PythonTimeoutError) {
    req.log.warn({ err }, `${operation} timed out`);
    res.status(504).json(errorResponse(err.message));
    return true;
  }
  if (err instanceof PythonBusyError) {
    req.log.warn({ err }, `${operation} rejected: engine saturated`);
    res.setHeader("Retry-After", "30");
    res.status(503).json(errorResponse(err.message));
    return true;
  }
  if (err instanceof PythonEngineError) {
    req.log.warn({ err }, `${operation} failed`);
    res.status(422).json(errorResponse(err.message));
    return true;
  }
  return false;
}

/** Strip anything that could break out of a Content-Disposition filename. */
function safeDownloadName(title: string, extension: string): string {
  const cleaned = Array.from(title)
    // Control characters can inject CRLF into the response header; drop them
    // by code point rather than with a regex literal that would put raw
    // control bytes in this source file.
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code > 0x1f && code !== 0x7f;
    })
    .join("")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return `${cleaned || "document"}.${extension}`;
}

// A document's effective style: a custom spec from guidelines wins over a
// built-in conference preset.
/** Narrow an untrusted string to a known class id, or undefined. */
function asDocumentClass(value: unknown): DocumentClassId | undefined {
  return typeof value === "string" &&
    (documentClassValues as readonly string[]).includes(value)
    ? (value as DocumentClassId)
    : undefined;
}

function styleSelectorFor(
  row: typeof documentsTable.$inferSelect,
): StyleSelector | null {
  // A class and a guidelines spec combine — the class gives structure, the spec
  // overrides typography — so both are sent when both are present.
  if (row.documentClass || row.styleSpec) {
    return {
      ...(row.documentClass ? { documentClass: row.documentClass } : {}),
      ...(row.styleSpec ? { styleSpec: row.styleSpec } : {}),
    };
  }
  if (row.conferenceStyle) return { conferenceStyle: row.conferenceStyle };
  return null;
}

// Flatten a TipTap/ProseMirror doc to plain text — used to read guidelines
// out of an uploaded PDF/DOCX (extracted via Docling) into raw text.
function tiptapToPlainText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { text?: string; content?: unknown[]; type?: string };
  if (typeof n.text === "string") return n.text;
  const inner = Array.isArray(n.content)
    ? n.content.map(tiptapToPlainText).join("")
    : "";
  // Block-level nodes should be newline-separated so line-based parsing works.
  const isBlock =
    n.type === "paragraph" || n.type === "heading" || n.type === "listItem";
  return isBlock ? `${inner}\n` : inner;
}

const router: IRouter = Router();

// Every route in this file operates on a user's own manuscripts. Applying the
// guard once here means a newly added route cannot accidentally ship
// unauthenticated. It is scoped to the /documents prefix rather than mounted
// bare, so an unknown path still falls through to the 404 handler instead of
// answering 401.
router.use("/documents", requireAuth);

// Storage lives outside the package by default so a deployment can point it at
// a mounted volume; the in-package path stays the development default.
const STORAGE_DIR = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : path.resolve(import.meta.dirname, "..", "..", "storage");
const UPLOADS_DIR = path.join(STORAGE_DIR, "uploads");
const EXPORTS_DIR = path.join(STORAGE_DIR, "exports");

// These directories are gitignored (they hold users' unpublished manuscripts),
// so a fresh clone or a new container has to create them before multer's disk
// storage tries to write into them.
for (const dir of [UPLOADS_DIR, EXPORTS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".pdf", ".docx", ".doc"];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF and DOCX files are supported."));
    }
  },
});

// Guidelines files: small text formats read directly, or a PDF/DOCX whose text
// we extract via Docling.
const GUIDELINES_TEXT_EXTS = [".txt", ".md", ".markdown", ".yaml", ".yml"];
const GUIDELINES_DOC_EXTS = [".pdf", ".docx", ".doc"];

const guidelinesUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([...GUIDELINES_TEXT_EXTS, ...GUIDELINES_DOC_EXTS].includes(ext)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Guidelines must be a .txt, .md, .yaml, .pdf, or .docx file.",
        ),
      );
    }
  },
});

const bibtexUpload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 1024 * 1024, files: 1, fields: 1 },
  fileFilter: (_req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === ".bib")
      cb(null, true);
    else cb(new Error("BibTeX must be a .bib file."));
  },
});

function toDocumentResponse(row: typeof documentsTable.$inferSelect) {
  return {
    id: row.id,
    revision: row.revision,
    title: row.title,
    authors: row.authors ?? [],
    affiliations: row.affiliations ?? [],
    references: row.references ?? [],
    originalFilename: row.originalFilename,
    status: row.status,
    conferenceStyle: row.conferenceStyle,
    documentClass: row.documentClass,
    pageBudget: row.pageBudget ?? null,
    // Derived, not stored twice: extraction records it inside extractedContent
    // and this lifts it into the typed response.
    suggestedClass:
      (row.extractedContent as { suggestedClass?: unknown } | null)
        ?.suggestedClass ?? null,
    guidelinesText: row.guidelinesText,
    styleSpec: row.styleSpec,
    editorContent: row.editorContent,
    extractedContent: row.extractedContent,
    formattingIssues: row.formattingIssues ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDocumentSummary(
  row: Pick<
    typeof documentsTable.$inferSelect,
    | "id"
    | "title"
    | "originalFilename"
    | "status"
    | "conferenceStyle"
    | "documentClass"
    | "guidelinesText"
    | "styleSpec"
    | "formattingIssues"
    | "createdAt"
    | "updatedAt"
  >,
) {
  return {
    id: row.id,
    title: row.title,
    originalFilename: row.originalFilename,
    status: row.status,
    conferenceStyle: row.conferenceStyle,
    documentClass: row.documentClass,
    hasGuidelines: Boolean(row.guidelinesText),
    styleName: row.styleSpec?.name ?? null,
    issueCount: (row.formattingIssues as FormattingIssue[] | null)?.length ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Load a document that belongs to the caller, or respond 404.
 *
 * The owner filter is part of the lookup rather than a check afterwards, so
 * there is no path through this file that reads a row without it. Another
 * user's document returns 404, not 403 — a 403 would confirm that the id
 * exists and let someone enumerate the corpus.
 */
async function findDocumentOrRespond404(
  id: number,
  ownerId: number,
  res: import("express").Response,
) {
  if (!Number.isInteger(id) || id <= 0) {
    res.status(404).json(errorResponse("Document not found"));
    return null;
  }

  const [row] = await db
    .select()
    .from(documentsTable)
    .where(and(eq(documentsTable.id, id), eq(documentsTable.ownerId, ownerId)));

  if (!row) {
    res.status(404).json(errorResponse("Document not found"));
    return null;
  }
  return row;
}

/** WHERE clause for a mutation: id *and* owner, so a wrong owner updates zero
 *  rows instead of someone else's document. */
function ownedDocument(id: number, ownerId: number) {
  return and(eq(documentsTable.id, id), eq(documentsTable.ownerId, ownerId));
}

router.get("/examples/manuscript", (_req, res) => {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  res.json(
    toDocumentResponse({
      ...sampleDocumentValues(),
      id: 0,
      ownerId: 0,
      revision: 0,
      sourceFilePath: null,
      createdAt,
      updatedAt: createdAt,
    }),
  );
});

router.post("/documents/sample", heavyRateLimit, async (req, res, next) => {
  try {
    const [row] = await db
      .insert(documentsTable)
      .values({
        ...sampleDocumentValues(),
        ownerId: currentUserId(req),
      })
      .returning();
    res.status(201).json(toDocumentResponse(row));
  } catch (error) {
    next(error);
  }
});

router.get("/documents", async (req, res, next) => {
  try {
    const rows = await db
      .select({
        id: documentsTable.id,
        title: documentsTable.title,
        originalFilename: documentsTable.originalFilename,
        status: documentsTable.status,
        conferenceStyle: documentsTable.conferenceStyle,
        documentClass: documentsTable.documentClass,
        guidelinesText: documentsTable.guidelinesText,
        styleSpec: documentsTable.styleSpec,
        formattingIssues: documentsTable.formattingIssues,
        createdAt: documentsTable.createdAt,
        updatedAt: documentsTable.updatedAt,
      })
      .from(documentsTable)
      .where(eq(documentsTable.ownerId, currentUserId(req)))
      .orderBy(desc(documentsTable.updatedAt));
    res.json(rows.map(toDocumentSummary));
  } catch (err) {
    next(err);
  }
});

router.post(
  "/documents/upload",
  heavyRateLimit,
  upload.single("file"),
  async (req, res, next) => {
    const file = req.file;
    if (!file) {
      res.status(422).json(errorResponse("No file was uploaded."));
      return;
    }

    try {
      const { editorContent, extractedContent } = await extractDocument(
        file.path,
      );
      const title = path.basename(
        file.originalname,
        path.extname(file.originalname),
      );

      // Preserve the source's actual design (page size, margins, columns, base
      // typography) so the editor renders the real layout and export defaults to
      // it — until the user applies guidelines or a preset.
      const initialSpec =
        (extractedContent as { design?: Partial<StyleSpec> })?.design ?? null;

      const [row] = await db
        .insert(documentsTable)
        .values({
          ownerId: currentUserId(req),
          title,
          originalFilename: file.originalname,
          sourceFilePath: file.path,
          status: "extracted",
          conferenceStyle: null,
          styleSpec: initialSpec,
          editorContent,
          extractedContent,
          formattingIssues: [],
        })
        .returning();

      req.log.info({ documentId: row.id }, "Document extracted");
      res.status(201).json(toDocumentResponse(row));
    } catch (err) {
      fs.rm(file.path, { force: true }, () => {});
      if (respondToEngineError(err, req, res, "Extraction")) return;
      next(err);
    }
  },
);

router.get("/documents/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await findDocumentOrRespond404(id, currentUserId(req), res);
    if (!row) return;
    res.json(toDocumentResponse(row));
  } catch (err) {
    next(err);
  }
});

router.patch("/documents/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const ownerId = currentUserId(req);
    const body = UpdateDocumentBody.parse(req.body);
    const row = await findDocumentOrRespond404(id, ownerId, res);
    if (!row) return;

    const [updated] = await db
      .update(documentsTable)
      .set({
        revision: sql`${documentsTable.revision} + 1`,
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.editorContent !== undefined
          ? { editorContent: body.editorContent }
          : {}),
        // Both lists are replaced wholesale rather than merged: the editor owns
        // the ordering, and author order is meaningful.
        ...(body.authors !== undefined ? { authors: body.authors } : {}),
        ...(body.affiliations !== undefined
          ? { affiliations: body.affiliations }
          : {}),
        ...(body.references !== undefined
          ? { references: body.references }
          : {}),
      })
      .where(ownedDocument(id, ownerId))
      .returning();

    res.json(toDocumentResponse(updated));
  } catch (err) {
    next(err);
  }
});

router.delete("/documents/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const ownerId = currentUserId(req);
    const row = await findDocumentOrRespond404(id, ownerId, res);
    if (!row) return;

    await db.delete(documentsTable).where(ownedDocument(id, ownerId));
    if (row.sourceFilePath)
      fs.rm(row.sourceFilePath, { force: true }, () => {});
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.post("/documents/:id/analyze", aiRateLimit, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const ownerId = currentUserId(req);
    const row = await findDocumentOrRespond404(id, ownerId, res);
    if (!row) return;

    if (!row.conferenceStyle) {
      res
        .status(422)
        .json(
          errorResponse(
            "Select a conference style before running an analysis.",
          ),
        );
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      res
        .status(422)
        .json(
          errorResponse(
            "AI compliance analysis is not configured on this server (missing OPENAI_API_KEY).",
          ),
        );
      return;
    }

    const { analyzeDocumentCompliance } = await import("../lib/aiAnalysis");
    const issues = await analyzeDocumentCompliance(
      row.editorContent,
      row.conferenceStyle,
    );

    const [updated] = await db
      .update(documentsTable)
      .set({
        formattingIssues: issues,
        revision: sql`${documentsTable.revision} + 1`,
      })
      .where(ownedDocument(id, ownerId))
      .returning();

    res.json(toDocumentResponse(updated));
  } catch (err) {
    next(err);
  }
});

// Persist guidelines text + everything read out of it on a document. A custom
// spec supersedes the legacy conferenceStyle preset, so that is cleared and the
// document is marked as needing a (re)format.
//
// documentClass is only *filled in*, never overwritten: the guidelines describe
// typography and a page limit precisely, but the user's own choice of genre is
// more authoritative than a keyword match on "conference".
async function applyGuidelines(
  id: number,
  ownerId: number,
  guidelinesText: string,
  existingClass: string | null,
) {
  const { spec, pageBudget, documentClass } =
    await resolveGuidelines(guidelinesText);
  const [updated] = await db
    .update(documentsTable)
    .set({
      revision: sql`${documentsTable.revision} + 1`,
      guidelinesText,
      styleSpec: spec,
      conferenceStyle: null,
      // A stated limit is the venue's own rule and beats the class preset.
      ...(pageBudget ? { pageBudget } : {}),
      ...(!existingClass && documentClass ? { documentClass } : {}),
      status: "extracted",
    })
    .where(ownedDocument(id, ownerId))
    .returning();
  return updated;
}

// Guidelines text is stored verbatim and fed to the parser; cap it so a
// multi-megabyte paste cannot be used to bloat rows or stall the regex scan.
const MAX_GUIDELINES_CHARS = 200_000;

// Set guidelines from pasted text.
router.post("/documents/:id/guidelines", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const ownerId = currentUserId(req);
    const guidelines =
      typeof req.body?.guidelines === "string" ? req.body.guidelines : "";
    if (!guidelines.trim()) {
      res.status(422).json(errorResponse("Provide guidelines text."));
      return;
    }
    if (guidelines.length > MAX_GUIDELINES_CHARS) {
      res
        .status(422)
        .json(
          errorResponse(
            "Guidelines text is too long (200,000 character limit).",
          ),
        );
      return;
    }
    const row = await findDocumentOrRespond404(id, ownerId, res);
    if (!row) return;

    const updated = await applyGuidelines(
      id,
      ownerId,
      guidelines,
      row.documentClass,
    );
    res.json(toDocumentResponse(updated));
  } catch (err) {
    next(err);
  }
});

// Import a BibTeX library. Accepts a multipart .bib upload or a JSON body with
// a "bibtex" string — reference managers export files, but people also paste.
router.post(
  "/documents/:id/references/bibtex",
  heavyRateLimit,
  bibtexUpload.single("file"),
  async (req, res, next) => {
    const file = req.file;
    try {
      const id = Number(req.params.id);
      const ownerId = currentUserId(req);
      const row = await findDocumentOrRespond404(id, ownerId, res);
      if (!row) return;

      const source = file
        ? await fs.promises.readFile(file.path, "utf8")
        : typeof req.body?.bibtex === "string"
          ? req.body.bibtex
          : "";
      if (!source.trim()) {
        res.status(422).json(errorResponse("No BibTeX was supplied."));
        return;
      }

      if (source.length > MAX_GUIDELINES_CHARS) {
        res
          .status(422)
          .json(errorResponse("BibTeX is too long (200,000 character limit)."));
        return;
      }
      const imported = await importBibtex(source);
      if (imported.length === 0) {
        res
          .status(422)
          .json(
            errorResponse("No BibTeX entries could be read from that input."),
          );
        return;
      }

      // Merge by cite key: re-importing an updated library should correct the
      // entries it covers without discarding anything added by hand.
      const existing = (row.references ?? []) as Array<{ id: string }>;
      const merged = new Map(existing.map((ref) => [ref.id, ref]));
      for (const ref of imported as Array<{ id: string }>) {
        merged.set(ref.id, ref);
      }

      const [updated] = await db
        .update(documentsTable)
        .set({
          references: [...merged.values()],
          revision: sql`${documentsTable.revision} + 1`,
        })
        .where(ownedDocument(id, ownerId))
        .returning();

      req.log.info(
        { documentId: id, imported: imported.length },
        "BibTeX imported",
      );
      res.json(toDocumentResponse(updated));
    } catch (err) {
      if (respondToEngineError(err, req, res, "BibTeX import")) return;
      next(err);
    } finally {
      if (file) fs.rm(file.path, { force: true }, () => {});
    }
  },
);

// Set guidelines from an uploaded file (.txt/.md/.yaml read directly; .pdf/.docx
// text extracted via Docling).
router.post(
  "/documents/:id/guidelines/file",
  heavyRateLimit,
  guidelinesUpload.single("file"),
  async (req, res, next) => {
    const file = req.file;
    try {
      const id = Number(req.params.id);
      const ownerId = currentUserId(req);
      const row = await findDocumentOrRespond404(id, ownerId, res);
      if (!row) return;
      if (!file) {
        res.status(422).json(errorResponse("No guidelines file was uploaded."));
        return;
      }

      const ext = path.extname(file.originalname).toLowerCase();
      let text: string;
      if (GUIDELINES_TEXT_EXTS.includes(ext)) {
        text = await fs.promises.readFile(file.path, "utf8");
      } else {
        const { editorContent } = await extractDocument(file.path);
        text = tiptapToPlainText(editorContent);
      }

      if (!text.trim()) {
        res
          .status(422)
          .json(
            errorResponse("Could not read any guidelines text from that file."),
          );
        return;
      }

      const updated = await applyGuidelines(
        id,
        ownerId,
        text.slice(0, MAX_GUIDELINES_CHARS),
        row.documentClass,
      );
      res.json(toDocumentResponse(updated));
    } catch (err) {
      if (respondToEngineError(err, req, res, "Guidelines extraction")) return;
      next(err);
    } finally {
      if (file) fs.rm(file.path, { force: true }, () => {});
    }
  },
);

router.post("/documents/:id/format", heavyRateLimit, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const ownerId = currentUserId(req);
    const row = await findDocumentOrRespond404(id, ownerId, res);
    if (!row) return;
    if (
      req.body?.dryRun !== undefined &&
      typeof req.body.dryRun !== "boolean"
    ) {
      res.status(422).json(errorResponse("dryRun must be a boolean."));
      return;
    }
    if (
      req.body?.expectedRevision !== undefined &&
      (!Number.isInteger(req.body.expectedRevision) ||
        req.body.expectedRevision < 0)
    ) {
      res
        .status(422)
        .json(
          errorResponse("expectedRevision must be a non-negative integer."),
        );
      return;
    }
    if (
      req.body?.expectedRevision !== undefined &&
      req.body.expectedRevision !== row.revision
    ) {
      res
        .status(409)
        .json(
          errorResponse(
            "The manuscript changed. Close the preview and review the latest version before applying formatting.",
          ),
        );
      return;
    }

    // A class or preset in the body explicitly selects one (and supersedes any
    // custom guidelines spec); otherwise format with the document's stored
    // style — the class/guidelines spec if present, else its existing preset.
    // Reject an unknown class here rather than letting the engine fail on it:
    // a bad id is a client error, not an engine error.
    if (
      req.body?.documentClass !== undefined &&
      !asDocumentClass(req.body.documentClass)
    ) {
      res.status(422).json(errorResponse("Unknown document class."));
      return;
    }
    const bodyClass = asDocumentClass(req.body?.documentClass);
    const bodyStyle =
      typeof req.body?.conferenceStyle === "string"
        ? req.body.conferenceStyle
        : undefined;
    const selector: StyleSelector | null = bodyClass
      ? { documentClass: bodyClass }
      : bodyStyle
        ? { conferenceStyle: bodyStyle }
        : styleSelectorFor(row);

    if (!selector) {
      res
        .status(422)
        .json(
          errorResponse(
            "Apply guidelines or select a document class before formatting.",
          ),
        );
      return;
    }

    // The engine needs the extraction summary (page count, columns) to tell
    // whether the chosen class actually fits this manuscript.
    const result = await formatDocument(
      row.editorContent,
      selector,
      row.extractedContent,
      row.references,
    );

    const changes = {
      editorContent: result.editorContent,
      ...(bodyStyle ? { conferenceStyle: bodyStyle } : {}),
      ...(asDocumentClass(result.documentClass)
        ? { documentClass: asDocumentClass(result.documentClass) }
        : {}),
      styleSpec: result.styleSpec ?? row.styleSpec,
      status: "formatted" as const,
      formattingIssues: result.formattingIssues,
    };
    if (req.body?.dryRun === true) {
      res.json(toDocumentResponse({ ...row, ...changes }));
      return;
    }
    const updated = await db.transaction(async (tx) => {
      const [saved] = await tx
        .update(documentsTable)
        .set({ ...changes, revision: sql`${documentsTable.revision} + 1` })
        .where(
          and(
            ownedDocument(id, ownerId),
            eq(documentsTable.revision, row.revision),
          ),
        )
        .returning();
      if (!saved) return null;
      await tx.insert(documentVersionsTable).values({
        documentId: id,
        label: "Before formatting",
        snapshot: documentSnapshot(row),
      });
      return saved;
    });
    if (!updated) {
      res
        .status(409)
        .json(
          errorResponse(
            "The manuscript changed while formatting. Review it again before applying.",
          ),
        );
      return;
    }
    res.json(toDocumentResponse(updated));
  } catch (err) {
    if (respondToEngineError(err, req, res, "Formatting")) return;
    next(err);
  }
});

router.get("/documents/:id/versions", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!(await findDocumentOrRespond404(id, currentUserId(req), res))) return;
    const versions = await db
      .select({
        id: documentVersionsTable.id,
        label: documentVersionsTable.label,
        createdAt: documentVersionsTable.createdAt,
      })
      .from(documentVersionsTable)
      .innerJoin(
        documentsTable,
        eq(documentsTable.id, documentVersionsTable.documentId),
      )
      .where(ownedDocument(id, currentUserId(req)))
      .orderBy(desc(documentVersionsTable.id))
      .limit(50);
    res.json(versions);
  } catch (error) {
    next(error);
  }
});

router.post(
  "/documents/:id/versions/:versionId/restore",
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const ownerId = currentUserId(req);
      const row = await findDocumentOrRespond404(id, ownerId, res);
      if (!row) return;
      const versionId = Number(req.params.versionId);
      if (!Number.isSafeInteger(versionId) || versionId < 1) {
        res.status(404).json(errorResponse("Version not found."));
        return;
      }
      if (
        !Number.isInteger(req.body?.expectedRevision) ||
        req.body.expectedRevision < 0
      ) {
        res
          .status(422)
          .json(errorResponse("Provide the current document revision."));
        return;
      }
      const [version] = await db
        .select({ snapshot: documentVersionsTable.snapshot })
        .from(documentVersionsTable)
        .innerJoin(
          documentsTable,
          eq(documentsTable.id, documentVersionsTable.documentId),
        )
        .where(
          and(
            ownedDocument(id, ownerId),
            eq(documentVersionsTable.id, versionId),
          ),
        );
      if (!version) {
        res.status(404).json(errorResponse("Version not found."));
        return;
      }
      const restored = await db.transaction(async (tx) => {
        const [saved] = await tx
          .update(documentsTable)
          .set({
            ...version.snapshot,
            revision: sql`${documentsTable.revision} + 1`,
          })
          .where(
            and(
              ownedDocument(id, ownerId),
              eq(documentsTable.revision, row.revision),
              eq(documentsTable.revision, req.body.expectedRevision),
            ),
          )
          .returning();
        if (!saved) return null;
        await tx.insert(documentVersionsTable).values({
          documentId: id,
          label: "Before restoring a version",
          snapshot: documentSnapshot(row),
        });
        return saved;
      });
      if (!restored) {
        res
          .status(409)
          .json(
            errorResponse(
              "The manuscript changed. Reload it before restoring a version.",
            ),
          );
        return;
      }
      res.json(toDocumentResponse(restored));
    } catch (error) {
      next(error);
    }
  },
);

router.get("/documents/:id/export", heavyRateLimit, async (req, res, next) => {
  const temporaryFiles: string[] = [];
  const cleanup = () => {
    for (const file of temporaryFiles) fs.rm(file, { force: true }, () => {});
  };
  try {
    const id = Number(req.params.id);
    const row = await findDocumentOrRespond404(id, currentUserId(req), res);
    if (!row) return;

    const expected = req.query.expectedRevision;
    if (expected !== undefined) {
      if (
        typeof expected !== "string" ||
        !/^\d+$/.test(expected) ||
        !Number.isSafeInteger(Number(expected))
      ) {
        res
          .status(422)
          .json(
            errorResponse("expectedRevision must be a non-negative integer."),
          );
        return;
      }
      if (Number(expected) !== row.revision) {
        res
          .status(409)
          .json(
            errorResponse(
              "The manuscript changed before export. Refresh it and try again.",
            ),
          );
        return;
      }
    }

    const selector = styleSelectorFor(row);
    if (!selector) {
      res
        .status(422)
        .json(
          errorResponse(
            "Format the document with a conference style or guidelines before exporting.",
          ),
        );
      return;
    }

    const requestedFormat = req.query.format === "pdf" ? "pdf" : "docx";
    const docxPath = path.join(EXPORTS_DIR, `${row.id}-${randomUUID()}.docx`);
    const pdfPath =
      requestedFormat === "pdf"
        ? docxPath.replace(/\.docx$/, ".pdf")
        : undefined;

    temporaryFiles.push(docxPath);
    if (pdfPath) temporaryFiles.push(pdfPath);

    await exportDocument({
      editorContent: row.editorContent,
      title: row.title,
      authors: row.authors,
      affiliations: row.affiliations,
      references: row.references,
      style: selector,
      docxPath,
      pdfPath,
    });

    const outputPath = pdfPath ?? docxPath;
    // Rendering uses the row snapshot above, even if another edit finishes meanwhile.
    res.setHeader("X-Document-Revision", String(row.revision));
    res.download(
      outputPath,
      safeDownloadName(row.title, requestedFormat),
      (err) => {
        // The rendered files are throwaway: remove them once the response is on
        // the wire so the exports directory does not grow without bound.
        cleanup();
        if (err) next(err);
      },
    );
  } catch (err) {
    cleanup();
    if (respondToEngineError(err, req, res, "Export")) return;
    next(err);
  }
});

export default router;
