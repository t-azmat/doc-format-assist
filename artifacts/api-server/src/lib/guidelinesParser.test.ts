import { describe, expect, it } from "vitest";
import { parseGuidelines } from "./guidelinesParser";

describe("parseGuidelines", () => {
  it("reads structured key: value lines", () => {
    const { spec } = parseGuidelines(
      ["body font: Arial", "font size: 11pt", "line spacing: double", "columns: 2"].join(
        "\n",
      ),
    );

    expect(spec.body_font).toBe("Arial");
    expect(spec.body_size_pt).toBe(11);
    expect(spec.line_spacing).toBe(2);
    expect(spec.columns).toBe(2);
  });

  it("reads free text when no structured lines are present", () => {
    const { spec } = parseGuidelines(
      "Manuscripts must be double-spaced in 12pt Times New Roman with 1 inch margins.",
    );

    expect(spec.body_font).toBe("Times New Roman");
    expect(spec.body_size_pt).toBe(12);
    expect(spec.line_spacing).toBe(2);
    expect(spec.margins_in).toEqual({ top: 1, bottom: 1, left: 1, right: 1 });
  });

  it("lets structured lines win over free text", () => {
    const { spec } = parseGuidelines(
      ["Papers are usually set in Arial.", "body font: Georgia"].join("\n"),
    );

    expect(spec.body_font).toBe("Georgia");
  });

  it("converts centimetre margins to inches", () => {
    const { spec } = parseGuidelines("margins: 2.54cm");

    expect(spec.margins_in?.top).toBeCloseTo(1, 3);
  });

  it("omits fields it cannot detect, leaving them to the engine defaults", () => {
    const { spec } = parseGuidelines("Please submit your paper on time.");

    expect(spec.body_font).toBeUndefined();
    expect(spec.line_spacing).toBeUndefined();
    expect(spec.columns).toBeUndefined();
  });

  it("reports what it understood", () => {
    const { detected } = parseGuidelines("body font: Arial");

    expect(detected).toContain("body font -> Arial");
  });

  it.each([
    ["IEEE numbered references", "numeric"],
    ["APA author-date citations", "author-date"],
  ])("detects the %s citation style", (text, expected) => {
    expect(parseGuidelines(text).spec.citation_style).toBe(expected);
  });

  it.each([
    ["headings: all caps", "upper"],
    ["heading case: title", "title"],
    ["heading case: sentence", "sentence"],
  ])("detects heading case from %s", (text, expected) => {
    expect(parseGuidelines(text).spec.heading_case).toBe(expected);
  });

  it("always marks the result as a custom style", () => {
    const { spec } = parseGuidelines("");

    expect(spec.id).toBe("custom");
  });

  describe("page limits", () => {
    it.each([
      ["Papers may be a maximum of 8 pages.", 8],
      ["Submissions must not exceed 6 pages.", 6],
      ["There is a 4-page limit.", 4],
      ["Papers of up to 12 pages are welcome.", 12],
      ["page limit: 10", 10],
      ["Contributions are limited to 9 pages.", 9],
      ["No more than 14 pages, please.", 14],
    ])("reads the limit from %s", (text, expected) => {
      expect(parseGuidelines(text).pageBudget?.maxPages).toBe(expected);
    });

    it.each([
      ["Papers may be up to 10 pages excluding references.", false],
      ["A maximum of 8 pages, not including references.", false],
      ["Up to 8 pages; references do not count.", false],
      ["A maximum of 8 pages including references.", true],
      ["Papers may be up to 6 pages inclusive of references.", true],
    ])("reads whether references count from %s", (text, expected) => {
      expect(parseGuidelines(text).pageBudget?.includesReferences).toBe(expected);
    });

    it("counts references by default, which is the tighter reading", () => {
      expect(parseGuidelines("Maximum 8 pages.").pageBudget).toEqual({
        maxPages: 8,
        includesReferences: true,
      });
    });

    it("reads the scope from around the limit, not the whole document", () => {
      const text = [
        "Papers may be up to 8 pages including references.",
        "",
        "Appendices are excluded from the bibliography requirements.",
      ].join("\n");

      expect(parseGuidelines(text).pageBudget?.includesReferences).toBe(true);
    });

    it("finds no limit when none is stated", () => {
      expect(parseGuidelines("Use 12pt Times New Roman.").pageBudget).toBeNull();
    });

    it("reports the limit it understood", () => {
      const { detected } = parseGuidelines("Maximum 8 pages excluding references.");

      expect(detected).toContain("page limit -> 8 pages excluding references");
    });
  });

  describe("document class", () => {
    it.each([
      ["Call for papers: IEEE conference on robotics.", "ieee-conference"],
      ["Submission to IEEE Transactions on Computing (journal).", "ieee-journal"],
      ["ACM conference proceedings submission.", "acm-conference"],
      ["Doctoral dissertation formatting requirements.", "apa-dissertation"],
      ["Thesis submission guidelines.", "apa-dissertation"],
    ])("infers the class from %s", (text, expected) => {
      expect(parseGuidelines(text).documentClass).toBe(expected);
    });

    it("does not guess a class from a genre alone", () => {
      // "conference" says nothing about which template.
      expect(parseGuidelines("This is a conference submission.").documentClass).toBeNull();
    });

    it("identifies a thesis without needing a family", () => {
      expect(parseGuidelines("Dissertation handbook").documentClass).toBe(
        "apa-dissertation",
      );
    });

    it("finds no class in pure typography guidelines", () => {
      expect(parseGuidelines("12pt Times New Roman, double spaced.").documentClass).toBeNull();
    });
  });
});
