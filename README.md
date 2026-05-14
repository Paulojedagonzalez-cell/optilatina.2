# 🏪 Optilatina — Guía de instalación completa

## ⚡ Lo que necesitas (todo gratis)
- Cuenta en **github.com** (para guardar el código)
- Cuenta en **vercel.com** (para publicar la app)
- Cuenta en **firebase.google.com** (para la base de datos)

---

## PASO 1 — Configurar Firebase (base de datos) ~5 min

1. Ve a **console.firebase.google.com** → inicia sesión con Google
2. **"Crear un proyecto"** → nómbralo `optilatina` → Continuar
3. En el panel, haz clic en **"Firestore Database"** → **"Crear base de datos"**
   - Selecciona **"Comenzar en modo de prueba"** → Siguiente → Habilitar
4. Ve al ícono ⚙️ (engranaje) → **"Configuración del proyecto"**
5. Baja hasta **"Tus apps"** → clic en `</>` (Web)
6. Ponle nombre `optilatina` → **Registrar app**
7. Copia el objeto **`firebaseConfig`** que aparece — lo necesitarás en el siguiente paso

---

## PASO 2 — Poner tus credenciales en el código ~2 min

1. Abre el archivo `src/App.jsx` con cualquier editor de texto
2. Al inicio del archivo busca `FIREBASE_CONFIG` y reemplaza con tus valores:

```javascript
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSy...",        // ← tu apiKey
  authDomain:        "optilatina.firebaseapp.com",
  projectId:         "optilatina",
  storageBucket:     "optilatina.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123...",
};
```

---

## PASO 3 — Subir a GitHub ~3 min

1. Ve a **github.com** → Sign up (si no tienes cuenta) → New repository
2. Nómbralo `optilatina` → Public → **Create repository**
3. En la página del repo vacío, haz clic en **"uploading an existing file"**
4. Arrastra **TODOS** los archivos y carpetas del ZIP a la ventana
   - `src/` (carpeta completa)
   - `public/` (carpeta completa)
   - `package.json`
   - `vite.config.js`
   - `index.html`
   - `vercel.json`
5. Clic en **"Commit changes"**

---

## PASO 4 — Publicar en Vercel (la URL pública) ~2 min

1. Ve a **vercel.com** → Sign up con tu cuenta de GitHub
2. **"Add New Project"** → importa tu repo `optilatina`
3. Vercel detecta automáticamente que es Vite:
   - Build Command: `npm run build` ✓
   - Output Directory: `dist` ✓
4. Clic **Deploy** — espera ~1 minuto
5. ¡Listo! Obtienes una URL como `https://optilatina.vercel.app`

---

## PASO 5 — Instalar como app en el celular

### Android (Chrome)
1. Abre tu URL en Chrome
2. Menú ⋮ → **"Agregar a pantalla de inicio"**
3. ✅ Aparece como app nativa con ícono

### iPhone (Safari — NO Chrome)
1. Abre tu URL en **Safari**
2. Ícono 📤 compartir → **"Agregar a pantalla de inicio"**
3. ✅ Aparece como app nativa con ícono

---

## 🔄 Actualizar la app después

Cuando Claude te haga mejoras:
1. Descarga el `App.jsx` nuevo
2. Reemplaza `src/App.jsx` en GitHub (subir archivo)
3. Vercel detecta el cambio y republica en automático (~30 seg)

---

## 📊 Límites del plan gratis de Firebase

| Recurso | Límite gratis | Suficiente para... |
|---------|--------------|-------------------|
| Almacenamiento | 1 GB | ~10 años de ventas |
| Lecturas/día | 50,000 | Uso normal sin problema |
| Escrituras/día | 20,000 | +100 ventas/día |
| Conectado en tiempo real | Ilimitado | Todas las tiendas |
