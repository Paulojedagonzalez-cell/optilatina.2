import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode><App /></StrictMode>
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
  // Cuando una version nueva del service worker toma el control, la pagina
  // ya abierta sigue con el JS viejo en memoria hasta que recarga — sin esto,
  // una app instalada que nunca se cierra del todo queda congelada en una
  // version antigua (con bugs ya corregidos) para siempre.
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
}
