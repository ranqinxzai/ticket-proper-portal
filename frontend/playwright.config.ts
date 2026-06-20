import { defineConfig, devices } from "@playwright/test";

/**
 * E2E + accessibility tests run against the live pilot (or any reachable base URL).
 * Override with PW_BASE_URL. Dev deps are installed out-of-band (not in package.json)
 * so the Docker image build is unaffected:
 *   npm i -D @playwright/test @axe-core/playwright && npx playwright install chromium
 *   npx playwright test
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PW_BASE_URL ?? "https://pilot-ticket.onemedai.org",
    ignoreHTTPSErrors: true,
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
