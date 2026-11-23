import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { radioReferencePlugin } from "./server/radioreference.ts";

export default defineConfig(({ mode }) => ({
  worker: { format: "es" },
  plugins: [
    react(),
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
    port: 5176,
    strictPort: true,
    headers: { "Permissions-Policy": "usb=(self)" },
  },
}));
