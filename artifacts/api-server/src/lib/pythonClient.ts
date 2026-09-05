import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type { StyleSpec } from "@workspace/db";

// The formatting engine lives in `python/` as standalone scripts, invoked as
// subprocesses with JSON over stdin/stdout. This avoids running a separate
// always-on Python microservice/workflow while keeping the engine (Docling
// extraction, style rules, docx/pdf export) in Python where those libraries
// live.
// import.meta.dirname is artifacts/api-server/dist at runtime (bundled) or
// artifacts/api-server/src in source form — both are one level below
// artifacts/api-server, so a single ".." reaches the package root.
const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");
const PYTHON_DIR = path.join(PACKAGE_ROOT, "python");

// Resolve the Python interpreter cross-platform. Precedence:
//   1. PYTHON_BIN env override (absolute path or a command on PATH)
//   2. A project virtualenv at <repo>/.venv (created via `uv sync` or pip)
//   3. "python" on Windows (avoids the py3 Microsoft Store alias stub),
//      "python3" elsewhere
const isWindows = process.platform === "win32";
const REPO_ROOT = path.resolve(PACKAGE_ROOT, "..", "..");
const VENV_PYTHON = isWindows
  ? path.join(REPO_ROOT, ".venv", "Scripts", "python.exe")
  : path.join(REPO_ROOT, ".venv", "bin", "python");

const PYTHON_BIN =
  process.env.PYTHON_BIN ??
  (fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : isWindows ? "python" : "python3");

class PythonEngineError extends Error {}

/** The engine ran too long and was killed. Distinct from a normal failure
 *  because the caller should answer 504 and the user should retry. */
class PythonTimeoutError extends PythonEngineError {}

/** Too many documents are already being processed. The caller should answer
 *  503 with Retry-After rather than pile another process onto a loaded box. */
class PythonBusyError extends PythonEngineError {}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

// Docling's layout inference on a long PDF is genuinely slow, but "slow"
// has to have a ceiling: without one, a single pathological upload holds a
// request open forever and keeps a Python process resident.
const TIMEOUT_MS = positiveInt(process.env.PYTHON_TIMEOUT_MS, 5 * 60_000);

// One at a time by default. A single Docling extraction of a half-megabyte PDF
// peaks around 2GB of RSS; two of them on a 16GB laptop that is also running an
// editor, a browser and Postgres pushes the machine into swap, and the symptom
// is the whole desktop freezing rather than a slow upload. Raise it only on a
// box with memory to spare.
const MAX_CONCURRENCY = positiveInt(process.env.PYTHON_MAX_CONCURRENCY, 1);

// Docling's inference runs on torch, which by default grabs half the cores
// (6 of 12 here). That is enough to make the UI unresponsive on its own, so
// leave the machine some room. These have to be set as environment variables
// because the thread pools are sized when torch is first imported.
const TORCH_THREADS = positiveInt(
  process.env.PYTHON_TORCH_THREADS,
  Math.max(1, Math.floor((os.cpus()?.length ?? 4) / 4)),
);

// How long a request will wait for a slot before giving up. Failing fast with
// a 503 is better than holding connections open behind a long queue.
const QUEUE_TIMEOUT_MS = positiveInt(process.env.PYTHON_QUEUE_TIMEOUT_MS, 30_000);
const MAX_QUEUE = positiveInt(process.env.PYTHON_MAX_QUEUE, 10);

// Grace period between asking a runaway process to stop and killing it.
const SIGKILL_GRACE_MS = 5_000;

interface Waiter {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

let active = 0;
const waiting: Waiter[] = [];

function acquireSlot(): Promise<void> {
  if (active < MAX_CONCURRENCY) {
    active += 1;
    return Promise.resolve();
  }

  if (waiting.length >= MAX_QUEUE) {
    return Promise.reject(new PythonBusyError(
      "The formatting engine is busy. Please try again in a moment.",
    ));
  }

  return new Promise<void>((resolve, reject) => {
    const waiter: Waiter = {
      resolve,
      reject,
      timer: setTimeout(() => {
        const index = waiting.indexOf(waiter);
        if (index !== -1) waiting.splice(index, 1);
        reject(
          new PythonBusyError(
            "The formatting engine is busy processing other documents. Please try again in a moment.",
          ),
        );
      }, QUEUE_TIMEOUT_MS),
    };
    waiting.push(waiter);
  });
}

function releaseSlot(): void {
  const next = waiting.shift();
  if (next) {
    clearTimeout(next.timer);
    next.resolve();
    return;
  }
  active = Math.max(0, active - 1);
}

/** Exposed for health reporting: how loaded the engine currently is. */
export function engineLoad(): {
  active: number;
  queued: number;
  maxConcurrency: number;
} {
  return { active, queued: waiting.length, maxConcurrency: MAX_CONCURRENCY };
}

function spawnPython(
  script: string,
  args: string[],
  stdin?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [path.join(PYTHON_DIR, script), ...args], {
      cwd: PYTHON_DIR,
      // Force UTF-8 for the subprocess stdio. On Windows, Python otherwise
      // decodes stdin using the locale code page (e.g. cp1252), corrupting the
      // UTF-8 JSON we send into lone surrogates that then fail to re-encode
      // (the docx export crash: "surrogates not allowed").
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
        // Thread pool sizes are fixed when torch/numpy are imported, so they
        // must arrive as environment, not be set from inside the script.
        OMP_NUM_THREADS: String(TORCH_THREADS),
        MKL_NUM_THREADS: String(TORCH_THREADS),
        NUMEXPR_NUM_THREADS: String(TORCH_THREADS),
        TOKENIZERS_PARALLELISM: "false",
      },
    });

    // Extraction is background work: it should never win a scheduling contest
    // against the window the user is typing in. Best-effort — unsupported
    // platforms and permission failures are not worth failing the request over.
    try {
      if (child.pid !== undefined) {
        os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
      }
    } catch {
      // Nothing to do; the process still runs, just at normal priority.
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // A wedged interpreter can ignore SIGTERM (and on Windows there is no
      // real signal at all), so escalate rather than leak the process.
      setTimeout(() => {
        if (!child.killed || child.exitCode === null) child.kill("SIGKILL");
      }, SIGKILL_GRACE_MS).unref();
    }, TIMEOUT_MS);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn();
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      // Keep the final diagnostic without accumulating model progress logs.
      stderr = (stderr + chunk.toString()).slice(-64 * 1024);
    });

    child.on("error", (err) =>
      finish(() => reject(new PythonEngineError(err.message))),
    );

    child.on("close", (code) => {
      finish(() => {
        if (timedOut) {
          reject(
            new PythonTimeoutError(
              `The formatting engine took longer than ${Math.round(
                TIMEOUT_MS / 1000,
              )}s and was stopped. Try a smaller document.`,
            ),
          );
          return;
        }
        if (code !== 0) {
          const message =
            extractErrorMessage(stderr) ?? stderr.trim() ?? `exited with code ${code}`;
          reject(new PythonEngineError(message));
          return;
        }
        resolve(stdout);
      });
    });

    if (stdin !== undefined) {
      // A killed child closes stdin early; without this handler the resulting
      // EPIPE surfaces as an unhandled error event and takes the server down.
      child.stdin.on("error", () => {});
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

async function runPython(
  script: string,
  args: string[],
  stdin?: string,
): Promise<string> {
  await acquireSlot();
  try {
    return await spawnPython(script, args, stdin);
  } finally {
    releaseSlot();
  }
}

function extractErrorMessage(stderr: string): string | null {
  const trimmed = stderr.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed.split("\n").pop() ?? trimmed);
    if (typeof parsed?.error === "string") return parsed.error;
  } catch {
    // stderr wasn't JSON (e.g. a Python traceback) — fall through to raw text.
  }
  return trimmed;
}

