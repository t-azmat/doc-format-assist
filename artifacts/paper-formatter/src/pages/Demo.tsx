import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { getExampleManuscript } from "@workspace/api-client-react";
import { ArrowRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SubmissionReport } from "@/components/SubmissionReport";
import {
  nodeText,
  submissionChecks,
  type ManuscriptNode,
} from "@/lib/submissionChecks";
import { useAuth } from "@/lib/auth";
import { useSampleManuscript } from "@/hooks/use-sample-manuscript";

const SHORT_ABSTRACT =
  "This fictional manuscript outlines a proposed comparison of shaded and exposed campus walking routes. It demonstrates how to edit an abstract, check a stated word limit, and review a manuscript. No measurements were collected and no scientific findings are claimed.";

export default function Demo() {
  const sample = useQuery({
    queryKey: ["public-sample"],
    queryFn: () => getExampleManuscript(),
  });
  const [edited, setEdited] = useState<string | null>(null);
  const { user } = useAuth();
  const { create, creating } = useSampleManuscript();
  if (sample.isPending)
    return (
      <p
        role="status"
        className="p-10 text-center text-sm text-muted-foreground"
      >
        Opening the sample…
      </p>
    );
  if (sample.isError)
    return (
      <div role="alert" className="p-10 text-center">
        <p>We couldn't load the sample.</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => void sample.refetch()}
        >
          Try again
        </Button>
      </div>
    );
  const root = sample.data.editorContent as ManuscriptNode;
  const abstract = edited ?? nodeText(root.content![1]);
  const manuscript = {
    ...sample.data,
    editorContent: {
      ...root,
      content: root.content!.map((node, i) =>
        i === 1
          ? { type: "paragraph", content: [{ type: "text", text: abstract }] }
          : node,
      ),
    },
  };
  const check = submissionChecks(manuscript).find((c) => c.id === "abstract")!;
  const words = abstract.trim() ? abstract.trim().split(/\s+/u).length : 0;
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8">
      <div className="mb-8 max-w-2xl">
        <p className="font-mono text-xs uppercase tracking-wider text-brand">
          Try it before you sign up
        </p>
        <h1 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">
          One draft. One requirement. Your first check.
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          This fictional sample has an abstract longer than its demonstration
          limit. Shorten it and watch the check update. Edits stay on this page
          and are not saved.
        </p>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section
          className="rounded-xl border border-border bg-card p-5 sm:p-8"
          aria-labelledby="sample-title"
        >
          <p className="text-xs text-muted-foreground">
            FICTIONAL SAMPLE · NO RESEARCH RESULTS
          </p>
          <h2 id="sample-title" className="mt-3 font-serif text-3xl">
            A cooler walk across campus
          </h2>
          <div className="my-6 rounded-md border border-brand/20 bg-brand/5 p-4">
            <p className="text-xs font-medium text-brand">The requirement</p>
            <p className="mt-1 text-sm">“Abstract must not exceed 60 words.”</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Demonstration guidelines, not a real venue's instructions.
            </p>
          </div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <label htmlFor="sample-abstract" className="text-sm font-medium">
              Edit the abstract
            </label>
            <span
              aria-live="polite"
              className={`font-mono text-xs ${words > 60 ? "text-warning" : "text-muted-foreground"}`}
            >
              {words} / 60 words
            </span>
          </div>
          <Textarea
            id="sample-abstract"
            value={abstract}
            onChange={(e) => setEdited(e.target.value)}
            className="min-h-64 resize-y text-base leading-relaxed"
          />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => setEdited(SHORT_ABSTRACT)}
            >
              Try a shorter abstract
            </Button>
            <Button variant="ghost" onClick={() => setEdited(null)}>
              <RotateCcw className="mr-2 h-3.5 w-3.5" />
              Reset sample
            </Button>
          </div>
          <p
            role="status"
            className={`mt-5 text-sm ${check.status === "passed" ? "text-success" : "text-muted-foreground"}`}
          >
            {check.status === "passed"
              ? "This abstract now meets the sample's word limit. The other checks still have their own limits."
              : check.detail}
          </p>
        </section>
        <div className="space-y-5">
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <SubmissionReport document={manuscript} mode="sample" />
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-base font-medium">
              Explore the full manuscript workflow
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Open a fresh sample in your workspace to try the editor, review
              formatting, restore saved versions, and export a file.
            </p>
            {user ? (
              <Button
                className="mt-4 w-full"
                disabled={creating}
                onClick={() => void create()}
              >
                {creating ? "Opening sample…" : "Open full sample editor"}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button asChild className="mt-4 w-full">
                <Link href="/signup">
                  Create your workspace <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
