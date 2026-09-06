import { test, expect } from "@playwright/test";

test("visitors can edit a real sample without an account on desktop and mobile", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  const mutations: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes("/api/") && request.method() !== "GET")
      mutations.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "More time on your research",
  );
  await page.screenshot({
    path: testInfo.outputPath("landing-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "Try a sample", exact: true }).click();
  const abstractCheck = page
    .locator("summary")
    .filter({ hasText: "Abstract word limit" });
  await expect(abstractCheck).toContainText("Failed");
  await page.getByRole("button", { name: "Try a shorter abstract" }).click();
  await expect(abstractCheck).toContainText("Passed");
  await page.getByLabel("Edit the abstract").fill("word ".repeat(61));
  await expect(abstractCheck).toContainText("Failed");
  await page.getByRole("button", { name: "Reset sample" }).click();
  await expect(page.getByLabel("Edit the abstract")).toHaveValue(
    /This fictional manuscript explores/,
  );
  await expect(
    page.getByRole("region", { name: "Submission checks" }),
  ).toContainText("Nothing is saved");
  await page.screenshot({
    path: testInfo.outputPath("sample-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("sample-mobile.png"),
    fullPage: true,
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("landing-mobile.png"),
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "Create your workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Create an account" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(mutations).toEqual([]);
  expect(errors).toEqual([]);
});

test("workspace search, deletion confirmation, and private sample entry work together", async ({
  page,
  request,
}, testInfo) => {
  const response = await request.get("/api/examples/manuscript");
  expect(response.ok()).toBe(true);
  const example = await response.json();
  const sample = { ...example, id: 3 };
  let documents = [
    {
      ...example,
      id: 1,
      title: "Campus routes",
      status: "extracted",
      originalFilename: "walking.docx",
    },
    {
      ...example,
      id: 2,
      title: "Soil temperatures",
      status: "formatted",
      originalFilename: "soil.pdf",
    },
  ];
  let deletes = 0;
  let creations = 0;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me")
      return route.fulfill({
        json: {
          id: 1,
          email: "researcher@example.invalid",
          displayName: "Researcher",
          createdAt: example.createdAt,
        },
      });
    if (path === "/api/documents") return route.fulfill({ json: documents });
    if (path === "/api/documents/1" && route.request().method() === "DELETE") {
      deletes++;
      documents = documents.filter((doc) => doc.id !== 1);
      return route.fulfill({ status: 204 });
    }
    if (path === "/api/documents/sample") {
      creations++;
      return route.fulfill({ status: 201, json: sample });
    }
    if (path === "/api/documents/3") return route.fulfill({ json: sample });
    if (path === "/api/healthz")
      return route.fulfill({ json: { status: "ok" } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your manuscripts" }),
  ).toBeVisible();
  await page.getByLabel("Search manuscripts").fill("walking");
  await expect(
    page.getByRole("link", { name: "Campus routes", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Soil temperatures", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Formatted", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No manuscripts match" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(
    page.getByRole("link", { name: "Soil temperatures", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("workspace.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Actions for Campus routes" }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("saved versions");
  await page.getByRole("button", { name: "Keep manuscript" }).click();
  expect(deletes).toBe(0);
  await page.getByRole("button", { name: "Actions for Campus routes" }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete manuscript", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Campus routes", exact: true }),
  ).toHaveCount(0);
  expect(deletes).toBe(1);
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open sample", exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/3$/);
  await expect(page.locator(".tiptap")).toContainText(
    "This fictional manuscript explores",
  );
  await expect(
    page.getByRole("button", { name: "Got it", exact: true }),
  ).toBeVisible();
  const abstractCheck = page
    .locator("summary")
    .filter({ hasText: "Abstract word limit" });
  await expect(abstractCheck).toContainText("Failed");
  await page
    .locator(".tiptap > p")
    .first()
    .fill("A short fictional abstract for testing live checks.");
  await expect(abstractCheck).toContainText("Passed");
  await expect(
    page.getByRole("region", { name: "Submission checks" }),
  ).toContainText("Updates while you write");
  expect(creations).toBe(1);
  expect(errors).toEqual([]);
});
