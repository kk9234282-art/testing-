import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  build: {
    rollupOptions: { input: { main: "index.html", scanner: "scanner.html" } },
  },
  server: { proxy: { "/api": "http://127.0.0.1:3001" } },
});
