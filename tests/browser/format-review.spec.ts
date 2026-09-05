import { test, expect } from "@playwright/test";

test("preview leaves the original intact, apply saves a version, and restore recovers it", async ({
  page,
}) => {
  const content = (heading: string) => ({
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: heading }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "Original research paragraph." }],
      },
    ],
  });
  const original = {
    id: 1,
    revision: 0,
    title: "Synthetic manuscript",
    authors: [],
    affiliations: [],
    references: [],
    status: "extracted",
    conferenceStyle: "ieee",
    documentClass: "ieee-conference",
    editorContent: content("Introduction"),
    extractedContent: {},
    formattingIssues: [],
    styleSpec: { body_size_pt: 12 },
    guidelinesText: null,
    createdAt: "2026-01-01T12:00:00.000Z",
    updatedAt: "2026-01-01T12:00:00.000Z",
  };
  let doc = structuredClone(original);
  let versions: { id: number; label: string; createdAt: string }[] = [];
  let previewRequests = 0;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let json: unknown;
    if (url.pathname === "/api/auth/me")
      json = {
        id: 1,
        email: "researcher@example.invalid",
        displayName: "Researcher",
        createdAt: original.createdAt,
      };
    else if (url.pathname === "/api/healthz") json = { status: "ok" };
    else if (url.pathname === "/api/document-classes")
      json = [
        {
          id: "ieee-conference",
          name: "IEEE Conference Paper",
          family: "ieee",
          genre: "conference_paper",
          toc: "forbidden",
          pageBudget: { maxPages: 6, includesReferences: true },
        },
      ];
    else if (url.pathname.endsWith("/format")) {
      const body = route.request().postDataJSON();
      expect(body.expectedRevision).toBe(doc.revision);
      const formatted = {
        ...doc,
        editorContent: content("INTRODUCTION"),
        styleSpec: { body_size_pt: 10 },
        status: "formatted",
      };
      if (body.dryRun) {
        previewRequests++;
        json = formatted;
      } else {
        versions = [
          { id: 1, label: "Before formatting", createdAt: original.createdAt },
        ];
        doc = { ...formatted, revision: doc.revision + 1 };
        json = doc;
      }
    } else if (url.pathname.endsWith("/versions")) json = versions;
    else if (url.pathname.endsWith("/restore")) {
      expect(route.request().postDataJSON().expectedRevision).toBe(1);
      doc = { ...structuredClone(original), revision: 2 };
      json = doc;
    } else if (url.pathname === "/api/documents/1") json = doc;
    else json = [];
    await route.fulfill({ json });
  });
  await page.goto("/documents/1");
  await expect(page.locator(".tiptap")).toContainText("Introduction");
  await page
    .getByRole("button", { name: "Review format", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Your manuscript has not changed",
  );
  expect(doc.revision).toBe(0);
  expect(versions).toHaveLength(0);
  await page.getByRole("button", { name: "Keep original" }).click();
  await expect(page.locator(".tiptap")).toContainText("Introduction");
  await page
    .getByRole("button", { name: "Review format", exact: true })
    .click();
  await page.getByRole("button", { name: "Apply and save original" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".tiptap")).toContainText("INTRODUCTION");
  expect(previewRequests).toBe(2);
  expect(doc.revision).toBe(1);
  await page.getByRole("button", { name: "Versions", exact: true }).click();
  await page.getByRole("radio").check();
  await page
    .getByRole("button", { name: "Save current draft and restore" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".tiptap")).toContainText("Introduction");
  await expect(
    page.getByRole("region", { name: "Submission checks" }),
  ).toContainText("Not checked");
});
