import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "src",
  publicDir: "../public",
  envDir: "..",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/index.html"),
        admin: resolve(__dirname, "src/admin.html"),
      },
    },
  },
  test: {
    environment: "node",
    root: ".",
    include: ["tests/**/*.test.js"],
  },
});
