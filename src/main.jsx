import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App.jsx";
import AppErrorBoundary from "./components/common/AppErrorBoundary.jsx";
import { initRuntimeMonitoring } from "./lib/monitoring/runtimeMonitor.js";
import "./styles/globals.css";

initRuntimeMonitoring();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);

if ("serviceWorker" in navigator) {
  const hostname = String(window.location.hostname || "").toLowerCase();
  const isLocalhost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]";

  if (import.meta.env.PROD && !isLocalhost) {
    window.addEventListener("load", () => {
      const swBuildId = import.meta.env.VITE_SW_BUILD_ID || "prod";
      const swUrl = `/sw.js?v=${encodeURIComponent(swBuildId)}`;
      navigator.serviceWorker.register(swUrl, { updateViaCache: "none" })
        .then((registration) => {
          if (registration.waiting) {
            window.dispatchEvent(new Event("app:update-ready"));
          }

          registration.addEventListener("updatefound", () => {
            const worker = registration.installing;
            if (!worker) return;
            worker.addEventListener("statechange", () => {
              if (worker.state === "installed" && navigator.serviceWorker.controller) {
                window.dispatchEvent(new Event("app:update-ready"));
              }
            });
          });
        })
        .catch((error) => {
          console.error("Service worker registration failed:", error);
        });
    });
  } else {
    // Avoid stale cache issues during Vite dev/HMR and localhost preview.
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister());
    });
  }
}
