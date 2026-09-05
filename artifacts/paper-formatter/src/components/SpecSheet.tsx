import type { StyleSpec } from "@workspace/api-client-react";

interface SpecSheetProps {
  spec: StyleSpec;
}

/**
 * A drawn page at the spec's real proportions.
 *
 * "0.625in margins, 2 columns" is four numbers a reader has to assemble into a
 * mental picture. Drawing it removes that step — and because the rectangle is
 * derived from the same values the exporter uses, a wrong spec looks wrong
 * before anyone exports a file.
 */
function PageDiagram({ spec }: SpecSheetProps) {
  const widthIn = spec.page_width_in ?? 8.5;
  const heightIn = spec.page_height_in ?? 11;
  const margins = spec.margins_in ?? {};
  const top = margins.top ?? 1;
  const right = margins.right ?? 1;
  const bottom = margins.bottom ?? 1;
  const left = margins.left ?? 1;
  const columns = Math.max(1, Math.min(spec.columns ?? 1, 4));

  // Draw in page inches so the SVG is a true scale model; the viewBox handles
  // the rest.
  const textWidth = Math.max(widthIn - left - right, 0.1);
  const textHeight = Math.max(heightIn - top - bottom, 0.1);
  const gutter = 0.3;
  const columnWidth = (textWidth - gutter * (columns - 1)) / columns;

  return (
    <svg
      viewBox={`0 0 ${widthIn} ${heightIn}`}
      className="h-auto w-full max-w-[104px] shrink-0"
      role="img"
      aria-label={`${widthIn} by ${heightIn} inch page, ${columns} column${
        columns === 1 ? "" : "s"
      }, ${top} inch top margin`}
    >
      <rect
        x="0.03"
        y="0.03"
        width={widthIn - 0.06}
        height={heightIn - 0.06}
        rx="0.05"
        className="fill-paper stroke-border"
        strokeWidth="0.06"
      />
      {Array.from({ length: columns }, (_, index) => (
        <rect
          key={index}
          x={left + index * (columnWidth + gutter)}
          y={top}
          width={columnWidth}
          height={textHeight}
          className="fill-brand"
          opacity="0.16"
        />
      ))}
    </svg>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="type-measure text-right text-foreground">{value}</dd>
    </div>
  );
}

/** Format a margin set as one value when uniform, or T/R/B/L when it isn't. */
function marginLabel(margins: StyleSpec["margins_in"]): string | null {
  if (!margins) return null;
  const { top, right, bottom, left } = margins;
  const values = [top, right, bottom, left];
  if (values.some((value) => value === undefined)) return null;
  const uniform = values.every((value) => value === top);
  return uniform
    ? `${top}in`
    : `${top} / ${right} / ${bottom} / ${left}in`;
}

export function SpecSheet({ spec }: SpecSheetProps) {
  const margins = marginLabel(spec.margins_in);
  const headings = spec.heading_sizes_pt ?? {};
  const headingScale = [headings["1"], headings["2"], headings["3"]]
    .filter((size): size is number => typeof size === "number")
    .join(" / ");

  const rows: Array<[string, string | null | undefined]> = [
    ["Page", `${spec.page_width_in ?? 8.5} × ${spec.page_height_in ?? 11}in`],
    ["Margins", margins],
    ["Columns", spec.columns ? String(spec.columns) : null],
    ["Body", spec.body_font && spec.body_size_pt
      ? `${spec.body_font} ${spec.body_size_pt}pt`
      : spec.body_font ?? null],
    ["Leading", spec.line_spacing ? `${spec.line_spacing}×` : null],
    ["Headings", headingScale ? `${headingScale}pt` : null],
    ["Case", spec.heading_case ?? null],
    ["Citations", spec.citation_style ?? null],
  ];

  return (
    <div className="rounded-md border border-border bg-background/60 p-3">
      <div className="mb-2.5 flex items-start gap-3">
        <PageDiagram spec={spec} />
        <div className="min-w-0 flex-1">
          <p className="type-eyebrow">Active style</p>
          <p className="type-label mt-1 truncate text-foreground">
            {spec.name || "Custom"}
          </p>
          {spec.required_sections && spec.required_sections.length > 0 && (
            <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
              Requires {spec.required_sections.join(", ")}
            </p>
          )}
        </div>
      </div>

      <dl className="divide-y divide-border/60 border-t border-border/60">
        {rows
          .filter((row): row is [string, string] => Boolean(row[1]))
          .map(([label, value]) => (
            <Row key={label} label={label} value={value} />
          ))}
      </dl>

      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        Anything not listed uses the engine's default.
      </p>
    </div>
  );
}
