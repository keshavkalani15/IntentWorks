import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // `import.meta.dirname` rather than `__dirname`: Vite 8's native config loader does
      // not provide CommonJS globals and warns on them.
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Everything under /api goes to the Worker. Keeping it same-origin from the browser's
      // point of view means the session cookie just works, with no CORS dance in development.
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: false,
      },
    },
  },
})
