import type { Document } from "@workspace/api-client-react";
import { nodeText, type ManuscriptNode } from "./submissionChecks";

export function formatReview(before: Document, after: Document) {
  const original = (before.editorContent as ManuscriptNode)?.content ?? [];
  const formatted = (after.editorContent as ManuscriptNode)?.content ?? [];
  const blocks = Array.from(
    { length: Math.max(original.length, formatted.length) },
    (_, i) => ({
      position: i + 1,
      before: original[i] ? nodeText(original[i]) : "",
      after: formatted[i] ? nodeText(formatted[i]) : "",
      changed: JSON.stringify(original[i]) !== JSON.stringify(formatted[i]),
    }),
  ).filter((block) => block.changed);
  const keys = new Set([
    ...Object.keys(before.styleSpec ?? {}),
    ...Object.keys(after.styleSpec ?? {}),
  ]);
  const styles = [...keys]
    .filter(
      (key) =>
        JSON.stringify(
          (before.styleSpec as Record<string, unknown> | null)?.[key],
        ) !==
        JSON.stringify(
          (after.styleSpec as Record<string, unknown> | null)?.[key],
        ),
    )
    .map((key) => ({
      name: key.replaceAll("_", " "),
      before:
        JSON.stringify(
          (before.styleSpec as Record<string, unknown> | null)?.[key],
        ) ?? "Not set",
      after:
        JSON.stringify(
          (after.styleSpec as Record<string, unknown> | null)?.[key],
        ) ?? "Not set",
    }));
  return { blocks, styles };
}
