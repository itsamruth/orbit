import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", proxy: { "/api": "http://127.0.0.1:4319" } },
  build: { outDir: "../dist/ui", emptyOutDir: true, sourcemap: false },
});
