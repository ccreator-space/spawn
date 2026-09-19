import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
  server: { port: 5173, proxy: { "/api": "http://localhost:3001" } },
  build: { outDir: "dist-web" },
});
