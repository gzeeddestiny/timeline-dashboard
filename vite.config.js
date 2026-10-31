import { defineConfig, loadEnv } from 'vite'
import process from 'node:process'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function v2Entry(req, _res, next) {
  const url = new URL(req.url, "http://localhost");
  if ((url.pathname === "/v2" || url.pathname.startsWith("/v2/")) && !url.pathname.split("/").at(-1).includes(".")) {
    req.url = `/v2/index.html${url.search}`;
  }
  next();
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_")
  const forbidden = ["GITHUB_TOKEN", "GIST_ID", "APPS_SCRIPT_URL", "GOOGLE_SHEETS_API_KEY"]
    .map((name) => `VITE_${name}`)
    .filter((name) => env[name])
  if (forbidden.length) throw new Error(`Unsafe client environment variables: ${forbidden.join(", ")}`)

  return {
    cacheDir: env.VITE_TEST_RUNTIME === "true" ? "node_modules/.vite-v2-tests" : undefined,
    build: { manifest: true, rollupOptions: { input: { main: 'index.html', v2: 'v2/index.html' } } },
    plugins: [
      {
        name: "magic-v2-entry",
        // Match the Vercel V2 rewrite in local dev and build preview.
        // https://vite.dev/guide/api-plugin.html#configureserver
        configureServer(server) { server.middlewares.use(v2Entry); },
        configurePreviewServer(server) { server.middlewares.use(v2Entry); },
      },
      react(),
      tailwindcss(),
    ],
  }
})
