import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { Editor } from "@tiptap/react";
import type { FormattingIssue } from "@workspace/api-client-react";

interface IssueListProps {
  issues: FormattingIssue[];
  editor: Editor | null;
}

const SEVERITY = {
  error: {
    icon: AlertTriangle,
    rule: "border-l-destructive",
    text: "text-destructive",
  },
  warning: {
    icon: AlertCircle,
    rule: "border-l-warning",
    text: "text-warning",
  },
  info: {
    icon: Info,
    rule: "border-l-info",
    text: "text-info",
  },
} as const;

/**
 * Find the heading an issue refers to and scroll it into view.
 *
 * `location` holds the heading's text. It is matched case-insensitively
 * because the most common issue — a casing rewrite — reports the text as it
 * read *before* the rewrite, so an exact match would fail on precisely the
 * issues Format produces.
 */
function revealIssue(editor: Editor, location: string): boolean {
  const needle = location.trim().toLowerCase();
  if (!needle) return false;

  let found: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name !== "heading") return undefined;
    if (node.textContent.trim().toLowerCase() === needle) {
      found = { from: pos, to: pos + node.nodeSize };
      return false;
    }
    return undefined;
  });

  if (!found) return false;

  const { from, to } = found;
  editor.chain().focus().setTextSelection({ from: from + 1, to: to - 1 }).run();

  const dom = editor.view.domAtPos(from + 1).node;
  const element =
    dom.nodeType === Node.ELEMENT_NODE
      ? (dom as HTMLElement)
      : dom.parentElement;

  if (element) {
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.classList.remove("doc-flash");
    // Force a reflow so the class re-triggers when the same issue is clicked
    // twice in a row.
    void element.offsetWidth;
    element.classList.add("doc-flash");
    window.setTimeout(() => element.classList.remove("doc-flash"), 1000);
  }

  return true;
}

export function IssueList({ issues, editor }: IssueListProps) {
  if (issues.length === 0) {
    return (
      <div className="flex flex-col items-center px-6 py-10 text-center">
        <CheckCircle2 className="mb-3 h-6 w-6 text-success/60" />
        <p className="type-label text-foreground">Nothing flagged</p>
        <p className="mt-1 max-w-[22ch] text-xs leading-snug text-muted-foreground">
          Set a style, then run Format to check this manuscript against it.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {issues.map((issue) => {
        const severity = SEVERITY[issue.severity] ?? SEVERITY.info;
        const Icon = severity.icon;
        const targetable = Boolean(issue.location && editor);

        return (
          <li key={issue.id}>
            <button
              type="button"
              disabled={!targetable}
              onClick={() => {
                if (editor && issue.location) revealIssue(editor, issue.location);
              }}
              className={`flex w-full items-start gap-2.5 border-l-2 px-4 py-3 text-left transition-colors ${severity.rule} ${
                targetable
                  ? "cursor-pointer hover:bg-accent/60"
                  : "cursor-default"
              }`}
            >
              <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${severity.text}`} />
              <span className="min-w-0 flex-1">
                <span className="block text-xs leading-snug text-foreground">
                  {issue.message}
                </span>
                {issue.location && (
                  <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">
                    {issue.location}
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