export interface ExtractResult {
  editorContent: unknown;
  extractedContent: unknown;
}

export async function extractDocument(filePath: string): Promise<ExtractResult> {
  const stdout = await runPython("extract.py", [filePath]);
  return JSON.parse(stdout);
}

// Selects which style the Python engine applies: a custom spec (from
// guidelines) takes precedence over a built-in conference preset id.
export type StyleSelector = {
  documentClass?: string | null;
  conferenceStyle?: string | null;
  styleSpec?: Partial<StyleSpec> | null;
};

function stylePayload(style: StyleSelector): Record<string, unknown> {
  // A class and a guidelines spec are not exclusive: the class supplies the
  // structure, the spec overrides typography. The engine merges them.
  const payload: Record<string, unknown> = {};
  if (style.documentClass) payload.documentClass = style.documentClass;
  if (style.styleSpec) payload.styleSpec = style.styleSpec;
  if (!style.documentClass && !style.styleSpec && style.conferenceStyle) {
    payload.conferenceStyle = style.conferenceStyle;
  }
  if (Object.keys(payload).length === 0) {
    throw new PythonEngineError(
      "No style provided: apply guidelines or select a document class.",
    );
  }
  return payload;
}

export interface FormatResult {
  editorContent: unknown;
  formattingIssues: Array<{
    id: string;
    severity: "error" | "warning" | "info";
    message: string;
    location?: string | null;
  }>;
  // The full StyleSpec the engine actually applied (preset resolved to concrete
  // values, or the guidelines spec merged over defaults) — stored so the editor
  // can render the document in that format.
  styleSpec?: Partial<StyleSpec>;
  // The class the engine resolved, so a legacy conferenceStyle document records
  // which class it was actually formatted as.
  documentClass?: string | null;
  pageBudget?: { maxPages: number; includesReferences: boolean } | null;
}

export async function formatDocument(
  editorContent: unknown,
  style: StyleSelector,
  extractedContent?: unknown,
  references?: unknown,
): Promise<FormatResult> {
  const stdout = await runPython(
    "format.py",
    [],
    // extractedContent carries page count and column detection, which is how
    // the engine judges whether the selected class fits the manuscript.
    JSON.stringify({
      editorContent,
      extractedContent,
      references: references ?? [],
      ...stylePayload(style),
    }),
  );
  return JSON.parse(stdout);
}

/** Convert a .bib file to CSL-JSON. Import path only — nothing stores BibTeX. */
export async function importBibtex(source: string): Promise<unknown[]> {
  const stdout = await runPython("bibimport.py", [], source);
  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed.references) ? parsed.references : [];
}

export async function exportDocument(params: {
  editorContent: unknown;
  title: string;
  authors?: unknown;
  affiliations?: unknown;
  references?: unknown;
  style: StyleSelector;
  docxPath: string;
  pdfPath?: string;
}): Promise<void> {
  const args = [params.docxPath];
  if (params.pdfPath) {
    args.push("--pdf", params.pdfPath);
  }
  await runPython(
    "export.py",
    args,
    JSON.stringify({
      editorContent: params.editorContent,
      title: params.title,
      // The engine renders the author block from these; camelCase here, unlike
      // StyleSpec's deliberate snake_case.
      authors: params.authors ?? [],
      affiliations: params.affiliations ?? [],
      // The engine resolves citation ids to markers and builds the
      // bibliography from these, per style.
      references: params.references ?? [],
      ...stylePayload(params.style),
    }),
  );
}

export { PythonEngineError, PythonTimeoutError, PythonBusyError };
