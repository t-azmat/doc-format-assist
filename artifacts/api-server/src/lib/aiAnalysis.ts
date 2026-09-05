import { randomUUID } from "crypto";
import OpenAI from "openai";
import type { FormattingIssue } from "@workspace/db";

// Lazily constructed so the server can boot without OPENAI_API_KEY set; the
// /documents/:id/analyze route checks for the key before importing this
// module and calling analyzeDocumentCompliance.
function getClient(): OpenAI {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

const STYLE_NAMES: Record<string, string> = {
  ieee: "IEEE Conference",
  apa: "APA 7th Edition",
  acm: "ACM Conference",
};

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["error", "warning", "info"] },
          message: { type: "string" },
          location: { type: "string" },
        },
        required: ["severity", "message"],
        additionalProperties: false,
      },
    },
  },
  required: ["issues"],
  additionalProperties: false,
} as const;

export async function analyzeDocumentCompliance(
  editorContent: unknown,
  conferenceStyleId: string,
): Promise<FormattingIssue[]> {
  const client = getClient();
  const styleName = STYLE_NAMES[conferenceStyleId] ?? conferenceStyleId;

  const response = await client.chat.completions.create({
    model: "gpt-5-mini",
    max_completion_tokens: 2000,
    messages: [
      {
        role: "system",
        content:
          "You are an academic paper formatting reviewer. Given a paper's content as TipTap/ProseMirror JSON and a target conference style, list concrete formatting/structural compliance issues (missing sections, citation style mismatches, abstract/keyword issues, heading structure problems). Be specific and concise. Respond only with JSON matching the provided schema.",
      },
      {
        role: "user",
        content: `Target conference style: ${styleName} (${conferenceStyleId}).\n\nDocument content (TipTap JSON):\n${JSON.stringify(editorContent).slice(0, 12000)}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "compliance_issues", schema: RESPONSE_SCHEMA, strict: true },
    },
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) return [];

  const parsed = JSON.parse(raw) as {
    issues: Array<{ severity: "error" | "warning" | "info"; message: string; location?: string }>;
  };

  return parsed.issues.map((issue) => ({
    id: randomUUID(),
    severity: issue.severity,
    message: issue.message,
    location: issue.location ?? null,
  }));
}
