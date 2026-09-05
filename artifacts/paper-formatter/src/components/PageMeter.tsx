import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** CSS reference pixels per inch. Browsers define this as exactly 96. */
export const PX_PER_INCH = 96;

interface PageMeterProps {
  /** Estimated page count, measured by the caller. */
  pages: number;
  /** Venue page limit, when the user has set one. */
  limit: number | null;
  onLimitChange: (limit: number | null) => void;
  /**
   * The selected document class's budget, when it has one. Used as the starting
   * limit instead of an arbitrary number, and to say where the limit came from
   * — "6 pages including references" is the venue's rule, not this app's.
   */
  budget?: { maxPages: number; includesReferences: boolean } | null;
}

/**
 * Live page count with a limit meter.
 *
 * Page limits are what turn a finished paper into a desk-rejected one, and the
 * app previously gave no indication of length at all. The count is an estimate
 * from the on-screen reflow rather than LibreOffice's pagination, and says so —
 * a number presented as exact would be trusted as exact.
 */
export function PageMeter({
  pages,
  limit,
  onLimitChange,
  budget,
}: PageMeterProps) {
  const shown = pages > 0 ? Math.max(pages, 0.1) : 0;
  const scope = budget
    ? budget.includesReferences
      ? "including references"
      : "excluding references"
    : null;

  if (!limit) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onLimitChange(budget?.maxPages ?? 8)}
            className="type-measure text-muted-foreground transition-colors hover:text-foreground"
          >
            {shown.toFixed(1)} pp
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          {budget
            ? `Estimated length. Click to track against the venue limit of ${budget.maxPages} pages ${scope}.`
            : "Estimated length. Click to track it against a page limit."}
        </TooltipContent>
      </Tooltip>
    );
  }

  const ratio = shown / limit;
  const over = ratio > 1;
  const near = !over && ratio > 0.9;

  return (
    <div className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onLimitChange(null)}
            className="flex items-center gap-2"
          >
            <span
              className={`type-measure ${
                over
                  ? "text-destructive"
                  : near
                    ? "text-warning"
                    : "text-muted-foreground"
              }`}
            >
              {shown.toFixed(1)} / {limit} pp
            </span>
            <span className="h-1 w-16 overflow-hidden rounded-full bg-border">
              <span
                className={`block h-full transition-[width] duration-300 ${
                  over ? "bg-destructive" : near ? "bg-warning" : "bg-success"
                }`}
                style={{ width: `${Math.min(ratio, 1) * 100}%` }}
              />
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          {over
            ? `About ${(shown - limit).toFixed(1)} pages over${
                scope && limit === budget?.maxPages ? ` the venue limit (${scope})` : ""
              }. Click to stop tracking.`
            : scope && limit === budget?.maxPages
              ? `Venue limit, ${scope}. Estimated from the on-screen reflow; click to stop tracking.`
              : "Estimated from the on-screen reflow. Click to stop tracking."}
        </TooltipContent>
      </Tooltip>

      <div className="flex items-center">
        <button
          type="button"
          className="px-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => onLimitChange(Math.max(1, limit - 1))}
          aria-label="Lower the page limit"
        >
          −
        </button>
        <button
          type="button"
          className="px-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => onLimitChange(limit + 1)}
          aria-label="Raise the page limit"
        >
          +
        </button>
      </div>
    </div>
  );
}
