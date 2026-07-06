// Sella el service worker con un ID único en cada build.
// Así, cada despliegue genera un sw.js distinto → el navegador detecta la
// versión nueva, la instala sola y recarga la app (adiós versiones pegadas
// en caché). Corre después de `vite build` (ver package.json).
import { readFileSync, writeFileSync } from "node:fs";

const file = "dist/sw.js";
const buildId = Date.now().toString(36);

let src = readFileSync(file, "utf8");
if (!src.includes("__BUILD_ID__")) {
  console.warn("stamp-sw: no se encontró __BUILD_ID__ en dist/sw.js (¿ya sellado?)");
}
src = src.replaceAll("__BUILD_ID__", buildId);
writeFileSync(file, src, "utf8");
console.log("stamp-sw: service worker sellado con build id", buildId);
