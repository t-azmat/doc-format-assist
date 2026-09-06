import { templateData } from "./templates.generated.js";

/** Typography is presentation, never a mutation of the manuscript's wording. */
export interface ManuscriptStyle {
  id: string;
  name: string;
  body_font: string;
  heading_font: string;
  body_size_pt: number;
  heading_sizes_pt: Record<string, number>;
  line_spacing: number;
  margins_in: { top: number; right: number; bottom: number; left: number };
  columns: number;
  heading_case: string;
  page_width_in: number;
  page_height_in: number;
}

export type ManuscriptStyleInput = Partial<
  Omit<ManuscriptStyle, "margins_in" | "heading_sizes_pt">
> & {
  margins_in?: Partial<ManuscriptStyle["margins_in"]>;
  heading_sizes_pt?: Record<string, number>;
};

export const manuscriptTemplates: Readonly<Record<string, ManuscriptStyle>> =
  templateData.classes;
const defaults: ManuscriptStyle = templateData.default;
const familyDefaults: Record<string, string> = {
  ieee: "ieee-conference",
  apa: "apa-journal",
  acm: "acm-conference",
};
const bounded = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max
    ? value
    : fallback;

export function resolveManuscriptStyle(
  options: {
    styleSpec?: ManuscriptStyleInput | null;
    documentClass?: string | null;
    conferenceStyle?: string | null;
  } = {},
): ManuscriptStyle {
  // Explicit classes supply defaults for custom overrides, matching resolve_document_class.
  const preset =
    manuscriptTemplates[
      options.documentClass ?? familyDefaults[options.conferenceStyle ?? ""]
    ];
  const base = (options.documentClass ? preset : undefined) ?? defaults;
  const input = options.styleSpec ?? preset ?? defaults;
  const margins = input.margins_in ?? {};
  const width = bounded(input.page_width_in, base.page_width_in, 1, 48);
  const height = bounded(input.page_height_in, base.page_height_in, 1, 48);
  const result: ManuscriptStyle = {
    ...base,
    ...input,
    body_font: input.body_font?.trim() || base.body_font,
    heading_font: input.heading_font?.trim() || base.heading_font,
    body_size_pt: bounded(input.body_size_pt, base.body_size_pt, 6, 72),
    line_spacing: bounded(input.line_spacing, base.line_spacing, 0.5, 4),
    columns: (input.columns ?? base.columns) === 2 ? 2 : 1,
    page_width_in: width,
    page_height_in: height,
    heading_sizes_pt: Object.fromEntries(
      ["1", "2", "3"].map((level) => [
        level,
        bounded(
          input.heading_sizes_pt?.[level],
          base.heading_sizes_pt[level],
          6,
          96,
        ),
      ]),
    ),
    margins_in: {
      top: bounded(
        margins.top,
        Math.min(base.margins_in.top, height / 4),
        0,
        height / 3,
      ),
      bottom: bounded(
        margins.bottom,
        Math.min(base.margins_in.bottom, height / 4),
        0,
        height / 3,
      ),
      left: bounded(
        margins.left,
        Math.min(base.margins_in.left, width / 4),
        0,
        width / 3,
      ),
      right: bounded(
        margins.right,
        Math.min(base.margins_in.right, width / 4),
        0,
        width / 3,
      ),
    },
  };
  return result;
}

/** CSS variables only; resolving a template never rewrites or emits document JSON. */
export function manuscriptStyleVariables(
  style: ManuscriptStyle,
): Record<string, string> {
  return {
    "--ed-font": JSON.stringify(style.body_font),
    "--ed-heading-font": JSON.stringify(style.heading_font),
    "--ed-size": `${style.body_size_pt}pt`,
    "--ed-line": String(style.line_spacing),
    "--ed-columns": String(style.columns),
    "--ed-h1": `${style.heading_sizes_pt["1"]}pt`,
    "--ed-h2": `${style.heading_sizes_pt["2"]}pt`,
    "--ed-h3": `${style.heading_sizes_pt["3"]}pt`,
    // Title/sentence case need linguistic decisions. Never silently recase text.
    "--ed-heading-case": style.heading_case === "upper" ? "uppercase" : "none",
  };
}
