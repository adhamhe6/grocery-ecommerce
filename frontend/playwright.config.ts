import { defineConfig, devices } from "@playwright/test";

// The suite drives a *running* stack (storefront + API + database seeded with `manage.py seed_demo`) — see README "End-to-end tests".
// E2E_BASE_URL        storefront origin (default http://localhost:3000)
// E2E_DATABASE_URL    PostgreSQL URL of the same database the API uses; specs read it to verify persisted state
// E2E_CHROMIUM_PATH   optional path to a Chromium binary (CI uses the one `playwright install` downloads)
const executablePath = process.env.E2E_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "./e2e",
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: false,
  workers: 1, // the workflows share one database and mutate stock, so they run one at a time
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    launchOptions: { executablePath },
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 900 } } }],
});
