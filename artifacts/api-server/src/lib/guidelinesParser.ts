import type {
  StyleSpec,
  HeadingCase,
  CitationStyle,
  DocumentClassId,
  PageBudget,
} from "@workspace/db";

// Deterministic guidelines interpreter. Turns free-text or structured
// ("key: value") formatting guidelines into a *partial* StyleSpec containing
// only the fields it could confidently detect. The Python engine
// (styles.spec_from_dict) fills every unspecified field from its BASE_SPEC, so
// this file is intentionally NOT a source of default values.

export interface ParsedGuidelines {
  spec: Partial<StyleSpec>;
  // A page limit is not typography, so it does not live on StyleSpec — it is
  // stored on the document and drives the page meter.
  pageBudget?: PageBudget | null;
  // The class the guidelines describe, when they say enough to tell.
  documentClass?: DocumentClassId | null;
  // Human-readable summary of what was understood, for surfacing back to the
  // user (e.g. "body font -> Arial").
  detected: string[];
}

// Calls for papers state page limits in a small number of shapes. Each captures
// the number; scope (whether references count) is read separately below.
const PAGE_LIMIT_PATTERNS = [
  /(?:maximum|max\.?|no more than|not exceed|up to|limited to|at most)\s+(?:of\s+)?(\d{1,2})\s*(?:pages?|pp\b)/i,
  /(\d{1,2})[-\s]?page\s+(?:limit|maximum|max\b)/i,
  /page\s*(?:limit|count|budget)\s*[:=]\s*(\d{1,2})/i,
  /(?:limit|maximum)\s+of\s+(\d{1,2})\s*(?:pages?|pp\b)/i,
];

// "8 pages including references" and "8 pages excluding references" differ by
// about two pages of work, so the distinction is parsed rather than assumed.
const EXCLUDES_REFERENCES =
  /(?:excluding|not\s+including|exclusive\s+of|without)\s+(?:the\s+)?(?:references|bibliography|citations)|references\s+(?:are\s+)?not\s+(?:counted|included)|(?:references|bibliography)\s+(?:do|does)\s+not\s+count/i;
const INCLUDES_REFERENCES =
  /(?:including|inclusive\s+of)\s+(?:the\s+)?(?:references|bibliography|citations)|references\s+(?:are\s+)?included/i;

function parsePageBudget(text: string): PageBudget | null {
  for (const pattern of PAGE_LIMIT_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const maxPages = Number(match[1]);
    if (!Number.isFinite(maxPages) || maxPages <= 0) continue;

    // Read the scope from the sentence around the limit, not the whole
    // document — a later "excluding appendices" elsewhere is not about this.
    const at = match.index ?? 0;
    const window = text.slice(Math.max(0, at - 120), at + 200);
    const excludes = EXCLUDES_REFERENCES.test(window);
    const includes = INCLUDES_REFERENCES.test(window);

    return {
      maxPages,
      // Default to counting them: it is the tighter reading, and being wrong
      // that way costs the author nothing at submission.
      includesReferences: excludes ? false : includes ? true : true,
    };
  }
  return null;
}

const FAMILY_PATTERNS: Array<[RegExp, string]> = [
  [/\bieee\b|\btransactions on\b/i, "ieee"],
  [/\bacm\b|\bsigchi\b|\bsigplan\b|\bproceedings of the acm\b/i, "acm"],
  [/\bapa\b|american psychological/i, "apa"],
];

const GENRE_PATTERNS: Array<[RegExp, string]> = [
  [/\bdissertation\b|\bthesis\b/i, "thesis"],
  [/\bconference\b|\bproceedings\b|\bworkshop\b|\bsymposium\b|call for papers/i, "conference_paper"],
  [/\bjournal\b|\btransactions\b|\bmanuscript submission\b/i, "journal_article"],
];

// Mirrors _CLASS_FOR in python/infer.py. A thesis lands on the dissertation
// class whatever the family: there is no IEEE or ACM thesis class.
const CLASS_FOR: Record<string, DocumentClassId> = {
  "ieee:conference_paper": "ieee-conference",
  "ieee:journal_article": "ieee-journal",
  "ieee:thesis": "apa-dissertation",
  "acm:conference_paper": "acm-conference",
  "acm:journal_article": "acm-conference",
  "acm:thesis": "apa-dissertation",
  "apa:conference_paper": "apa-journal",
  "apa:journal_article": "apa-journal",
  "apa:thesis": "apa-dissertation",
};

function parseDocumentClass(text: string): DocumentClassId | null {
  const genre = GENRE_PATTERNS.find(([pattern]) => pattern.test(text))?.[1];
  if (!genre) return null;

  // A thesis is identifiable from genre alone; anything else needs a family,
  // because "conference" says nothing about which template.
  if (genre === "thesis") return "apa-dissertation";

  const family = FAMILY_PATTERNS.find(([pattern]) => pattern.test(text))?.[1];
  if (!family) return null;

  return CLASS_FOR[`${family}:${genre}`] ?? null;
}

