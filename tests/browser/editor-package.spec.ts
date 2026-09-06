import { test, expect } from "@playwright/test";

test("independent editor restyles typing without rewriting content or losing rich nodes", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes("/api/documents")) requests.push(request.url());
  });
  await page.goto("/editor-lab");
  const editor = page.getByRole("textbox", { name: "Manuscript", exact: true });
  await expect(editor).toContainText("A manuscript that follows your style");
  await expect(editor).toHaveCSS("font-size", "16px");
  await expect(editor).toHaveCSS("line-height", "32px");
  await expect(editor.locator(".math-block .katex")).toBeVisible();
  await page.getByText("Inspect document JSON", { exact: true }).click();
  const json = page.getByTestId("editor-json");
  const original = await json.textContent();
  await page.getByLabel("Editor template").selectOption("ieee-conference");
  await expect(editor).toHaveCSS("font-size", "13.3333px");
  await expect(editor.locator("h1")).toHaveCSS("text-transform", "uppercase");
  await expect(json).toHaveText(original!);
  await expect(page.getByRole("status")).toContainText("0 content edits");
  await editor.locator("p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("A new paragraph inherits the venue typography.");
  const added = editor
    .locator("p")
    .filter({ hasText: "A new paragraph inherits" });
  await expect(added).toHaveCSS("font-size", "13.3333px");
  await expect(json).toContainText("A new paragraph inherits");
  await page.getByLabel("Editor template").selectOption("apa-journal");
  await expect(added).toHaveCSS("font-size", "16px");
  await expect(added).toHaveCSS("line-height", "32px");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor).not.toContainText("A new paragraph inherits");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(editor).toContainText("A new paragraph inherits");
  const content = JSON.parse((await json.textContent())!);
  expect(
    content.content.some((node: { type: string }) => node.type === "table"),
  ).toBe(true);
  expect(
    content.content.some(
      (node: { type: string; attrs?: { latex?: string } }) =>
        node.type === "mathBlock" && node.attrs?.latex === "E = mc^2",
    ),
  ).toBe(true);
  expect(JSON.stringify(content)).toContain("example-reference");
  await page.getByLabel("Show template columns").check();
  await page.getByLabel("Editor template").selectOption("ieee-conference");
  await expect(editor).toHaveCSS("column-count", "2");
  await page.screenshot({
    path: testInfo.outputPath("editor-lab.png"),
    fullPage: true,
  });
  await page.getByLabel("Show template columns").uncheck();
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});

test("equations can be edited and undone without losing LaTeX", async ({
  page,
}) => {
  await page.goto("/editor-lab");
  const math = page.locator(".tiptap .math-block");
  await expect(math.locator(".katex")).toBeVisible();
  await math.click();
  await page.getByRole("button", { name: "Equation", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Edit equation");
  await page.getByLabel("LaTeX source").fill("\\frac{a}{b}");
  await page.getByRole("button", { name: "Update equation" }).click();
  await expect(math).toHaveAttribute("data-latex", "\\frac{a}{b}");
  await expect(math.locator(".katex")).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(math).toHaveAttribute("data-latex", "E = mc^2");
  await math.click();
  await page.getByRole("button", { name: "Equation", exact: true }).click();
  await page.getByLabel("LaTeX source").fill("\\frac{");
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Update equation" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(math).toHaveAttribute("data-latex", "E = mc^2");
});
