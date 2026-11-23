import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { radioReferencePlugin } from "./server/radioreference.ts";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => ({
  worker: { format: "es" },
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src/pwa",
      filename: "sw.js",
      registerType: "prompt",
      injectRegister: false,
      includeManifestIcons: false,
      manifest: {
        id: "/",
        name: "Spectrum — RTL-SDR Analyzer",
        short_name: "Spectrum",
        description:
          "A local spectrum analyzer and radio decoder for RTL-SDR. Receive, decode, and record IQ offline.",
        lang: "en",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#101419",
        theme_color: "#101419",
        categories: ["utilities", "productivity"],
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      injectManifest: {
        globPatterns: [
          "**/*.{js,css,html,wasm,woff,woff2,png,svg,json,webmanifest,txt,md,c,sh,gz}",
        ],
        maximumFileSizeToCacheInBytes: 16 * 1024 * 1024,
        rollupFormat: "iife",
      },
      devOptions: { enabled: false },
    }),
    radioReferencePlugin(
      process.env.RR_APP_KEY ||
        loadEnv(mode, process.cwd(), "RR_").RR_APP_KEY ||
        "",
    ),
  ],
  server: {
    host: "127.0.0.1",
    port: 5176,
    strictPort: true,
    headers: { "Permissions-Policy": "usb=(self)" },
  },
  preview: {
    host: "127.0.0.1",
    port: 5177,
    strictPort: true,
    headers: { "Permissions-Policy": "usb=(self)" },
  },
}));
