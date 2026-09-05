import OpenAI from "openai";
import { z } from "zod/v4";
import {
  documentClassValues,
  type DocumentClassId,
  type PageBudget,
  type StyleSpec,
} from "@workspace/db";

/**
 * Read a call for papers with a model, into the *same typed shape* the presets
 * and the deterministic parser produce.
 *
 * The rule that makes this safe: the model never emits prose, and nothing it
 * returns is trusted until it has been through the schema below. A field that
 * fails validation is dropped, not coerced — a hallucinated 3pt body size
 * would otherwise render a document nobody can read.
 *
 * Lazily imported and key-gated by resolveGuidelines, so the server boots and
 * the whole feature works without OPENAI_API_KEY.
 */

// Bounds are the real defence. Anything outside them is a misread, not a venue
// with unusual taste.
const aiGuidelinesSchema = z.object({
  body_font: z.string().min(1).max(80).optional(),
  heading_font: z.string().min(1).max(80).optional(),
  body_size_pt: z.number().min(6).max(24).optional(),
  line_spacing: z.number().min(0.5).max(4).optional(),
  columns: z.number().int().min(1).max(3).optional(),
  margins_in: z
    .object({
      top: z.number().min(0.1).max(4),
      bottom: z.number().min(0.1).max(4),
      left: z.number().min(0.1).max(4),
      right: z.number().min(0.1).max(4),
    })
    .optional(),
  heading_case: z.enum(["title", "upper", "sentence", "none"]).optional(),
  citation_style: z.enum(["numeric", "author-date"]).optional(),
  required_sections: z.array(z.string().min(1).max(60)).max(20).optional(),
  page_budget: z
    .object({
      max_pages: z.number().min(1).max(500),
      includes_references: z.boolean(),
    })
    .nullish(),
  document_class: z.enum(documentClassValues).nullish(),
});

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    body_font: { type: ["string", "null"] },
    heading_font: { type: ["string", "null"] },
    body_size_pt: { type: ["number", "null"] },
    line_spacing: { type: ["number", "null"] },
    columns: { type: ["integer", "null"] },
    margins_in: {
      type: ["object", "null"],
      properties: {
        top: { type: "number" },
        bottom: { type: "number" },
        left: { type: "number" },
        right: { type: "number" },
      },
      required: ["top", "bottom", "left", "right"],
      additionalProperties: false,
    },
    heading_case: { type: ["string", "null"], enum: ["title", "upper", "sentence", "none", null] },
    citation_style: { type: ["string", "null"], enum: ["numeric", "author-date", null] },
    required_sections: { type: ["array", "null"], items: { type: "string" } },
    page_budget: {
      type: ["object", "null"],
      properties: {
        max_pages: { type: "number" },
        includes_references: { type: "boolean" },
      },
      required: ["max_pages", "includes_references"],
      additionalProperties: false,
    },
    document_class: {
      type: ["string", "null"],
      enum: [...documentClassValues, null],
    },
  },
  required: [
    "body_font",
    "heading_font",
    "body_size_pt",
    "line_spacing",
    "columns",
    "margins_in",
    "heading_case",
    "citation_style",
    "required_sections",
    "page_budget",
    "document_class",
  ],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = [
  "You extract formatting requirements from an academic call for papers or",
  "author guidelines. Report only what the text actually states. Use null for",
  "anything it does not state — do not infer a venue's usual practice, and do",
  "not fill in defaults. Page limits: set includes_references from the text",
  "('excluding references' means false); if the text does not say, use true.",
  "document_class: choose one only when the text identifies both the venue",
  "family and the kind of document, or when it is plainly a thesis or",
  "dissertation.",
].join(" ");

export interface AiGuidelines {
  spec: Partial<StyleSpec>;
  pageBudget: PageBudget | null;
  documentClass: DocumentClassId | null;
  detected: string[];
}

/** Strip nulls so the schema's `.optional()` fields behave as "absent". */
function withoutNulls(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== null && v !== undefined),
  );
}

export async function extractGuidelines(
  text: string,
): Promise<AiGuidelines | null> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await client.chat.completions.create({
    model: "gpt-5-mini",
    max_completion_tokens: 1200,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: text.slice(0, 12000) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "formatting_guidelines", schema: RESPONSE_SCHEMA, strict: true },
    },
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) return null;

  const parsed = aiGuidelinesSchema.safeParse(withoutNulls(JSON.parse(raw)));
  if (!parsed.success) return null;

  const { page_budget, document_class, ...spec } = parsed.data;
  const detected = Object.keys(spec).map((field) => `${field} (read by model)`);

  const pageBudget: PageBudget | null = page_budget
    ? {
        maxPages: page_budget.max_pages,
        includesReferences: page_budget.includes_references,
      }
    : null;
  if (pageBudget) {
    detected.push(
      `page limit -> ${pageBudget.maxPages} pages ${
        pageBudget.includesReferences ? "including" : "excluding"
      } references (read by model)`,
    );
  }

  return {
    spec: spec as Partial<StyleSpec>,
    pageBudget,
    documentClass: document_class ?? null,
    detected,
  };
}
