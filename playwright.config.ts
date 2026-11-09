import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  timeout: 60000,
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: "node mock/server.mjs",
    url: "http://localhost:4173",
    reuseExistingServer: false,
  },
});
