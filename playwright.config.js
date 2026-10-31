import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:5174",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5174 --strictPort",
    url: "http://127.0.0.1:5174/v2/",
    reuseExistingServer: false,
    env: {
      VITE_TEST_RUNTIME: "true",
      VITE_SUPABASE_URL: "https://v2-fixture.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "fixture-public-key",
    },
  },
});
