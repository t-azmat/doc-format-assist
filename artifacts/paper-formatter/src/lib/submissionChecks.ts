import type { Document } from "@workspace/api-client-react";

export interface SubmissionCheck {
  id: string;
  title: string;
  status: "passed" | "failed" | "not_checked";
  detail: string;
  source: string;
}

export interface ManuscriptNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: ManuscriptNode[];
}

export function nodeText(node: ManuscriptNode): string {
  return node.text ?? (node.content ?? []).map(nodeText).join("");
}

export function submissionChecks(
  doc: Pick<Document, "editorContent" | "references" | "guidelinesText">,
): SubmissionCheck[] {
  const content = (doc.editorContent as ManuscriptNode | null)?.content ?? [];
  const headings = content.filter((n) => n.type === "heading");
  const results: SubmissionCheck[] = [
    {
      id: "structure",
      title: "Section headings",
      status: headings.length ? "passed" : "failed",
      detail: headings.length
        ? `${headings.length} top-level headings found. This does not verify venue-specific sections.`
        : "No top-level headings found. Mark section titles as headings in the editor.",
      source: "Saved manuscript structure",
    },
  ];

  const cited = new Set<string>();
  function walk(nodes: ManuscriptNode[]) {
    for (const node of nodes) {
      if (node.type === "citation" || node.type === "cite") {
        const ids = node.attrs?.ids;
        if (Array.isArray(ids)) ids.forEach((id) => cited.add(String(id)));
      }
      walk(node.content ?? []);
    }
  }
  walk(content);
  const library = new Set((doc.references ?? []).map((r) => r.id));
  const missing = [...cited].filter((id) => !library.has(id));
  results.push({
    id: "citations",
    title: "Citation links",
    status: !cited.size ? "not_checked" : missing.length ? "failed" : "passed",
    detail: !cited.size
      ? "No structured citations found. Plain-text citation markers cannot be verified by this check."
      : missing.length
        ? `Missing reference entries: ${missing.slice(0, 10).join(", ")}.`
        : `All ${cited.size} cited IDs resolve to entries in the reference library.`,
    source:
      "Saved manuscript and reference library; bibliographic accuracy is not checked",
  });

  // Only explicit maximums are recognized. Conflicting rules remain unverified.
  const rules = (doc.guidelinesText ?? "")
    .split(/\n|(?<=[.!?])\s+/)
    .filter(
      (line) =>
        !/\b(?:if|unless|except|example|recommended|may)\b|\b(?:no|without)\s+(?:word\s+)?(?:limit|maximum)\b/i.test(
          line,
        ),
    )
    .map((line) => ({
      line: line.trim(),
      match: line.match(
        /\babstract\b[^.!?\n]{0,80}?\b(?:must not exceed|no more than|maximum(?: of)?|up to|limit(?: of)?)\s*:?\s*(\d{1,4})\s+words\b/i,
      ),
    }))
    .filter((r): r is { line: string; match: RegExpMatchArray } => !!r.match);
  const limits = new Set(rules.map((r) => Number(r.match[1])));
  const abstractIndex = content.findIndex(
    (n) =>
      n.type === "heading" && nodeText(n).trim().toLowerCase() === "abstract",
  );
  const abstract: ManuscriptNode[] = [];
  if (abstractIndex >= 0) {
    for (const node of content.slice(abstractIndex + 1)) {
      if (node.type === "heading") break;
      abstract.push(node);
    }
  }
  const text = abstract.map(nodeText).join(" ").trim();
  const count = text ? text.split(/\s+/u).length : 0;
  const limit =
    limits.size === 1 && [...limits][0] > 0 ? [...limits][0] : undefined;
  results.push({
    id: "abstract",
    title: "Abstract word limit",
    status:
      limit === undefined || !count
        ? "not_checked"
        : count > limit
          ? "failed"
          : "passed",
    detail:
      limits.size > 1
        ? "Conflicting abstract limits were found. Confirm which rule applies."
        : limit === undefined
          ? "No supported, explicit abstract maximum was found in your guidelines."
          : !count
            ? "Could not locate text under an Abstract heading."
            : `${count} whitespace-separated words; stated maximum ${limit}. A venue may count words differently.`,
    source: rules.length
      ? `Your supplied guidelines: “${rules.map((r) => r.line).join(" / ")}”`
      : "Your supplied guidelines",
  });

  results.push(
    {
      id: "layout",
      title: "Exported page count and layout",
      status: "not_checked",
      detail:
        "The editor's page meter is an estimate. Review the exported PDF for final pagination, margins, fonts, and overflow.",
      source: "Requires inspection of the exported file",
    },
    {
      id: "preservation",
      title: "Import fidelity",
      status: "not_checked",
      detail:
        "Compare equations, figures, tables, and references against the original file. Their presence alone does not establish accurate extraction.",
      source: "Requires comparison with the original manuscript",
    },
    {
      id: "venue",
      title: "Complete venue requirements",
      status: "not_checked",
      detail:
        "These checks do not certify submission compliance. Review the current venue instructions, including anonymity and required declarations.",
      source: "Requires the venue's current submission instructions",
    },
  );
  return results;
}
