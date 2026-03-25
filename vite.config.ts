import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  root: "src/frontend",
  build: {
    outDir: "../../dist-frontend",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
