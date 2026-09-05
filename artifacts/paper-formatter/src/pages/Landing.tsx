import { Link } from "wouter";
import { ArrowRight, FileInput, ScanLine, Undo2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Landing() {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
      <section className="grid items-center gap-12 py-14 md:grid-cols-[1.15fr_1fr] md:gap-16 md:py-24">
        <div>
          <p className="mb-5 font-mono text-xs uppercase tracking-[0.18em] text-brand">
            From draft to submission
          </p>
          <h1 className="max-w-xl text-4xl font-medium leading-[1.08] tracking-tight sm:text-6xl">
            Less time formatting.
            <br />
            <span className="font-serif italic text-brand">
              More time on your research.
            </span>
          </h1>
          <p className="mt-6 max-w-lg text-base leading-relaxed text-muted-foreground">
            Bring a Word or PDF draft, check it against your submission
            instructions, and review formatting changes before you export.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/signup">
                Create your workspace <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/demo">Try a sample</Link>
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Explore the sample without an account. No LaTeX setup required.
          </p>
          <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
            {[
              "PDF & Word input",
              "Review before applying",
              "DOCX & PDF export",
            ].map((text) => (
              <span key={text} className="flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-brand" />
                {text}
              </span>
            ))}
          </div>
        </div>
        <Link
          href="/demo"
          className="group block rounded-xl border border-border bg-card p-4 shadow-lg transition-transform hover:-translate-y-1 focus-visible:outline-2 focus-visible:outline-brand sm:p-6"
          aria-label="Explore the sample manuscript"
        >
          <div className="mb-5 flex items-center justify-between border-b border-border pb-3 text-xs text-muted-foreground">
            <span className="font-mono uppercase tracking-wider">
              A sample on your desk
            </span>
            <span>01 / Review</span>
          </div>
          <div className="rounded-sm border border-border bg-background/30 px-6 py-8 sm:px-8">
            <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              Fictional demonstration manuscript
            </p>
            <h2 className="mt-4 font-serif text-2xl leading-tight">
              A cooler walk
              <br />
              across campus
            </h2>
            <div className="my-5 h-px bg-border" />
            <h3 className="font-serif text-sm font-semibold">Abstract</h3>
            <p className="mt-2 font-serif text-sm leading-relaxed text-muted-foreground">
              A draft begins with an idea. Getting it ready for a venue means
              checking the details: the abstract, citations, layout, and the
              instructions that matter to your submission.
            </p>
            <div className="mt-5 rounded-md border border-warning/30 bg-warning/5 p-3 text-xs">
              <span className="font-medium text-warning">
                Abstract needs a shorter version
              </span>
              <p className="mt-1 text-muted-foreground">
                See the requirement. Make an edit. Check again.
              </p>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between text-sm font-medium text-brand">
            <span>Try the interactive walkthrough</span>
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </div>
        </Link>
      </section>
      <section
        aria-labelledby="workflow-heading"
        className="border-t border-border py-12"
      >
        <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          A clearer path to your next submission
        </p>
        <h2
          id="workflow-heading"
          className="mt-3 text-2xl font-medium tracking-tight"
        >
          Keep the research. Take control of the details.
        </h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            {
              Icon: FileInput,
              step: "01",
              title: "Start with your draft",
              text: "Upload a DOCX or PDF and work in a visual editor. Keep authors, equations, citations, and references alongside the manuscript.",
            },
            {
              Icon: ScanLine,
              step: "02",
              title: "Understand what needs attention",
              text: "Supply your guidelines and inspect checks with their evidence. See which requirements were checked and which still need your review.",
            },
            {
              Icon: Undo2,
              step: "03",
              title: "Approve, export, recover",
              text: "Compare formatting changes, apply them when you're ready, and export a Word document or PDF. Saved versions let you return to an earlier draft.",
            },
          ].map(({ Icon, step, title, text }) => (
            <article
              key={step}
              className="rounded-lg border border-border bg-card p-6"
            >
              <div className="mb-5 flex items-center justify-between">
                <Icon className="h-5 w-5 text-brand" />
                <span className="font-mono text-xs text-muted-foreground">
                  {step}
                </span>
              </div>
              <h3 className="text-base font-medium">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {text}
              </p>
            </article>
          ))}
        </div>
      </section>
      <section
        className="grid gap-8 border-t border-border py-12 md:grid-cols-2"
        aria-labelledby="questions-heading"
      >
        <div>
          <h2
            id="questions-heading"
            className="text-2xl font-medium tracking-tight"
          >
            Before you bring your manuscript
          </h2>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
            Start with the sample to see what the app checks and how the
            workflow feels.
          </p>
          <Button asChild variant="outline" className="mt-5">
            <Link href="/demo">
              Explore the sample <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
        <div className="divide-y divide-border">
          {[
            [
              "Which files can I use?",
              "Upload PDF or DOCX files up to 50 MB. If you have the original Word file, start there. Review extracted equations, tables, and figures against your source, especially when importing a PDF.",
            ],
            [
              "Do I need LaTeX or an AI subscription?",
              "Core editing, formatting, checks, and exports work without an AI key. Optional AI features depend on how the server is configured.",
            ],
            [
              "Does a passed check mean my paper is ready?",
              "A passed check covers the specific rule it names. Venue requirements vary, and final pagination and layout still need review in the exported file.",
            ],
            [
              "Where is my manuscript stored?",
              "Uploaded manuscripts and saved versions are stored on the application server under your account. If AI analysis or AI-assisted guideline parsing is enabled, relevant text is sent to the configured AI service.",
            ],
          ].map(([question, answer]) => (
            <details key={question} className="py-4">
              <summary className="cursor-pointer text-sm font-medium">
                {question}
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {answer}
              </p>
            </details>
          ))}
        </div>
      </section>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-6 text-xs text-muted-foreground">
        <span>Editorial Desk · Built for careful manuscript preparation.</span>
        <a
          className="hover:text-brand hover:underline"
          href="https://github.com/t-azmat/doc-format-assist"
          target="_blank"
          rel="noreferrer"
        >
          Explore the open-source project
        </a>
      </footer>
    </div>
  );
}
