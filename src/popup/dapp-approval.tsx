// Must be first: installs the Buffer/global polyfills @solana/web3.js needs at
// runtime, before the wallet.service chunk (which bundles it) is evaluated.
import "../polyfills/buffer";
import React from "react";
import ReactDOM from "react-dom/client";
import DappApprovalPage from "./routes/DappApprovalPage";

import "../design-system/colors_and_type.css";
import "../design-system/ui_kits/extension/styles.css";
import "../ui/claude/styles/runtime-overrides.css";

document.documentElement.setAttribute("data-simple-surface", "approval");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DappApprovalPage />
  </React.StrictMode>,
);
