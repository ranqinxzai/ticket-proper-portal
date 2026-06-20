import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "Pilot@2026";

type Session = { access: string; refresh: string; user: string };
const sessions: Record<string, Session> = {};

async function login(request: any, username: string): Promise<Session> {
  const res = await request.post("/api/v1/itsm/auth/login/", {
    data: { username, password: PASSWORD },
  });
  const body = await res.json();
  return { access: body.access, refresh: body.refresh, user: JSON.stringify(body.user) };
}

test.beforeAll(async ({ request }) => {
  sessions.admin = await login(request, "admin");
  sessions.req1 = await login(request, "req1");
});

async function visit(page: Page, path: string, session: Session | null, theme: "light" | "dark") {
  await page.addInitScript(
    ([s, th]: [Session | null, string]) => {
      if (s) {
        localStorage.setItem("itsm_access", s.access);
        localStorage.setItem("itsm_refresh", s.refresh);
        localStorage.setItem("itsm_user", s.user);
      }
      localStorage.setItem("itsm-theme", th);
    },
    [session, theme] as [Session | null, string],
  );
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

async function expectNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  const summary = serious.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
  expect(serious, `${label}: ${JSON.stringify(summary, null, 2)}`).toEqual([]);
}

const AGENT_ROUTES = [
  "/agent",
  "/agent/w/IT/dashboard",
  "/agent/w/IT/p/ITINC",
  "/agent/approvals",
  "/agent/reports",
  "/agent/w/IT/settings",
];
const PORTAL_ROUTES = ["/portal", "/portal/catalog", "/portal/kb", "/portal/requests"];

for (const theme of ["light", "dark"] as const) {
  test(`a11y: /login (${theme})`, async ({ page }) => {
    await visit(page, "/login", null, theme);
    await expectNoSeriousViolations(page, `/login (${theme})`);
  });

  for (const route of AGENT_ROUTES) {
    test(`a11y: ${route} (${theme})`, async ({ page }) => {
      await visit(page, route, sessions.admin, theme);
      await expectNoSeriousViolations(page, `${route} (${theme})`);
    });
  }

  for (const route of PORTAL_ROUTES) {
    test(`a11y: ${route} (${theme})`, async ({ page }) => {
      await visit(page, route, sessions.req1, theme);
      await expectNoSeriousViolations(page, `${route} (${theme})`);
    });
  }
}
