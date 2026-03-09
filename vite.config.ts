import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { toastApiPlugin } from './server/viteToastPlugin.ts'
import { dataApiPlugin } from './server/viteDataPlugin.ts'

export default defineConfig(({ mode }) => {
  // Load .env vars into process.env so the server-side Toast plugin can use them.
  // Only non-VITE_ prefixed vars are loaded — credentials stay server-side only.
  const env = loadEnv(mode, process.cwd(), '')
  Object.assign(process.env, env)

  return {
    plugins: [react(), tailwindcss(), toastApiPlugin(), dataApiPlugin()],
  }
})
