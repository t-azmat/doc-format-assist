import type { DocumentClassId, PageBudget, StyleSpec } from "@workspace/db";
import { parseGuidelines } from "./guidelinesParser";

export interface ResolvedGuidelines {
  spec: Partial<StyleSpec>;
  pageBudget: PageBudget | null;
  documentClass: DocumentClassId | null;
  detected: string[];
  source: "deterministic" | "ai";
}

/**
 * Turn raw guidelines text into a (partial) StyleSpec plus the non-typographic
 * constraints a call for papers states — a page limit, and which kind of
 * document it is asking for.
 *
 * Hybrid: the deterministic parser always runs, and when an LLM key is
 * configured the model fills only the fields the parser could not read. The
 * model's output is validated against the same shape before anything is kept,
 * so an unavailable or misbehaving model degrades to the deterministic result
 * rather than corrupting the spec.
 */
export async function resolveGuidelines(
  text: string,
): Promise<ResolvedGuidelines> {
  const parsed = parseGuidelines(text);
  const base: ResolvedGuidelines = {
    spec: parsed.spec,
    pageBudget: parsed.pageBudget ?? null,
    documentClass: parsed.documentClass ?? null,
    detected: parsed.detected,
    source: "deterministic",
  };

  if (!process.env.OPENAI_API_KEY || !text.trim()) return base;

  try {
    const { extractGuidelines } = await import("./guidelinesAi");
    const ai = await extractGuidelines(text);
    if (!ai) return base;

    // The deterministic reading wins wherever it found something: it is exact
    // where it fires, and the model is only filling gaps.
    const merged: ResolvedGuidelines = {
      spec: { ...ai.spec, ...parsed.spec },
      pageBudget: base.pageBudget ?? ai.pageBudget ?? null,
      documentClass: base.documentClass ?? ai.documentClass ?? null,
      detected: [...parsed.detected, ...ai.detected],
      source: "ai",
    };
    return merged;
  } catch {
    // Any failure — no network, rate limit, malformed response — falls back.
    return base;
  }
}
