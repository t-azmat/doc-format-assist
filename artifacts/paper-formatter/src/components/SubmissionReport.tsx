import type { Document } from "@workspace/api-client-react";
import { submissionChecks } from "@/lib/submissionChecks";

const labels = {
  passed: "Passed",
  failed: "Failed",
  not_checked: "Not checked",
};
const colors = {
  passed: "text-success",
  failed: "text-destructive",
  not_checked: "text-muted-foreground",
};

export function SubmissionReport({
  document,
  mode = "saved",
}: {
  document: Document;
  mode?: "saved" | "sample";
}) {
  const checks = submissionChecks(document);
  return (
    <section
      aria-label="Submission checks"
      className="border-b border-border px-4 py-4"
    >
      <h2 className="text-sm font-medium">Submission checks</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {mode === "sample"
          ? "Updates as you edit the sample. Nothing is saved."
          : "Based on your saved draft. Expand a check to see its evidence and limits."}
      </p>
      <div className="mt-3 divide-y divide-border">
        {checks.map((check) => (
          <details key={check.id} className="py-2">
            <summary className="cursor-pointer text-xs">
              {check.title}{" "}
              <span className={`ml-1 font-medium ${colors[check.status]}`}>
                — {labels[check.status]}
              </span>
            </summary>
            <p className="mt-2 text-xs leading-relaxed">{check.detail}</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">
              {mode === "sample"
                ? check.source.replaceAll(
                    "Saved manuscript",
                    "Sample manuscript",
                  )
                : check.source}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
