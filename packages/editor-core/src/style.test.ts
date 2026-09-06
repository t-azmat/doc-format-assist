import { describe, expect, it } from "vitest";
import {
  resolveManuscriptStyle,
  manuscriptStyleVariables,
  manuscriptTemplates,
} from "./index";

describe("manuscript style resolution", () => {
  it("inherits the selected export template before applying partial custom fields", () => {
    const result = resolveManuscriptStyle({
      documentClass: "ieee-conference",
      styleSpec: { body_size_pt: 11, margins_in: { top: 1 } },
    });
    expect(result.columns).toBe(2);
    expect(result.line_spacing).toBe(1);
    expect(result.body_size_pt).toBe(11);
    expect(result.margins_in.left).toBe(0.625);
    expect(result.margins_in.top).toBe(1);
  });
  it("uses the custom default when no explicit class accompanies guidelines", () => {
    const result = resolveManuscriptStyle({
      conferenceStyle: "ieee",
      styleSpec: { body_size_pt: 11 },
    });
    expect(result.columns).toBe(1);
    expect(result.line_spacing).toBe(2);
  });
  it("keeps templates independent from resolved objects", () => {
    const result = resolveManuscriptStyle({ documentClass: "apa-journal" });
    result.margins_in.top = 7;
    result.heading_sizes_pt["1"] = 72;
    expect(manuscriptTemplates["apa-journal"].margins_in.top).toBe(1);
    expect(
      resolveManuscriptStyle({ documentClass: "apa-journal" }).heading_sizes_pt[
        "1"
      ],
    ).toBe(12);
  });
  it("rejects geometry that could make the canvas unusable", () => {
    const result = resolveManuscriptStyle({
      styleSpec: {
        body_size_pt: NaN,
        line_spacing: -1,
        page_width_in: 0,
        margins_in: { left: 50 },
        columns: 900,
      },
    });
    expect(result.body_size_pt).toBe(12);
    expect(result.line_spacing).toBe(2);
    expect(result.page_width_in).toBe(8.5);
    expect(result.margins_in.left).toBe(1);
    expect(result.columns).toBe(1);
  });
  it("produces presentation variables without changing the caller's template", () => {
    const style = resolveManuscriptStyle({ documentClass: "ieee-conference" });
    const original = structuredClone(style);
    expect(manuscriptStyleVariables(style)["--ed-heading-case"]).toBe(
      "uppercase",
    );
    expect(style).toEqual(original);
  });
});
