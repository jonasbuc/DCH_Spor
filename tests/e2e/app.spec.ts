import { expect, test } from "@playwright/test";

const accessToken = process.env.DCH_E2E_ACCESS_TOKEN ?? "e2e-token";

test("kræver login, når adgangstoken er sat", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await context.close();
});

test.describe.serial("autoriserede arbejdsgange", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("opret projekt, tegn, validér, auto-placér, eksportér og genåbn", async ({ page }) => {
    const projectName = `E2E B-spor ${Date.now()}`;
    await createProject(page, projectName);
    await expect(page.getByTestId("editor-canvas")).toBeVisible();
    await expect(page.getByText("2,831 ha")).toBeVisible();

    await page.getByRole("button", { name: /tegn markpolygon/i }).click();
    const canvas = page.getByTestId("editor-canvas");
    await canvas.click({ position: { x: 120, y: 120 } });
    await canvas.click({ position: { x: 520, y: 120 } });
    await canvas.click({ position: { x: 520, y: 260 } });
    await canvas.click({ position: { x: 120, y: 260 } });
    await page.getByRole("button", { name: /afslut polygon/i }).click();

    await page.getByRole("button", { name: /tilføj b-spor/i }).click();
    await canvas.click({ position: { x: 220, y: 170 } });
    await expect(page.getByText(/200 skridt/i)).toBeVisible();

    await page.getByRole("button", { name: /automatisk placering/i }).click();
    await expect(page.getByText(/bedste fundne forslag/i)).toBeVisible();
    await page.getByRole("button", { name: /validér/i }).click();
    await expect(page.getByText(/gyldig|fejl/i)).toBeVisible();

    await page.getByRole("button", { name: "PNG" }).click();
    await page.goto("/");
    await page.getByText(projectName).click();
    await expect(page.getByTestId("editor-canvas")).toBeVisible();
  });

  test("kortflow søger adresse, tegner polygon og gemmer lokale meterkoordinater", async ({ page }) => {
    await page.route("**/api/geocode?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: [{ label: "DcH E2E Mark", lat: 55.6761, lon: 12.5683 }]
        })
      });
    });

    await createProject(page, `E2E kort ${Date.now()}`);
    const editorUrl = page.url();
    await page.getByRole("button", { name: /kort/i }).click();
    await expect(page.getByRole("heading", { name: /kortgrundlag/i })).toBeVisible();
    await page.getByLabel(/adresse eller stednavn/i).fill("DcH E2E Mark");
    await page.getByRole("button", { name: "Søg" }).click();
    await page.getByText("DcH E2E Mark").click();

    const map = page.locator(".leaflet-container");
    await expect(map).toBeVisible();
    await map.click({ position: { x: 220, y: 190 } });
    await map.click({ position: { x: 380, y: 190 } });
    await map.click({ position: { x: 380, y: 330 } });
    await map.click({ position: { x: 220, y: 330 } });
    await page.getByRole("button", { name: /gem markpolygon/i }).click();
    await expect(page.getByText(/kortpolygonen er gemt/i)).toBeVisible();
    await page.goto(editorUrl);
    await expect(page.getByTestId("editor-canvas")).toBeVisible();
  });

  test("admin kan redigere regeltemplate", async ({ page }) => {
    await page.goto("/templates");
    await expect(page.getByRole("heading", { name: /sportemplates/i })).toBeVisible();
    await page.getByLabel("Skridtlængde").fill("0.76");
    await page.getByRole("button", { name: /gem regler/i }).click();
    await expect(page.getByText("Gemt")).toBeVisible();
  });

  test("versionsflow gemmer snapshot og gendanner projekt", async ({ page }) => {
    await createProject(page, `E2E version ${Date.now()}`);
    await page.getByRole("button", { name: /indstillinger/i }).click();
    await page.getByRole("button", { name: /gem snapshot/i }).click();
    await expect(page.getByText(/snapshot gemt/i)).toBeVisible();
    await page.getByRole("button", { name: /gendan/i }).first().click();
    await expect(page.getByTestId("editor-canvas")).toBeVisible();
  });
});

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel(/adgangstoken/i).fill(accessToken);
  await page.getByRole("button", { name: /log ind/i }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function createProject(page: import("@playwright/test").Page, projectName: string) {
  await page.goto("/projects/new");
  await page.getByLabel("Projektnavn").fill(projectName);
  await page.getByLabel("Kendt markareal").fill("28.310 m²");
  await page.getByRole("button", { name: /opret projekt/i }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
}
