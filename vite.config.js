import { defineConfig, loadEnv } from 'vite'
import process from 'node:process'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_")
  const forbidden = ["GITHUB_TOKEN", "GIST_ID", "APPS_SCRIPT_URL", "GOOGLE_SHEETS_API_KEY"]
    .map((name) => `VITE_${name}`)
    .filter((name) => env[name])
  if (forbidden.length) throw new Error(`Unsafe client environment variables: ${forbidden.join(", ")}`)

  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
  }
})
