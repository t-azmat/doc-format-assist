import type { DocumentClass, SuggestedClass } from "@workspace/api-client-react";
import { Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ClassSuggestionBannerProps {
  suggestion: SuggestedClass;
  classes: DocumentClass[] | undefined;
  onAccept: (classId: string) => void;
  onDismiss: () => void;
}

const CONFIDENCE_PHRASE: Record<string, string> = {
  high: "This looks like",
  medium: "This may be",
  low: "This might be",
};

/**
 * What the manuscript looks like, offered — never applied.
 *
 * Choosing "IEEE conference" means "I am writing a six-page paper"; a
 * ninety-page manuscript with chapters is a different kind of document and the
 * app used to accept that combination without comment. It still accepts it: the
 * user knows their venue and this does not, and a wrong auto-correction the day
 * before a deadline is far worse than a suggestion that can be dismissed.
 *
 * The reasons are shown because a suggestion the user cannot evaluate is worse
 * than no suggestion at all.
 */
export function ClassSuggestionBanner({
  suggestion,
  classes,
  onAccept,
  onDismiss,
}: ClassSuggestionBannerProps) {
  const match = classes?.find((candidate) => candidate.id === suggestion.classId);
  const name = match?.name ?? suggestion.classId;
  const lead = CONFIDENCE_PHRASE[suggestion.confidence] ?? "This may be";

  return (
    <div className="rounded-md border border-brand/40 bg-brand/5 p-3">
      <div className="flex items-start gap-2">
        <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <p className="type-label text-foreground">
            {lead} a{/^[aeiou]/i.test(name) ? "n" : ""} {name}.
          </p>
          {suggestion.reasons.length > 0 && (
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              Based on {suggestion.reasons.join(", ")}.
            </p>
          )}
          {match?.pageBudget && (
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              That class allows {match.pageBudget.maxPages} pages{" "}
              {match.pageBudget.includesReferences ? "including" : "excluding"}{" "}
              references.
            </p>
          )}

          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              className="h-7"
              onClick={() => onAccept(suggestion.classId)}
            >
              Use it
            </Button>
            <Button size="sm" variant="ghost" className="h-7" onClick={onDismiss}>
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
