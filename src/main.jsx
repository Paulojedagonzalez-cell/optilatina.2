import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode><App /></StrictMode>
);

if ("serviceWorker" in navigator) {
  // Cuando el service worker nuevo toma el control, la página abierta sigue con
  // el JS viejo en memoria hasta recargar. Sin esto, una app instalada que nunca
  // se cierra del todo queda congelada en una versión antigua para siempre.
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });

  const checkForUpdate = async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return;
      await reg.update();                       // busca sw.js nuevo
      const w = reg.waiting || reg.installing;  // si hay uno esperando, actívalo ya
      if (w) w.postMessage("skipWaiting");
    } catch {}
  };

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then(checkForUpdate).catch(() => {});
  });
  // Al volver a la app (reabrir la PWA / cambiar de pestaña) revisa si hay
  // versión nueva — así se actualiza sola sin depender de recargar a mano.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForUpdate();
  });
}
