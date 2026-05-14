import { StrictMode } from "react";
import { createRoot }  from "react-dom/client";
import App              from "./App.jsx";

// Mount app
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Register service worker (PWA offline support)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
