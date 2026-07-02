import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        // Separar librerias en chunks propios: al actualizar la app los
        // usuarios solo re-descargan el codigo que cambio, no React/Firebase
        manualChunks: {
          react:    ["react", "react-dom"],
          firebase: ["firebase/app", "firebase/firestore"],
        },
      },
    },
  },
});