const KNOWN_FONTS = [
  "Times New Roman",
  "Arial",
  "Calibri",
  "Helvetica",
  "Georgia",
  "Cambria",
  "Garamond",
  "Verdana",
  "Book Antiqua",
  "Palatino",
  "Linux Libertine",
];

function toInchesFromCm(cm: number): number {
  return Math.round((cm / 2.54) * 1000) / 1000;
}

function parseSpacing(value: string): number | null {
  const v = value.toLowerCase();
  if (/\bsingle\b/.test(v)) return 1.0;
  if (/\bone[- ]and[- ]a[- ]half\b|\b1\.5\b/.test(v)) return 1.5;
  if (/\bdouble\b/.test(v)) return 2.0;
  const num = v.match(/(\d+(?:\.\d+)?)/);
  return num ? Number(num[1]) : null;
}

function parseColumns(value: string): number | null {
  const v = value.toLowerCase();
  if (/\b(one|single)\b/.test(v)) return 1;
  if (/\b(two|double)\b/.test(v)) return 2;
  const num = v.match(/(\d+)/);
  return num ? Number(num[1]) : null;
}

function parseMarginInches(value: string): number | null {
  const v = value.toLowerCase();
  const cm = v.match(/(\d+(?:\.\d+)?)\s*cm/);
  if (cm) return toInchesFromCm(Number(cm[1]));
  const mm = v.match(/(\d+(?:\.\d+)?)\s*mm/);
  if (mm) return toInchesFromCm(Number(mm[1]) / 10);
  const inch = v.match(/(\d+(?:\.\d+)?)\s*(?:in\b|inch|"|”)/);
  if (inch) return Number(inch[1]);
  const bare = v.match(/(\d+(?:\.\d+)?)/);
  return bare ? Number(bare[1]) : null;
}

function parseHeadingCase(value: string): HeadingCase | null {
  const v = value.toLowerCase();
  if (/\btitle\b/.test(v)) return "title";
  if (/\ball[- ]?caps\b|\buppercase\b|\bupper\b/.test(v)) return "upper";
  if (/\bsentence\b/.test(v)) return "sentence";
  if (/\bnone\b|\bas[- ]is\b|\bpreserve\b/.test(v)) return "none";
  return null;
}

function parseCitationStyle(value: string): CitationStyle | null {
  const v = value.toLowerCase();
  if (/\bauthor[- ]date\b|\bapa\b|\bharvard\b|\bnamed?\b/.test(v)) {
    return "author-date";
  }
  if (/\bnumeric\b|\bnumbered?\b|\bieee\b|\bacm\b|\bvancouver\b|\[\d+\]/.test(v)) {
    return "numeric";
  }
  return null;
}

function parseFont(value: string): string | null {
  const lower = value.toLowerCase();
  for (const font of KNOWN_FONTS) {
    if (lower.includes(font.toLowerCase())) return font;
  }
  return null;
}

function parseSections(value: string): string[] | null {
  const parts = value
    .split(/[,;\n]|\band\b/gi)
    .map((s) => s.replace(/^[\s\-*\d.)]+/, "").trim().toLowerCase())
    .filter(Boolean);
  return parts.length ? Array.from(new Set(parts)) : null;
}

// Structured "key: value" lines take precedence over free-text scanning.
const STRUCTURED_KEYS: Record<string, keyof StyleSpec | "font"> = {
  name: "name",
  title: "name",
  "body font": "body_font",
  "body typeface": "body_font",
  "heading font": "heading_font",
  font: "font", // sets both body + heading
  typeface: "font",
  "body size": "body_size_pt",
  "font size": "body_size_pt",
  "body size pt": "body_size_pt",
  size: "body_size_pt",
  "line spacing": "line_spacing",
  spacing: "line_spacing",
  leading: "line_spacing",
  margin: "margins_in",
  margins: "margins_in",
  column: "columns",
  columns: "columns",
  "heading case": "heading_case",
  headings: "heading_case",
  citation: "citation_style",
  citations: "citation_style",
  "citation style": "citation_style",
  section: "required_sections",
  sections: "required_sections",
  "required sections": "required_sections",
};

function applyField(
  spec: Partial<StyleSpec>,
  detected: string[],
  field: keyof StyleSpec | "font",
  rawValue: string,
): void {
  const value = rawValue.trim();
  if (!value) return;

  switch (field) {
    case "name":
      spec.name = value;
      detected.push(`name -> ${value}`);
      break;
    case "font": {
      const font = parseFont(value) ?? value;
      spec.body_font = font;
      spec.heading_font = font;
      detected.push(`font -> ${font}`);
      break;
    }
    case "body_font": {
      const font = parseFont(value) ?? value;
      spec.body_font = font;
      detected.push(`body font -> ${font}`);
      break;
    }
    case "heading_font": {
      const font = parseFont(value) ?? value;
      spec.heading_font = font;
      detected.push(`heading font -> ${font}`);
      break;
    }
    case "body_size_pt": {
      const m = value.match(/(\d+(?:\.\d+)?)/);
      if (m) {
        spec.body_size_pt = Math.round(Number(m[1]));
        detected.push(`body size -> ${spec.body_size_pt}pt`);
      }
      break;
    }
    case "line_spacing": {
      const spacing = parseSpacing(value);
      if (spacing != null) {
        spec.line_spacing = spacing;
        detected.push(`line spacing -> ${spacing}`);
      }
      break;
    }
    case "margins_in": {
      const inches = parseMarginInches(value);
      if (inches != null) {
        spec.margins_in = {
          top: inches,
          bottom: inches,
          left: inches,
          right: inches,
        };
        detected.push(`margins -> ${inches}in`);
      }
      break;
    }
    case "columns": {
      const cols = parseColumns(value);
      if (cols != null) {
        spec.columns = cols;
        detected.push(`columns -> ${cols}`);
      }
      break;
    }
    case "heading_case": {
      const hc = parseHeadingCase(value);
      if (hc) {
        spec.heading_case = hc;
        detected.push(`heading case -> ${hc}`);
      }
      break;
    }
    case "citation_style": {
      const cs = parseCitationStyle(value);
      if (cs) {
        spec.citation_style = cs;
        detected.push(`citation style -> ${cs}`);
      }
      break;
    }
    case "required_sections": {
      const sections = parseSections(value);
      if (sections) {
        spec.required_sections = sections;
        detected.push(`required sections -> ${sections.join(", ")}`);
      }
      break;
    }
    default:
      break;
  }
}

function parseStructuredLines(
  text: string,
  spec: Partial<StyleSpec>,
  detected: string[],
): void {
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z][A-Za-z _-]*?)\s*[:=]\s*(.+)$/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase().replace(/[_-]+/g, " ");
    const field = STRUCTURED_KEYS[key];
    if (field) applyField(spec, detected, field, match[2]);
  }
}

