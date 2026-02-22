import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App.jsx";
import "./styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
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
