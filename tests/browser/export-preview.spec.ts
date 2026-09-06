import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("PDF preview flushes edits, renders real pages, and downloads the same snapshot", async ({
  page,
  request,
}, testInfo) => {
  const pdf = await readFile("tests/fixtures/export-preview.pdf");
  let doc = {
    ...(await (await request.get("/api/examples/manuscript")).json()),
    id: 42,
  };
  let exports = 0;
  let rejectExport = false;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/auth/me")
      return route.fulfill({
        json: {
          id: 1,
          email: "test@example.invalid",
          displayName: "Researcher",
        },
      });
    if (path === "/api/documents/42") {
      if (route.request().method() === "PATCH")
        doc = {
          ...doc,
          ...route.request().postDataJSON(),
          revision: doc.revision + 1,
        };
      return route.fulfill({ json: doc });
    }
    if (path === "/api/documents/42/export") {
      exports++;
      expect(url.searchParams.get("format")).toBe("pdf");
      expect(url.searchParams.get("expectedRevision")).toBe(
        String(doc.revision),
      );
      expect(doc.title).toBe("Saved before preview");
      if (rejectExport)
        return route.fulfill({
          status: 503,
          json: { error: "The PDF renderer is busy. Try again." },
        });
      return route.fulfill({
        contentType: "application/pdf",
        headers: { "X-Document-Revision": String(doc.revision) },
        body: pdf,
      });
    }
    if (path === "/api/healthz")
      return route.fulfill({ json: { status: "ok" } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/documents/42");
  await expect(page.locator(".tiptap")).toBeVisible();
  await page.getByLabel("Manuscript title").fill("Saved before preview");
  const open = async () => {
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.getByRole("menuitem", { name: "Preview exported PDF" }).click();
  };
  await open();
  await expect(page.getByRole("dialog")).toContainText(/Page 1 of [2-9]/);
  await page.getByText("Read page text", { exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Fictional export preview fixture",
  );
  await page.screenshot({ path: testInfo.outputPath("export-preview.png"), fullPage: true });
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByRole("dialog")).toContainText(/Page 2 of/);
  await page.getByLabel("PDF zoom").selectOption("1.5");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download PDF", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Saved before preview.pdf");
  expect(await readFile((await download.path())!)).toEqual(pdf);
  expect(exports).toBe(1);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  rejectExport = true;
  await open();
  await expect(page.getByRole("alert")).toContainText("renderer is busy");
  rejectExport = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(/Page 1 of/);
  expect(errors).toEqual([]);
});
