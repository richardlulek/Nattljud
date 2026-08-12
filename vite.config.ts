import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Fristående PWA. Sätt NATTLJUD_BASE om appen serveras under en undermapp,
// t.ex. NATTLJUD_BASE=/nattljud/ npm run build
export default defineConfig({
  base: process.env.NATTLJUD_BASE ?? "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/*.png", "spike.html"],
      manifest: {
        id: "nattljud",
        name: "Nattljud – lugna ljud för bebis",
        short_name: "Nattljud",
        description:
          "Vitt brus och lugna ljud för bebis. Fungerar offline, hela natten, utan tracking.",
        lang: "sv",
        dir: "ltr",
        start_url: ".",
        scope: ".",
        display: "standalone",
        orientation: "portrait",
        background_color: "#06070c",
        theme_color: "#06070c",
        categories: ["kids", "lifestyle", "utilities"],
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest,ico}"],
        navigateFallback: "index.html",
        // Spike-sidan ska serveras som egen sida, inte falla tillbaka till appen.
        navigateFallbackDenylist: [/spike\.html$/],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
});