// Free-text scanning fills only fields not already set by structured lines.
function scanFreeText(
  text: string,
  spec: Partial<StyleSpec>,
  detected: string[],
): void {
  const lower = text.toLowerCase();

  if (spec.body_font === undefined) {
    const font = parseFont(text);
    if (font) {
      spec.body_font = font;
      spec.heading_font = font;
      detected.push(`font -> ${font}`);
    }
  }
  if (spec.body_size_pt === undefined) {
    const m = lower.match(/(\d{1,2})\s*(?:pt|point|-point)\b/);
    if (m) {
      spec.body_size_pt = Number(m[1]);
      detected.push(`body size -> ${spec.body_size_pt}pt`);
    }
  }
  if (spec.line_spacing === undefined) {
    if (/double[- ]spaced|double spacing/.test(lower)) {
      spec.line_spacing = 2.0;
      detected.push("line spacing -> 2");
    } else if (/single[- ]spaced|single spacing/.test(lower)) {
      spec.line_spacing = 1.0;
      detected.push("line spacing -> 1");
    } else if (/1\.5[- ]spac/.test(lower)) {
      spec.line_spacing = 1.5;
      detected.push("line spacing -> 1.5");
    }
  }
  if (spec.columns === undefined) {
    if (/\b(two|double)[- ]column/.test(lower)) {
      spec.columns = 2;
      detected.push("columns -> 2");
    } else if (/\b(one|single)[- ]column/.test(lower)) {
      spec.columns = 1;
      detected.push("columns -> 1");
    }
  }
  if (spec.margins_in === undefined) {
    const m = lower.match(/(\d+(?:\.\d+)?)[- ]?(?:in\b|inch)[- ]?margin/);
    if (m) {
      const inches = Number(m[1]);
      spec.margins_in = { top: inches, bottom: inches, left: inches, right: inches };
      detected.push(`margins -> ${inches}in`);
    }
  }
  if (spec.heading_case === undefined) {
    const hc = parseHeadingCase(lower);
    if (hc) {
      spec.heading_case = hc;
      detected.push(`heading case -> ${hc}`);
    }
  }
  if (spec.citation_style === undefined) {
    const cs = parseCitationStyle(lower);
    if (cs) {
      spec.citation_style = cs;
      detected.push(`citation style -> ${cs}`);
    }
  }
}

/**
 * Parse formatting guidelines into a partial StyleSpec. Structured
 * "key: value" lines win; free-text heuristics fill the gaps. Fields that
 * cannot be detected are omitted (the engine defaults them).
 */
export function parseGuidelines(text: string): ParsedGuidelines {
  const spec: Partial<StyleSpec> = { id: "custom", name: "Custom guidelines" };
  const detected: string[] = [];

  parseStructuredLines(text, spec, detected);
  scanFreeText(text, spec, detected);

  const pageBudget = parsePageBudget(text);
  if (pageBudget) {
    detected.push(
      `page limit -> ${pageBudget.maxPages} pages ${
        pageBudget.includesReferences ? "including" : "excluding"
      } references`,
    );
  }

  const documentClass = parseDocumentClass(text);
  if (documentClass) {
    detected.push(`document class -> ${documentClass}`);
  }

  return { spec, pageBudget, documentClass, detected };
}
