import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App.jsx";
import AppErrorBoundary from "./components/common/AppErrorBoundary.jsx";
import "./styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);

if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      const swBuildId = import.meta.env.VITE_SW_BUILD_ID || "prod";
      const swUrl = `/sw.js?v=${encodeURIComponent(swBuildId)}`;
      navigator.serviceWorker.register(swUrl, { updateViaCache: "none" }).catch((error) => {
        console.error("Service worker registration failed:", error);
      });
    });
  } else {
    // Avoid stale cache issues during Vite dev/HMR.
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister());
    });
  }
}
