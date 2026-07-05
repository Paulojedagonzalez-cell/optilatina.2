// Respaldo automático de Firestore (OptiLatina).
// Exporta todas las colecciones + settings a backups/latest.json.
// Se ejecuta a diario desde GitHub Actions. La config de Firebase es la
// misma pública del cliente; la lectura está permitida por las reglas.
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, getDoc } from "firebase/firestore";
import { writeFileSync, mkdirSync } from "node:fs";

const cfg = {
  apiKey: "AIzaSyAacxqRKfmdQ1AAqsT0d1T-lcQ0UxKDWKM",
  authDomain: "optilatina-595e2.firebaseapp.com",
  projectId: "optilatina-595e2",
  storageBucket: "optilatina-595e2.firebasestorage.app",
  messagingSenderId: "361156126696",
  appId: "1:361156126696:web:b4117c7ccb43a6c346e65d",
};
const db = getFirestore(initializeApp(cfg));

const COLLECTIONS = ["inventory", "sales", "orders", "deposits", "expenses", "investments", "recovery", "cierres"];
const SETTINGS = ["rate", "payments", "profilesData", "dynProfiles"];

const out = { _backupAt: new Date().toISOString() };
for (const c of COLLECTIONS) {
  const snap = await getDocs(collection(db, c));
  out[c] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
for (const k of SETTINGS) {
  const s = await getDoc(doc(db, "settings", k));
  out["setting_" + k] = s.exists() ? s.data().value : null;
}

mkdirSync("backups", { recursive: true });
writeFileSync("backups/latest.json", JSON.stringify(out, null, 2), "utf8");
console.log("Respaldo OK:", Object.fromEntries(COLLECTIONS.map(c => [c, out[c].length])));
process.exit(0);
