import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// This optional build only publishes the isolated browser demonstration. The
// ordinary Next/vinext frontend continues to use its existing configuration.
export default defineConfig({
  root: fileURLToPath(new URL("./demo", import.meta.url)),
  base: "/ku-ai/",
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: [
      { find: "next/link", replacement: fileURLToPath(new URL("./demo/link.tsx", import.meta.url)) },
      { find: "next/navigation", replacement: fileURLToPath(new URL("./demo/navigation.ts", import.meta.url)) },
    ],
  },
  define: {
    "process.env.NEXT_PUBLIC_BANDAL_DEMO": JSON.stringify("1"),
    "process.env.NEXT_PUBLIC_BANDAL_DEMO_BASE": JSON.stringify("/ku-ai"),
    "process.env.NEXT_PUBLIC_BLUEPRINT_API_BASE_URL": JSON.stringify("/api/blueprint"),
    "process.env.NEXT_PUBLIC_BLUEPRINT_READER_DIAGNOSTICS": JSON.stringify("0"),
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "../dist-demo",
    emptyOutDir: true,
    target: "es2022",
  },
});
