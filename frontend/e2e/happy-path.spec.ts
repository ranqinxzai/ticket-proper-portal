import { expect, test } from "@playwright/test";

const PASSWORD = "Pilot@2026";

test("agent logs in, picks a workspace, opens the Incident queue", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/agent$/);
  await expect(page.getByRole("heading", { name: /Select Helpdesk/i })).toBeVisible();

  await page.getByRole("link", { name: /IT Helpdesk/i }).first().click();
  await expect(page).toHaveURL(/\/agent\/w\/IT/);

  await page.getByRole("link", { name: "Incident", exact: true }).click();
  await expect(page).toHaveURL(/\/agent\/w\/IT\/p\/ITINC/);
  await expect(page.getByRole("link", { name: /New ticket/i })).toBeVisible();
});

test("requestor lands on the portal and browses the catalog", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill("req1");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/portal/);
  await page.getByRole("link", { name: "Request Catalog" }).first().click();
  await expect(page).toHaveURL(/\/portal\/catalog/);
  await expect(page.getByRole("heading", { name: /Request Catalog/i })).toBeVisible();
  await expect(page.getByText(/Request a New Laptop/i)).toBeVisible();
});

test("theme toggle switches to dark", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
});
