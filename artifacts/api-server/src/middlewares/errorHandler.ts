import type { ErrorRequestHandler, RequestHandler } from "express";
import { MulterError } from "multer";

interface ZodLikeError {
  name: string;
  issues: Array<{ message?: string }>;
}

/**
 * Duck-type rather than `instanceof ZodError`.
 *
 * The schemas come from @workspace/api-zod and @workspace/db, which may resolve
 * their own copies of zod. `instanceof` fails across module instances, and a
 * validation error silently becoming a 500 is exactly the bug that is hardest
 * to notice in production.
 */
function isZodError(err: unknown): err is ZodLikeError {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as ZodLikeError).name === "ZodError" &&
    Array.isArray((err as ZodLikeError).issues)
  );
}

/**
 * Terminal error handler.
 *
 * Express's default handler renders the stack trace into the response body
 * outside production, which leaks absolute paths and internal structure. This
 * logs the detail server-side and returns a message that is safe to show.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    // The response is already streaming (an export download, typically), so
    // the only correct move is to let Express destroy the connection.
    next(err);
    return;
  }

  if (isZodError(err)) {
    res.status(422).json({
      error: err.issues[0]?.message ?? "Request body failed validation.",
    });
    return;
  }

  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: "Request body must be valid JSON." });
    return;
  }
  if (err?.type === "entity.too.large") {
    res.status(413).json({ error: "Request body is too large." });
    return;
  }

  if (err instanceof MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "That file is too large."
        : "The uploaded file could not be accepted.";
    res.status(413).json({ error: message });
    return;
  }

  // multer's fileFilter rejects with a plain Error carrying a user-facing
  // message; surface it rather than turning a wrong file type into a 500.
  if (err instanceof Error && /only pdf|guidelines must be|bibtex must be/i.test(err.message)) {
    res.status(415).json({ error: err.message });
    return;
  }

  req.log?.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Something went wrong. Please try again." });
};

/** JSON 404 for anything that reached the API router without matching. */
export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "Not found" });
};
