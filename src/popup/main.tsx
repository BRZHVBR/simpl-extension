// Must be first: installs the Buffer/global polyfills @solana/web3.js needs at
// runtime, before any Solana code (reached via walletService) is evaluated.
import "../polyfills/buffer";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

import "../design-system/colors_and_type.css";
import "../design-system/ui_kits/extension/styles.css";
import "../ui/claude/styles/runtime-overrides.css";

if (new URLSearchParams(window.location.search).get("surface") === "fullscreen") {
  document.documentElement.setAttribute("data-simple-surface", "fullscreen");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);