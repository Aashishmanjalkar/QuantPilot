import { expect, test } from "@playwright/test";

const API_URL = process.env.E2E_API_URL ?? "http://localhost:4000";

async function fillStrategy(
  page: import("@playwright/test").Page,
  overrides: Record<string, string> = {},
) {
  const values: Record<string, string> = {
    ticker: "DEMO",
    startDate: "2022-01-01",
    endDate: "2023-12-31",
    entryBelow: "35",
    exitAbove: "60",
    ...overrides,
  };
  for (const [name, value] of Object.entries(values)) {
    await page.locator(`input[name="${name}"]`).fill(value);
  }
}

test("QP-E2E-001 submit an RSI strategy and see results", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByTestId("disclaimer")).toContainText("not investment advice");
  await fillStrategy(page);
  await page.getByRole("button", { name: "Run backtest" }).click();

  await expect(page).toHaveURL(/\/backtests\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("run-status")).toHaveText("Results", { timeout: 30_000 });

  const metrics = page.getByTestId("metrics");
  await expect(metrics).toContainText("Total return");
  await expect(metrics).toContainText("Buy & hold");
  await expect(page.getByTestId("equity-chart").locator("svg path.recharts-curve")).toHaveCount(2);
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByTestId("disclaimer")).toBeVisible();

  // Side effect: the run is persisted as completed with a result.
  const id = page.url().split("/").pop();
  const res = await request.get(`${API_URL}/api/backtests/${id}`);
  expect(res.ok()).toBe(true);
  const run = await res.json();
  expect(run.status).toBe("completed");
  expect(run.result.ticker).toBe("DEMO");
  expect(run.result.equity_curve.length).toBe(run.result.bars);
});

test("QP-E2E-002 an invalid strategy shows field errors and stays on the form", async ({
  page,
}) => {
  await page.goto("/");
  await fillStrategy(page, { endDate: "2021-01-01" });
  await page.getByRole("button", { name: "Run backtest" }).click();
  const alert = page.locator(".error[role=alert]");
  await expect(alert).toContainText("end_date must be after start_date");
  await expect(page).toHaveURL(/\/$/);
});

test("QP-E2E-003 an unknown ticker shows a failed run with the reason", async ({ page }) => {
  await page.goto("/");
  await fillStrategy(page, { ticker: "NOSUCH" });
  await page.getByRole("button", { name: "Run backtest" }).click();
  await expect(page.getByTestId("run-status")).toHaveText("Failed", { timeout: 30_000 });
  await expect(page.locator(".error[role=alert]")).toContainText("no price data for NOSUCH");
});
