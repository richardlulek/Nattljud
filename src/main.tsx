import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./ui/App";
import "./styles.css";

// Offline-first: service workern cachar hela appen vid första besöket och
// uppdaterar sig själv i bakgrunden.
registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
