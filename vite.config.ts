// vite.config.ts

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "popup.html"),
        sidepanel: resolve(__dirname, "sidepanel.html"),
        walletconnectApproval: resolve(__dirname, "walletconnect-approval.html"),
        walletconnectOffscreen: resolve(__dirname, "walletconnect-offscreen.html"),
        serviceWorker: resolve(__dirname, "src/background/service-worker.ts"),
        dappApproval: resolve(__dirname, "dapp-approval.html"),
        content: resolve(__dirname, "src/content/content.ts"),
        inpage: resolve(__dirname, "src/inpage/inpage.ts"),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === "serviceWorker") {
            return "background/service-worker.js";
          }
          if (chunkInfo.name === "content") {
            return "assets/content.js";
          }
          if (chunkInfo.name === "inpage") {
            return "assets/inpage.js";
          }

          return "assets/[name].js";
        },
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
  },
});