import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ── Utilidades globales ───────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const today = () => new Date().toISOString().slice(0,10);
const weekStart = () => { const d=new Date(); d.setDate(d.getDate()-d.getDay()); return d.toISOString().slice(0,10); };

// ══════════════════════════════════════════════════════════════════════════════
// FIREBASE DATABASE LAYER — Firestore (tiempo real + offline incluido)
// ══════════════════════════════════════════════════════════════════════════════
// 🔧  REEMPLAZA CON TU CONFIGURACIÓN DE FIREBASE
//     Firebase Console → Tu proyecto → Configuración → Apps web → firebaseConfig
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyAacxqRKfmdQ1AAqsT0d1T-lcQ0UxKDWKM",
  authDomain:        "optilatina-595e2.firebaseapp.com",
  projectId:         "optilatina-595e2",
  storageBucket:     "optilatina-595e2.firebasestorage.app",
  messagingSenderId: "361156126696",
  appId:             "1:361156126696:web:b4117c7ccb43a6c346e65d",
};

const CONFIGURED = true; // Firebase configurado ✓

// ── Firebase imports (npm, via Vite) ─────────────────────────────────────────
import {
  initializeApp, getApps,
} from "firebase/app";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDocs, setDoc, deleteDoc,
  onSnapshot, query, orderBy, writeBatch, getDoc,
} from "firebase/firestore";

// Inicializar solo una vez
const firebaseApp = getApps().length
  ? getApps()[0]
  : initializeApp(FIREBASE_CONFIG);

const db = CONFIGURED
  ? initializeFirestore(firebaseApp, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    })
  : null;

// ── CRUD helpers ──────────────────────────────────────────────────────────────
const DB = {
  async getAll(col, orderField = "createdAt") {
    if (!db) return [];
    try {
      const q = query(collection(db, col), orderBy(orderField, "asc"));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch {
      const snap = await getDocs(collection(db, col));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
  },

  async upsertMany(col, items) {
    if (!db || !items?.length) return;
    // Firestore batch: máx 500 ops por batch
    const BATCH_SIZE = 490;
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      items.slice(i, i + BATCH_SIZE).forEach(item => {
        batch.set(doc(db, col, item.id), item, { merge: true });
      });
      await batch.commit();
    }
  },

  async set(col, id, data) {
    if (!db) return;
    await setDoc(doc(db, col, id), data, { merge: true });
  },

  async delete(col, id) {
    if (!db) return;
    await deleteDoc(doc(db, col, id));
  },

  async deleteAll(col, ids) {
    if (!db || !ids?.length) return;
    const BATCH_SIZE = 490;
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      ids.slice(i, i + BATCH_SIZE).forEach(id => batch.delete(doc(db, col, id)));
      await batch.commit();
    }
  },

  async getSetting(key) {
    if (!db) return null;
    const snap = await getDoc(doc(db, "settings", key));
    return snap.exists() ? snap.data().value : null;
  },

  async setSetting(key, value) {
    if (!db) return;
    await setDoc(doc(db, "settings", key), {
      value, updatedAt: new Date().toISOString()
    });
  },

  // Suscripción en tiempo real — llama callback cuando cambia la colección
  listen(col, callback) {
    if (!db) return () => {};
    return onSnapshot(collection(db, col), snap => {
      callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  },

  listenSetting(key, callback) {
    if (!db) return () => {};
    return onSnapshot(doc(db, "settings", key), snap => {
      if (snap.exists()) callback(snap.data().value);
    });
  },
};

// ── Load all data on startup ──────────────────────────────────────────────────
async function dbLoadAll() {
  if (!CONFIGURED) return null;
  try {
    // Timeout de 5s: si Firebase no responde, la app arranca con datos locales
    const _timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Firebase timeout")), 5000));
    const [inventory, sales, expenses, deposits, investments, orders,
           rate, payments, profilesData, dynProfiles] = await Promise.race([Promise.all([
      DB.getAll("inventory", "name"),
      DB.getAll("sales",     "date"),
      DB.getAll("expenses",  "createdAt"),
      DB.getAll("deposits",  "date"),
      DB.getAll("investments","date"),
      DB.getAll("orders",    "createdAt"),
      DB.getSetting("rate"),
      DB.getSetting("payments"),
      DB.getSetting("profilesData"),
      DB.getSetting("dynProfiles"),
    ]), _timeout]);
    return { inventory, sales, expenses, deposits, investments, orders,
             rate, payments, profilesData, dynProfiles };
  } catch (e) {
    console.error("Firebase load error:", e);
    return null;
  }
}

// ── Save functions ────────────────────────────────────────────────────────────
async function dbSaveInventory(items) {
  await DB.upsertMany("inventory", items.map(p => ({
    id: p.id, name: p.name, cat: p.cat,
    cost: p.cost, price: p.price,
    isService: p.isService ?? false,
    serials: p.serials ?? [],
    photo: p.photo ?? null,
    description: p.description ?? "",
    storeId: p.storeId ?? null,
    createdAt: p.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })));
}

async function dbDeleteInventoryItem(id) { await DB.delete("inventory", id); }

async function dbSaveSales(newSales) {
  await DB.upsertMany("sales", newSales.map(s => ({
    id: s.id, saleId: s.saleId, date: s.date,
    note: s.note ?? "", paymentMethod: s.paymentMethod,
    registeredBy: s.registeredBy, storeId: s.storeId,
    productId: s.productId, productName: s.productName,
    cat: s.cat, cost: s.cost, price: s.price, qty: s.qty,
    total: s.total, profit: s.profit, totalBs: s.totalBs ?? null,
    serials: s.serials ?? [],
    frameType: s.frameType ?? null, crystalType: s.crystalType ?? null,
    lab: s.lab ?? null, labCost: s.labCost ?? 0, rx: s.rx ?? null,
    createdAt: s.createdAt ?? new Date().toISOString(),
  })));
}

async function dbSaveExpenses(items) {
  await DB.upsertMany("expenses", items.map(e => ({
    id: e.id, cat: e.cat, amount: e.amount,
    month: e.month ?? null, date: e.date ?? null, note: e.note ?? "",
    createdAt: e.createdAt ?? new Date().toISOString(),
  })));
}

async function dbSaveDeposits(items) {
  await DB.upsertMany("deposits", items.map(d => ({
    id: d.id, date: d.date, amount: d.amount, note: d.note ?? "",
    createdAt: d.createdAt ?? new Date().toISOString(),
  })));
}

async function dbSaveInvestments(items) {
  await DB.upsertMany("investments", items.map(i => ({
    id: i.id, date: i.date, amount: i.amount,
    description: i.description ?? "", note: i.note ?? "",
    createdAt: i.createdAt ?? new Date().toISOString(),
  })));
}

async function dbSaveSetting(key, value) { await DB.setSetting(key, value); }

// Legacy shims
const KEYS = {};
const load = async () => null;
const useIsMobile = () => {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  useEffect(() => {
    const fn = () => setM(window.innerWidth < 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return m;
};

// Instalación como app (PWA): captura el evento del navegador para ofrecer instalar
const useInstallPrompt = () => {
  const [deferred, setDeferred] = useState(null);
  const [installed, setInstalled] = useState(() =>
    typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true)
  );
  useEffect(() => {
    const onPrompt = e => { e.preventDefault(); setDeferred(e); };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  const isIOS = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch {}
    setDeferred(null);
  };
  return { canInstall: !!deferred, installed, isIOS, install };
};

// ── SVG Icons ─────────────────────────────────────────────────────────────────
const Svg = ({d,s=20}) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={d}/></svg>;
const IHome   = () => <Svg d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>;
const IBox    = () => <Svg d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>;
const IChart  = () => <Svg d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>;
const IWeek   = () => <Svg d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>;
const IPlus   = () => <Svg d="M12 4v16m8-8H4" s={18}/>;
const ITrash  = () => <Svg d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" s={16}/>;
const IEdit   = () => <Svg d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" s={16}/>;
const IClose  = () => <Svg d="M6 18L18 6M6 6l12 12" s={18}/>;
const ICheck  = () => <Svg d="M5 13l4 4L19 7" s={18}/>;
const ILogout = () => <Svg d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" s={18}/>;

const IStats  = () => <Svg d="M16 8v8m-4-5v5m-4-2v2M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>;
const IGear   = () => <Svg d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z"/>;
const IPerson = () => <Svg d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>;
const ICash   = () => <Svg d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"/>;
const ICard   = () => <Svg d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/>;
const IUsers  = () => <Svg d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/>;
const ISend   = () => <Svg d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" s={18}/>;
const IKey    = () => <Svg d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/>;
const IDeposit= () => <Svg d="M19 14l-7 7m0 0l-7-7m7 7V3"/>;


const TEAL = "#0e7a8c";
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
input,select{outline:none}button{cursor:pointer}
::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:#080c14}::-webkit-scrollbar-thumb{background:#1a3a3e;border-radius:4px}
.card{background:#071418;border:1px solid #0d2a30;border-radius:16px;padding:22px}
.card-sm{background:#071418;border:1px solid #0d2a30;border-radius:12px;padding:16px}
.nav-btn{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;border:none;background:transparent;color:#2a5a60;font-family:'Outfit',sans-serif;font-size:14px;font-weight:500;transition:background .2s,color .2s;width:100%;text-align:left;cursor:pointer}
.nav-btn:hover{background:#081e22;color:#6abbc8}
.nav-btn.active{background:#0c2e35;color:#2dcfe8;box-shadow:inset 0 0 0 1px #1a5060}
.btn-p{background:linear-gradient(135deg,#0a6070,#0e7a8c);color:#fff;border:none;border-radius:10px;padding:10px 20px;font-family:'Outfit',sans-serif;font-size:14px;font-weight:600;display:flex;align-items:center;gap:6px;transition:all .2s;cursor:pointer}
.btn-p:hover{opacity:.9;transform:translateY(-1px)}
.btn-g{background:transparent;border:1px solid #0d2a30;color:#2a5a60;border-radius:8px;padding:7px 14px;font-family:'Outfit',sans-serif;font-size:13px;transition:all .2s;cursor:pointer}
.btn-g:hover{border-color:#1a5060;color:#6abbc8}
.btn-d{background:#2a1010;border:1px solid #4a1a1a;color:#f87171;border-radius:8px;padding:7px 11px;font-family:'Outfit',sans-serif;font-size:13px;cursor:pointer}
.btn-d:hover{background:#3a1414}
.field{display:flex;flex-direction:column;gap:6px}
.field label{font-size:11px;color:#2a5060;font-weight:600;text-transform:uppercase;letter-spacing:.07em}
.field input,.field select{background:#050e10;border:1px solid #0d2a30;border-radius:8px;padding:10px 13px;color:#e2e8f4;font-family:'Outfit',sans-serif;font-size:14px;transition:border .2s}
.field input:focus,.field select:focus{border-color:#0e7a8c}
.field select option{background:#071418}
table{width:100%;border-collapse:collapse}
th{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#1a4a50;font-weight:600;padding:10px 14px;text-align:left;border-bottom:1px solid #081820}
td{padding:11px 14px;border-bottom:1px solid #071015;font-size:14px}
tr:last-child td{border-bottom:none}
tr:hover td{background:#061215}
.ov{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:100;display:flex;align-items:center;justify-content:center;padding:20px}
.modal{background:#071c22;border:1px solid #0d2a30;border-radius:20px;padding:28px;width:100%;max-width:500px;max-height:85vh;overflow-y:auto}
.badge{display:inline-block;padding:3px 9px;border-radius:20px;font-size:11px;font-weight:600}
.bb{background:#0d2a38;color:#2dcfe8}.bg{background:#0f2820;color:#34d399}.ba{background:#2a1e08;color:#fbbf24}.br{background:#2a0c0c;color:#f87171}.bv{background:#1e1440;color:#a78bfa}
.prod-card{background:#071418;border:1px solid #0d2a30;border-radius:12px;padding:13px 14px;cursor:pointer;transition:border-color .18s,background .18s;text-align:left;color:#e2e8f4;font-family:'Outfit',sans-serif;width:100%}
.prod-card:hover{border-color:#1a5060;background:#091c22}
.prod-card.sel{border-color:#0e7a8c;background:#071e25}
.qty-btn{background:#081820;border:1px solid #0d2a40;color:#e2e8f4;width:36px;height:36px;border-radius:8px;font-size:18px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background .15s}
.qty-btn:hover{background:#0d2a40}
@keyframes popin{0%{transform:scale(.85);opacity:0}60%{transform:scale(1.04)}100%{transform:scale(1);opacity:1}}
@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
.popin{animation:popin .3s ease forwards}
@keyframes fadein{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
.fadein{animation:fadein .22s ease forwards}
.profile-card{background:#071418;border:1px solid #0d2a30;border-radius:20px;padding:32px 28px;cursor:pointer;transition:all .25s;display:flex;flex-direction:column;align-items:center;gap:14px;min-width:180px}
.profile-card:hover{transform:translateY(-6px);border-color:#1a5060;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.period-btn{background:transparent;border:1px solid #0d2a30;border-radius:20px;padding:5px 16px;font-family:'Outfit',sans-serif;font-size:12px;color:#2a5060;cursor:pointer;transition:all .2s}
.period-btn.active{background:#0c2e35;border-color:#1a5060;color:#2dcfe8}
/* Responsive grids */
.rg2{display:grid;grid-template-columns:1fr 1fr;gap:13px}
.rg3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:13px}
.rg4{display:grid;grid-template-columns:repeat(4,1fr);gap:13px}
@media(max-width:767px){
  .rg2{grid-template-columns:1fr}
  .rg3{grid-template-columns:1fr 1fr}
  .rg4{grid-template-columns:1fr 1fr}
}

/* ── Mobile bottom nav ── */
.mob-nav{display:none}
.mob-header{display:none}
@media(max-width:767px){
  .desk-sidebar{display:none!important}
  .mob-nav{display:flex;position:fixed;bottom:0;left:0;right:0;background:#050f12;border-top:1px solid #0a2028;z-index:50;padding:4px 0 max(4px,env(safe-area-inset-bottom))}
  .mob-header{display:flex;align-items:center;justify-content:space-between;background:#050f12;border-bottom:1px solid #0a2028;padding:10px 16px;position:sticky;top:0;z-index:40}
  .mob-nav-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 2px;border:none;background:transparent;color:#2a5060;font-family:'Outfit',sans-serif;font-size:10px;cursor:pointer;transition:color .2s}
  .mob-nav-btn.active{color:#2dcfe8}
  .mob-nav-btn svg{width:22px;height:22px}
  .mob-main{padding:14px 12px 80px!important}
  .card{padding:14px!important}
  .card-sm{padding:11px!important}
  table{font-size:12px}
  th,td{padding:8px 10px!important}
  [style*="1fr 1fr"]{grid-template-columns:1fr!important}
  [style*="1fr 1fr 1fr"]{grid-template-columns:1fr 1fr!important}
  [style*="repeat(3,1fr)"]{grid-template-columns:1fr 1fr!important}
  [style*="repeat(4,1fr)"]{grid-template-columns:1fr 1fr!important}
  [style*="1fr auto"]{grid-template-columns:1fr!important}
  /* Tablas anchas: scroll horizontal en vez de aplastarse */
  .card{overflow-x:auto!important}
  .card table{min-width:560px}
  /* Modales comodos en pantallas chicas */
  .ov{padding:10px}
  .modal{padding:18px!important;border-radius:16px;max-height:92vh}
  h1{font-size:22px!important}
  .profile-card{min-width:140px;padding:22px 18px}
}
`;

// ══════════════════════════════════════════════════════════════════════════════
const fmtUSD = (n=0) => "$"+Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtBs  = (n=0,r=36) => "Bs "+Number(n*r).toLocaleString("es-VE",{minimumFractionDigits:2,maximumFractionDigits:2});
const getStock = p => p.isService ? 999 : (p.serials ? p.serials.length : (p.stock || 0));

// Codigos internos generados para unidades sin serial (ajustes y cantidad rapida)
const isAutoCode = s => /^(AJ-|U-)/.test(s);
const genAutoCodes = n => Array.from({length:n}, (_,i) => `U-${Date.now().toString(36)}${i}`);
const fmtSerials = arr => {
  if (!arr?.length) return "—";
  const real = arr.filter(s => !isAutoCode(s));
  const auto = arr.length - real.length;
  return [...real, ...(auto ? [`${auto} sin código`] : [])].join(", ");
};

// ── Metodos de pago (Venezuela): cada uno con su moneda ──────────────────────
// Bs entra por Pago Movil y Transferencia; USD por Efectivo y Zelle; USDT aparte.
const METHOD_INFO = {
  efectivo:      {label:"Efectivo",      icon:"💵", cur:"USD"},
  zelle:         {label:"Zelle",         icon:"💸", cur:"USD"},
  usdt:          {label:"USDT",          icon:"₮",  cur:"USDT"},
  pagoMovil:     {label:"Pago Móvil",    icon:"📱", cur:"Bs"},
  transferencia: {label:"Transferencia", icon:"🏦", cur:"Bs"},
};
// Ventas viejas usan ids legacy: cash → efectivo, bank → pagoMovil
const normMethod = m => m==="cash" ? "efectivo" : m==="bank" ? "pagoMovil" : (m || "efectivo");
const methodCur  = m => METHOD_INFO[normMethod(m)]?.cur || "USD";
const methodLbl  = m => { const i = METHOD_INFO[normMethod(m)]; return i ? `${i.icon} ${i.label}` : m; };

// Suma entradas de dinero por metodo y moneda (ventas directas + abonos de apartados)
const moneyIn = (salesList, ordersList, fromDate, toDate) => {
  const inRange = d => d && d >= fromDate && d <= toDate;
  const acc = {}; // {metodo: {usd, bs}}
  const add = (method, usd, bs) => {
    const m = normMethod(method);
    if (!acc[m]) acc[m] = {usd:0, bs:0};
    acc[m].usd += usd; acc[m].bs += bs;
  };
  salesList.forEach(s => { if (inRange(s.date)) add(s.paymentMethod, s.total, s.totalBs ?? 0); });
  ordersList.forEach(o => (o.payments||[]).forEach(p => {
    if (inRange(p.date)) add(p.method, p.amount, p.amountBs ?? 0);
  }));
  let totUSD = 0, totBs = 0, totUSDT = 0;
  Object.entries(acc).forEach(([m,v]) => {
    const cur = methodCur(m);
    if (cur === "Bs") totBs += v.bs || 0;
    else if (cur === "USDT") totUSDT += v.usd;
    else totUSD += v.usd;
  });
  return {byMethod: acc, totUSD, totBs, totUSDT};
};

const orderPaid    = o => (o.payments||[]).reduce((s,p)=>s+p.amount,0);
const orderBalance = o => Math.max(0, (o.total||0) - orderPaid(o));

// Umbral de reposicion por producto (configurable; 3 por defecto)
const lowAt = p => p.minStock ?? 3;
const isLow = p => !p.isService && getStock(p) <= lowAt(p);

// ── Telefonos internacionales ─────────────────────────────────────────────────
const CC_LIST = [
  ["+58","🇻🇪 Venezuela"],["+57","🇨🇴 Colombia"],["+1","🇺🇸 USA/Canadá"],["+52","🇲🇽 México"],
  ["+34","🇪🇸 España"],["+55","🇧🇷 Brasil"],["+51","🇵🇪 Perú"],["+56","🇨🇱 Chile"],
  ["+54","🇦🇷 Argentina"],["+593","🇪🇨 Ecuador"],["+507","🇵🇦 Panamá"],["+506","🇨🇷 Costa Rica"],
  ["+591","🇧🇴 Bolivia"],["+595","🇵🇾 Paraguay"],["+598","🇺🇾 Uruguay"],["+53","🇨🇺 Cuba"],
];
const splitPhone = value => {
  const m = (value || "").match(/^(\+\d{1,3})\s*(.*)$/);
  return m ? [m[1], m[2]] : ["+58", value || ""];
};
function PhoneInput({ value, onChange }) {
  const [cc, num] = splitPhone(value);
  const ccValid = CC_LIST.some(c => c[0] === cc) ? cc : "+58";
  return (
    <div style={{display:"flex",gap:6}}>
      <select value={ccValid} onChange={e=>onChange(num ? `${e.target.value} ${num}` : e.target.value + " ")}
        style={{width:120,flexShrink:0}}>
        {CC_LIST.map(([c,l]) => <option key={c} value={c}>{l} {c}</option>)}
      </select>
      <input style={{flex:1,minWidth:0}} type="tel" placeholder="412 1234567" value={num}
        onChange={e=>onChange(`${ccValid} ${e.target.value.replace(/[^\d\s-]/g,"")}`)}/>
    </div>
  );
}
const phoneDigits = p => (p || "").replace(/\D/g, "");

// Comprimir imagen antes de guardar — Firestore limita cada documento a 1MB,
// una foto de camara sin comprimir rompe la sincronizacion silenciosamente.
const compressImage = (file, maxDim = 640, quality = 0.72) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = reject;
    img.src = ev.target.result;
  };
  r.onerror = reject;
  r.readAsDataURL(file);
});

const CATS = ["Montura","Lente","Lente de contacto","Accesorio","Servicio","Otro"];
const FRAME_TYPES = ["Clásica","Metálica","Sin aro","Deportiva","Aviador","Redonda","Cuadrada","Ojo de gato","Wraparound","Otro"];
const CRYSTAL_TYPES = ["Monofocal","Progresivo","Bifocal","Antirreflejante","Fotocromático","Polarizado","UV400","Blue-Cut","Otro"];
const LAB_LIST = ["Sin laboratorio","LUX","INDO","HOYA","Shamir","Essilor","Kodak","Zeiss","Rodenstock","Otro"];

const DEFAULT_PAYMENTS = { usdt:{address:"",network:"TRC20"}, zelle:{email:"",phone:"",name:""}, bank:{bank:"",account:"",phone:"",name:""} };
const DEFAULT_PROFILES_DATA = { owner:{name:"P.G",email:"",phone:""}, rene:{name:"René",email:"",phone:""}, local:{name:"Tienda",email:"",phone:""} };
const DEFAULT_DYN_PROFILES = [
  {id:"owner",        name:"P.G",       role:"admin", color:"#0e7a8c", pin:"1290", storeName:null,          address:null,     phone:"", email:"", description:"Propietario", photo:null},
  {id:"rene",         name:"René",      role:"admin", color:"#10b981", pin:"2607", storeName:null,          address:null,     phone:"", email:"", description:"Socio",       photo:null},
  {id:"store_chinita",name:"OptiLatina",role:"store", color:"#f59e0b", pin:"0000", storeName:"Optilatina",  address:"Chinita",phone:"", email:"", description:"",            photo:null},
];
const PROFILES = DEFAULT_DYN_PROFILES;
const PROFIT_SPLIT = { owner:0.55, rene:0.45 };

// Logo components — SVG inline (no depende de archivos externos)
const LOGO_B64 = "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";
// Logo de la FRANQUICIA OptiLatina (circular dorado/azul) — identidad principal de la app
const Logo = ({s=34}) => <img src="/icon-192.png?v=6" alt="OptiLatina" style={{width:s,height:s,borderRadius:"50%",objectFit:"cover"}}/>;
// Logo de la DISTRIBUIDORA (lentes) — marca secundaria, acompaña a la franquicia
const LogoDist = ({s=26}) => <img src={`data:image/jpeg;base64,${LOGO_B64}`} alt="Distribuidora" style={{width:s,height:s,borderRadius:s*.22,objectFit:"cover"}}/>;
const LOGO2_B64 = "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";
const Logo2 = ({s=44}) => <img src={`data:image/jpeg;base64,${LOGO2_B64}`} style={{width:s,height:s,borderRadius:s*.15,objectFit:"cover"}}/>;

const PAY_METHODS = [
  {id:"efectivo",      label:"Efectivo",       icon:"💵"},
  {id:"usdt",          label:"USDT",           icon:"🔐"},
  {id:"zelle",         label:"Zelle",          icon:"💳"},
  {id:"transferencia", label:"Transferencia",  icon:"🏦"},
  {id:"pagoMovil",     label:"Pago Móvil",    icon:"📱"},
];
const EXPENSE_CATS = [
  {id:"alquiler",   label:"Alquiler",        icon:"🏠", dueDay:15, schedule:"Día 15 de cada mes",    defaultAmt:null},
  {id:"nomina",     label:"Nómina",          icon:"👥", dueDay:null, schedule:"Día 1 y 15 de cada mes ($300 c/u · $600 mensual)", defaultAmt:300},
  {id:"redes",      label:"Redes sociales",  icon:"📲", dueDay:15, schedule:"Día 15 de cada mes",    defaultAmt:null},
  {id:"condominio", label:"Condominio",      icon:"🏢", dueDay:-1, schedule:"Último día del mes",    defaultAmt:null},
  {id:"wifi",       label:"WiFi",            icon:"📶", dueDay:-1, schedule:"Último día del mes",    defaultAmt:null},
  {id:"otro",       label:"Otro",            icon:"📋", dueDay:null, schedule:null,                  defaultAmt:null},
];
const IMoney = () => <Svg d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>;
const ITag   = () => <Svg d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" s={16}/>;
const IBarcode=() => <Svg d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" s={16}/>;
const IEye    = () => <Svg d="M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" s={18}/>;
const IRefresh= () => <Svg d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" s={16}/>;

// Boton "Actualizar": recarga los datos de la nube y busca version nueva de la app
function RefreshBtn({ refreshData, label = true, style = {} }) {
  const [st, setSt] = useState("idle"); // idle | busy | ok | err
  const go = async () => {
    if (st === "busy") return;
    setSt("busy");
    const ok = await refreshData();
    setSt(ok ? "ok" : "err");
    setTimeout(() => setSt("idle"), 2500);
  };
  return (
    <button className="btn-g" onClick={go} title="Recargar datos de la nube"
      style={{display:"flex",alignItems:"center",gap:6,justifyContent:"center",fontSize:12, ...style}}>
      <span style={{display:"inline-flex",animation:st==="busy"?"spin 1s linear infinite":"none"}}><IRefresh/></span>
      {label && (st==="busy" ? "Actualizando…" : st==="ok" ? "✓ Actualizado" : st==="err" ? "Sin conexión" : "Actualizar")}
    </button>
  );
}
const ILock   = () => <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#e8c96a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>;
const IEyeOff = () => <Svg d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" s={18}/>;

export default function App() {
  const [profile,      setProfile]      = useState(null);
  const [inventory,    setInventory]    = useState([]);
  const [sales,        setSales]        = useState([]);
  const [deposits,     setDeposits]     = useState([]);
  const [expenses,     setExpenses]     = useState([]);
  const [investments,  setInvestments]  = useState([]);
  const [orders,       setOrders]       = useState([]); // apartados con abonos
  const [rate,         setRateState]    = useState(36.5);
  const [payments,     setPayments]     = useState(DEFAULT_PAYMENTS);
  const [profilesData, setProfilesData] = useState(DEFAULT_PROFILES_DATA);
  const [dynProfiles,  setDynProfiles]  = useState(DEFAULT_DYN_PROFILES);
  const [storeFilter,  setStoreFilter]  = useState("all"); // "all" | storeId
  const [viewAs,       setViewAs]       = useState(null);  // owner viendo la app como otro perfil
  const [recovery,     setRecovery]     = useState([]);    // solicitudes de recuperacion de acceso
  const [loading,      setLoading]      = useState(true);

  useEffect(() => {
    (async () => {
      // 1) Hidratar desde el respaldo local al instante — la app arranca ya,
      //    sin esperar a Firebase. Firebase sobreescribe despues si responde.
      let hadBackup = false;
      try {
        const raw = localStorage.getItem("ol_backup");
        if (raw) {
          const b = JSON.parse(raw);
          hadBackup = true;
          if (b.inventory?.length) setInventory(b.inventory);
          setSales(b.sales ?? []);
          setDeposits(b.deposits ?? []);
          setExpenses(b.expenses ?? []);
          setInvestments(b.investments ?? []);
          setOrders(b.orders ?? []);
          if (b.rate         != null) setRateState(b.rate);
          if (b.payments     != null) setPayments(b.payments);
          if (b.profilesData != null) setProfilesData(b.profilesData);
          if (b.dynProfiles?.length)  setDynProfiles(b.dynProfiles);
        }
      } catch {}
      if (hadBackup) setLoading(false);

      if (!CONFIGURED) {
        if (!hadBackup) { setInventory([]); setSales([]); }
        setLoading(false); return;
      }
      // 2) Cargar de Firebase (fuente de verdad cuando esta disponible)
      const data = await dbLoadAll();
      if (data) {
        setInventory(data.inventory ?? []);
        setSales(data.sales ?? []);
        setDeposits(data.deposits ?? []);
        setExpenses(data.expenses ?? []);
        setInvestments(data.investments ?? []);
        setOrders(data.orders ?? []);
        if (data.rate         !== null) setRateState(data.rate);
        if (data.payments     !== null) setPayments(data.payments);
        if (data.profilesData !== null) setProfilesData(data.profilesData);
        if (data.dynProfiles  !== null) setDynProfiles(data.dynProfiles);
      }
      setLoading(false);
    })();
  }, []);

  // Respaldo local automatico: cada cambio se guarda en el dispositivo,
  // asi los datos sobreviven recargas aunque Firebase no responda.
  // Con debounce y SIN fotos: serializar las fotos base64 en cada cambio
  // bloqueaba el hilo principal y congelaba la app con varias pestañas
  // abiertas (las fotos siempre se recuperan desde Firestore).
  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem("ol_backup", JSON.stringify({
          inventory: inventory.map(({photo, ...rest}) => rest),
          sales, deposits, expenses, investments, orders,
          rate, payments, profilesData,
          dynProfiles: dynProfiles.map(({photo, storeLogo, ...rest}) => rest),
        }));
      } catch {}
    }, 1500);
    return () => clearTimeout(t);
  }, [loading, inventory, sales, deposits, expenses, investments, orders, rate, payments, profilesData, dynProfiles]);

  // Sesion recordada: si el usuario marco "Recordar mi sesion", entrar directo
  useEffect(() => {
    if (loading) return;
    try {
      const raw = localStorage.getItem("ol_session");
      if (raw) {
        const { id } = JSON.parse(raw);
        if (id && dynProfiles.find(p => p.id === id)) setProfile(prev => prev ?? id);
      }
    } catch {}
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime listeners — Firebase onSnapshot sincroniza automáticamente entre dispositivos
  useEffect(() => {
    if (!profile || !CONFIGURED) return;
    const unsubs = [
      DB.listen("inventory",   d => setInventory(d)),
      DB.listen("sales",       d => setSales(d)),
      DB.listen("expenses",    d => setExpenses(d)),
      DB.listen("deposits",    d => setDeposits(d)),
      DB.listen("investments", d => setInvestments(d)),
      DB.listen("orders",      d => setOrders(d)),
      DB.listen("recovery",    d => setRecovery(d)),
      DB.listenSetting("rate",          v => setRateState(v)),
      DB.listenSetting("payments",      v => setPayments(v)),
      DB.listenSetting("profilesData",  v => setProfilesData(v)),
      DB.listenSetting("dynProfiles",   v => setDynProfiles(v)),
    ];
    return () => unsubs.forEach(u => u());
  }, [profile]);

  // Save callbacks
  const saveInv = useCallback(async d => {
    const removed = inventory.filter(p => !d.find(x => x.id === p.id));
    setInventory(d);
    await dbSaveInventory(d);
    await Promise.all(removed.map(p => dbDeleteInventoryItem(p.id)));
  }, [inventory]);

  const saveSal = useCallback(async d => {
    const newItems = d.filter(s => !sales.find(x => x.id === s.id));
    setSales(d);
    if (newItems.length) await dbSaveSales(newItems);
  }, [sales]);

  const saveOrders = useCallback(async d => {
    const removed = orders.filter(o => !d.find(x => x.id === o.id));
    setOrders(d);
    await DB.upsertMany("orders", d);
    await Promise.all(removed.map(o => DB.delete("orders", o.id)));
  }, [orders]);

  const saveDeposits    = useCallback(async d => { setDeposits(d);    await dbSaveDeposits(d);    }, []);
  const saveExpenses    = useCallback(async d => { setExpenses(d);    await dbSaveExpenses(d);    }, []);
  const saveInvestments = useCallback(async d => { setInvestments(d); await dbSaveInvestments(d); }, []);
  const saveRate        = useCallback(async r => { setRateState(r);   await dbSaveSetting("rate", r); }, []);
  const savePayments    = useCallback(async d => { setPayments(d);    await dbSaveSetting("payments", d); }, []);
  const savePD          = useCallback(async d => { setProfilesData(d);await dbSaveSetting("profilesData", d); }, []);
  const saveDynProfiles = useCallback(async d => { setDynProfiles(d); await dbSaveSetting("dynProfiles", d); }, []);

  // Actualizar: recarga todos los datos de Firestore y busca app nueva
  const refreshData = useCallback(async () => {
    try { const rs = await navigator.serviceWorker?.getRegistrations?.(); rs?.forEach(r => r.update()); } catch {}
    const data = await dbLoadAll();
    if (!data) return false;
    setInventory(data.inventory ?? []);
    setSales(data.sales ?? []);
    setDeposits(data.deposits ?? []);
    setExpenses(data.expenses ?? []);
    setInvestments(data.investments ?? []);
    setOrders(data.orders ?? []);
    if (data.rate         !== null) setRateState(data.rate);
    if (data.payments     !== null) setPayments(data.payments);
    if (data.profilesData !== null) setProfilesData(data.profilesData);
    if (data.dynProfiles  !== null) setDynProfiles(data.dynProfiles);
    return true;
  }, []);

  if (loading) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#040d10",fontFamily:"'Outfit',sans-serif",color:"#1a4a50",fontSize:16}}>
      <style>{CSS}</style>
      <div style={{textAlign:"center",maxWidth:460,padding:24}}>
        <div style={{marginBottom:12}}><Logo s={60}/></div>
        {CONFIGURED
          ? <><div style={{color:"#2dcfe8",fontSize:18,fontWeight:700,marginBottom:6}}>OptiLatina</div><div>Conectando con Firebase…</div></>
          : (<>
              <div style={{color:"#fbbf24",fontSize:18,fontWeight:700,marginBottom:10}}>⚠️ Configura Firebase</div>
              <div style={{background:"#071418",border:"1px solid #1a3a10",borderRadius:12,padding:"16px",textAlign:"left",fontSize:13,color:"#a0c0b0",lineHeight:1.8}}>
                <div style={{color:"#2dcfe8",fontWeight:600,marginBottom:6}}>Pasos rápidos:</div>
                <div>1. Ve a <strong style={{color:"#fbbf24"}}>console.firebase.google.com</strong></div>
                <div>2. Nuevo proyecto → Firestore Database → Crear</div>
                <div>3. Configuración → Apps Web → Registrar app</div>
                <div>4. Copia <code style={{color:"#f87171"}}>firebaseConfig</code> en las primeras líneas del código</div>
              </div>
              <div style={{marginTop:10,color:"#1a4a50",fontSize:11}}>Funciona con datos demo hasta que configures Firebase</div>
            </>)
        }
      </div>
    </div>
  );

  const handleLogin = (id, remember) => {
    setProfile(id);
    try {
      if (remember) localStorage.setItem("ol_session", JSON.stringify({ id }));
      else localStorage.removeItem("ol_session");
    } catch {}
  };
  const handleLogout = () => {
    setProfile(null);
    try { localStorage.removeItem("ol_session"); } catch {}
  };

  if (!profile) return <LoginScreen onSelect={handleLogin} dynProfiles={dynProfiles} />;
  const p = dynProfiles.find(x => x.id === profile);
  // Cambio directo de perfil (solo owner, desde Gestion): entra de lleno al
  // otro perfil. La sesion recordada sigue siendo la suya — al recargar vuelve.
  const switchTo = id => { setViewAs(null); setProfile(id); };
  const shared = { inventory, sales, rate, deposits, expenses, investments, orders, recovery, payments, profilesData, dynProfiles, storeFilter, setStoreFilter, saveInv, saveSal, saveRate, saveDeposits, savePayments, savePD, saveExpenses, saveInvestments, saveOrders, saveDynProfiles, setViewAs, switchTo, refreshData, onLogout:handleLogout };

  // "Ver como": el propietario puede ver la app tal cual la ve otro perfil
  if (viewAs && p?.id === "owner") {
    const vp = dynProfiles.find(x => x.id === viewAs);
    if (vp) {
      const sharedAs = { ...shared, onLogout: () => setViewAs(null) };
      return (
        <div>
          <div style={{position:"fixed",top:0,left:0,right:0,zIndex:2000,background:"linear-gradient(90deg,#5a4408,#8a6a10)",color:"#f5e6b8",display:"flex",justifyContent:"center",alignItems:"center",gap:12,padding:"7px 12px",fontFamily:"'Outfit',sans-serif",fontSize:13,flexWrap:"wrap"}}>
            <IEye/> Viendo como <strong>{vp.role==="store" ? `${vp.storeName||"Tienda"} — ${vp.address||""}` : vp.name}</strong>
            <span style={{fontSize:11,opacity:.75}}>(lo que hagas aquí se registra a nombre de este perfil)</span>
            <button onClick={()=>setViewAs(null)} style={{background:"#040d10",border:"none",borderRadius:8,color:"#e8c96a",padding:"5px 14px",cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontSize:12,fontWeight:600}}>← Volver a mi panel</button>
          </div>
          <div style={{paddingTop:40}}>
            {vp.role === "store"
              ? <StoreView profile={vp} {...sharedAs} />
              : <AdminView profile={vp} {...sharedAs} />}
          </div>
        </div>
      );
    }
  }

  return p?.role === "store"
    ? <StoreView  profile={p} {...shared} />
    : <AdminView  profile={p} {...shared} />;
}

// ── Login por invitación: usuario/correo + contraseña, sin perfiles visibles ──
function LoginScreen({ onSelect, dynProfiles }) {
  const [user,     setUser]     = useState("");
  const [pw,       setPw]       = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [remember, setRemember] = useState(true);
  const [error,    setError]    = useState("");
  const [forgot,   setForgot]   = useState(false);
  const [recEmail, setRecEmail] = useState("");
  const [recSent,  setRecSent]  = useState(null); // true | "error"
  const [busy,     setBusy]     = useState(false);
  const [iosHelp,  setIosHelp]  = useState(false);
  const { canInstall, installed, isIOS, install } = useInstallPrompt();

  const owner = dynProfiles.find(p => p.id === "owner");

  // Solicitud de recuperacion: se guarda en la nube y le aparece como
  // alerta al administrador en su panel (sin servicios de correo).
  const sendRecovery = async () => {
    const u = recEmail.trim().toLowerCase();
    if (!u) { setRecSent("vacio"); return; }
    try {
      const id = "req_" + u.replace(/[^a-z0-9@._-]/g, "_").slice(0, 60);
      await DB.set("recovery", id, { id, user: u, date: today(), createdAt: new Date().toISOString(), status: "pendiente" });
      setRecSent(true);
    } catch { setRecSent("error"); }
  };

  const tryLogin = () => {
    setError("");
    const u = user.trim().toLowerCase();
    if (!u || !pw) { setError("Escribe tu usuario y contraseña."); return; }
    setBusy(true);
    // Si el perfil tiene correo, el usuario es SOLO el correo.
    // Si no tiene, se acepta el nombre (o la tienda) mientras tanto.
    const p = dynProfiles.find(x => {
      if (x.email?.trim()) return x.email.trim().toLowerCase() === u;
      return x.name?.trim().toLowerCase() === u ||
        (x.role === "store" && (x.address?.trim().toLowerCase() === u || `${x.storeName||""} ${x.address||""}`.trim().toLowerCase() === u));
    });
    const ok = p && (p.password ? pw === p.password : pw === (p.pin || "0000"));
    setTimeout(() => { // pequeña pausa para no delatar si el usuario existe
      setBusy(false);
      if (ok) { onSelect(p.id, remember); }
      else setError("Usuario o contraseña incorrectos.");
    }, 350);
  };

  return (
    <div style={{minHeight:"100vh",background:"#040d10",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,fontFamily:"'Outfit',sans-serif"}}>
      <style>{CSS}</style>
      <div style={{width:"100%",maxWidth:400,display:"flex",flexDirection:"column",gap:18}}>
        <div style={{textAlign:"center",marginBottom:6}}>
          <div style={{width:90,height:90,margin:"0 auto 14px",borderRadius:"50%",overflow:"hidden",boxShadow:"0 0 46px #c9a22745"}}><Logo s={90}/></div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
            <div style={{fontSize:30,fontWeight:800,color:"#e8c96a",letterSpacing:".01em"}}>OptiLatina</div>
            <span style={{fontSize:10,fontWeight:700,color:"#fbbf24",background:"#2a2008",border:"1px solid #4a3810",borderRadius:6,padding:"2px 7px",letterSpacing:".08em"}}>BETA</span>
          </div>
          <div style={{fontSize:12,color:"#3a5a68",marginTop:4,textTransform:"uppercase",letterSpacing:".22em"}}>Plataforma de gestión</div>
          <div style={{fontSize:11,color:"#2a5a60",marginTop:8,lineHeight:1.5}}>Versión de prueba · la estamos afinando este mes</div>
        </div>

        <div className="field">
          <label>Usuario o correo</label>
          <input autoFocus placeholder="tu nombre o tu@correo.com" value={user}
            onChange={e=>setUser(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter")tryLogin();}}
            style={{padding:"13px 15px",fontSize:15,borderRadius:12}}/>
        </div>
        <div className="field">
          <label>Contraseña</label>
          <div style={{display:"flex",gap:6}}>
            <input type={showPw?"text":"password"} placeholder="••••••••" value={pw}
              onChange={e=>setPw(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter")tryLogin();}}
              style={{flex:1,minWidth:0,padding:"13px 15px",fontSize:15,borderRadius:12}}/>
            <button onClick={()=>setShowPw(s=>!s)} title={showPw?"Ocultar contraseña":"Mostrar contraseña"}
              style={{background:"#071418",border:"1px solid #0d2a30",borderRadius:12,padding:"0 15px",color:"#3a7a88",cursor:"pointer",display:"flex",alignItems:"center"}}>{showPw?<IEyeOff/>:<IEye/>}</button>
          </div>
          <div style={{textAlign:"right",marginTop:6}}>
            <button onClick={()=>setForgot(true)} style={{background:"transparent",border:"none",color:"#2a5a60",cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontSize:12,textDecoration:"underline"}}>¿Olvidaste tu contraseña?</button>
          </div>
        </div>

        {error&&<div style={{background:"#2a0c0c",border:"1px solid #5a1a1a",borderRadius:10,padding:"11px 14px",fontSize:13,color:"#f87171"}}>{error}</div>}

        <button className="btn-p" onClick={tryLogin} disabled={busy}
          style={{justifyContent:"center",padding:"14px",fontSize:15,borderRadius:12,opacity:busy?.6:1}}>
          {busy?"Verificando…":"Entrar"}
        </button>

        <label style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,fontSize:13,color:"#2a5a60",cursor:"pointer",userSelect:"none"}}>
          <input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)} style={{accentColor:"#0e7a8c",width:16,height:16}}/>
          Recordar mi sesión en este dispositivo
        </label>

        <div style={{textAlign:"center",fontSize:12,color:"#1a4a50",lineHeight:1.6}}>
          ¿Necesitas una cuenta? Pídesela al administrador —<br/>el acceso es únicamente por invitación.
        </div>

        {/* Instalar como app en el teléfono */}
        {!installed && (canInstall || isIOS) && (
          <div style={{marginTop:2}}>
            {canInstall ? (
              <button onClick={install} className="btn-g" style={{width:"100%",justifyContent:"center",display:"flex",alignItems:"center",gap:8,padding:"11px",borderColor:"#0e3a4a",color:"#2dcfe8"}}>
                📲 Instalar como app en este dispositivo
              </button>
            ) : (
              <button onClick={()=>setIosHelp(v=>!v)} className="btn-g" style={{width:"100%",justifyContent:"center",display:"flex",alignItems:"center",gap:8,padding:"11px",borderColor:"#0e3a4a",color:"#2dcfe8"}}>
                📲 Instalar como app en tu iPhone
              </button>
            )}
            {iosHelp && (
              <div style={{fontSize:11,color:"#7a94a8",lineHeight:1.6,marginTop:8,background:"#050f12",border:"1px solid #0a2028",borderRadius:10,padding:"11px 14px"}}>
                En tu iPhone, con Safari: toca el botón <strong style={{color:"#2dcfe8"}}>Compartir</strong> (el cuadrito con la flecha ↑) abajo, baja y elige <strong style={{color:"#2dcfe8"}}>"Agregar a inicio"</strong>. Quedará como una app más en tu pantalla.
              </div>
            )}
          </div>
        )}

        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:9,marginTop:8,paddingTop:16,borderTop:"1px solid #081820"}}>
          <LogoDist s={22}/>
          <span style={{fontSize:11,color:"#2a4a55",letterSpacing:".04em"}}>Franquicia de ópticas · Distribuidora OptiLatina</span>
        </div>
      </div>

      {forgot && (
        <div className="ov" onClick={e=>{if(e.target===e.currentTarget)setForgot(false);}}>
          <div className="modal" style={{maxWidth:400,textAlign:"center"}}>
            <div style={{marginBottom:8,display:"flex",justifyContent:"center"}}><ILock/></div>
            <div style={{fontSize:17,fontWeight:700,color:"#fff",marginBottom:8}}>Recuperar acceso</div>
            {recSent === true ? (
              <div style={{marginBottom:14}}>
                <div style={{background:"#06231a",border:"1px solid #14503a",borderRadius:10,padding:"14px",fontSize:13,color:"#34d399",lineHeight:1.6}}>
                  ✓ Solicitud enviada. El administrador la verá en su panel
                  y te hará llegar una invitación con tu acceso nuevo.
                </div>
              </div>
            ) : (
              <>
                <div style={{fontSize:13,color:"#7a94a8",lineHeight:1.6,marginBottom:14}}>
                  Escribe tu correo o usuario y envía la solicitud — le llegará
                  como alerta al administrador y él restablece tu acceso.
                </div>
                <div style={{display:"flex",gap:6,marginBottom:12}}>
                  <input type="email" placeholder="tu@correo.com" value={recEmail} onChange={e=>{setRecEmail(e.target.value);setRecSent(null);}}
                    onKeyDown={e=>{if(e.key==="Enter")sendRecovery();}}
                    style={{flex:1,minWidth:0,background:"#050e10",border:"1px solid #0d2a30",borderRadius:10,padding:"11px 13px",color:"#e2e8f4",fontFamily:"'Outfit',sans-serif",fontSize:14,outline:"none"}}/>
                </div>
                {recSent==="vacio" && <div style={{fontSize:12,color:"#f87171",marginBottom:10}}>Escribe tu correo o usuario primero.</div>}
                {recSent==="error" && <div style={{fontSize:12,color:"#f87171",marginBottom:10}}>No se pudo enviar. Contacta directo a {owner?.name||"P.G"} (Administrador).</div>}
                <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap",marginBottom:14}}>
                  <button className="btn-p" style={{fontSize:13}} onClick={sendRecovery}>Enviar solicitud al administrador</button>
                  {phoneDigits(owner?.phone) && (
                    <a href={`https://wa.me/${phoneDigits(owner.phone)}?text=${encodeURIComponent(`Hola! Necesito restablecer mi acceso a OptiLatina. Mi correo/usuario: ${recEmail || ""}`)}`}
                      target="_blank" rel="noreferrer" className="btn-g" style={{textDecoration:"none",fontSize:13,display:"inline-flex",alignItems:"center"}}>Por WhatsApp</a>
                  )}
                </div>
              </>
            )}
            <button className="btn-g" onClick={()=>{setForgot(false);setRecSent(null);}}>Entendido</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Store View (pantalla tienda) ──────────────────────────────────────────────
function StoreView({ profile, inventory, sales, rate, payments, dynProfiles, orders, saveOrders, saveInv, saveSal, refreshData, onLogout }) {
  const [lines,      setLines]     = useState([]);
  const [note,       setNote]      = useState("");
  const [method,     setMethod]    = useState("cash");
  const [showApart,  setShowApart] = useState(false);
  const [success,    setSuccess]   = useState(null);
  const [catF,       setCatF]      = useState("Todos");
  const [addStockM,  setAddStockM] = useState(false);
  // Prescription modal
  const [rxLine,     setRxLine]    = useState(null); // line id that needs Rx
  const [rx,         setRx]        = useState({od:{sphere:"",cylinder:"",axis:""},oi:{sphere:"",cylinder:"",axis:""},add:""});
  const [frameType,  setFrameType] = useState(FRAME_TYPES[0]);
  const [crystalType,setCrystalType]=useState(CRYSTAL_TYPES[0]);
  const [labCost,    setLabCost]   = useState("");
  const [lab,        setLab]       = useState(LAB_LIST[0]);
  const [camera,     setCamera]    = useState(false); // camera modal

  const METHODS = [
    {id:"cash",          label:"Efectivo",      icon:"💵", currency:"USD", detail:null},
    {id:"zelle",         label:"Zelle",         icon:"💸", currency:"USD", detail:payments?.zelle?.name ? `${payments.zelle.name} — ${payments.zelle.email||payments.zelle.phone}` : null},
    {id:"usdt",          label:"USDT",          icon:"₮",  currency:"USDT", detail:payments?.usdt?.address ? `${payments.usdt.network} · ${payments.usdt.address}` : null},
    {id:"bank",          label:"Pago Móvil",    icon:"📱", currency:"Bs",  detail:payments?.bank?.name ? `${payments.bank.bank} · ${payments.bank.phone} · ${payments.bank.name}` : null},
    {id:"transferencia", label:"Transferencia", icon:"🏦", currency:"Bs",  detail:payments?.bank?.account ? `${payments.bank.bank} · ${payments.bank.account} · ${payments.bank.name}` : null},
  ];
  const selMethod = METHODS.find(m=>m.id===method);

  const todaySales = sales.filter(s => s.date===today());
  const todayRev   = todaySales.reduce((s,v)=>s+v.total,0);

  const resolved = lines.map(r => {
    const p = inventory.find(x=>x.id===r.productId);
    if (!p) return {...r,product:null,subtotal:0,profit:0};
    return {...r,product:p,subtotal:p.price*r.qty,profit:(p.price-p.cost)*r.qty};
  });
  const total  = resolved.reduce((s,r)=>s+r.subtotal,0);
  const profit = resolved.reduce((s,r)=>s+r.profit,0);
  const valid  = resolved.length>0 && resolved.every(r=>r.product && r.qty>0);
  const stockWarn = resolved.filter(r=>r.product && !r.product.isService && r.qty>getStock(r.product));

  const toggleProduct = p => {
    const has = lines.find(l=>l.productId===p.id);
    if (has) setLines(l=>l.filter(r=>r.productId!==p.id));
    else setLines(l=>[...l,{id:uid(),productId:p.id,qty:1}]);
  };
  const changeQty = (id,v) => setLines(l=>l.map(r=>r.id===id?{...r,qty:Math.max(1,v)}:r));

  const handleSale = async () => {
    if (!valid || stockWarn.length>0) return;
    const saleId=uid(), newSales=[...sales];
    const labC = Number(labCost)||0;
    const newInv = inventory.map(p=>({...p}));
    resolved.forEach(r=>{
      const prodInv = newInv.find(p=>p.id===r.product.id);
      let assignedSerials = [];
      if (prodInv && !prodInv.isService && prodInv.serials) {
        // Consumir primero las unidades sin codigo; los seriales reales
        // se conservan en stock hasta que se vendan especificamente
        const ordered = [...prodInv.serials].sort((a,b)=>(isAutoCode(a)?0:1)-(isAutoCode(b)?0:1));
        assignedSerials = ordered.slice(0, r.qty);
        prodInv.serials = ordered.slice(r.qty);
      }
      const lineLabCost = labC / resolved.length;
      const isBs = methodCur(method) === "Bs"; // Pago Móvil / Transferencia = Bs
      newSales.push({
        id:uid(), saleId, date:today(), note, paymentMethod:method,
        registeredBy:profile.id, storeId:profile.id,
        productId:r.product.id, productName:r.product.name, cat:r.product.cat,
        cost:r.product.cost, price:r.product.price, qty:r.qty,
        total:r.subtotal + lineLabCost, profit:r.profit,
        totalBs: isBs ? (r.subtotal + lineLabCost) * rate : null, // monto en Bs (pago móvil / transferencia)
        serials:assignedSerials,
        frameType, crystalType, lab, labCost:lineLabCost,
        rx: (r.product.cat==="Lente"||r.product.cat==="Lente de contacto") ? rx : null,
      });
    });
    await saveSal(newSales); await saveInv(newInv);
    setSuccess({total: total+labC, profit});
    setTimeout(()=>{setSuccess(null);setLines([]);setNote("");setMethod("cash");setLabCost("");setRx({od:{sphere:"",cylinder:"",axis:""},oi:{sphere:"",cylinder:"",axis:""},add:""});},3000);
  };

  const isMobile = useIsMobile();

  const [searchQ, setSearchQ] = useState("");
  const filteredInv = useMemo(() => inventory.filter(p => {
    if (p.isService ? false : getStock(p) < 1) return false;
    if (searchQ) return p.name.toLowerCase().includes(searchQ.toLowerCase());
    return catF === "Todos" || p.cat === catF;
  }), [inventory, searchQ, catF]);

  // Payment methods breakdown for today
  const todayByMethod = METHODS.map(m => ({
    ...m,
    rev: todaySales.filter(s=>s.paymentMethod===m.id||(m.id==="cash"&&s.paymentMethod==="efectivo")).reduce((s,v)=>s+v.total,0)
  })).filter(m=>m.rev>0);

  // Quick inventory adjust state
  const [adjustProd, setAdjustProd] = useState(null);
  const [adjustQty,  setAdjustQty]  = useState(1);
  const [adjustMode, setAdjustMode] = useState("add"); // "add" | "remove"

  const handleAdjust = async () => {
    if (!adjustProd) return;
    const newInv = inventory.map(p => {
      if (p.id !== adjustProd.id || p.isService) return p;
      const current = p.serials || [];
      if (adjustMode === "add") {
        // Add N generic serials
        const news = Array.from({length:adjustQty}, (_,i) => `AJ-${Date.now()}-${i}`);
        return {...p, serials:[...current,...news]};
      } else {
        return {...p, serials: current.slice(0, Math.max(0, current.length - adjustQty))};
      }
    });
    await saveInv(newInv);
    setAdjustProd(null);
  };

  return (
    <div style={{fontFamily:"'Outfit',sans-serif",background:"#040d10",color:"#e2e8f4",display:"flex",flexDirection:"column",height:isMobile?"auto":"100dvh",minHeight:isMobile?"100svh":"100dvh",overflow:isMobile?"auto":"hidden"}}>
      <style>{CSS}</style>

      {showApart && (
        <div style={{position:"fixed",inset:0,background:"#040d10",zIndex:200,overflow:"auto",padding:"16px"}}>
          <div style={{maxWidth:920,margin:"0 auto"}}>
            <button className="btn-g" onClick={()=>setShowApart(false)} style={{marginBottom:14}}>← Volver a ventas</button>
            <ApartadosTab orders={orders||[]} saveOrders={saveOrders} rate={rate} profile={profile} isMobile={isMobile}/>
          </div>
        </div>
      )}

      {success && (
        <div className="popin" style={{position:"fixed",inset:0,background:"rgba(2,8,10,.95)",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:10}}>
          <div style={{fontSize:72}}>✅</div>
          <div style={{fontSize:26,fontWeight:800,color:"#34d399"}}>¡Venta registrada!</div>
          <div style={{fontSize:18,color:"#1a5060"}}>Total <span style={{color:"#fff",fontFamily:"'JetBrains Mono',monospace"}}>{fmtUSD(success.total)}</span></div>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:14,color:"#fbbf24"}}>{fmtBs(success.total,rate)}</div>
        </div>
      )}

      {/* ── HEADER ── */}
      <div style={{background:"#050f12",borderBottom:"1px solid #0a2028",padding:isMobile?"10px 14px":"12px 20px",flexShrink:0}}>
        {/* Row 1: Logo + Store info + Back */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            {/* Store logo or default */}
            <div style={{width:isMobile?38:44,height:isMobile?38:44,borderRadius:isMobile?8:10,overflow:"hidden",flexShrink:0,border:`2px solid ${profile.color}40`}}>
              {profile.storeLogo
                ? <img src={profile.storeLogo} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="logo"/>
                : <Logo2 s={isMobile?38:44}/>
              }
            </div>
            <div>
              <div style={{fontSize:isMobile?14:16,fontWeight:800,color:"#fff",letterSpacing:"-.01em",display:"flex",alignItems:"center",gap:6}}>{profile.storeName||"OptiLatina"}<span style={{fontSize:9,color:"#fbbf24",fontWeight:700,background:"#2a2008",border:"1px solid #4a3810",borderRadius:5,padding:"1px 5px"}}>BETA</span></div>
              <div style={{fontSize:isMobile?11:13,fontWeight:600,color:profile.color,marginTop:1}}>{profile.address}</div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <button className="btn-p" style={{fontSize:11,padding:"6px 10px",display:"flex",alignItems:"center",gap:4,background:"linear-gradient(135deg,#7a5a0a,#b8860b)"}} onClick={()=>setShowApart(true)}>🧾{isMobile?"":" Apartados"}{orders?.filter(o=>o.status!=="entregado"&&orderBalance(o)>0).length>0&&<span style={{background:"#2a1e08",borderRadius:10,padding:"0 6px",fontSize:10}}>{orders.filter(o=>o.status!=="entregado"&&orderBalance(o)>0).length}</span>}</button>
            <RefreshBtn refreshData={refreshData} label={false} style={{padding:"6px 10px"}}/>
            <button className="btn-p" style={{fontSize:11,padding:"6px 10px",display:"flex",alignItems:"center",gap:4}} onClick={()=>setCamera(true)}>📷{isMobile?"":" Escanear"}</button>
            <button onClick={()=>setAddStockM(true)} className="btn-p" style={{fontSize:11,padding:"6px 10px",display:"flex",alignItems:"center",gap:4}}><IPlus/>{isMobile?"":" Stock"}</button>
            <button onClick={onLogout} className="btn-g" style={{fontSize:11,padding:"6px 10px",display:"flex",alignItems:"center",gap:4,borderColor:"#1a3040"}}>
              <ILogout/>{isMobile?"Salir":" Cambiar perfil"}
            </button>
          </div>
        </div>

        {/* Row 2: Today's stats */}
        <div style={{display:"flex",gap:isMobile?8:14,alignItems:"center",flexWrap:"wrap"}}>
          <div style={{background:"#071c22",border:"1px solid #0a2a30",borderRadius:10,padding:"7px 14px",display:"flex",gap:16,alignItems:"center"}}>
            <div>
              <div style={{fontSize:9,color:"#1a4a50",letterSpacing:".07em"}}>VENTAS HOY</div>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:isMobile?15:17,fontWeight:700,color:"#2dcfe8"}}>{fmtUSD(todayRev)}</div>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:"#fbbf24"}}>{fmtBs(todayRev,rate)}</div>
            </div>
            <div style={{width:1,height:36,background:"#0a2a30"}}/>
            <div>
              <div style={{fontSize:9,color:"#1a4a50",letterSpacing:".07em"}}>TRANSACCIONES</div>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:isMobile?15:17,fontWeight:700,color:"#a78bfa"}}>{todaySales.length}</div>
            </div>
          </div>
          {/* Payment method pills */}
          {todayByMethod.map(m=>(
            <div key={m.id} style={{background:"#071418",border:"1px solid #0a2028",borderRadius:8,padding:"5px 10px",display:"flex",alignItems:"center",gap:5}}>
              <span style={{fontSize:14}}>{m.icon}</span>
              <div>
                <div style={{fontSize:9,color:"#1a4050"}}>{m.label}</div>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"#e2e8f4",fontWeight:600}}>{fmtUSD(m.rev)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modals */}
      {camera && <CameraModal onClose={()=>setCamera(false)} onDetect={code=>{
        const matched = inventory.find(p=>p.serials?.includes(code));
        if (matched) {
          setLines(l=>l.some(r=>r.productId===matched.id)?l:[...l,{id:uid(),productId:matched.id,qty:1}]);
          setCamera(false);
        } else {
          setCamera(false);
          alert(`Código: ${code}\nNo encontrado en inventario.`);
        }
      }}/>}

      {addStockM && <InvModal item={null} inventory={inventory} saveInv={saveInv} onClose={()=>setAddStockM(false)} rate={rate}/>}

      {/* Quick inventory adjust modal */}
      {adjustProd && (
        <div className="ov" onClick={e=>{if(e.target===e.currentTarget)setAdjustProd(null);}}>
          <div className="modal" style={{maxWidth:360}}>
            <div style={{fontSize:16,fontWeight:700,color:"#fff",marginBottom:16,display:"flex",justifyContent:"space-between"}}>
              📦 Ajustar stock
              <button style={{background:"transparent",border:"none",color:"#2a4060",cursor:"pointer",fontSize:20}} onClick={()=>setAdjustProd(null)}>×</button>
            </div>
            <div style={{fontSize:13,color:"#a0c8d0",marginBottom:14}}>{adjustProd.name}</div>
            <div style={{fontSize:11,color:"#1a4a50",marginBottom:10}}>Stock actual: <strong style={{color:"#2dcfe8"}}>{getStock(adjustProd)} unidades</strong></div>
            <div style={{display:"flex",gap:8,marginBottom:12}}>
              {[["add","➕ Agregar"],["remove","➖ Reducir"]].map(([m,l])=>(
                <button key={m} onClick={()=>setAdjustMode(m)} style={{flex:1,background:adjustMode===m?"#0c2e35":"transparent",border:`1px solid ${adjustMode===m?"#0e7a8c":"#0a2028"}`,borderRadius:8,padding:"8px",fontSize:12,color:adjustMode===m?"#2dcfe8":"#2a4060",cursor:"pointer",fontFamily:"'Outfit',sans-serif"}}>{l}</button>
              ))}
            </div>
            <div className="field" style={{marginBottom:16}}>
              <label>Cantidad</label>
              <input type="number" min="1" value={adjustQty} onChange={e=>setAdjustQty(Math.max(1,parseInt(e.target.value)||1))}/>
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button className="btn-g" onClick={()=>setAdjustProd(null)}>Cancelar</button>
              <button className="btn-p" onClick={handleAdjust}><ICheck/>Confirmar ajuste</button>
            </div>
          </div>
        </div>
      )}

      {/* Prescription modal */}
      {rxLine && (
        <div className="ov" onClick={e=>{if(e.target===e.currentTarget)setRxLine(null);}}>
          <div className="modal" style={{maxWidth:520}}>
            <div style={{fontSize:16,fontWeight:700,color:"#fff",marginBottom:16,display:"flex",justifyContent:"space-between"}}>
              🔬 Fórmula óptica
              <button style={{background:"transparent",border:"none",color:"#2a4060",cursor:"pointer"}} onClick={()=>setRxLine(null)}><IClose/></button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
              {[["od","OD — Ojo derecho"],["oi","OI — Ojo izquierdo"]].map(([eye,label])=>(
                <div key={eye} style={{background:"#050f12",border:"1px solid #0a2028",borderRadius:10,padding:"12px"}}>
                  <div style={{fontSize:11,fontWeight:600,color:"#2dcfe8",marginBottom:10}}>{label}</div>
                  {[["sphere","Esfera"],["cylinder","Cilindro"],["axis","Eje"]].map(([f,l])=>(
                    <div key={f} className="field" style={{marginBottom:8}}>
                      <label style={{fontSize:10}}>{l}</label>
                      <input type="number" step="0.25" placeholder="0.00" value={rx[eye][f]}
                        onChange={e=>setRx(r=>({...r,[eye]:{...r[eye],[f]:e.target.value}}))}
                        style={{padding:"7px 10px",fontSize:13}}/>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
              <div className="field"><label>ADD (adición)</label><input type="number" step="0.25" placeholder="0.00" value={rx.add} onChange={e=>setRx(r=>({...r,add:e.target.value}))}/></div>
              <div className="field"><label>DP (distancia pupilar)</label><input type="number" step="0.5" placeholder="62" value={rx.pd||""} onChange={e=>setRx(r=>({...r,pd:e.target.value}))}/></div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
              <div className="field"><label>Tipo de montura</label>
                <select value={frameType} onChange={e=>setFrameType(e.target.value)}>
                  {FRAME_TYPES.map(t=><option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="field"><label>Tipo de cristal</label>
                <select value={crystalType} onChange={e=>setCrystalType(e.target.value)}>
                  {CRYSTAL_TYPES.map(t=><option key={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:18}}>
              <div className="field"><label>Laboratorio</label>
                <select value={lab} onChange={e=>setLab(e.target.value)}>
                  {LAB_LIST.map(t=><option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="field"><label>Costo laboratorio (USD)</label>
                <input type="number" min="0" placeholder="0.00" value={labCost} onChange={e=>setLabCost(e.target.value)}/>
              </div>
            </div>
            <div style={{display:"flex",justifyContent:"flex-end",gap:10}}>
              <button className="btn-g" onClick={()=>setRxLine(null)}>Cancelar</button>
              <button className="btn-p" onClick={()=>setRxLine(null)}><ICheck/>Guardar fórmula</button>
            </div>
          </div>
        </div>
      )}

      <div style={{display:isMobile?"flex":"grid",flexDirection:isMobile?"column":"unset",gridTemplateColumns:isMobile?"unset":"1fr 340px",flex:1,overflow:isMobile?"auto":"hidden"}}>

        {/* Catálogo */}
        <div style={{overflow:"auto",padding:isMobile?"12px 10px":"14px 16px",borderRight:isMobile?"none":"1px solid #0f1825",borderBottom:isMobile?"1px solid #0f1825":"none",maxHeight:isMobile?"55vmax":"100%"}}>
          {/* Search + filters */}
          <div style={{marginBottom:10}}>
            <input
              placeholder="🔍 Buscar producto..."
              value={searchQ}
              onChange={e=>setSearchQ(e.target.value)}
              style={{width:"100%",background:"#071418",border:"1px solid #0a2028",borderRadius:8,padding:"8px 12px",color:"#e2e8f4",fontFamily:"'Outfit',sans-serif",fontSize:13,outline:"none",marginBottom:8}}
            />
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {["Todos",...CATS].map(c=>(
                <button key={c} onClick={()=>{setCatF(c);setSearchQ("");}} style={{background:catF===c&&!searchQ?"#0f1e35":"transparent",border:`1px solid ${catF===c&&!searchQ?"#1e3a60":"#141e30"}`,color:catF===c&&!searchQ?"#60a5fa":"#2a4060",borderRadius:16,padding:isMobile?"3px 9px":"4px 12px",fontSize:isMobile?10:11,fontFamily:"'Outfit',sans-serif",cursor:"pointer",transition:"all .15s"}}>{c}</button>
              ))}
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:isMobile?"repeat(2,1fr)":"repeat(auto-fill,minmax(170px,1fr))",gap:isMobile?7:9}}>
            {filteredInv.map(p=>{
              const sel = lines.some(l=>l.productId===p.id);
              const stock = getStock(p);
              return (
                <div key={p.id} style={{position:"relative"}}>
                  <button className={`prod-card ${sel?"sel":""}`} onClick={()=>toggleProduct(p)} style={{width:"100%",textAlign:"left"}}>
                    <div style={{fontSize:isMobile?9:10,color:sel?"#2dcfe8":"#1a4a50",marginBottom:2}}>{p.cat}</div>
                    <div style={{fontSize:isMobile?11:12,fontWeight:600,color:sel?"#c5d8f5":"#bcc8e0",lineHeight:1.3,marginBottom:isMobile?5:7}}>{p.name}</div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
                      <div>
                        <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:isMobile?12:13,fontWeight:700,color:sel?"#2dcfe8":"#e2e8f4"}}>{fmtUSD(p.price)}</div>
                        <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:"#fbbf24"}}>{fmtBs(p.price,rate)}</div>
                      </div>
                      {!p.isService&&(
                        <div style={{textAlign:"right"}}>
                          <div style={{fontSize:9,color:stock<=lowAt(p)?"#f87171":stock<=lowAt(p)*2?"#fbbf24":"#1a4a50",fontWeight:600}}>{stock} pz</div>
                          {stock<=lowAt(p) && <div style={{fontSize:8,color:"#f87171"}}>⚠ por agotarse</div>}
                        </div>
                      )}
                    </div>
                    {sel&&<div style={{marginTop:5,background:"#2dcfe820",borderRadius:5,padding:"2px 6px",fontSize:9,color:"#2dcfe8",textAlign:"center"}}>✓ En ticket</div>}
                  </button>
                  {/* Quick adjust button */}
                  {!p.isService && (
                    <button
                      onClick={e=>{e.stopPropagation();setAdjustProd(p);setAdjustQty(1);setAdjustMode("add");}}
                      style={{position:"absolute",top:4,right:4,width:20,height:20,borderRadius:4,background:"#0a2028",border:"1px solid #1a3040",color:"#2a5060",cursor:"pointer",fontSize:11,display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}
                      title="Ajustar inventario">⚙</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Ticket — scroll independiente en PC, integrado en mobile */}
        <div style={{display:"flex",flexDirection:"column",background:"#080c14",overflow:isMobile?"visible":"hidden",minHeight:isMobile?"auto":"0"}}>
          <div style={{padding:"15px 18px",borderBottom:"1px solid #0f1825",fontSize:12,fontWeight:600,color:"#2a4060",textTransform:"uppercase",letterSpacing:".08em"}}>Ticket</div>
          <div style={{flex:1,overflow:"auto",padding:"10px 18px",display:"flex",flexDirection:"column",gap:8}}>
            {lines.length===0
              ? <div style={{color:"#141e2e",fontSize:13,textAlign:"center",marginTop:40,lineHeight:1.8}}>Toca un producto<br/>para agregarlo</div>
              : lines.map(row=>{
                  const res=resolved.find(r=>r.id===row.id);
                  if(!res?.product) return null;
                  return (
                    <div key={row.id} className="fadein" style={{background:"#0c1422",border:"1px solid #1a2640",borderRadius:12,padding:"12px 13px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:9}}>
                        <div style={{flex:1}}>
                          <div style={{fontSize:13,fontWeight:600,color:"#c5d5f5",lineHeight:1.3}}>{res.product.name}</div>
                          <div style={{fontSize:11,color:"#2a4060",marginTop:1}}>{fmtUSD(res.product.price)} · {fmtBs(res.product.price,rate)} c/u</div>
                        </div>
                        <button onClick={()=>setLines(l=>l.filter(r=>r.id!==row.id))} style={{background:"transparent",border:"none",color:"#2a4060",cursor:"pointer",padding:"2px 4px"}}><IClose/></button>
                      </div>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <button className="qty-btn" onClick={()=>changeQty(row.id,row.qty-1)}>−</button>
                          <input
                            type="number" min="1"
                            value={row.qty}
                            onChange={e=>changeQty(row.id,parseInt(e.target.value)||1)}
                            style={{width:52,textAlign:"center",background:"#081820",border:"1px solid #0d2a40",borderRadius:8,padding:"6px 4px",color:"#e2e8f4",fontFamily:"'JetBrains Mono',monospace",fontSize:15,outline:"none"}}
                          />
                          <button className="qty-btn" onClick={()=>changeQty(row.id,row.qty+1)}>+</button>
                        </div>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:15,fontWeight:600}}>{fmtUSD(res.subtotal)}</div>
                          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"#fbbf24"}}>{fmtBs(res.subtotal,rate)}</div>
                        </div>
                      </div>
                      {!res.product.isService && row.qty>getStock(res.product) && (
                        <div style={{marginTop:8,background:"#2a0c0c",border:"1px solid #5a1a1a",borderRadius:8,padding:"7px 10px",fontSize:12,color:"#f87171",display:"flex",alignItems:"center",gap:6}}>
                          ⚠️ Solo hay <strong>{getStock(res.product)}</strong> unidad(es) en inventario
                        </div>
                      )}
                      {(res.product.cat==="Lente"||res.product.cat==="Montura"||res.product.cat==="Lente de contacto") && (
                        <button onClick={()=>setRxLine(row.id)} style={{marginTop:8,width:"100%",background:"#071c22",border:"1px solid #0e3a4a",borderRadius:8,padding:"6px",fontSize:11,color:"#2dcfe8",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>
                          🔬 {rx.od.sphere||rx.oi.sphere ? "Ver fórmula ✓" : "Agregar fórmula óptica"}
                        </button>
                      )}
                    </div>
                  );
                })
            }
          </div>
          <div style={{padding:"8px 18px 0"}}>
            <div style={{fontSize:10,color:"#1a4a50",marginBottom:6,letterSpacing:".07em"}}>MÉTODO DE PAGO</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5,marginBottom:8}}>
              {METHODS.map(m=>(
                <button key={m.id} onClick={()=>setMethod(m.id)} style={{background:method===m.id?"#0c2e35":"#071418",border:`1px solid ${method===m.id?"#0e7a8c":"#0d2a30"}`,borderRadius:8,padding:"6px 4px",cursor:"pointer",textAlign:"center",transition:"all .15s"}}>
                  <div style={{fontSize:16}}>{m.icon}</div>
                  <div style={{fontSize:10,color:method===m.id?"#2dcfe8":"#1a4a50",marginTop:2}}>{m.label}</div>
                </button>
              ))}
            </div>
            {selMethod?.detail && (
              <div style={{background:"#050f12",border:"1px solid #0a2028",borderRadius:8,padding:"8px 12px",fontSize:11,color:"#2dcfe8",marginBottom:6,wordBreak:"break-all"}}>
                {selMethod.detail}
              </div>
            )}
          </div>
          <div style={{padding:"4px 18px 8px"}}>
            <input placeholder="Nota (opcional)..." value={note} onChange={e=>setNote(e.target.value)}
              style={{width:"100%",background:"#071418",border:"1px solid #0d2a30",borderRadius:10,padding:"9px 13px",color:"#e2e8f4",fontFamily:"'Outfit',sans-serif",fontSize:13}}
            />
          </div>

          {/* Datos ópticos */}
          {lines.some(l=>{ const p=inventory.find(x=>x.id===l.productId); return p&&(p.cat==="Lente"||p.cat==="Lente de contacto"||p.cat==="Montura"); }) && (
            <div style={{padding:"0 18px 8px"}}>
              <div style={{background:"#050f12",border:"1px solid #0a2028",borderRadius:10,padding:"12px"}}>
                <div style={{fontSize:10,fontWeight:600,color:"#2dcfe8",textTransform:"uppercase",letterSpacing:".07em",marginBottom:10}}>👓 Datos ópticos</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:7}}>
                  <div>
                    <div style={{fontSize:10,color:"#1a4050",marginBottom:3}}>TIPO MONTURA</div>
                    <select value={frameType} onChange={e=>setFrameType(e.target.value)} style={{width:"100%",background:"#071418",border:"1px solid #0d2a30",borderRadius:7,padding:"6px 9px",color:"#e2e8f4",fontFamily:"'Outfit',sans-serif",fontSize:12,outline:"none"}}>
                      {FRAME_TYPES.map(t=><option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{fontSize:10,color:"#1a4050",marginBottom:3}}>TIPO CRISTAL</div>
                    <select value={crystalType} onChange={e=>setCrystalType(e.target.value)} style={{width:"100%",background:"#071418",border:"1px solid #0d2a30",borderRadius:7,padding:"6px 9px",color:"#e2e8f4",fontFamily:"'Outfit',sans-serif",fontSize:12,outline:"none"}}>
                      {CRYSTAL_TYPES.map(t=><option key={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                {/* Fórmula Rx */}
                <div style={{background:"#040d10",borderRadius:8,padding:"8px",marginBottom:7}}>
                  <div style={{fontSize:10,color:"#1a4050",marginBottom:6}}>FÓRMULA Rx</div>
                  {[["od","Ojo Derecho (OD)"],["oi","Ojo Izquierdo (OI)"]].map(([eye,label])=>(
                    <div key={eye} style={{marginBottom:6}}>
                      <div style={{fontSize:10,color:"#2dcfe8",marginBottom:4}}>{label}</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:5}}>
                        {[["sphere","Esfera"],["cylinder","Cilindro"],["axis","Eje"]].map(([field,placeholder])=>(
                          <input key={field} placeholder={placeholder} value={rx[eye][field]}
                            onChange={e=>setRx(r=>({...r,[eye]:{...r[eye],[field]:e.target.value}}))}
                            style={{background:"#071418",border:"1px solid #0d2a30",borderRadius:6,padding:"5px 8px",color:"#e2e8f4",fontFamily:"'JetBrains Mono',monospace",fontSize:11,outline:"none",textAlign:"center"}}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <div style={{fontSize:10,color:"#2dcfe8",whiteSpace:"nowrap"}}>ADD</div>
                    <input placeholder="Adición" value={rx.add} onChange={e=>setRx(r=>({...r,add:e.target.value}))}
                      style={{flex:1,background:"#071418",border:"1px solid #0d2a30",borderRadius:6,padding:"5px 8px",color:"#e2e8f4",fontFamily:"'JetBrains Mono',monospace",fontSize:11,outline:"none",textAlign:"center"}}
                    />
                  </div>
                </div>
                {/* Lab + costo lab */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
                  <div>
                    <div style={{fontSize:10,color:"#1a4050",marginBottom:3}}>LABORATORIO</div>
                    <select value={lab} onChange={e=>setLab(e.target.value)} style={{width:"100%",background:"#071418",border:"1px solid #0d2a30",borderRadius:7,padding:"6px 9px",color:"#e2e8f4",fontFamily:"'Outfit',sans-serif",fontSize:11,outline:"none"}}>
                      {LAB_LIST.map(l=><option key={l}>{l}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{fontSize:10,color:"#1a4050",marginBottom:3}}>COSTO LAB (USD)</div>
                    <input type="number" placeholder="0.00" min="0" value={labCost} onChange={e=>setLabCost(e.target.value)}
                      style={{width:"100%",background:"#071418",border:"1px solid #0d2a30",borderRadius:7,padding:"6px 9px",color:"#fbbf24",fontFamily:"'JetBrains Mono',monospace",fontSize:12,outline:"none"}}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          <div style={{padding:"14px 18px",borderTop:"1px solid #0a2028"}}>
            <div style={{marginBottom:13}}>
              <div style={{fontSize:10,color:"#1a4a50"}}>TOTAL A COBRAR</div>
              {method === "bank" ? (<>
                {/* Pago Móvil — cobro en Bs, mostrar Bs grande */}
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:26,fontWeight:800,color:"#fbbf24"}}>
                  {fmtBs(total+(Number(labCost)||0), rate)}
                </div>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13,color:"#2dcfe8",marginTop:2}}>
                  ≈ {fmtUSD(total+(Number(labCost)||0))} USDT
                </div>
                <div style={{fontSize:10,color:"#1a4050",marginTop:1}}>📱 Pago Móvil / Transferencia en Bolívares</div>
              </>) : (<>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:26,fontWeight:700,color:"#fff"}}>
                  {fmtUSD(total+(Number(labCost)||0))}
                </div>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:14,color:"#fbbf24",marginTop:2}}>
                  {fmtBs(total+(Number(labCost)||0),rate)}
                </div>
              </>)}
              {(Number(labCost)||0)>0 && <div style={{fontSize:11,color:"#f87171",marginTop:3}}>Incluye lab: {fmtUSD(Number(labCost))}</div>}
            </div>
            {stockWarn.length>0 && (
              <div style={{background:"#1a0808",border:"1px solid #4a1010",borderRadius:10,padding:"10px 14px",marginBottom:10,fontSize:12,color:"#f87171"}}>
                ⚠️ No se puede registrar — hay {stockWarn.length} producto(s) con cantidad mayor al stock disponible. Ajusta las cantidades o actualiza el inventario.
              </div>
            )}
            {!valid && lines.length===0 && (
              <div style={{background:"#0a1820",border:"1px solid #0d2a40",borderRadius:10,padding:"10px 14px",marginBottom:10,fontSize:12,color:"#1a4a60"}}>
                Selecciona al menos un producto del catálogo para continuar.
              </div>
            )}
            <button onClick={handleSale} disabled={!valid||stockWarn.length>0}
              style={{width:"100%",background:stockWarn.length>0?"#1a0808":valid?"linear-gradient(135deg,#0a6070,#0e7a8c)":"#071418",border:stockWarn.length>0?"1px solid #4a1010":"none",borderRadius:13,padding:"15px",color:stockWarn.length>0?"#f87171":valid?"#fff":"#1a4a60",fontFamily:"'Outfit',sans-serif",fontSize:16,fontWeight:700,cursor:valid&&!stockWarn.length?"pointer":"default",display:"flex",alignItems:"center",justifyContent:"center",gap:8,transition:"all .2s"}}>
              {stockWarn.length>0 ? "⚠️ Stock insuficiente" : <><ICheck/> Registrar venta</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Camera / Barcode Scanner ──────────────────────────────────────────────────
function CameraModal({ onClose, onDetect }) {
  const videoRef   = useRef(null);
  const streamRef  = useRef(null);
  const rafRef     = useRef(null);
  const fileRef    = useRef(null);
  const [manual,   setManual]  = useState("");
  const [error,    setError]   = useState(null);
  const [scanning, setScanning]= useState(false);
  const [mode,     setMode]    = useState("cam"); // "cam" | "manual" | "file"

  useEffect(() => {
    if (mode !== "cam") return;
    let active = true;

    // Check permissions first — more informative error
    const startCam = async () => {
      try {
        // iOS Safari needs exact constraint
        const constraints = {
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }
        };
        const s = await navigator.mediaDevices.getUserMedia(constraints);
        if (!active) { s.getTracks().forEach(t=>t.stop()); return; }
        streamRef.current = s;
        if (videoRef.current) { videoRef.current.srcObject = s; }
        setScanning(true);
        setError(null);

        if ('BarcodeDetector' in window) {
          const detector = new window.BarcodeDetector({
            formats: ['code_128','code_39','ean_13','ean_8','qr_code','data_matrix','upc_a','upc_e']
          });
          const detect = async () => {
            if (!active || !videoRef.current) return;
            try {
              const barcodes = await detector.detect(videoRef.current);
              if (barcodes.length > 0 && active) {
                active = false;
                onDetect(barcodes[0].rawValue);
                return;
              }
            } catch {}
            rafRef.current = requestAnimationFrame(detect);
          };
          rafRef.current = requestAnimationFrame(detect);
        }
      } catch (e) {
        const msg = e.name === "NotAllowedError"
          ? "Permiso de cámara denegado. Ve a Configuración del navegador → Permisos → Cámara y permite el acceso."
          : e.name === "NotFoundError"
          ? "No se encontró cámara en este dispositivo."
          : "No se pudo acceder a la cámara: " + e.message;
        setError(msg);
        setMode("manual");
      }
    };

    startCam();
    return () => {
      active = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t=>t.stop());
    };
  }, [mode]);

  const handleClose = () => {
    if (streamRef.current) streamRef.current.getTracks().forEach(t=>t.stop());
    onClose();
  };

  const handleManual = () => {
    if (manual.trim()) { handleClose(); onDetect(manual.trim()); }
  };

  // iOS fallback — open file input with camera capture
  const handleFileCapture = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    // For image files, we try to decode barcode if BarcodeDetector supports ImageBitmap
    if ('BarcodeDetector' in window) {
      createImageBitmap(file).then(async bitmap => {
        try {
          const detector = new window.BarcodeDetector({ formats:['code_128','code_39','ean_13','ean_8','qr_code','data_matrix'] });
          const barcodes = await detector.detect(bitmap);
          if (barcodes.length > 0) { handleClose(); onDetect(barcodes[0].rawValue); }
          else { setError("No se detectó código en la foto. Intenta de nuevo o ingresa manualmente."); setMode("manual"); }
        } catch { setMode("manual"); }
      }).catch(() => setMode("manual"));
    } else {
      setMode("manual");
    }
  };

  return (
    <div className="ov" onClick={e=>{if(e.target===e.currentTarget)handleClose();}}>
      <div className="modal" style={{maxWidth:420}}>
        <div style={{fontSize:17,fontWeight:700,color:"#fff",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          📷 Escanear código
          <button style={{background:"transparent",border:"none",color:"#2a4060",cursor:"pointer",fontSize:20}} onClick={handleClose}>×</button>
        </div>

        {/* Mode switcher */}
        <div style={{display:"flex",gap:6,marginBottom:14}}>
          {[["cam","🎥 Cámara"],["file","📸 Tomar foto"],["manual","⌨️ Manual"]].map(([m,l])=>(
            <button key={m} onClick={()=>setMode(m)}
              style={{flex:1,background:mode===m?"#0c2e35":"transparent",border:`1px solid ${mode===m?"#0e7a8c":"#0a2028"}`,borderRadius:8,padding:"7px 4px",fontSize:11,color:mode===m?"#2dcfe8":"#2a4060",cursor:"pointer",fontFamily:"'Outfit',sans-serif"}}>
              {l}
            </button>
          ))}
        </div>

        {error && (
          <div style={{background:"#1a0a04",border:"1px solid #4a2010",borderRadius:10,padding:"12px",fontSize:12,color:"#fbbf24",marginBottom:12,lineHeight:1.5}}>{error}</div>
        )}

        {mode === "cam" && !error && (
          <div style={{position:"relative",marginBottom:14,borderRadius:12,overflow:"hidden",background:"#000",aspectRatio:"4/3"}}>
            <video ref={videoRef} autoPlay playsInline muted style={{width:"100%",height:"100%",objectFit:"cover"}}/>
            {scanning && (
              <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none"}}>
                <div style={{width:"70%",height:"35%",border:"2.5px solid #2dcfe8",borderRadius:10,boxShadow:"0 0 0 9999px rgba(0,0,0,.5)"}}/>
                <div style={{position:"absolute",bottom:12,fontSize:11,color:"#2dcfe8"}}>Apunta al código</div>
              </div>
            )}
            {!('BarcodeDetector' in window) && (
              <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,.8)",display:"flex",alignItems:"center",justifyContent:"center",padding:16,textAlign:"center"}}>
                <div>
                  <div style={{fontSize:24,marginBottom:8}}>⚠️</div>
                  <div style={{fontSize:12,color:"#fbbf24",lineHeight:1.5}}>
                    Tu navegador no soporta escaneo automático.<br/>
                    Usa <strong>"Tomar foto"</strong> o ingresa el código manualmente.
                  </div>
                  <button className="btn-p" style={{marginTop:12,fontSize:12}} onClick={()=>setMode("file")}>📸 Tomar foto</button>
                </div>
              </div>
            )}
          </div>
        )}

        {mode === "file" && (
          <div style={{marginBottom:14,textAlign:"center",padding:"20px 0"}}>
            <div style={{fontSize:36,marginBottom:8}}>📸</div>
            <div style={{fontSize:13,color:"#4a8090",marginBottom:14,lineHeight:1.5}}>Abre la cámara para fotografiar el código de barras o QR</div>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={handleFileCapture}/>
            <button className="btn-p" style={{fontSize:14,padding:"12px 24px"}} onClick={()=>fileRef.current?.click()}>
              📷 Abrir cámara
            </button>
          </div>
        )}

        {(mode === "manual" || error) && (
          <div style={{fontSize:12,color:"#1a4a50",marginBottom:8}}>Ingresa el código manualmente:</div>
        )}
        <div style={{display:"flex",gap:8}}>
          <input value={manual} onChange={e=>setManual(e.target.value)}
            placeholder="Código de serie o barras"
            onKeyDown={e=>e.key==="Enter"&&handleManual()}
            autoFocus={mode==="manual"}
            style={{flex:1,background:"#050e10",border:"1px solid #0d2a30",borderRadius:8,padding:"10px 12px",color:"#e2e8f4",fontFamily:"'JetBrains Mono',monospace",fontSize:13,outline:"none"}}
          />
          <button className="btn-p" onClick={handleManual} disabled={!manual.trim()}><ICheck/></button>
        </div>
        <div style={{fontSize:11,color:"#1a3a40",marginTop:10,textAlign:"center"}}>
          Tip: Si la cámara no funciona, usa <strong style={{color:"#2dcfe8"}}>Tomar foto</strong> para iOS/Android
        </div>
      </div>
    </div>
  );
}

// ── Admin View ────────────────────────────────────────────────────────────────
function AdminView({ profile, inventory, sales, rate, deposits, expenses, investments, orders, recovery = [], payments, profilesData, dynProfiles, storeFilter, setStoreFilter, saveInv, saveSal, saveRate, saveDeposits, savePayments, savePD, saveExpenses, saveInvestments, saveOrders, saveDynProfiles, setViewAs, switchTo, refreshData, onLogout }) {
  const [tab,       setTab]      = useState("dash");
  const [invModal,  setInvModal] = useState(null);
  const [detailDate,setDD]       = useState(null);
  const [editRate,  setEditRate] = useState(false);
  const [rateInput, setRateInput]= useState(String(rate));

  // storeProfiles debe declararse ANTES de filteredSales
  const storeProfiles = dynProfiles.filter(p=>p.role==="store");

  // Filtra ventas por tienda — maneja IDs nuevos + legacy ("local") + ventas sin storeId
  const storeProfileIds = new Set(storeProfiles.map(s => s.id));
  const filteredSales = storeFilter === "all" ? sales : sales.filter(s => {
    // Coincidencia directa con el ID de tienda seleccionado
    if (s.storeId === storeFilter)       return true;
    if (s.registeredBy === storeFilter)  return true;
    // Legacy: ventas antiguas con registeredBy:"local" pertenecen a la única tienda
    // (antes de que se implementara storeId, el ID era "local")
    const legacyIds = ["local", "store_chinita", "tienda"];
    if (legacyIds.includes(s.registeredBy) || legacyIds.includes(s.storeId)) {
      // Asignar a la tienda seleccionada si es la única, o si es store_chinita
      return storeProfiles.length === 1 || storeFilter === "store_chinita";
    }
    // Ventas sin storeId registradas desde un perfil de tienda → asignar a la única tienda
    if (!s.storeId && !storeProfileIds.has(s.registeredBy)) {
      return storeProfiles.length === 1;
    }
    return false;
  });

  const totalInvested = inventory.reduce((s,p)=>s+(p.isService?0:p.cost*getStock(p)),0);
  const totalRetail   = inventory.reduce((s,p)=>s+(p.isService?0:p.price*getStock(p)),0);
  const todaySales    = filteredSales.filter(s=>s.date===today());
  const todayRev      = todaySales.reduce((s,v)=>s+v.total,0);
  const todayProf     = todaySales.reduce((s,v)=>s+v.profit,0);
  const todayItems    = todaySales.reduce((s,v)=>s+v.qty,0);
  const ws            = weekStart();
  const weekSales     = filteredSales.filter(s=>s.date>=ws);
  const weekRev       = weekSales.reduce((s,v)=>s+v.total,0);
  const weekProf      = weekSales.reduce((s,v)=>s+v.profit,0);
  const byDate        = filteredSales.reduce((a,s)=>{if(!a[s.date])a[s.date]=[];a[s.date].push(s);return a},{});
  const sortedDates   = Object.keys(byDate).sort((a,b)=>b.localeCompare(a));
  const lowStock      = inventory.filter(isLow);

  // Comparativas vs periodo anterior (estilo panel profesional)
  const isoDaysAgo = n => { const d=new Date(today()+"T12:00"); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10); };
  const yest        = isoDaysAgo(1);
  const yestSales   = filteredSales.filter(s=>s.date===yest);
  const yestRev     = yestSales.reduce((s,v)=>s+v.total,0);
  const yestProf    = yestSales.reduce((s,v)=>s+v.profit,0);
  const lastWs      = isoDaysAgo(7 + new Date(today()+"T12:00").getDay());
  const lastWe      = isoDaysAgo(1 + new Date(today()+"T12:00").getDay());
  const lastWeekSales = filteredSales.filter(s=>s.date>=lastWs && s.date<=lastWe);
  const lastWeekRev   = lastWeekSales.reduce((s,v)=>s+v.total,0);
  const lastWeekProf  = lastWeekSales.reduce((s,v)=>s+v.profit,0);
  const deltas = { todayRev:[todayRev,yestRev], todayProf:[todayProf,yestProf], weekRev:[weekRev,lastWeekRev], weekProf:[weekProf,lastWeekProf] };

  const handleRateSave = async () => {
    const r = parseFloat(rateInput);
    if (!isNaN(r) && r > 0) { await saveRate(r); setEditRate(false); }
  };

  const isMobile = useIsMobile();

  const NAV_ITEMS = [
    {id:"dash",    I:IHome,   l:"Inicio"},
    {id:"apart",   I:ITag,    l:"Apartados"},
    {id:"stats",   I:IStats,  l:"Stats"},
    {id:"caja",    I:ICash,   l:"Caja"},
    {id:"inv",     I:IBox,    l:"Inventario"},
    {id:"history", I:IChart,  l:"Historial"},
  ];
  const SIDE_EXTRA = [
    {id:"week",    I:IWeek,   l:"Esta semana"},
    {id:"finanzas",I:IMoney,  l:"Finanzas"},
    {id:"miperfil",I:IGear,   l:"Mi perfil"},
    ...(profile.id==="owner" ? [{id:"ajustes",I:IUsers,l:"Gestión"},{id:"cierre",I:IChart,l:"Cierre"}] : []),
  ];

  return (
    <div style={{fontFamily:"'Outfit',sans-serif",background:"#040d10",minHeight:"100vh",color:"#e2e8f4",display:"flex",flexDirection:isMobile?"column":"row",height:"100vh",overflow:"hidden"}}>
      <style>{CSS}</style>

      {/* ── MOBILE HEADER ── */}
      {isMobile && (
        <div className="mob-header">
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <Logo s={28}/>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:"#fff"}}>{profile.name}</div>
              <div style={{fontSize:10,color:profile.color}}>Administrador <span style={{color:"#fbbf24",fontWeight:700,marginLeft:2}}>· BETA</span></div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {storeProfiles.length > 0 && (
              <select value={storeFilter} onChange={e=>setStoreFilter(e.target.value)}
                style={{background:"#071418",border:"1px solid #0a2028",borderRadius:8,padding:"5px 8px",color:"#2dcfe8",fontFamily:"'Outfit',sans-serif",fontSize:11,maxWidth:120}}>
                <option value="all">🌐 Todas</option>
                {storeProfiles.map(s=><option key={s.id} value={s.id}>🏪 {s.address}</option>)}
              </select>
            )}
            {/* Tasa rápida en mobile */}
            {editRate
              ? <div style={{display:"flex",gap:4,alignItems:"center"}}>
                  <input value={rateInput} onChange={e=>setRateInput(e.target.value)} type="number"
                    style={{width:70,background:"#071418",border:"1px solid #0a2028",borderRadius:6,padding:"4px 6px",color:"#fbbf24",fontFamily:"'JetBrains Mono',monospace",fontSize:12,outline:"none"}}
                    onKeyDown={e=>e.key==="Enter"&&handleRateSave()} autoFocus/>
                  <button onClick={handleRateSave} style={{background:"#0a2840",border:"none",borderRadius:6,padding:"4px 8px",color:"#2dcfe8",fontSize:12,cursor:"pointer"}}>✓</button>
                  <button onClick={()=>{setEditRate(false);setRateInput(String(rate));}} style={{background:"transparent",border:"none",color:"#3a5070",fontSize:12,cursor:"pointer"}}>✕</button>
                </div>
              : <button onClick={()=>{setEditRate(true);setRateInput(String(rate));}} style={{background:"#071c22",border:"1px solid #0a2028",borderRadius:8,padding:"5px 10px",cursor:"pointer"}}>
                  <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"#fbbf24"}}>Bs {rate.toLocaleString("es-VE",{maximumFractionDigits:1})}</div>
                </button>
            }
            <RefreshBtn refreshData={refreshData} label={false} style={{padding:"6px 10px",borderColor:"#0a2028",color:"#2a5060"}}/>
            <button onClick={onLogout} style={{background:"transparent",border:"1px solid #0a2028",borderRadius:8,padding:"6px 10px",color:"#2a5060",cursor:"pointer",fontSize:11,display:"flex",alignItems:"center",gap:4}}><ILogout/>Salir</button>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside className="desk-sidebar" style={{width:210,background:"#050f12",borderRight:"1px solid #0a2028",display:"flex",flexDirection:"column",padding:"18px 10px",flexShrink:0,overflow:"hidden"}}>
        <div style={{padding:"0 6px 18px",borderBottom:"1px solid #0a2028",marginBottom:14,flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:34,height:34,borderRadius:8,overflow:"hidden"}}><Logo s={34}/></div>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:"#e2e8f4"}}>{profile.name}</div>
              <div style={{fontSize:11,color:`${profile.color}99`}}>Administrador <span style={{color:"#fbbf24",fontWeight:700}}>· BETA</span></div>
            </div>
          </div>
        </div>
        <nav style={{flex:1,display:"flex",flexDirection:"column",gap:3,overflowY:"auto",overflowX:"hidden"}}>
          {/* Store filter (owner only) */}
          {storeProfiles.length > 0 && (
            <div style={{marginBottom:8}}>
              <div style={{fontSize:9,color:"#1a3a40",textTransform:"uppercase",letterSpacing:".1em",marginBottom:5,paddingLeft:4}}>Vista de tienda</div>
              <select value={storeFilter} onChange={e=>setStoreFilter(e.target.value)}
                style={{width:"100%",background:"#040d10",border:"1px solid #0a2028",borderRadius:8,padding:"6px 10px",color:storeFilter==="all"?"#2dcfe8":"#fbbf24",fontFamily:"'Outfit',sans-serif",fontSize:12,cursor:"pointer"}}>
                <option value="all">🌐 Todas las tiendas</option>
                {storeProfiles.map(s=><option key={s.id} value={s.id}>🏪 {s.storeName} {s.address}</option>)}
              </select>
            </div>
          )}
          {[
            {id:"dash",    I:IHome,   l:"Dashboard"},
            {id:"apart",   I:ITag,    l:"Apartados"},
            {id:"stats",   I:IStats,  l:"Estadísticas"},
            {id:"week",    I:IWeek,   l:"Esta semana"},
            {id:"finanzas",I:IMoney,  l:"Finanzas"},
            {id:"caja",    I:ICash,   l:"Caja"},
            {id:"inv",     I:IBox,    l:"Inventario"},
            {id:"history", I:IChart,  l:"Historial"},
            {id:"miperfil",I:IGear,   l:"Mi perfil"},
            ...(profile.id==="owner" ? [{id:"ajustes",I:IUsers,l:"Gestión"},{id:"cierre",I:IChart,l:"Cierre de caja"}] : []),
          ].map(({id,I,l})=>(
            <button key={id} className={`nav-btn ${tab===id?"active":""}`} onClick={()=>setTab(id)}><I/>{l}</button>
          ))}
        </nav>
        <div style={{padding:"14px 6px 0",borderTop:"1px solid #0f1825",flexShrink:0}}>
          {/* Tasa del día */}
          <div style={{background:"#07111e",border:"1px solid #141e30",borderRadius:10,padding:"10px 12px",marginBottom:12}}>
            <div style={{fontSize:10,color:"#1e3050",marginBottom:4}}>TASA DEL DÍA</div>
            {editRate ? (
              <div style={{display:"flex",gap:5,alignItems:"center"}}>
                <input value={rateInput} onChange={e=>setRateInput(e.target.value)} type="number" min="0"
                  style={{background:"#0a1420",border:"1px solid #2a4060",borderRadius:6,padding:"4px 8px",color:"#fbbf24",fontFamily:"'JetBrains Mono',monospace",fontSize:13,width:"100%"}}
                  onKeyDown={e=>e.key==="Enter"&&handleRateSave()}
                  autoFocus
                />
                <button onClick={handleRateSave} style={{background:"#1a3a60",border:"none",borderRadius:6,padding:"5px 8px",color:"#60a5fa",cursor:"pointer",fontSize:14}}>✓</button>
                <button onClick={()=>{setEditRate(false);setRateInput(String(rate));}} style={{background:"transparent",border:"1px solid #1e2e45",borderRadius:6,padding:"5px 8px",color:"#3a5070",cursor:"pointer",fontSize:12}}>✕</button>
              </div>
            ) : (
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}} onClick={()=>{setEditRate(true);setRateInput(String(rate));}}>
                <div>
                  <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:15,fontWeight:700,color:"#fbbf24"}}>Bs {rate.toLocaleString("es-VE",{maximumFractionDigits:2})}</div>
                  <div style={{fontSize:10,color:"#1e3050",marginTop:1}}>por 1 USDT</div>
                </div>
                <span style={{fontSize:11,color:"#1e3050"}}>✎</span>
              </div>
            )}
          </div>
          <div style={{fontSize:10,color:"#1e3050",marginBottom:3}}>INVERTIDO (USD)</div>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13,fontWeight:600,color:"#60a5fa"}}>{fmtUSD(totalInvested)}</div>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"#fbbf24",marginTop:1}}>{fmtBs(totalInvested,rate)}</div>
          {/* Actualizar + Logout — siempre visibles */}
          <RefreshBtn refreshData={refreshData} style={{marginTop:12,width:"100%",padding:"9px 10px",borderColor:"#1a3040",color:"#4a8090"}}/>
          <button
            className="btn-g"
            style={{marginTop:8,width:"100%",fontSize:12,padding:"9px 10px",display:"flex",alignItems:"center",gap:6,justifyContent:"center",borderColor:"#1a3040",color:"#4a8090"}}
            onClick={onLogout}
          >
            <ILogout/>Cambiar perfil
          </button>
        </div>
      </aside>

      <main className={isMobile?"mob-main":""} style={{flex:1,overflow:"auto",padding:"24px"}}>
        {/* Alerta de solicitudes de recuperacion (solo owner) */}
        {profile.id==="owner" && recovery.length>0 && tab!=="ajustes" && (
          <div onClick={()=>setTab("ajustes")} style={{cursor:"pointer",background:"#2a1e08",border:"1px solid #6a4a10",borderRadius:12,padding:"12px 16px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <div style={{fontSize:13,color:"#fbbf24"}}>🔔 <strong>{recovery.length}</strong> solicitud(es) de recuperación de acceso pendiente(s)</div>
            <span style={{fontSize:12,color:"#e8c96a",textDecoration:"underline"}}>Resolver en Gestión →</span>
          </div>
        )}
        {tab==="dash"     && <DashTab    {...{todayRev,todayProf,todayItems,weekRev,weekProf,totalInvested,totalRetail,inventory,byDate,sortedDates,lowStock,setDD,rate,storeFilter,storeProfiles,isMobile,deltas}} />}
        {tab==="stats"    && <StatsTab   {...{sales:filteredSales,expenses,rate,isMobile,profile}} />}
        {tab==="week"     && <WeekTab    {...{byDate,sortedDates,weekRev,weekProf,ws,setDD,rate,dynProfiles,isMobile}} />}
        {tab==="finanzas" && <FinanzasTab {...{sales:filteredSales,expenses,investments,inventory,rate,saveExpenses,saveInvestments,profile,isMobile}} />}
        {tab==="apart"    && <ApartadosTab {...{orders,saveOrders,rate,profile,isMobile}} />}
        {tab==="caja"     && <CajaTab    {...{sales:filteredSales,deposits,saveDeposits,rate,payments,isMobile,orders}} />}
        {tab==="cierre"   && profile.id==="owner" && <CierreTab {...{sales,expenses,orders,rate,dynProfiles,profile}} />}
        {tab==="inv"      && <InvTab     {...{inventory,saveInv,totalInvested,totalRetail,setInvModal,rate,isMobile}} />}
        {tab==="history"  && <HistTab    {...{byDate,sortedDates,setDD,storeFilter}} />}
        {tab==="miperfil" && <ProfileSettingsTab profile={profile} dynProfiles={dynProfiles} saveDynProfiles={saveDynProfiles}/>}
        {tab==="ajustes"  && profile.id==="owner" && <GestionTab {...{profilesData,savePD,payments,savePayments,dynProfiles,saveDynProfiles,setViewAs,switchTo,recovery}} />}
      </main>

      {/* ── MOBILE BOTTOM NAV ── */}
      {isMobile && (
        <nav className="mob-nav">
          {NAV_ITEMS.map(({id,I,l})=>(
            <button key={id} className={`mob-nav-btn ${tab===id?"active":""}`} onClick={()=>setTab(id)}>
              <I/><span>{l}</span>
            </button>
          ))}
          <button className={`mob-nav-btn ${["week","miperfil","ajustes"].includes(tab)?"active":""}`}
            onClick={()=>setTab(tab==="miperfil"||tab==="ajustes"?"miperfil":"week")}
            style={{position:"relative"}}>
            <IGear/>
            <span>Más</span>
          </button>
          {/* Sub-menu "Más" */}
          {["week","miperfil","ajustes"].includes(tab) && (
            <div style={{position:"fixed",bottom:60,right:0,left:0,background:"#050f12",borderTop:"1px solid #0a2028",padding:"8px 0",display:"flex",gap:0,zIndex:51}}>
              {[...SIDE_EXTRA].map(({id,I,l})=>(
                <button key={id} className={`mob-nav-btn ${tab===id?"active":""}`} onClick={()=>setTab(id)} style={{flex:1}}>
                  <I/><span>{l}</span>
                </button>
              ))}
            </div>
          )}
        </nav>
      )}

      {invModal!==null  && <InvModal  item={invModal==="new"?null:invModal} inventory={inventory} saveInv={saveInv} onClose={()=>setInvModal(null)} rate={rate} />}
      {detailDate       && <DayModal  date={detailDate} sales={byDate[detailDate]||[]} onClose={()=>setDD(null)} rate={rate} />}
    </div>
  );
}

// ── Finanzas Tab ──────────────────────────────────────────────────────────────
function FinanzasTab({ sales, expenses, investments, inventory, rate, saveExpenses, saveInvestments, profile }) {
  const [viewMonth, setViewMonth] = useState(today().slice(0,7));
  const [showExpForm, setShowExpForm] = useState(false);
  const [ef, setEf] = useState({cat:"alquiler", amount:"", month:today().slice(0,7), note:""});

  // ── Calculations for selected month ──
  const mSales    = sales.filter(s=>s.date.slice(0,7)===viewMonth);
  const mRevenue  = mSales.reduce((s,v)=>s+v.total,0);
  const mCOGS     = mSales.reduce((s,v)=>s+v.cost*v.qty,0);
  const mGross    = mRevenue - mCOGS;
  const mExpenses = expenses.filter(e=>e.month===viewMonth).reduce((s,e)=>s+e.amount,0);
  const mNet      = mGross - mExpenses;
  const ownerNet  = mNet * PROFIT_SPLIT.owner;
  const reneNet   = mNet * PROFIT_SPLIT.rene;

  // ── Months list for selector ──
  const allMonths = [...new Set([
    ...sales.map(s=>s.date.slice(0,7)),
    ...expenses.map(e=>e.month),
    today().slice(0,7)
  ])].sort((a,b)=>b.localeCompare(a));

  const monthExpenses = expenses.filter(e=>e.month===viewMonth);

  const saveExp = async () => {
    if (!ef.amount) return;
    await saveExpenses([...expenses,{id:uid(),cat:ef.cat,amount:+ef.amount,month:ef.month,date:ef.date||ef.month,note:ef.note}]);
    setShowExpForm(false); setEf({cat:"alquiler",amount:"",month:today().slice(0,7),note:""});
  };
  const delExp = async id => await saveExpenses(expenses.filter(e=>e.id!==id));

  const Card = ({l,usd,txt,c,sub}) => (
    <div className="card-sm" style={{borderLeft:`3px solid ${c}50`}}>
      <div style={{fontSize:10,color:"#1a4a50",marginBottom:4,textTransform:"uppercase",letterSpacing:".06em"}}>{l}</div>
      {usd!==undefined
        ? <><div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:16,fontWeight:700,color:c}}>{fmtUSD(usd)}</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"#fbbf24",marginTop:1}}>{fmtBs(usd,rate)}</div></>
        : <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:16,fontWeight:700,color:c}}>{txt}</div>
      }
      {sub && <div style={{fontSize:11,color:"#1a4a50",marginTop:3}}>{sub}</div>}
    </div>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:22}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
        <div>
          <h1 style={{fontSize:26,fontWeight:800,color:"#fff",letterSpacing:"-.02em"}}>Finanzas</h1>
          <div style={{color:"#1a4a50",fontSize:13,marginTop:2}}>Gastos fijos · Distribución de ganancias</div>
        </div>
        <select value={viewMonth} onChange={e=>setViewMonth(e.target.value)}
          style={{background:"#071418",border:"1px solid #0d2a30",borderRadius:8,padding:"8px 14px",color:"#e2e8f4",fontFamily:"'JetBrains Mono',monospace",fontSize:13}}>
          {allMonths.map(m=><option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {/* ── Resumen del mes ── */}
      <div className="card" style={{background:"#030b0e",border:"1px solid #0e2530"}}>
        <div style={{fontSize:12,fontWeight:700,color:"#2dcfe8",marginBottom:16,textTransform:"uppercase",letterSpacing:".08em"}}>
          Resumen de {viewMonth}
        </div>
        <div className="rg3" style={{marginBottom:16}}>
          <Card l="Ingresos brutos"  usd={mRevenue} c="#2dcfe8"/>
          <Card l="Costo mercancía (base invertida)" usd={mCOGS} c="#fbbf24" sub="No es ganancia — es tu inversión de vuelta"/>
          <Card l="Ganancia bruta"   usd={mGross}   c="#34d399" sub="Ingresos − base invertida"/>
        </div>
        <div className="rg3" style={{marginBottom:16}}>
          <Card l="Gastos fijos del mes" usd={mExpenses} c="#f87171"/>
          <Card l="Ganancia neta"   usd={mNet}  c={mNet>=0?"#a78bfa":"#f87171"} sub="Ganancia bruta − gastos fijos"/>
          <div className="card-sm" style={{borderLeft:"3px solid #0e7a8c50",background:"#040d10"}}>
            <div style={{fontSize:10,color:"#1a4a50",marginBottom:4,textTransform:"uppercase"}}>Margen neto</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:22,fontWeight:700,color:"#2dcfe8"}}>
              {mRevenue>0 ? `${((mNet/mRevenue)*100).toFixed(1)}%` : "—"}
            </div>
          </div>
        </div>

        {/* Split 55/45 */}
        {mNet > 0 && (
          <div style={{background:"#040d10",border:"1px solid #0a2028",borderRadius:12,padding:"16px"}}>
            <div style={{fontSize:11,color:"#1a4a50",marginBottom:12,textTransform:"uppercase",letterSpacing:".07em"}}>Distribución de ganancia neta</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              {[
                {id:"owner",pct:PROFIT_SPLIT.owner,label:"Mi parte",color:"#0e7a8c"},
                {id:"rene", pct:PROFIT_SPLIT.rene, label:"René",    color:"#10b981"},
              ].map(({id,pct,label,color})=>(
                <div key={id} style={{background:`${color}08`,border:`1px solid ${color}25`,borderRadius:10,padding:"14px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <span style={{fontSize:13,fontWeight:600,color:`${color}cc`}}>{label}</span>
                    <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:`${color}80`,background:`${color}15`,padding:"2px 8px",borderRadius:20}}>{(pct*100).toFixed(0)}%</span>
                  </div>
                  <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:22,fontWeight:700,color}}>{fmtUSD(mNet*pct)}</div>
                  <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"#fbbf24",marginTop:2}}>{fmtBs(mNet*pct,rate)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {mNet <= 0 && mRevenue > 0 && (
          <div style={{background:"#1a0808",border:"1px solid #4a1010",borderRadius:10,padding:"12px 16px",fontSize:13,color:"#f87171"}}>
            ⚠️ Este mes los gastos superan la ganancia bruta. No hay distribución disponible.
          </div>
        )}
      </div>

      {/* ── Gastos fijos ── */}
      <div className="card">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div>
            <div style={{fontSize:13,fontWeight:700,color:"#f87171"}}>📋 Gastos fijos — {viewMonth}</div>
            <div style={{fontSize:11,color:"#1a4a50",marginTop:2}}>Calendario de vencimientos del mes</div>
          </div>
          <button className="btn-p" style={{fontSize:12,padding:"7px 14px"}} onClick={()=>setShowExpForm(true)}><IPlus/>Registrar pago</button>
        </div>

        {/* Calendario de gastos recurrentes */}
        <div style={{background:"#040d10",border:"1px solid #0a2028",borderRadius:12,padding:"14px",marginBottom:16}}>
          <div style={{fontSize:11,fontWeight:600,color:"#1a4050",textTransform:"uppercase",letterSpacing:".07em",marginBottom:10}}>Vencimientos del mes</div>
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {EXPENSE_CATS.filter(c=>c.schedule).map(cat=>{
              const paid = monthExpenses.filter(e=>e.cat===cat.id);
              const isPaid = paid.length > 0;
              const amtPaid = paid.reduce((s,e)=>s+e.amount,0);
              const isNomina = cat.id === "nomina";
              return (
                <div key={cat.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",background:isPaid?"#071c12":"#071018",border:`1px solid ${isPaid?"#1a4a2a":"#0a1820"}`,borderRadius:8}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:16}}>{cat.icon}</span>
                    <div>
                      <div style={{fontSize:13,color:isPaid?"#34d399":"#9abac8",fontWeight:500}}>{cat.label}</div>
                      <div style={{fontSize:11,color:isPaid?"#1a5a30":"#1a3a50"}}>{cat.schedule}</div>
                    </div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    {isPaid
                      ? <span style={{fontSize:12,color:"#34d399",fontFamily:"'JetBrains Mono',monospace"}}>✓ {fmtUSD(amtPaid)}</span>
                      : <span style={{fontSize:11,color:"#f87171",background:"#2a0c0c",padding:"2px 8px",borderRadius:20,border:"1px solid #4a1010"}}>⏳ Pendiente</span>
                    }
                    {!isPaid && (
                      <button onClick={()=>setEf(f=>({...f,cat:cat.id,amount:cat.defaultAmt||""}))||setShowExpForm(true)}
                        style={{background:"#0c2e35",border:"1px solid #1a5060",borderRadius:6,padding:"4px 10px",color:"#2dcfe8",fontSize:11,cursor:"pointer",fontFamily:"'Outfit',sans-serif"}}>
                        Registrar
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {showExpForm && (
          <div style={{background:"#050f12",border:"1px solid #0a2028",borderRadius:12,padding:"16px",marginBottom:16,display:"flex",flexDirection:"column",gap:12}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
              <div className="field"><label>Categoría</label>
                <select value={ef.cat} onChange={e=>{
                  const cat = EXPENSE_CATS.find(c=>c.id===e.target.value);
                  setEf(f=>({...f,cat:e.target.value,amount:cat?.defaultAmt||f.amount}));
                }}>
                  {EXPENSE_CATS.map(c=><option key={c.id} value={c.id}>{c.icon} {c.label} {c.schedule?`(${c.schedule})`:""}</option>)}
                </select>
              </div>
              <div className="field"><label>Mes</label>
                <input type="month" value={ef.month} onChange={e=>setEf(f=>({...f,month:e.target.value}))}/>
              </div>
              <div className="field"><label>Monto (USD)</label>
                <input type="number" min="0" placeholder="0.00" value={ef.amount} onChange={e=>setEf(f=>({...f,amount:e.target.value}))}/>
              </div>
            </div>
            {EXPENSE_CATS.find(c=>c.id===ef.cat)?.schedule && (
              <div style={{background:"#071c22",border:"1px solid #0a2028",borderRadius:8,padding:"8px 12px",fontSize:11,color:"#1a5060"}}>
                📅 {EXPENSE_CATS.find(c=>c.id===ef.cat)?.label} vence el: <strong style={{color:"#2dcfe8"}}>{EXPENSE_CATS.find(c=>c.id===ef.cat)?.schedule}</strong>
              </div>
            )}
            <div className="field"><label>Nota (opcional)</label>
              <input placeholder="Ej: Alquiler local Chinita, mes pagado" value={ef.note} onChange={e=>setEf(f=>({...f,note:e.target.value}))}/>
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button className="btn-g" onClick={()=>setShowExpForm(false)}>Cancelar</button>
              <button className="btn-p" onClick={saveExp}><ICheck/>Guardar</button>
            </div>
          </div>
        )}

        {monthExpenses.length===0
          ? <div style={{color:"#0d2a30",textAlign:"center",padding:"12px 0",fontSize:13}}>Sin pagos registrados para {viewMonth}</div>
          : <table>
              <thead><tr><th>Categoría</th><th>Nota</th><th>Fecha</th><th style={{textAlign:"right"}}>USD</th><th style={{textAlign:"right"}}>Bs</th><th></th></tr></thead>
              <tbody>
                {monthExpenses.map(e=>{
                  const cat=EXPENSE_CATS.find(c=>c.id===e.cat);
                  return (
                    <tr key={e.id}>
                      <td><span style={{fontSize:15}}>{cat?.icon}</span> <span style={{color:"#a0c8c0"}}>{cat?.label}</span></td>
                      <td style={{color:"#1a4a50",fontSize:12}}>{e.note||"—"}</td>
                      <td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"#1a4a50"}}>{e.date||e.month||"—"}</td>
                      <td style={{textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontSize:13,color:"#f87171"}}>{fmtUSD(e.amount)}</td>
                      <td style={{textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"#fbbf24"}}>{fmtBs(e.amount,rate)}</td>
                      <td><button className="btn-d" style={{padding:"3px 8px",fontSize:11}} onClick={()=>delExp(e.id)}>✕</button></td>
                    </tr>
                  );
                })}
                <tr style={{background:"#040d10"}}>
                  <td colSpan={3} style={{fontWeight:700,color:"#f87171",fontSize:13}}>Total gastos</td>
                  <td style={{textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontSize:14,fontWeight:700,color:"#f87171"}}>{fmtUSD(mExpenses)}</td>
                  <td style={{textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"#fbbf24"}}>{fmtBs(mExpenses,rate)}</td>
                  <td/>
                </tr>
              </tbody>
            </table>
        }
      </div>

    </div>
  );
}

// ── Stats Tab ─────────────────────────────────────────────────────────────────
function StatsTab({ sales, expenses=[], rate, profile, isMobile }) {
  // v2 — fixed buildData scope
  const [period, setPeriod] = useState("day");
  const [hover,  setHover]  = useState(null);

  const fmtLabel = (key, pd) => {
    if (pd === "day") {
      const d = new Date(key+"T12:00");
      const dn = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
      const mn = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
      return `${dn[d.getDay()]} ${d.getDate()} ${mn[d.getMonth()]}`;
    }
    if (pd === "week") {
      const d = new Date(key+"T12:00");
      return `Sem ${d.getDate()}/${d.getMonth()+1}`;
    }
    if (pd === "month") {
      const mn = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
      const [y,m] = key.split("-");
      return `${mn[parseInt(m)-1]} ${y.slice(2)}`;
    }
    return key;
  };

  // Buckets CONTINUOS hasta hoy: cada dia/semana/mes/año existe aunque no
  // haya ventas — asi cada venta cae en su lugar y no se deforma el tiempo.
  const keyOf = date => {
    if (period === "day")   return date;
    if (period === "week")  { const d=new Date(date+"T12:00"), w=new Date(d); w.setDate(d.getDate()-d.getDay()); return w.toISOString().slice(0,10); }
    if (period === "month") return date.slice(0,7);
    return date.slice(0,4);
  };
  const buildData = () => {
    const limit = period==="day"?14 : period==="week"?12 : period==="month"?12 : 6;
    // generar las llaves del rango, terminando hoy
    const keys = [];
    const now = new Date(today()+"T12:00");
    for (let i=limit-1; i>=0; i--) {
      const d = new Date(now);
      if (period==="day")        d.setDate(now.getDate()-i);
      else if (period==="week")  d.setDate(now.getDate()-now.getDay()-i*7);
      else if (period==="month") d.setMonth(now.getMonth()-i);
      else                       d.setFullYear(now.getFullYear()-i);
      const iso = d.toISOString().slice(0,10);
      keys.push(period==="month" ? iso.slice(0,7) : period==="year" ? iso.slice(0,4) : iso);
    }
    const buckets = Object.fromEntries(keys.map(k=>[k,{rev:0,profit:0,items:0}]));
    sales.forEach(s => {
      const k = keyOf(s.date);
      if (buckets[k]) { buckets[k].rev+=s.total; buckets[k].profit+=s.profit; buckets[k].items+=s.qty; }
    });
    return keys.map(k => ({key:k, lbl:fmtLabel(k,period), ...buckets[k]}));
  };

  const data      = buildData();
  const maxRev    = Math.max(1, ...data.map(d=>d.rev));
  const totalRev  = data.reduce((s,d)=>s+d.rev,0);
  const totalProf = data.reduce((s,d)=>s+d.profit,0);
  const totalItems= data.reduce((s,d)=>s+d.items,0);

  const PERIODS = [
    {id:"day",l:"Diario"},{id:"week",l:"Semanal"},
    {id:"month",l:"Mensual"},{id:"year",l:"Anual"},
  ];

  // Chart geometry
  const chartW=800, chartH=240, padL=14, padR=62, padB=40, padT=14;
  const innerW=chartW-padL-padR, innerH=chartH-padT-padB;
  const xOf=(i,len)=>padL+(i/Math.max(len-1,1))*innerW;
  const yOf=(v,mx)=>padT+innerH-Math.max(0,v/mx)*innerH;

  const smoothPath = (vals, mx) => {
    if (vals.length < 2) return "";
    const P = vals.map((v,i)=>[xOf(i,vals.length),yOf(v,mx)]);
    let d = `M ${P[0][0].toFixed(1)},${P[0][1].toFixed(1)}`;
    for (let i=0;i<P.length-1;i++) {
      const cp1x=P[i][0]+(P[i+1][0]-P[Math.max(0,i-1)][0])/6;
      const cp1y=P[i][1]+(P[i+1][1]-P[Math.max(0,i-1)][1])/6;
      const cp2x=P[i+1][0]-(P[Math.min(P.length-1,i+2)][0]-P[i][0])/6;
      const cp2y=P[i+1][1]-(P[Math.min(P.length-1,i+2)][1]-P[i][1])/6;
      d+=` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${P[i+1][0].toFixed(1)},${P[i+1][1].toFixed(1)}`;
    }
    return d;
  };
  const areaPath = (lp, len) => {
    if (!lp) return "";
    return `${lp} L ${xOf(len-1,len).toFixed(1)},${(padT+innerH)} L ${padL},${padT+innerH} Z`;
  };

  const revPath  = smoothPath(data.map(d=>d.rev),  maxRev);
  const profPath = smoothPath(data.map(d=>d.profit),maxRev);
  const yTicks   = [0,0.25,0.5,0.75,1].map(pct=>({y:padT+innerH-pct*innerH,label:`$${(maxRev*pct).toFixed(0)}`}));

  // NET profit split — expenses for the SAME period as the selected data
  const currentMonth = today().slice(0,7);

  // Which months are represented in the current data view?
  const dataMonths = new Set(data.map(d =>
    period === "day"  ? d.key.slice(0,7) :
    period === "week" ? d.key.slice(0,7) :
    period === "month"? d.key :
    d.key  // year
  ));
  const dataYears = new Set(data.map(d => d.key.slice(0,4)));

  const periodExpenses = expenses.filter(e => {
    const eM = (e.month || e.date?.slice(0,7) || "");
    const eY = eM.slice(0,4);
    if (!eM) return false;
    if (period === "year")  return dataYears.has(eY);
    return dataMonths.has(eM);
  });

  const totalExpenses = periodExpenses.reduce((s,e) => s + e.amount, 0);
  const netProfit     = Math.max(0, totalProf - totalExpenses);
  const ownerCut      = netProfit * PROFIT_SPLIT.owner;
  const reneCut       = netProfit * PROFIT_SPLIT.rene;

  // Expense coverage = how many fixed expense CATEGORIES are registered as paid this month
  // vs total categories that should be paid (those with a schedule)
  const scheduledCats = EXPENSE_CATS.filter(c => c.schedule);
  const paidCatIds    = new Set(
    expenses
      .filter(e => (e.month || e.date?.slice(0,7)) === currentMonth)
      .map(e => e.cat)
  );
  const paidCount    = scheduledCats.filter(c => paidCatIds.has(c.id)).length;
  // Nómina counts twice (día 1 y día 15) — check if registered ≥ 2 times
  const nominaPayments = expenses.filter(e => e.cat==="nomina" && (e.month||e.date?.slice(0,7))===currentMonth);
  const nominaTotal    = nominaPayments.reduce((s,e)=>s+e.amount,0);
  const nominaTarget   = 2; // 2 pagos de $300
  // Count: each $300 = 1 pago; $600 in one shot = 2 pagos
  const nominaDone     = Math.min(nominaTarget, nominaTotal >= 600 ? 2 : nominaPayments.length);
  const totalUnits     = scheduledCats.length - 1 + nominaTarget;
  const paidUnits      = (paidCount - (paidCatIds.has("nomina")?1:0)) + nominaDone;
  const expCoverage    = totalUnits > 0 ? Math.min(100, (paidUnits / totalUnits) * 100) : 0;
  const expPaidTotal   = expenses.filter(e=>(e.month||e.date?.slice(0,7))===currentMonth).reduce((s,e)=>s+e.amount,0);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      {/* Header + period selector */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:10}}>
        <div>
          <h1 style={{fontSize:26,fontWeight:800,color:"#fff",letterSpacing:"-.02em"}}>Estadísticas</h1>
          <div style={{color:"#1a4a50",fontSize:13,marginTop:2}}>Ingresos · Ganancias · Tu parte</div>
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {PERIODS.map(p=>(
            <button key={p.id} className={`period-btn ${period===p.id?"active":""}`} onClick={()=>setPeriod(p.id)}>{p.l}</button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="rg4">
        {[
          {l:"Ingresos",    usd:totalRev,   c:"#2dcfe8"},
          {l:"Ganancia bruta",usd:totalProf, c:"#34d399"},
          {l:"Margen prom.", txt:totalRev>0?`${((totalProf/totalRev)*100).toFixed(1)}%`:"—", c:"#a78bfa"},
          {l:"Artículos",   txt:`${totalItems} pz`, c:"#fbbf24"},
        ].map(({l,usd,txt,c})=>(
          <div key={l} className="card" style={{borderTop:`2px solid ${c}30`}}>
            <div style={{fontSize:10,color:"#1a4a50",textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>{l}</div>
            {usd!==undefined
              ? <><div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:18,fontWeight:700,color:c}}>{fmtUSD(usd)}</div>
                  <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"#fbbf24",marginTop:2}}>{fmtBs(usd,rate)}</div></>
              : <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:22,fontWeight:700,color:c}}>{txt}</div>
            }
          </div>
        ))}
      </div>

      {/* Line chart */}
      <div style={{background:"#030b0e",border:"1px solid #0a2028",borderRadius:16,padding:"20px 16px 10px",position:"relative"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,paddingRight:4}}>
          <div style={{display:"flex",alignItems:"baseline",gap:10}}>
            <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:20,fontWeight:700,color:"#2dcfe8"}}>{fmtUSD(totalRev)}</span>
            <span style={{fontSize:11,color:"#1a4a50"}}>{PERIODS.find(p=>p.id===period)?.l.toLowerCase()}</span>
          </div>
          <div style={{display:"flex",gap:18,fontSize:11}}>
            <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{display:"inline-block",width:24,height:2,background:"#2dcfe8",borderRadius:2}}/><span style={{color:"#2dcfe8"}}>Ingresos</span></span>
            <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{display:"inline-block",width:24,height:2,background:"#34d399",borderRadius:2,opacity:.8}}/><span style={{color:"#34d399"}}>Ganancia</span></span>
          </div>
        </div>

        {/* Tooltip */}
        {hover!==null && data[hover] && (
          <div style={{position:"absolute",top:14,left:"50%",transform:"translateX(-50%)",background:"#071c22",border:"1px solid #0e7a8c",borderRadius:10,padding:"7px 16px",fontSize:12,zIndex:10,pointerEvents:"none",display:"flex",gap:16,whiteSpace:"nowrap"}}>
            <span style={{color:"#1a4a50"}}>{data[hover].lbl}</span>
            <span style={{color:"#2dcfe8",fontFamily:"'JetBrains Mono',monospace"}}>{fmtUSD(data[hover].rev)}</span>
            <span style={{color:"#34d399",fontFamily:"'JetBrains Mono',monospace"}}>+{fmtUSD(data[hover].profit)}</span>
          </div>
        )}

        {data.length===0
          ? <div style={{color:"#0d2a30",textAlign:"center",padding:"60px 0",fontSize:13}}>Sin datos para este período</div>
          : <svg viewBox={`0 0 ${chartW} ${chartH}`} style={{width:"100%",height:chartH,display:"block",overflow:"visible"}}
              onMouseLeave={()=>setHover(null)}>
              <defs>
                <filter id="gR"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
                <filter id="gP"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
                <linearGradient id="fillRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2dcfe8" stopOpacity=".2"/>
                  <stop offset="100%" stopColor="#2dcfe8" stopOpacity="0"/>
                </linearGradient>
                <linearGradient id="fillProf" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34d399" stopOpacity=".15"/>
                  <stop offset="100%" stopColor="#34d399" stopOpacity="0"/>
                </linearGradient>
              </defs>

              {/* Grid + Y labels */}
              {yTicks.map(({y,label},i)=>(
                <g key={i}>
                  <line x1={padL} x2={chartW-padR} y1={y} y2={y} stroke={i===0?"#0e2530":"#081820"} strokeWidth={i===0?1:.7} strokeDasharray={i===0?"0":"4,5"}/>
                  <text x={chartW-padR+8} y={y+4} fontSize="9" fill="#1a4055" fontFamily="'JetBrains Mono',monospace" textAnchor="start">{label}</text>
                </g>
              ))}

              {/* Barras: ingreso (cian) con la ganancia encima (verde) */}
              {data.map((d,i)=>{
                const slot = innerW/data.length;
                const bw   = Math.min(46, slot*0.62);
                const x    = padL + slot*i + (slot-bw)/2;
                const ry   = yOf(d.rev,maxRev),  rh = padT+innerH-ry;
                const py   = yOf(d.profit,maxRev), ph = padT+innerH-py;
                const hov  = hover===i;
                return (
                  <g key={i} onMouseEnter={()=>setHover(i)} style={{cursor:"crosshair"}}>
                    <rect x={padL+slot*i} y={padT} width={slot} height={innerH} fill={hov?"#0a202808":"transparent"}/>
                    {d.rev>0 && <rect x={x} y={ry} width={bw} height={Math.max(rh,2)} rx="4" fill={hov?"#3addf5":"#1a9ab5"} opacity={hov?1:.85}/>}
                    {d.profit>0 && <rect x={x+bw*0.2} y={py} width={bw*0.6} height={Math.max(ph,2)} rx="3" fill={hov?"#4ef0b0":"#22a874"}/>}
                    {d.rev===0 && <rect x={x} y={padT+innerH-2} width={bw} height="2" rx="1" fill="#0d2530"/>}
                    {hov && d.rev>0 && (
                      <text x={x+bw/2} y={ry-6} textAnchor="middle" fontSize="10" fill="#3addf5" fontFamily="'JetBrains Mono',monospace" fontWeight="700">${d.rev.toFixed(0)}</text>
                    )}
                  </g>
                );
              })}

              {/* Etiquetas del eje X */}
              {data.map((d,i)=>{
                const slot = innerW/data.length;
                const x = padL + slot*i + slot/2;
                const step = data.length>12 ? 2 : 1;
                const show = i%step===0 || i===data.length-1;
                const parts = period==="day" ? d.lbl.split(" ") : [d.lbl];
                return show ? (
                  <g key={i}>
                    {parts.length===3
                      ? <>
                          <text x={x} y={chartH-14} textAnchor="middle" fontSize="9" fill={hover===i?"#3addf5":"#2dcfe8"} fontFamily="'JetBrains Mono',monospace" fontWeight="700">{parts[0]}</text>
                          <text x={x} y={chartH-4}  textAnchor="middle" fontSize="8.5" fill="#1a4055" fontFamily="'JetBrains Mono',monospace">{parts[1]} {parts[2]}</text>
                        </>
                      : <text x={x} y={chartH-6} textAnchor="middle" fontSize="9" fill={hover===i?"#3addf5":"#1a4055"} fontFamily="'JetBrains Mono',monospace">{d.lbl}</text>
                    }
                  </g>
                ) : null;
              })}
              <line x1={padL} x2={chartW-padR} y1={padT+innerH} y2={padT+innerH} stroke="#0e2530" strokeWidth="1"/>
            </svg>
        }
      </div>

      {/* ── Profit split NET ── */}
      <div className="card" style={{background:"#040d10",borderColor:"#1a3a20"}}>
        <div style={{fontSize:12,fontWeight:700,color:"#34d399",marginBottom:14,textTransform:"uppercase",letterSpacing:".08em"}}>
          💰 Lo que te queda — {PERIODS.find(p=>p.id===period)?.l}
        </div>

        {/* Month expense coverage — by category */}
        <div style={{background:"#071418",border:"1px solid #0a2028",borderRadius:12,padding:"12px 14px",marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{fontSize:11,color:"#a0c8d0",fontWeight:600}}>📋 Gastos fijos — {currentMonth}</div>
            <div style={{fontSize:11,fontFamily:"'JetBrains Mono',monospace",color:expCoverage>=100?"#34d399":"#fbbf24",fontWeight:700}}>
              {paidUnits}/{totalUnits} pagos {expCoverage>=100?"✓ Al día":"pendientes"}
            </div>
          </div>
          {/* Per-category pills */}
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
            {scheduledCats.map(cat=>{
              const catPaid = paidCatIds.has(cat.id);
              const catCount = expenses.filter(e=>e.cat===cat.id&&(e.month||e.date?.slice(0,7))===currentMonth).length;
              const catTotal = expenses.filter(e=>e.cat===cat.id&&(e.month||e.date?.slice(0,7))===currentMonth).reduce((s,e)=>s+e.amount,0);
              const isNomina = cat.id==="nomina";
              const done = isNomina ? nominaDone >= 2 : catPaid;
              const partial = isNomina && nominaDone===1;
              return (
                <div key={cat.id} style={{background:done?"#0f2820":partial?"#1a1a08":"#1a0808",border:`1px solid ${done?"#1a5a30":partial?"#3a3010":"#3a1010"}`,borderRadius:8,padding:"4px 10px",fontSize:11,color:done?"#34d399":partial?"#fbbf24":"#f87171",display:"flex",alignItems:"center",gap:5}}>
                  <span>{cat.icon}</span>
                  <span>{cat.label}</span>
                  {isNomina && <span style={{fontSize:9,opacity:.8}}>(${catTotal}/600)</span>}
                  <span>{done?"✓":partial?"½":"✗"}</span>
                </div>
              );
            })}
          </div>
          <div style={{height:6,background:"#0a1820",borderRadius:4,overflow:"hidden",marginBottom:8}}>
            <div style={{height:"100%",width:`${expCoverage}%`,background:expCoverage>=100?"#34d399":"linear-gradient(90deg,#f87171,#fbbf24)",borderRadius:4,transition:"width .6s"}}/>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#1a4050"}}>
            <div>Total pagado: <span style={{fontFamily:"'JetBrains Mono',monospace",color:"#f87171"}}>{fmtUSD(expPaidTotal)}</span>
              <span style={{fontFamily:"'JetBrains Mono',monospace",color:"#fbbf24",marginLeft:5}}>{fmtBs(expPaidTotal,rate)}</span>
            </div>
            {expCoverage<100 && <div style={{color:"#fbbf24",fontWeight:600}}>⚠ Pendiente al fin de mes</div>}
          </div>
        </div>

        {/* Gross → Net waterfall */}
        <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
          {[
            {l:"Ganancia bruta",v:totalProf,   c:"#2dcfe8"},
            {l:"− Gastos período",v:-totalExpenses, c:"#f87171"},
            {l:"= Ganancia NETA",v:netProfit,   c:"#34d399", bold:true},
          ].map(({l,v,c,bold})=>(
            <div key={l} style={{flex:1,minWidth:110,background:"#071418",border:`1px solid ${bold?"#1a3a20":"#0a2028"}`,borderRadius:10,padding:"10px 12px"}}>
              <div style={{fontSize:9,color:"#1a4050",textTransform:"uppercase",letterSpacing:".06em",marginBottom:4}}>{l}</div>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:bold?15:13,fontWeight:bold?700:400,color:c}}>
                {v<0?"-":""}{fmtUSD(Math.abs(v))}
              </div>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:"#fbbf24",marginTop:1}}>{fmtBs(Math.abs(v),rate)}</div>
            </div>
          ))}
        </div>

        {/* Personal split — HERO SIZE */}
        <div className="rg2" style={{gap:16}}>
          {[
            {id:"owner",name:"P.G",  pct:PROFIT_SPLIT.owner, cut:ownerCut, color:"#0e7a8c"},
            {id:"rene", name:"René", pct:PROFIT_SPLIT.rene,  cut:reneCut,  color:"#10b981"},
          ].map(p=>{
            const isMe = profile?.id === p.id;
            return (
              <div key={p.id} style={{background:isMe?"#071c22":"#050f12",border:`2px solid ${isMe?p.color+"80":"#0a2028"}`,borderRadius:16,padding:"22px",position:"relative",overflow:"hidden",boxShadow:isMe?`0 0 40px ${p.color}20`:""}}> 
                {/* Giant % watermark */}
                <div style={{position:"absolute",right:-4,top:-14,fontSize:100,fontWeight:900,color:`${p.color}07`,fontFamily:"'JetBrains Mono',monospace",lineHeight:1,userSelect:"none",pointerEvents:"none"}}>
                  {(p.pct*100).toFixed(0)}%
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,position:"relative"}}>
                  <div>
                    <div style={{fontSize:11,color:p.color,fontWeight:700,textTransform:"uppercase",letterSpacing:".12em",marginBottom:4}}>
                      {isMe ? "✦ Tu parte" : p.name}
                    </div>
                    <div style={{fontSize:20,fontWeight:800,color:"#e2e8f4"}}>{p.name}</div>
                  </div>
                  <div style={{background:`${p.color}20`,border:`2px solid ${p.color}50`,borderRadius:12,padding:"7px 18px",fontSize:20,fontWeight:900,color:p.color}}>
                    {(p.pct*100).toFixed(0)}%
                  </div>
                </div>
                <div style={{height:6,background:"#071418",borderRadius:4,marginBottom:18,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${p.pct*100}%`,background:`linear-gradient(90deg,${p.color}50,${p.color})`,borderRadius:4,boxShadow:`0 0 8px ${p.color}40`}}/>
                </div>
                {/* THE BIG NUMBER */}
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:42,fontWeight:900,color:p.color,lineHeight:1}}>
                  {fmtUSD(p.cut)}
                </div>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:18,color:"#fbbf24",marginTop:6,fontWeight:700}}>
                  {fmtBs(p.cut,rate)}
                </div>
                <div style={{fontSize:11,color:"#1a4a50",marginTop:10,lineHeight:1.5}}>
                  Libre · ganancia neta después de gastos · {PERIODS.find(x=>x.id===period)?.l.toLowerCase()}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail table */}
      <div className="card" style={{padding:0,overflow:"hidden"}}>
        <table>
          <thead><tr>
            <th>Período</th>
            <th style={{textAlign:"right"}}>Ingresos</th>
            <th style={{textAlign:"right"}}>Bs</th>
            <th style={{textAlign:"right"}}>Ganancia</th>
            <th style={{textAlign:"right"}}>Margen</th>
            <th style={{textAlign:"right"}}>Pzas</th>
          </tr></thead>
          <tbody>
            {data.length===0
              ? <tr><td colSpan={6} style={{textAlign:"center",color:"#0d2a30",padding:"24px 0"}}>Sin datos</td></tr>
              : [...data].reverse().map(d=>(
                  <tr key={d.key}>
                    <td style={{color:"#a0c0c8",fontWeight:500,fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{d.lbl}</td>
                    <td style={{textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"#2dcfe8"}}>{fmtUSD(d.rev)}</td>
                    <td style={{textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"#fbbf24"}}>{fmtBs(d.rev,rate)}</td>
                    <td style={{textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"#34d399"}}>{fmtUSD(d.profit)}</td>
                    <td style={{textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:d.rev>0&&(d.profit/d.rev)>=.3?"#34d399":"#fbbf24"}}>{d.rev>0?`${((d.profit/d.rev)*100).toFixed(1)}%`:"—"}</td>
                    <td style={{textAlign:"right",color:"#1a4a50",fontSize:11}}>{d.items}</td>
                  </tr>
                ))
            }
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DashTab({todayRev,todayProf,todayItems,weekRev,weekProf,totalInvested,totalRetail,inventory,byDate,sortedDates,lowStock,setDD,rate,storeFilter,storeProfiles,isMobile,deltas}) {
  const last7=sortedDates.slice(0,7).reverse();
  const maxR=Math.max(1,...last7.map(d=>byDate[d].reduce((s,v)=>s+v.total,0)));
  const storeLabel = storeFilter==="all" ? "Todas las tiendas" : (storeProfiles?.find(s=>s.id===storeFilter)?.address || storeFilter);
  // Delta vs periodo anterior, estilo panel profesional: ↑ verde / ↓ rojo
  const Delta = ({pair, vs}) => {
    if (!pair) return null;
    const [now, prev] = pair;
    if (!prev && !now) return null;
    if (!prev) return <span style={{fontSize:10,color:"#34d399"}}>nuevo · {vs}</span>;
    const pct = ((now - prev) / prev) * 100;
    const up = pct >= 0;
    return (
      <span style={{fontSize:11,fontWeight:600,color:up?"#34d399":"#f87171",fontFamily:"'JetBrains Mono',monospace"}}>
        {up?"↑":"↓"} {Math.abs(pct).toFixed(1)}% <span style={{color:"#2a4060",fontWeight:400,fontFamily:"'Outfit',sans-serif"}}>{vs}</span>
      </span>
    );
  };
  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
        <div>
          <h1 style={{fontSize:26,fontWeight:800,color:"#fff",letterSpacing:"-.02em"}}>Dashboard</h1>
          <div style={{color:"#2a4060",fontSize:13,marginTop:2}}>{new Date().toLocaleDateString("es-MX",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div>
        </div>
        <div style={{background:"#071c22",border:"1px solid #0e3040",borderRadius:10,padding:"6px 14px",fontSize:12,color:"#2dcfe8"}}>
          🏪 {storeLabel}
        </div>
      </div>
      <div className="rg4">
        {[
          {l:"Ventas hoy",    usd:todayRev,  s:`${todayItems} artículos`, c:"#60a5fa", d:deltas?.todayRev,  vs:"vs ayer"},
          {l:"Ganancia hoy",  usd:todayProf, s:todayRev>0?`Margen ${((todayProf/todayRev)*100).toFixed(0)}%`:"Sin ventas", c:"#34d399", d:deltas?.todayProf, vs:"vs ayer"},
          {l:"Ventas semana", usd:weekRev,   s:"Lunes → hoy",  c:"#a78bfa", d:deltas?.weekRev,  vs:"vs sem. pasada"},
          {l:"Gan. semana",   usd:weekProf,  s:weekRev>0?`Margen ${((weekProf/weekRev)*100).toFixed(0)}%`:"Sin ventas",   c:"#fbbf24", d:deltas?.weekProf, vs:"vs sem. pasada"},
        ].map(({l,usd,s,c,d,vs})=>(
          <div key={l} className="card" style={{borderTop:`2px solid ${c}22`}}>
            <div style={{fontSize:10,color:"#2a4060",textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>{l}</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:20,fontWeight:700,color:c}}>{fmtUSD(usd)}</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"#fbbf24",marginTop:2}}>{fmtBs(usd,rate)}</div>
            <div style={{fontSize:11,color:"#2a4060",marginTop:4,display:"flex",justifyContent:"space-between",gap:6,flexWrap:"wrap"}}>
              <span>{s}</span><Delta pair={d} vs={vs}/>
            </div>
          </div>
        ))}
      </div>
      <div className="rg2">
        <div className="card" style={{background:"#030b0e",borderColor:"#0a2028"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:600,color:"#1e3050",textTransform:"uppercase",letterSpacing:".08em"}}>Últimos 7 días</div>
            <div style={{display:"flex",gap:12,fontSize:10}}>
              <span style={{color:"#2dcfe8"}}>— Ingresos</span>
              <span style={{color:"#34d399"}}>— Ganancia</span>
            </div>
          </div>
          {last7.length===0
            ? <div style={{color:"#141e2e",fontSize:13,textAlign:"center",padding:"30px 0"}}>Sin ventas aún</div>
            : (() => {
                const DAYS_ES = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
                const pts = last7.map((d,i)=>({
                  d, i,
                  rev:  byDate[d].reduce((s,v)=>s+v.total,0),
                  prof: byDate[d].reduce((s,v)=>s+v.profit,0),
                  lbl: (()=>{const dt=new Date(d+"T12:00");return DAYS_ES[dt.getDay()];})(),
                }));
                const maxR = Math.max(1,...pts.map(p=>p.rev));
                const W=520,H=100,pL=4,pR=4,pB=22,pT=6;
                const iW=W-pL-pR, iH=H-pT-pB;
                const xf=(i,n)=>pL+(i/Math.max(n-1,1))*iW;
                const yf=(v,mx)=>pT+iH-Math.max(0,v/mx)*iH;
                const path=(vals,mx)=>{
                  if(vals.length<2)return "";
                  const P=vals.map((v,i)=>[xf(i,vals.length),yf(v,mx)]);
                  let d=`M ${P[0][0].toFixed(1)},${P[0][1].toFixed(1)}`;
                  for(let i=0;i<P.length-1;i++){
                    const cp1x=P[i][0]+(P[i+1][0]-P[Math.max(0,i-1)][0])/6;
                    const cp1y=P[i][1]+(P[i+1][1]-P[Math.max(0,i-1)][1])/6;
                    const cp2x=P[i+1][0]-(P[Math.min(P.length-1,i+2)][0]-P[i][0])/6;
                    const cp2y=P[i+1][1]-(P[Math.min(P.length-1,i+2)][1]-P[i][1])/6;
                    d+=` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${P[i+1][0].toFixed(1)},${P[i+1][1].toFixed(1)}`;
                  }
                  return d;
                };
                const area=(lp,n)=>{if(!lp)return "";const lx=xf(n-1,n);const bl=pT+iH;return `${lp} L ${lx.toFixed(1)},${bl} L ${pL},${bl} Z`;};
                const rp=path(pts.map(p=>p.rev),maxR);
                const pp=path(pts.map(p=>p.prof),maxR);
                return (
                  <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:H,display:"block",overflow:"visible"}}>
                    <defs>
                      <linearGradient id="dR2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2dcfe8" stopOpacity=".2"/><stop offset="100%" stopColor="#2dcfe8" stopOpacity="0"/>
                      </linearGradient>
                      <linearGradient id="dP2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#34d399" stopOpacity=".15"/><stop offset="100%" stopColor="#34d399" stopOpacity="0"/>
                      </linearGradient>
                      <filter id="gR2"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
                    </defs>
                    {/* baseline */}
                    <line x1={pL} x2={W-pR} y1={pT+iH} y2={pT+iH} stroke="#0e2530" strokeWidth="1"/>
                    <path d={area(rp,pts.length)} fill="url(#dR2)"/>
                    <path d={area(pp,pts.length)} fill="url(#dP2)"/>
                    <path d={rp} fill="none" stroke="#2dcfe8" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" filter="url(#gR2)"/>
                    <path d={pp} fill="none" stroke="#34d399" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
                    {pts.map((p,i)=>{
                      const x=xf(i,pts.length), ry=yf(p.rev,maxR), py=yf(p.prof,maxR);
                      const dt=new Date(p.d+"T12:00");
                      const dateNum=dt.getDate();
                      return (
                        <g key={p.d} style={{cursor:"pointer"}} onClick={()=>setDD(p.d)}>
                          <circle cx={x} cy={ry} r="3.5" fill="#2dcfe8" stroke="#030b0e" strokeWidth="1.5"/>
                          <circle cx={x} cy={py} r="2.5" fill="#34d399" stroke="#030b0e" strokeWidth="1.2"/>
                          {/* Day name bold */}
                          <text x={x} y={H-12} textAnchor="middle" fontSize="8.5" fill="#2dcfe8" fontFamily="monospace" fontWeight="700">{p.lbl}</text>
                          {/* Date number */}
                          <text x={x} y={H-3}  textAnchor="middle" fontSize="7.5" fill="#1a4055" fontFamily="monospace">{dateNum}</text>
                          {/* Revenue above point */}
                          <text x={x} y={Math.max(pT+2,ry-7)} textAnchor="middle" fontSize="7" fill="#2dcfe8" fontFamily="monospace" opacity=".75">
                            ${p.rev>=1000?`${(p.rev/1000).toFixed(1)}k`:p.rev.toFixed(0)}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                );
              })()
          }
        </div>
        <div className="card">
          <div style={{fontSize:11,fontWeight:600,color:"#1e3050",textTransform:"uppercase",letterSpacing:".08em",marginBottom:14}}>
            Stock bajo {lowStock.length>0&&<span className="badge br" style={{marginLeft:8}}>{lowStock.length}</span>}
          </div>
          {lowStock.length===0 ? <div style={{color:"#141e2e",fontSize:13,textAlign:"center",padding:"30px 0"}}>Todo en orden ✓</div>
            : lowStock.map(p=>(
                <div key={p.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <div>
                    <div style={{fontSize:13,color:"#b0c0d8"}}>{p.name}</div>
                    <div style={{fontSize:11,color:"#1e3050"}}>{p.cat}</div>
                  </div>
                  <span className={`badge ${getStock(p)===0?"br":"ba"}`}>{getStock(p)===0?"Agotado":`${getStock(p)} pz`}</span>
                </div>
              ))
          }
        </div>
      </div>
      <div className="card">
        <div style={{fontSize:11,fontWeight:600,color:"#1e3050",textTransform:"uppercase",letterSpacing:".08em",marginBottom:14}}>Inversión por categoría</div>
        <div style={{display:"flex",flexDirection:"column",gap:11}}>
          {CATS.map(cat=>{
            const items=inventory.filter(p=>p.cat===cat&&!p.isService);
            if(!items.length) return null;
            const inv=items.reduce((s,p)=>s+p.cost*getStock(p),0);
            const pct=totalInvested>0?(inv/totalInvested)*100:0;
            return (
              <div key={cat}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:5,fontSize:13}}>
                  <span style={{color:"#7a9ab8"}}>{cat}</span>
                  <div style={{textAlign:"right"}}>
                    <span style={{fontFamily:"'JetBrains Mono',monospace",color:"#60a5fa",fontSize:12}}>{fmtUSD(inv)}</span>
                    <span style={{fontFamily:"'JetBrains Mono',monospace",color:"#fbbf24",fontSize:11,marginLeft:8}}>{fmtBs(inv,rate)}</span>
                  </div>
                </div>
                <div style={{height:5,background:"#0a1018",borderRadius:3,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${pct}%`,background:"linear-gradient(90deg,#1d4ed8,#60a5fa)",borderRadius:3,transition:"width .6s"}}/>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Week Tab ──────────────────────────────────────────────────────────────────
function WeekTab({byDate,sortedDates,weekRev,weekProf,ws,setDD,rate,dynProfiles}) {
  const weekDates=sortedDates.filter(d=>d>=ws);
  const weekItems=weekDates.reduce((s,d)=>s+byDate[d].reduce((a,v)=>a+v.qty,0),0);
  const allW=weekDates.flatMap(d=>byDate[d]);

  const allProfs = dynProfiles || PROFILES;
  const byProf=allProfs.reduce((acc,p)=>{
    const ps=allW.filter(s=>s.registeredBy===p.id);
    acc[p.id]={rev:ps.reduce((s,v)=>s+v.total,0),profit:ps.reduce((s,v)=>s+v.profit,0),count:ps.reduce((s,v)=>s+v.qty,0)};
    return acc;
  },{});

  const prodMap={};
  allW.forEach(s=>{if(!prodMap[s.productName])prodMap[s.productName]={qty:0,rev:0,profit:0};prodMap[s.productName].qty+=s.qty;prodMap[s.productName].rev+=s.total;prodMap[s.productName].profit+=s.profit;});
  const topProds=Object.entries(prodMap).sort((a,b)=>b[1].rev-a[1].rev).slice(0,5);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div>
        <h1 style={{fontSize:26,fontWeight:800,color:"#fff",letterSpacing:"-.02em"}}>Esta semana</h1>
        <div style={{color:"#2a4060",fontSize:13,marginTop:2}}>{weekDates.length} días con ventas registradas</div>
      </div>
      <div className="rg3">
        {[{l:"Ingresos semana",usd:weekRev,c:"#60a5fa"},{l:"Ganancia semana",usd:weekProf,c:"#34d399"},{l:"Artículos vendidos",usd:null,extra:`${weekItems} pz`,c:"#a78bfa"}].map(({l,usd,extra,c})=>(
          <div key={l} className="card" style={{textAlign:"center",borderTop:`2px solid ${c}22`}}>
            <div style={{fontSize:10,color:"#2a4060",textTransform:"uppercase",letterSpacing:".07em",marginBottom:8}}>{l}</div>
            {usd!==null ? <>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:20,fontWeight:700,color:c}}>{fmtUSD(usd)}</div>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"#fbbf24",marginTop:2}}>{fmtBs(usd,rate)}</div>
            </> : <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:22,fontWeight:700,color:c}}>{extra}</div>}
          </div>
        ))}
      </div>
      <div className="rg2">
        <div className="card">
          <div style={{fontSize:11,fontWeight:600,color:"#1e3050",textTransform:"uppercase",letterSpacing:".08em",marginBottom:12}}>Días de la semana</div>
          {weekDates.length===0 ? <div style={{color:"#141e2e",fontSize:13,textAlign:"center",padding:"20px 0"}}>Sin ventas esta semana</div>
            : weekDates.map(d=>{
                const rev=byDate[d].reduce((s,v)=>s+v.total,0),prof=byDate[d].reduce((s,v)=>s+v.profit,0),items=byDate[d].reduce((s,v)=>s+v.qty,0);
                return (
                  <div key={d} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:"1px solid #0a1018",cursor:"pointer"}} onClick={()=>setDD(d)}>
                    <div>
                      <div style={{fontSize:13,color:"#b0c0d8"}}>{new Date(d+"T12:00").toLocaleDateString("es-MX",{weekday:"long",day:"numeric",month:"short"})}</div>
                      <div style={{fontSize:11,color:"#1e3050"}}>{items} artículos</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"#60a5fa"}}>{fmtUSD(rev)}</div>
                      <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"#fbbf24"}}>{fmtBs(rev,rate)}</div>
                      <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"#34d399"}}>+{fmtUSD(prof)}</div>
                    </div>
                  </div>
                );
              })
          }
        </div>
        <div className="card">
          <div style={{fontSize:11,fontWeight:600,color:"#1e3050",textTransform:"uppercase",letterSpacing:".08em",marginBottom:12}}>Top productos</div>
          {topProds.length===0 ? <div style={{color:"#141e2e",fontSize:13,textAlign:"center",padding:"20px 0"}}>Sin ventas</div>
            : topProds.map(([name,d],i)=>(
                <div key={name} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 0",borderBottom:i<topProds.length-1?"1px solid #0a1018":"none"}}>
                  <div>
                    <div style={{fontSize:13,color:"#b0c0d8",maxWidth:175}}>{name}</div>
                    <div style={{fontSize:11,color:"#1e3050"}}>{d.qty} pz</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"#60a5fa"}}>{fmtUSD(d.rev)}</div>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"#fbbf24"}}>{fmtBs(d.rev,rate)}</div>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"#34d399"}}>+{fmtUSD(d.profit)}</div>
                  </div>
                </div>
              ))
          }
        </div>
      </div>
      <div className="card">
        <div style={{fontSize:11,fontWeight:600,color:"#1e3050",textTransform:"uppercase",letterSpacing:".08em",marginBottom:14}}>Ventas por perfil</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12}}>
          {allProfs.filter(p=>byProf[p.id]?.count>0||(byProf[p.id]?.rev>0)).map(p=>{
            const d=byProf[p.id]||{rev:0,profit:0,count:0};
            return (
              <div key={p.id} className="card-sm" style={{borderLeft:`3px solid ${p.color}40`}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                  <div style={{width:28,height:28,borderRadius:p.role==="store"?8:"50%",background:`${p.color}15`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>{p.role==="store"?"🏪":p.name.slice(0,2)}</div>
                  <div>
                    <div style={{fontSize:13,fontWeight:600,color:"#c0cfe8"}}>{p.name}</div>
                    {p.address&&<div style={{fontSize:10,color:`${p.color}80`}}>{p.address}</div>}
                  </div>
                </div>
                <div style={{fontSize:10,color:"#1e3050",marginBottom:2}}>INGRESOS</div>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:15,color:p.color,fontWeight:600}}>{fmtUSD(d.rev)}</div>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"#fbbf24",marginTop:1}}>{fmtBs(d.rev,rate)}</div>
                <div style={{fontSize:11,color:"#1e3050",marginTop:3}}>{d.count} arts · {fmtUSD(d.profit)} gan.</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Inv Tab ───────────────────────────────────────────────────────────────────
function InvTab({inventory,saveInv,totalInvested,totalRetail,setInvModal,rate}) {
  const [filter,setFilter]=useState("Todos");
  const [search,setSearch]=useState("");
  const [copied,setCopied]=useState(false);
  const filtered=inventory.filter(p=>(filter==="Todos"||p.cat===filter)&&(search===""||p.name.toLowerCase().includes(search.toLowerCase())));
  const del=async id=>{if(!confirm("¿Eliminar?"))return;await saveInv(inventory.filter(p=>p.id!==id));};

  // Control automatico de reposicion: productos en o bajo su umbral
  const porAgotarse = inventory.filter(isLow).sort((a,b)=>getStock(a)-getStock(b));
  const pedidoMsg = `📦 Pedido de reposición — OptiLatina\n${today()}\n\n` +
    porAgotarse.map(p=>`• ${p.name} — quedan ${getStock(p)} (reponer)`).join("\n");
  const copyPedido = async () => {
    try { await navigator.clipboard.writeText(pedidoMsg); setCopied(true); setTimeout(()=>setCopied(false),2500); } catch {}
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <h1 style={{fontSize:26,fontWeight:800,color:"#fff",letterSpacing:"-.02em"}}>Inventario</h1>
        <button className="btn-p" onClick={()=>setInvModal("new")}><IPlus/>Agregar</button>
      </div>

      {/* Reposicion automatica */}
      {porAgotarse.length>0 && (
        <div className="card" style={{borderColor:"#4a3510"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8,marginBottom:10}}>
            <div style={{fontSize:13,fontWeight:700,color:"#fbbf24"}}>⚠️ Por agotarse — {porAgotarse.length} producto(s) necesitan reposición</div>
            <div style={{display:"flex",gap:7}}>
              <button className="btn-g" style={{fontSize:12}} onClick={copyPedido}>{copied?"✓ Copiado":"Copiar pedido"}</button>
              <a href={`https://api.whatsapp.com/send?text=${encodeURIComponent(pedidoMsg)}`} target="_blank" rel="noreferrer"
                className="btn-p" style={{textDecoration:"none",fontSize:12,padding:"7px 13px"}}>Enviar a distribuidora</a>
            </div>
          </div>
          <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
            {porAgotarse.map(p=>(
              <span key={p.id} style={{background:"#2a1e08",border:"1px solid #4a3510",borderRadius:8,padding:"5px 11px",fontSize:11,color:"#fbbf24",cursor:"pointer"}} onClick={()=>setInvModal(p)} title="Editar / reponer">
                {p.name} — <strong>{getStock(p)===0?"AGOTADO":`${getStock(p)} pz`}</strong>
              </span>
            ))}
          </div>
        </div>
      )}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:11}}>
        <div className="card-sm" style={{textAlign:"center"}}>
          <div style={{fontSize:10,color:"#2a4060",marginBottom:4}}>PRODUCTOS</div>
          <div style={{fontSize:22,fontWeight:700,color:"#60a5fa",fontFamily:"'Outfit',sans-serif"}}>{inventory.length}</div>
        </div>
        <div className="card-sm" style={{textAlign:"center"}}>
          <div style={{fontSize:10,color:"#2a4060",marginBottom:4}}>INVERTIDO</div>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:14,fontWeight:700,color:"#60a5fa"}}>{fmtUSD(totalInvested)}</div>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"#fbbf24",marginTop:1}}>{fmtBs(totalInvested,rate)}</div>
        </div>
        <div className="card-sm" style={{textAlign:"center"}}>
          <div style={{fontSize:10,color:"#2a4060",marginBottom:4}}>VALOR VENTA</div>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:14,fontWeight:700,color:"#34d399"}}>{fmtUSD(totalRetail)}</div>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"#fbbf24",marginTop:1}}>{fmtBs(totalRetail,rate)}</div>
        </div>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
        <input placeholder="Buscar..." value={search} onChange={e=>setSearch(e.target.value)} style={{background:"#0c1220",border:"1px solid #141e30",borderRadius:8,padding:"8px 12px",color:"#e2e8f4",fontFamily:"'Outfit',sans-serif",fontSize:13,width:190}}/>
        {["Todos",...CATS].map(c=>(
          <button key={c} onClick={()=>setFilter(c)} style={{background:filter===c?"#0f1e35":"transparent",border:`1px solid ${filter===c?"#1e3a60":"#141e30"}`,color:filter===c?"#60a5fa":"#1e3050",borderRadius:20,padding:"4px 12px",fontSize:12,fontFamily:"'Outfit',sans-serif",cursor:"pointer"}}>{c}</button>
        ))}
      </div>
      <div className="card" style={{padding:0,overflow:"hidden"}}>
        <table>
          <thead><tr>
            <th>Producto</th><th>Categoría</th>
            <th style={{textAlign:"right"}}>Costo USD</th>
            <th style={{textAlign:"right"}}>Precio USD</th>
            <th style={{textAlign:"right"}}>Precio Bs</th>
            <th style={{textAlign:"right"}}>Margen</th>
            <th style={{textAlign:"center"}}>Stock</th>
            <th style={{textAlign:"right"}}>Invertido</th>
            <th></th>
          </tr></thead>
          <tbody>
            {filtered.length===0 ? <tr><td colSpan={9} style={{textAlign:"center",color:"#1e3050",padding:"28px 0"}}>Sin resultados</td></tr>
              : filtered.map(p=>{
                  const mg=p.price>0?((p.price-p.cost)/p.price*100).toFixed(0):0;
                  const sb=p.isService?{c:"bb",t:"Servicio"}:getStock(p)===0?{c:"br",t:"Agotado"}:getStock(p)<3?{c:"ba",t:`${getStock(p)} pz`}:{c:"bg",t:`${getStock(p)} pz`};
                  return (
                    <tr key={p.id}>
                      <td style={{color:"#b0c0d8",fontWeight:500}}>{p.name}</td>
                      <td><span className={`badge bb`}>{p.cat}</span></td>
                      <td style={{textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"#3a5070"}}>{fmtUSD(p.cost)}</td>
                      <td style={{textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"#60a5fa"}}>{fmtUSD(p.price)}</td>
                      <td style={{textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"#fbbf24"}}>{fmtBs(p.price,rate)}</td>
                      <td style={{textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:mg>=40?"#34d399":mg>=20?"#fbbf24":"#f87171"}}>{mg}%</td>
                      <td style={{textAlign:"center"}}><span className={`badge ${sb.c}`}>{sb.t}</span></td>
                      <td style={{textAlign:"right"}}>
                        {!p.isService ? <>
                          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"#60a5fa"}}>{fmtUSD(p.cost*getStock(p))}</div>
                          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:"#fbbf24"}}>{fmtBs(p.cost*getStock(p),rate)}</div>
                        </> : <span style={{color:"#1e3050"}}>-</span>}
                      </td>
                      <td><div style={{display:"flex",gap:5,justifyContent:"flex-end"}}>
                        <button className="btn-g" style={{padding:"5px 9px"}} onClick={()=>setInvModal(p)}><IEdit/></button>
                        <button className="btn-d" style={{padding:"5px 9px"}} onClick={()=>del(p.id)}><ITrash/></button>
                      </div></td>
                    </tr>
                  );
                })
            }
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Caja Tab ─────────────────────────────────────────────────────────────────
function CajaTab({ sales, deposits, saveDeposits, rate, payments, orders = [] }) {
  const [showDeposit, setShowDeposit] = useState(false);
  const [depAmount,   setDepAmount]   = useState("");
  const [depNote,     setDepNote]     = useState("");
  const [depDate,     setDepDate]     = useState(today());
  const [inPeriod,    setInPeriod]    = useState("hoy"); // hoy | semana | mes

  const cashSales   = sales.filter(s=>normMethod(s.paymentMethod)==="efectivo");
  const totalCash   = cashSales.reduce((s,v)=>s+v.total,0);
  const totalDep    = deposits.reduce((s,d)=>s+d.amount,0);
  const saldoCaja   = totalCash - totalDep;

  // Desglose por metodo (normaliza ids legacy: cash→efectivo, bank→pagoMovil)
  const byMethod = PAY_METHODS.map(m=>{
    const ms = sales.filter(s=>normMethod(s.paymentMethod)===m.id);
    return {...m, total:ms.reduce((s,v)=>s+v.total,0), count:ms.reduce((s,v)=>s+v.qty,0)};
  }).filter(m=>m.total>0);

  // Entradas de dinero del periodo: ventas directas + abonos de apartados
  const from = inPeriod==="hoy" ? today() : inPeriod==="semana" ? weekStart() : today().slice(0,7)+"-01";
  const flow = moneyIn(sales, orders, from, today());
  const porCobrar = orders.filter(o=>o.status!=="entregado").reduce((s,o)=>s+orderBalance(o),0);

  const handleDeposit = async () => {
    const amt = parseFloat(depAmount);
    if (!amt || amt<=0) return;
    const d = [...deposits, {id:uid(), date:depDate, amount:amt, note:depNote}];
    await saveDeposits(d);
    setShowDeposit(false); setDepAmount(""); setDepNote(""); setDepDate(today());
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
        <div>
          <h1 style={{fontSize:26,fontWeight:800,color:"#fff",letterSpacing:"-.02em"}}>Caja</h1>
          <div style={{color:"#1a4a50",fontSize:13,marginTop:2}}>Control de efectivo y métodos de cobro</div>
        </div>
        <button className="btn-p" onClick={()=>setShowDeposit(true)}><IDeposit/>Registrar depósito</button>
      </div>

      {/* ── Entradas de dinero por moneda: cuántos Bs y $ entraron ── */}
      <div className="card">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
          <div style={{fontSize:13,fontWeight:700,color:"#2dcfe8"}}>💱 Dinero que entró — ventas + abonos</div>
          <div style={{display:"flex",gap:6}}>
            {[["hoy","Hoy"],["semana","Esta semana"],["mes","Este mes"]].map(([id,l])=>(
              <button key={id} className={`period-btn ${inPeriod===id?"active":""}`} onClick={()=>setInPeriod(id)}>{l}</button>
            ))}
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:11,marginBottom:14}}>
          <div className="card-sm" style={{textAlign:"center",borderColor:"#2a2010"}}>
            <div style={{fontSize:10,color:"#7a6420",marginBottom:4}}>BOLÍVARES (Bs)</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:16,fontWeight:700,color:"#fbbf24"}}>Bs {flow.totBs.toLocaleString("es-VE",{maximumFractionDigits:0})}</div>
            <div style={{fontSize:9,color:"#5a4a18",marginTop:2}}>Pago Móvil + Transferencia</div>
          </div>
          <div className="card-sm" style={{textAlign:"center",borderColor:"#0e3040"}}>
            <div style={{fontSize:10,color:"#2a6070",marginBottom:4}}>DÓLARES (USD)</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:16,fontWeight:700,color:"#34d399"}}>{fmtUSD(flow.totUSD)}</div>
            <div style={{fontSize:9,color:"#1a4a50",marginTop:2}}>Efectivo + Zelle</div>
          </div>
          <div className="card-sm" style={{textAlign:"center",borderColor:"#1e1440"}}>
            <div style={{fontSize:10,color:"#5a4a90",marginBottom:4}}>USDT</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:16,fontWeight:700,color:"#a78bfa"}}>{flow.totUSDT.toFixed(2)} USDT</div>
            <div style={{fontSize:9,color:"#3a2a60",marginTop:2}}>Cripto</div>
          </div>
        </div>
        {Object.keys(flow.byMethod).length>0 ? (
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {Object.entries(flow.byMethod).sort((a,b)=>b[1].usd-a[1].usd).map(([m,v])=>{
              const info = METHOD_INFO[m] || {label:m, icon:"💳", cur:"USD"};
              return (
                <div key={m} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#050f12",borderRadius:10,padding:"9px 14px",border:"1px solid #0a2028"}}>
                  <div style={{fontSize:13,color:"#b0c0d8"}}>{info.icon} {info.label} <span style={{fontSize:10,color:info.cur==="Bs"?"#fbbf24":info.cur==="USDT"?"#a78bfa":"#34d399"}}>({info.cur})</span></div>
                  <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13,textAlign:"right"}}>
                    {info.cur==="Bs"
                      ? <><span style={{color:"#fbbf24"}}>Bs {(v.bs||v.usd*rate).toLocaleString("es-VE",{maximumFractionDigits:0})}</span><span style={{color:"#2a4060",fontSize:11}}> · {fmtUSD(v.usd)}</span></>
                      : <span style={{color:info.cur==="USDT"?"#a78bfa":"#34d399"}}>{fmtUSD(v.usd)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : <div style={{textAlign:"center",color:"#1e3050",fontSize:12,padding:"10px 0"}}>Sin entradas en este período</div>}
        {porCobrar>0 && (
          <div style={{marginTop:12,background:"#2a1e08",border:"1px solid #4a3510",borderRadius:10,padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontSize:12,color:"#fbbf24"}}>⚠️ Pendiente por cobrar (apartados)</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13,fontWeight:700,color:"#fbbf24"}}>{fmtUSD(porCobrar)} · {fmtBs(porCobrar,rate)}</div>
          </div>
        )}
      </div>

      {/* Modal depósito */}
      {showDeposit && (
        <div className="ov" onClick={e=>{if(e.target===e.currentTarget)setShowDeposit(false);}}>
          <div className="modal" style={{maxWidth:380}}>
            <div style={{fontSize:18,fontWeight:700,color:"#fff",marginBottom:20}}>Registrar depósito</div>
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <div className="field"><label>Fecha</label><input type="date" value={depDate} onChange={e=>setDepDate(e.target.value)}/></div>
              <div className="field"><label>Monto en USD</label><input type="number" min="0" placeholder="0.00" value={depAmount} onChange={e=>setDepAmount(e.target.value)}/></div>
              <div className="field"><label>Nota (banco, referencia…)</label><input placeholder="Ej: Banco Venezuela Cuenta #1234" value={depNote} onChange={e=>setDepNote(e.target.value)}/></div>
              <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                <button className="btn-g" onClick={()=>setShowDeposit(false)}>Cancelar</button>
                <button className="btn-p" onClick={handleDeposit}><ICheck/>Guardar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Resumen efectivo */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14}}>
        {[
          {l:"Efectivo cobrado",  usd:totalCash,  c:"#fbbf24"},
          {l:"Total depositado",  usd:totalDep,   c:"#34d399"},
          {l:"Saldo en caja",     usd:saldoCaja,  c:saldoCaja>=0?"#2dcfe8":"#f87171"},
        ].map(({l,usd,c})=>(
          <div key={l} className="card" style={{borderTop:`2px solid ${c}30`}}>
            <div style={{fontSize:10,color:"#1a4a50",textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>{l}</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:18,fontWeight:700,color:c}}>{fmtUSD(usd)}</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"#fbbf24",marginTop:2}}>{fmtBs(usd,rate)}</div>
          </div>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18}}>
        {/* Ventas por método */}
        <div className="card">
          <div style={{fontSize:11,fontWeight:600,color:"#1a4a50",textTransform:"uppercase",letterSpacing:".08em",marginBottom:14}}>Ventas por método de pago</div>
          {byMethod.length===0
            ? <div style={{color:"#0d2a30",textAlign:"center",padding:"20px 0",fontSize:13}}>Sin ventas</div>
            : byMethod.map(m=>(
                <div key={m.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:"1px solid #071015"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:18}}>{m.icon}</span>
                    <div>
                      <div style={{fontSize:13,color:"#a0c8d0"}}>{m.label}</div>
                      <div style={{fontSize:11,color:"#1a4a50"}}>{m.count} artículos</div>
                    </div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13,color:"#2dcfe8"}}>{fmtUSD(m.total)}</div>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"#fbbf24"}}>{fmtBs(m.total,rate)}</div>
                  </div>
                </div>
              ))
          }
        </div>

        {/* Métodos de pago configurados */}
        <div className="card">
          <div style={{fontSize:11,fontWeight:600,color:"#1a4a50",textTransform:"uppercase",letterSpacing:".08em",marginBottom:14}}>Nuestros datos de cobro</div>
          {payments?.usdt?.address && (
            <div style={{marginBottom:14}}>
              <div style={{fontSize:12,color:"#2dcfe8",fontWeight:600,marginBottom:4}}>🔐 USDT — {payments.usdt.network}</div>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"#6abbc8",wordBreak:"break-all",background:"#050f12",padding:"8px 10px",borderRadius:8}}>{payments.usdt.address}</div>
            </div>
          )}
          {payments?.zelle?.name && (
            <div style={{marginBottom:14}}>
              <div style={{fontSize:12,color:"#a78bfa",fontWeight:600,marginBottom:4}}>💳 Zelle</div>
              <div style={{fontSize:12,color:"#8060d0"}}>{payments.zelle.name}</div>
              <div style={{fontSize:12,color:"#6a50c0"}}>{payments.zelle.email} {payments.zelle.phone}</div>
            </div>
          )}
          {payments?.bank?.name && (
            <div>
              <div style={{fontSize:12,color:"#fbbf24",fontWeight:600,marginBottom:4}}>🏦 Pago Móvil / Transferencia</div>
              <div style={{fontSize:12,color:"#b08030"}}>{payments.bank.bank}</div>
              <div style={{fontSize:12,color:"#906020"}}>{payments.bank.phone} · {payments.bank.name}</div>
              {payments.bank.account && <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"#705010"}}>{payments.bank.account}</div>}
            </div>
          )}
          {!payments?.usdt?.address && !payments?.zelle?.name && !payments?.bank?.name && (
            <div style={{color:"#0d2a30",fontSize:13,textAlign:"center",padding:"20px 0"}}>Configura los métodos en Ajustes</div>
          )}
        </div>
      </div>

      {/* Depósitos */}
      <div className="card" style={{padding:0,overflow:"hidden"}}>
        <div style={{padding:"16px 20px",fontSize:11,fontWeight:600,color:"#1a4a50",textTransform:"uppercase",letterSpacing:".08em",borderBottom:"1px solid #081820"}}>
          Historial de depósitos
        </div>
        {deposits.length===0
          ? <div style={{textAlign:"center",color:"#0d2a30",padding:"30px 0",fontSize:13}}>Sin depósitos registrados</div>
          : <table>
              <thead><tr><th>Fecha</th><th style={{textAlign:"right"}}>Monto USD</th><th style={{textAlign:"right"}}>Monto Bs</th><th>Nota</th><th></th></tr></thead>
              <tbody>
                {[...deposits].reverse().map(d=>(
                  <tr key={d.id}>
                    <td style={{color:"#a0c8d0"}}>{d.date}</td>
                    <td style={{textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontSize:13,color:"#34d399"}}>{fmtUSD(d.amount)}</td>
                    <td style={{textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"#fbbf24"}}>{fmtBs(d.amount,rate)}</td>
                    <td style={{color:"#1a4a50",fontSize:12}}>{d.note||"—"}</td>
                    <td><button className="btn-d" style={{padding:"3px 8px",fontSize:11}} onClick={async()=>await saveDeposits(deposits.filter(x=>x.id!==d.id))}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
        }
      </div>
    </div>
  );
}

// ── Profile Settings Tab ──────────────────────────────────────────────────────
function ProfileSettingsTab({ profile, dynProfiles, saveDynProfiles }) {
  // Always read live data from dynProfiles, not the static prop
  const live = dynProfiles.find(p => p.id === profile.id) || profile;
  const [f, setF] = useState({
    name:        live.name || "",
    description: live.description || "",
    phone:       live.phone || "",
    email:       live.email || "",
    address:     live.address || "",
    pin:         "",
    pinConfirm:  "",
    pw:          "",
    pwConfirm:   "",
    photo:       live.photo || null,
    storeLogo:   live.storeLogo || null,   // logo personalizado de la tienda
  });
  const [saved,    setSaved]    = useState(false);
  const [copied,   setCopied]   = useState(false);
  const [pinErr,   setPinErr]   = useState("");
  const [saving,   setSaving]   = useState(false);
  const fileRef      = useRef(null);
  const storeLogoRef = useRef(null);

  // Keep form in sync if dynProfiles changes externally
  useEffect(() => {
    const l = dynProfiles.find(p => p.id === profile.id) || profile;
    setF(prev => ({
      ...prev,
      name: l.name || prev.name,
      description: l.description || prev.description,
      phone: l.phone || prev.phone,
      email: l.email || prev.email,
      address: l.address || prev.address,
      photo: l.photo ?? prev.photo,
      storeLogo: l.storeLogo ?? prev.storeLogo,
    }));
  }, [dynProfiles, profile.id]);

  const sf = (k,v) => setF(p=>({...p,[k]:v}));

  const handlePhoto = e => {
    const file = e.target.files[0]; if (!file) return;
    compressImage(file, 400).then(data => sf("photo", data)).catch(() => {});
  };
  const handleStoreLogo = e => {
    const file = e.target.files[0]; if (!file) return;
    compressImage(file, 400).then(data => sf("storeLogo", data)).catch(() => {});
  };

  const handleSave = async () => {
    setPinErr(""); setSaving(true);
    if (f.pin && f.pin !== f.pinConfirm) { setPinErr("Los PINs no coinciden"); setSaving(false); return; }
    if (f.pin && (f.pin.length !== 4 || !/^\d{4}$/.test(f.pin))) { setPinErr("El PIN debe ser de 4 dígitos numéricos"); setSaving(false); return; }
    if (f.pw && f.pw !== f.pwConfirm) { setPinErr("Las contraseñas no coinciden"); setSaving(false); return; }
    if (f.pw && f.pw.length < 6) { setPinErr("La contraseña debe tener al menos 6 caracteres"); setSaving(false); return; }
    try {
      const updated = dynProfiles.map(p => p.id === profile.id ? {
        ...p,
        name:        f.name        || p.name,
        description: f.description,
        phone:       f.phone,
        email:       f.email,
        address:     f.address,
        photo:       f.photo,
        storeLogo:   f.storeLogo,
        ...(f.pin ? {pin: f.pin} : {}),
        ...(f.pw  ? {password: f.pw} : {}),
      } : p);
      await saveDynProfiles(updated);
      setF(p => ({...p, pin:"", pinConfirm:"", pw:"", pwConfirm:""}));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch(e) {
      setPinErr("Error al guardar. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  const isStore = live.role === "store";

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20,maxWidth:600}}>
      <div>
        <h1 style={{fontSize:26,fontWeight:800,color:"#fff",letterSpacing:"-.02em"}}>{isStore ? `Tienda — ${live.address||live.name}` : "Mi perfil"}</h1>
        <div style={{color:"#1a4a50",fontSize:13,marginTop:2}}>Configura tu información {isStore?"de la tienda":"personal"}</div>
      </div>

      <div className="card" style={{display:"flex",flexDirection:"column",gap:18}}>
        {/* Avatar / Logo */}
        <div style={{display:"flex",alignItems:"center",gap:20,flexWrap:"wrap"}}>
          <div style={{position:"relative"}}>
            {f.photo
              ? <img src={f.photo} style={{width:80,height:80,borderRadius:isStore?14:"50%",objectFit:"cover",border:`3px solid ${live.color}40`}} alt=""/>
              : isStore
                ? <div style={{width:80,height:80,borderRadius:14,overflow:"hidden",border:`3px solid ${live.color}35`}}><Logo2 s={80}/></div>
                : <div style={{width:80,height:80,borderRadius:"50%",background:`${live.color}18`,border:`3px solid ${live.color}35`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,fontWeight:700,color:live.color}}>{live.name?.slice(0,2)||"?"}</div>
            }
            <button onClick={()=>fileRef.current?.click()} style={{position:"absolute",bottom:-4,right:-4,width:26,height:26,borderRadius:"50%",background:"#0e7a8c",border:"2px solid #040d10",color:"#fff",cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center"}}>📷</button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handlePhoto}/>
          <div style={{flex:1}}>
            <div style={{fontSize:17,fontWeight:700,color:"#e2e8f4"}}>{f.name||live.name}</div>
            <div style={{fontSize:12,color:`${live.color}99`,marginTop:2}}>{isStore ? `Tienda · ${live.address||""}` : "Administrador"}</div>
            <button onClick={()=>fileRef.current?.click()} style={{marginTop:6,fontSize:11,color:"#2dcfe8",background:"transparent",border:"1px solid #0e3a4a",borderRadius:6,padding:"3px 10px",cursor:"pointer"}}>
              Cambiar foto de perfil
            </button>
          </div>
        </div>

        {/* Logo de tienda (solo stores) */}
        {isStore && (
          <div style={{background:"#050f12",border:"1px solid #0a2028",borderRadius:12,padding:"14px",display:"flex",alignItems:"center",gap:16}}>
            <div style={{flexShrink:0}}>
              {f.storeLogo
                ? <img src={f.storeLogo} style={{width:60,height:60,borderRadius:10,objectFit:"cover",border:"2px solid #1a3040"}} alt="logo"/>
                : <div style={{width:60,height:60,borderRadius:10,overflow:"hidden",border:"2px solid #1a3040"}}><Logo2 s={60}/></div>
              }
            </div>
            <input ref={storeLogoRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleStoreLogo}/>
            <div>
              <div style={{fontSize:12,fontWeight:600,color:"#2dcfe8",marginBottom:4}}>Logo de la tienda en pantalla de login</div>
              <div style={{fontSize:11,color:"#1a4a50",marginBottom:8}}>Aparece en la tarjeta de selección de perfil</div>
              <button onClick={()=>storeLogoRef.current?.click()} style={{fontSize:11,color:"#fbbf24",background:"transparent",border:"1px solid #2a2010",borderRadius:6,padding:"4px 12px",cursor:"pointer"}}>
                📷 Cambiar logo de tienda
              </button>
              {f.storeLogo && (
                <button onClick={()=>sf("storeLogo",null)} style={{marginLeft:8,fontSize:11,color:"#f87171",background:"transparent",border:"1px solid #2a1010",borderRadius:6,padding:"4px 10px",cursor:"pointer"}}>✕ Quitar</button>
              )}
            </div>
          </div>
        )}

        <div className="rg2" style={{gap:12}}>
          <div className="field"><label>Nombre</label><input value={f.name} onChange={e=>sf("name",e.target.value)} placeholder="Tu nombre"/></div>
          <div className="field"><label>Teléfono</label><PhoneInput value={f.phone} onChange={v=>sf("phone",v)}/></div>
          <div className="field"><label>Correo electrónico</label><input type="email" value={f.email} onChange={e=>sf("email",e.target.value)} placeholder="tu@correo.com"/></div>
          {isStore && <div className="field"><label>Dirección / Ubicación</label><input value={f.address} onChange={e=>sf("address",e.target.value)} placeholder="Ej: Chinita, Local 12"/></div>}
          <div className="field" style={{gridColumn:"1/-1"}}><label>Descripción</label><input value={f.description} onChange={e=>sf("description",e.target.value)} placeholder="Descripción corta"/></div>
        </div>

        {/* Contraseña */}
        <div style={{background:"#050f12",border:"1px solid #0a2028",borderRadius:12,padding:"14px"}}>
          <div style={{fontSize:11,fontWeight:600,color:"#2dcfe8",marginBottom:4}}>🔑 Contraseña de acceso — dejar vacío para no modificar</div>
          <div style={{fontSize:10,color:"#1a4a50",marginBottom:10}}>{live.password ? "Tienes contraseña activa: al entrar se te pedirá la contraseña en vez del PIN." : "Sin contraseña: entras con PIN. Si creas una contraseña, reemplaza al PIN en el login."}</div>
          <div className="rg2" style={{gap:12}}>
            <div className="field"><label>Nueva contraseña (mín. 6)</label><input type="password" value={f.pw} onChange={e=>sf("pw",e.target.value)} placeholder="••••••••"/></div>
            <div className="field"><label>Confirmar contraseña</label><input type="password" value={f.pwConfirm} onChange={e=>sf("pwConfirm",e.target.value)} placeholder="••••••••"/></div>
          </div>
        </div>

        {/* PIN */}
        <div style={{background:"#050f12",border:"1px solid #0a2028",borderRadius:12,padding:"14px"}}>
          <div style={{fontSize:11,fontWeight:600,color:"#f87171",marginBottom:10}}>🔒 Cambiar PIN — dejar vacío para no modificar</div>
          <div className="rg2" style={{gap:12}}>
            <div className="field"><label>Nuevo PIN (4 dígitos)</label><input type="password" inputMode="numeric" maxLength={4} value={f.pin} onChange={e=>sf("pin",e.target.value.replace(/\D/g,""))} placeholder="••••"/></div>
            <div className="field"><label>Confirmar nuevo PIN</label><input type="password" inputMode="numeric" maxLength={4} value={f.pinConfirm} onChange={e=>sf("pinConfirm",e.target.value.replace(/\D/g,""))} placeholder="••••"/></div>
          </div>
          {pinErr && <div style={{color:"#f87171",fontSize:12,marginTop:6}}>⚠ {pinErr}</div>}
        </div>

        {saved && <div style={{background:"#0f2820",border:"1px solid #1a4a30",borderRadius:10,padding:"10px 14px",fontSize:13,color:"#34d399",textAlign:"center"}}>✓ Guardado correctamente</div>}

      {/* Invite link */}
      <div className="card" style={{background:"#050f12"}}>
        <div style={{fontSize:13,fontWeight:700,color:"#2dcfe8",marginBottom:12}}>🔗 Enlace de invitación</div>
        <div style={{fontSize:12,color:"#1a4a50",marginBottom:10,lineHeight:1.6}}>
          Comparte este enlace para que puedan acceder a la app con su PIN
        </div>
        <div style={{background:"#040d10",border:"1px solid #0a2028",borderRadius:10,padding:"12px 14px",display:"flex",gap:10,alignItems:"center",marginBottom:10}}>
          <div style={{flex:1,fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"#2dcfe8",wordBreak:"break-all"}}>
            {window.location.origin}
          </div>
          <button onClick={()=>{
            navigator.clipboard.writeText(window.location.origin);
            setCopied(true);
            setTimeout(()=>setCopied(false),2000);
          }} style={{background:"#0c2e35",border:"1px solid #0e7a8c",borderRadius:8,padding:"6px 14px",color:"#2dcfe8",cursor:"pointer",fontSize:12,fontFamily:"'Outfit',sans-serif",whiteSpace:"nowrap",flexShrink:0}}>
            {copied?"✓ Copiado":"Copiar"}
          </button>
        </div>
        <div style={{background:"#071418",border:"1px solid #0a2028",borderRadius:10,padding:"10px 14px",fontSize:11,color:"#1a4050"}}>
          PIN de <strong style={{color:"#e2e8f4"}}>{live.name}</strong>: <strong style={{color:"#fbbf24",fontFamily:"'JetBrains Mono',monospace",letterSpacing:"0.2em"}}>{"•".repeat(4)}</strong>
          <div style={{marginTop:4,color:"#1a3a40"}}>Recuerda compartir el PIN de forma privada, no por aquí</div>
        </div>
      </div>
        <div style={{display:"flex",justifyContent:"flex-end"}}>
          <button className="btn-p" style={{minWidth:150}} onClick={handleSave} disabled={saving}>
            <ICheck/>{saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Gestión Tab (solo P.G) ────────────────────────────────────────────────────
// ── Registro rapido: interpreta una venta dictada en texto libre ──────────────
const parseQuickSale = (text) => {
  const t = text.replace(/\s+/g, " ").trim();
  const low = t.toLowerCase();
  const num = s => parseFloat(String(s).replace(",", "."));
  // total: "se vendio a 200", "total 200$", "precio 200", "por 200 dolares"
  const totalM = low.match(/(?:se\s+vendi[oó](?:\s+(?:a|en|por))?|vendid[oa](?:\s+(?:a|en|por))?|total(?:\s+de)?|precio(?:\s+de)?|cuesta|cost[oó])\s*:?\s*\$?\s*(\d+(?:[.,]\d{1,2})?)/);
  // abono: "se abonaron 100", "abono 100", "adelanto 100", "dio 100"
  const abonoM = low.match(/(?:se\s+abon[oó]|abonaron|abon[oó]|adelant[oó]|adelanto(?:\s+de)?|di[oó]\s+de\s+abono|di[oó])\s*:?\s*\$?\s*(\d+(?:[.,]\d{1,2})?)/);
  const pagoCompleto = /pag[oó]\s+(?:todo|completo)|complet[oa]\b|cancel[oó]\s+(?:todo|completo)/.test(low);
  // metodo de pago
  let method = "efectivo";
  if (/zelle/.test(low)) method = "zelle";
  else if (/usdt|cripto|binance/.test(low)) method = "usdt";
  else if (/pago\s*m[oó]vil|pagomovil/.test(low)) method = "pagoMovil";
  else if (/transferencia|transferi/.test(low)) method = "transferencia";
  // telefono: secuencia de 8+ digitos (admite +58, espacios, guiones)
  const phoneM = t.match(/(\+?\d[\d\s.·-]{6,14}\d)/);
  // nombre: despues de "cliente", "nombre", "sr(a)", "a nombre de"
  const nameM = t.match(/(?:a\s+nombre\s+de|cliente|nombre(?:\s+del?\s+cliente)?|se[ñn]or[a]?|sra?\.?)\s*:?\s+([A-Za-zÁÉÍÓÚÑáéíóúñü]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñü]+){0,3})/i);
  // producto: el texto antes de la primera señal de precio/venta
  const cut = low.search(/se\s+vendi|vendid|,?\s*total|precio\s|\$\s*\d|\d+\s*d[oó]lares/);
  const product = (cut > 3 ? t.slice(0, cut) : t).replace(/[,.;\s]+$/, "").trim();
  const total = totalM ? num(totalM[1]) : null;
  const abono = abonoM ? num(abonoM[1]) : (pagoCompleto && total ? total : 0);
  return {
    product, total, abono, method,
    customer: nameM ? nameM[1].replace(/\s+(numero|celular|telefono|tel).*$/i,"").trim() : "",
    phone: phoneM ? phoneM[1].replace(/[\s.·-]/g, "") : "",
  };
};

function QuickEntry({ orders, saveOrders, rate, profile, nextOrderNum }) {
  const [txt,   setTxt]   = useState("");
  const [draft, setDraft] = useState(null);
  const [err,   setErr]   = useState("");
  const [done,  setDone]  = useState(false);
  const [scanning, setScanning] = useState(false);
  const scanRef = useRef(null);

  const interpret = () => {
    setErr("");
    if (txt.trim().length < 8) { setErr("Escribe la venta con más detalle."); return; }
    const d = parseQuickSale(txt);
    setDraft({...d, orderNumber: nextOrderNum});
  };
  const sd = (k,v) => setDraft(p=>({...p,[k]:v}));

  // Escanear la factura con IA de visión (el servidor guarda la clave)
  const scanReceipt = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErr(""); setScanning(true);
    try {
      const img = await compressImage(file, 1500, 0.8);
      const res = await fetch("/api/scan-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: img }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 503 || json.error === "not_configured") {
        setErr("El escáner todavía no está activado. Pídeselo al administrador (falta conectar la clave de IA).");
        return;
      }
      if (!res.ok || !json.ok) {
        setErr(json.message || "No se pudo leer la factura. Intenta con mejor luz o registra la venta a mano.");
        return;
      }
      const d = json.data || {};
      const extras = [d.rx, d.cedula ? `C.I. ${d.cedula}` : ""].filter(Boolean).join(" · ");
      setDraft({
        product:  [d.product, extras].filter(Boolean).join(" · "),
        customer: d.customer || "",
        phone:    d.phone ? (String(d.phone).startsWith("+") ? String(d.phone) : `+58 ${d.phone}`) : "",
        total:    d.total ?? "",
        abono:    d.abono ?? 0,
        method:   METHOD_INFO[d.method] ? d.method : "efectivo",
        orderNumber: d.orderNumber || nextOrderNum,
        _scanned: true,
      });
    } catch {
      setErr("No se pudo procesar la imagen. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setScanning(false);
    }
  };

  const save = async () => {
    setErr("");
    if (!draft.product?.trim()) { setErr("Falta la descripción del producto."); return; }
    if (!draft.total || isNaN(Number(draft.total)) || Number(draft.total)<=0) { setErr("Falta el precio total."); return; }
    const abono = Math.min(Number(draft.abono)||0, Number(draft.total));
    const o = {
      id: uid(), orderNumber: parseInt(draft.orderNumber)||nextOrderNum,
      customer: draft.customer?.trim() || "Cliente", phone: draft.phone||"",
      product: draft.product.trim(), total: Number(draft.total),
      payments: abono>0 ? [{id:uid(), date:today(), amount:abono, method:draft.method,
        amountBs: methodCur(draft.method)==="Bs" ? abono*rate : null, rate}] : [],
      status: "pendiente", storeId: profile.id,
      createdAt: new Date().toISOString(), createdDate: today(), viaTexto: true,
    };
    await saveOrders([...orders, o]);
    setDraft(null); setTxt(""); setDone(true);
    setTimeout(()=>setDone(false), 3500);
  };

  const bal = draft ? Math.max(0, (Number(draft.total)||0) - (Number(draft.abono)||0)) : 0;

  return (
    <div className="card" style={{borderColor:"#14402a"}}>
      <div style={{fontSize:13,fontWeight:700,color:"#34d399",marginBottom:4}}>⚡ Registro rápido — escanea la factura o escribe la venta</div>
      <div style={{fontSize:11,color:"#1a4a50",marginBottom:10}}>Toma foto de la factura y el sistema la lee, o escríbela: "Lentes Nike azul, fotocromático. Se vendió a 200$. Abonó 100 en efectivo. Cliente María Pérez 0414 1234567"</div>
      {done && <div style={{background:"#06231a",border:"1px solid #14503a",borderRadius:10,padding:"10px 14px",fontSize:13,color:"#34d399",marginBottom:10}}>✓ Guardado — la orden quedó registrada en su lugar</div>}
      {!draft ? (
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <input ref={scanRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={scanReceipt}/>
          <button className="btn-p" onClick={()=>scanRef.current?.click()} disabled={scanning}
            style={{justifyContent:"center",background:scanning?"#0a2028":"linear-gradient(135deg,#7a5a0a,#b8860b)",opacity:scanning?.7:1}}>
            {scanning ? "📷 Leyendo factura…" : "📷 Escanear factura"}
          </button>
          <div style={{display:"flex",alignItems:"center",gap:10,margin:"2px 0"}}>
            <div style={{flex:1,height:1,background:"#0d2a30"}}/>
            <span style={{fontSize:10,color:"#1a4a50"}}>o escribe la venta</span>
            <div style={{flex:1,height:1,background:"#0d2a30"}}/>
          </div>
          <textarea value={txt} onChange={e=>setTxt(e.target.value)} rows={3}
            placeholder="Escribe aquí la venta tal como la dirías…"
            style={{background:"#050e10",border:"1px solid #0d2a30",borderRadius:10,padding:"11px 14px",color:"#e2e8f4",fontFamily:"'Outfit',sans-serif",fontSize:14,resize:"vertical",outline:"none",width:"100%"}}/>
          {err&&<div style={{fontSize:12,color:"#f87171"}}>⚠️ {err}</div>}
          <div style={{display:"flex",justifyContent:"flex-end"}}>
            <button className="btn-p" onClick={interpret} style={{background:"linear-gradient(135deg,#0d7a50,#10b981)"}}>➤ Enviar</button>
          </div>
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{fontSize:11,color:"#fbbf24"}}>Revisa lo que entendí — corrige lo que haga falta y guarda:</div>
          <div className="field"><label>Producto</label><input value={draft.product} onChange={e=>sd("product",e.target.value)}/></div>
          <div className="rg2" style={{gap:10}}>
            <div className="field"><label>Cliente</label><input value={draft.customer} onChange={e=>sd("customer",e.target.value)} placeholder="Nombre del cliente"/></div>
            <div className="field"><label>Teléfono</label><PhoneInput value={draft.phone} onChange={v=>sd("phone",v)}/></div>
          </div>
          <div className="rg3" style={{gap:10}}>
            <div className="field"><label>Total (USD)</label><input type="number" min="0" step="0.01" value={draft.total??""} onChange={e=>sd("total",e.target.value)}/></div>
            <div className="field"><label>Abonado (USD)</label><input type="number" min="0" step="0.01" value={draft.abono??""} onChange={e=>sd("abono",e.target.value)}/></div>
            <div className="field"><label>Método del abono</label>
              <select value={draft.method} onChange={e=>sd("method",e.target.value)}>
                {Object.entries(METHOD_INFO).map(([id,m])=><option key={id} value={id}>{m.icon} {m.label} ({m.cur})</option>)}
              </select>
            </div>
          </div>
          <div style={{background:"#050f12",border:"1px solid #0a2028",borderRadius:10,padding:"10px 14px",display:"flex",gap:16,flexWrap:"wrap",fontSize:12}}>
            <span style={{color:"#60a5fa",fontFamily:"'JetBrains Mono',monospace"}}>Orden #{draft.orderNumber}</span>
            {methodCur(draft.method)==="Bs" && Number(draft.abono)>0 && <span style={{color:"#fbbf24",fontFamily:"'JetBrains Mono',monospace"}}>Abono = Bs {(Number(draft.abono)*rate).toLocaleString("es-VE",{maximumFractionDigits:0})}</span>}
            {bal>0
              ? <span style={{color:"#fbbf24"}}>Queda debiendo <strong>{fmtUSD(bal)}</strong> — se registra como apartado pendiente</span>
              : <span style={{color:"#34d399"}}>✓ Pagado completo — quedará listo para entregar</span>}
          </div>
          {err&&<div style={{fontSize:12,color:"#f87171"}}>⚠️ {err}</div>}
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <button className="btn-g" onClick={()=>setDraft(null)}>← Corregir texto</button>
            <button className="btn-p" onClick={save}><ICheck/>Guardar venta</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Apartados: clientes que pagan por partes y retiran al completar ───────────
function ApartadosTab({ orders, saveOrders, rate, profile, isMobile }) {
  const [showNew,  setShowNew]  = useState(false);
  const [payFor,   setPayFor]   = useState(null); // orden a abonar
  const [filter,   setFilter]   = useState("activos"); // activos | pagados | entregados | todos
  const [search,   setSearch]   = useState("");
  const [err,      setErr]      = useState("");

  const nextOrderNum = orders.reduce((m,o)=>Math.max(m, o.orderNumber||0), 0) + 1;
  const [no, setNo] = useState({customer:"", phone:"", product:"", total:"", orderNumber:"", firstAmt:"", firstMethod:"efectivo"});
  const [ab, setAb] = useState({amount:"", method:"efectivo", date:today()});

  const sno = (k,v)=>setNo(p=>({...p,[k]:v}));

  const statusOf = o => o.status==="entregado" ? "entregado" : orderBalance(o)<=0 ? "pagado" : "pendiente";
  const visible = orders
    .filter(o => {
      const st = statusOf(o);
      if (filter==="activos")    return st==="pendiente";
      if (filter==="pagados")    return st==="pagado";
      if (filter==="entregados") return st==="entregado";
      return true;
    })
    .filter(o => !search || o.customer?.toLowerCase().includes(search.toLowerCase()) || String(o.orderNumber).includes(search))
    .sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||""));

  const totalPendiente = orders.filter(o=>o.status!=="entregado").reduce((s,o)=>s+orderBalance(o),0);
  const activos  = orders.filter(o=>statusOf(o)==="pendiente").length;
  const listos   = orders.filter(o=>statusOf(o)==="pagado").length;

  const createOrder = async () => {
    setErr("");
    if (!no.customer.trim()) { setErr("Escribe el nombre del cliente."); return; }
    if (!no.total || isNaN(Number(no.total)) || Number(no.total)<=0) { setErr("Escribe el total de la orden."); return; }
    const num = parseInt(no.orderNumber) || nextOrderNum;
    if (orders.some(o=>o.orderNumber===num)) { setErr(`Ya existe la orden #${num}. Usa otro número.`); return; }
    const first = Number(no.firstAmt)||0;
    if (first > Number(no.total)) { setErr("El abono inicial no puede ser mayor que el total."); return; }
    const o = {
      id: uid(), orderNumber: num,
      customer: no.customer.trim(), phone: no.phone||"",
      product: no.product.trim(), total: Number(no.total),
      payments: first>0 ? [{id:uid(), date:today(), amount:first, method:no.firstMethod,
        amountBs: methodCur(no.firstMethod)==="Bs" ? first*rate : null, rate}] : [],
      status: "pendiente",
      storeId: profile.id, createdAt: new Date().toISOString(), createdDate: today(),
    };
    await saveOrders([...orders, o]);
    setShowNew(false);
    setNo({customer:"", phone:"", product:"", total:"", orderNumber:"", firstAmt:"", firstMethod:"efectivo"});
  };

  const addPayment = async () => {
    setErr("");
    const amt = Number(ab.amount);
    if (!amt || amt<=0) { setErr("Escribe el monto del abono."); return; }
    const bal = orderBalance(payFor);
    if (amt > bal + 0.001) { setErr(`El abono excede lo que falta (${fmtUSD(bal)}). Ajusta el monto.`); return; }
    const p = {id:uid(), date:ab.date, amount:amt, method:ab.method,
      amountBs: methodCur(ab.method)==="Bs" ? amt*rate : null, rate};
    const upd = orders.map(o => o.id===payFor.id ? {...o, payments:[...(o.payments||[]), p]} : o);
    await saveOrders(upd);
    setPayFor(null); setAb({amount:"", method:"efectivo", date:today()});
  };

  const markDelivered = async o => {
    if (orderBalance(o) > 0) return;
    if (!confirm(`¿Entregar la orden #${o.orderNumber} a ${o.customer}?`)) return;
    await saveOrders(orders.map(x => x.id===o.id ? {...x, status:"entregado", deliveredAt:today()} : x));
  };
  const removeOrder = async o => {
    if (!confirm(`¿Eliminar la orden #${o.orderNumber} de ${o.customer}? Se borra su historial de abonos.`)) return;
    await saveOrders(orders.filter(x => x.id!==o.id));
  };

  const stChip = o => {
    const st = statusOf(o);
    if (st==="entregado") return <span className="badge bb">✓ Entregado</span>;
    if (st==="pagado")    return <span className="badge bg">💰 Pagado — listo para entregar</span>;
    return <span className="badge ba">Debe {fmtUSD(orderBalance(o))}</span>;
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
        <div>
          <h1 style={{fontSize:26,fontWeight:800,color:"#fff",letterSpacing:"-.02em"}}>Apartados</h1>
          <div style={{color:"#1a4a50",fontSize:13,marginTop:2}}>Clientes que pagan por partes — se entrega al completar el pago</div>
        </div>
        <button className="btn-p" onClick={()=>{setShowNew(true);setErr("");}}><IPlus/>Nuevo apartado</button>
      </div>

      <QuickEntry orders={orders} saveOrders={saveOrders} rate={rate} profile={profile} nextOrderNum={nextOrderNum}/>

      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:11}}>
        <div className="card-sm" style={{textAlign:"center"}}>
          <div style={{fontSize:10,color:"#2a4060",marginBottom:4}}>POR COBRAR</div>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:16,fontWeight:700,color:"#fbbf24"}}>{fmtUSD(totalPendiente)}</div>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:"#7a6420"}}>{fmtBs(totalPendiente,rate)}</div>
        </div>
        <div className="card-sm" style={{textAlign:"center"}}>
          <div style={{fontSize:10,color:"#2a4060",marginBottom:4}}>APARTADOS ACTIVOS</div>
          <div style={{fontSize:22,fontWeight:700,color:"#60a5fa",fontFamily:"'Outfit',sans-serif"}}>{activos}</div>
        </div>
        <div className="card-sm" style={{textAlign:"center"}}>
          <div style={{fontSize:10,color:"#2a4060",marginBottom:4}}>LISTOS PARA ENTREGAR</div>
          <div style={{fontSize:22,fontWeight:700,color:"#34d399",fontFamily:"'Outfit',sans-serif"}}>{listos}</div>
        </div>
      </div>

      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
        <input placeholder="Buscar cliente o # de orden…" value={search} onChange={e=>setSearch(e.target.value)}
          style={{background:"#0c1220",border:"1px solid #141e30",borderRadius:8,padding:"8px 12px",color:"#e2e8f4",fontFamily:"'Outfit',sans-serif",fontSize:13,width:210}}/>
        {[["activos","Con deuda"],["pagados","Listos"],["entregados","Entregados"],["todos","Todos"]].map(([id,l])=>(
          <button key={id} onClick={()=>setFilter(id)} style={{background:filter===id?"#0f1e35":"transparent",border:`1px solid ${filter===id?"#1e3a60":"#141e30"}`,color:filter===id?"#60a5fa":"#1e3050",borderRadius:20,padding:"4px 12px",fontSize:12,fontFamily:"'Outfit',sans-serif",cursor:"pointer"}}>{l}</button>
        ))}
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {visible.length===0 && <div className="card" style={{textAlign:"center",color:"#1e3050",padding:"30px"}}>Sin apartados en esta vista</div>}
        {visible.map(o=>{
          const paid = orderPaid(o), bal = orderBalance(o), pct = o.total>0 ? Math.min(100, paid/o.total*100) : 0;
          return (
            <div key={o.id} className="card" style={{padding:"16px 18px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,flexWrap:"wrap"}}>
                <div style={{minWidth:200}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"#2dcfe8",background:"#071c22",border:"1px solid #0e3040",borderRadius:6,padding:"2px 8px"}}>#{o.orderNumber}</span>
                    <span style={{fontSize:15,fontWeight:700,color:"#e2e8f4"}}>{o.customer}</span>
                    {stChip(o)}
                  </div>
                  <div style={{fontSize:12,color:"#3a5070",marginTop:4}}>{o.product||"—"}{o.phone?` · 📞 ${o.phone}`:""} · creado {o.createdDate||o.createdAt?.slice(0,10)}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13}}>
                    <span style={{color:"#34d399"}}>{fmtUSD(paid)}</span>
                    <span style={{color:"#1e3050"}}> / </span>
                    <span style={{color:"#60a5fa"}}>{fmtUSD(o.total)}</span>
                  </div>
                  {bal>0 && <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"#fbbf24",marginTop:2}}>faltan {fmtUSD(bal)} · {fmtBs(bal,rate)}</div>}
                </div>
              </div>
              {/* Barra de progreso del pago */}
              <div style={{background:"#050f12",borderRadius:8,height:8,marginTop:10,overflow:"hidden"}}>
                <div style={{width:`${pct}%`,height:"100%",borderRadius:8,background:pct>=100?"linear-gradient(90deg,#0d7a50,#34d399)":"linear-gradient(90deg,#0e5a8c,#60a5fa)",transition:"width .3s"}}/>
              </div>
              {/* Historial de abonos */}
              {(o.payments||[]).length>0 && (
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:9}}>
                  {o.payments.map(p=>(
                    <span key={p.id} style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace",background:"#071418",border:"1px solid #0d2a30",borderRadius:6,padding:"3px 8px",color:"#4a9ab0"}}>
                      {p.date.slice(5)} · {methodLbl(p.method)} · {methodCur(p.method)==="Bs" ? `Bs ${(p.amountBs??p.amount*(p.rate||rate)).toLocaleString("es-VE",{maximumFractionDigits:0})} (${fmtUSD(p.amount)})` : fmtUSD(p.amount)}
                    </span>
                  ))}
                </div>
              )}
              <div style={{display:"flex",gap:7,justifyContent:"flex-end",marginTop:10}}>
                {statusOf(o)==="pendiente" && <button className="btn-p" style={{fontSize:12,padding:"6px 13px"}} onClick={()=>{setPayFor(o);setAb({amount:"",method:"efectivo",date:today()});setErr("");}}>💰 Abonar</button>}
                {statusOf(o)==="pagado" && <button className="btn-p" style={{fontSize:12,padding:"6px 13px",background:"linear-gradient(135deg,#0d7a50,#10b981)"}} onClick={()=>markDelivered(o)}>✓ Marcar entregado</button>}
                <button className="btn-d" style={{padding:"5px 9px"}} onClick={()=>removeOrder(o)}><ITrash/></button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal nuevo apartado */}
      {showNew && (
        <div className="ov" onClick={e=>{if(e.target===e.currentTarget)setShowNew(false);}}>
          <div className="modal" style={{maxWidth:460}}>
            <div style={{fontSize:17,fontWeight:700,color:"#fff",marginBottom:16}}>🧾 Nuevo apartado</div>
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <div className="rg2" style={{gap:10}}>
                <div className="field"><label>Cliente *</label><input autoFocus placeholder="Nombre y apellido" value={no.customer} onChange={e=>sno("customer",e.target.value)}/></div>
                <div className="field"><label># Orden</label><input type="number" placeholder={`${nextOrderNum} (auto)`} value={no.orderNumber} onChange={e=>sno("orderNumber",e.target.value)}/></div>
              </div>
              <div className="field"><label>Teléfono</label><PhoneInput value={no.phone} onChange={v=>sno("phone",v)}/></div>
              <div className="field"><label>Producto / Descripción</label><input placeholder="Ej: Montura Ray-Ban + cristales progresivos" value={no.product} onChange={e=>sno("product",e.target.value)}/></div>
              <div className="rg2" style={{gap:10}}>
                <div className="field"><label>Total (USD) *</label><input type="number" min="0" step="0.01" placeholder="0.00" value={no.total} onChange={e=>sno("total",e.target.value)}/></div>
                <div className="field"><label>Equivale en Bs</label><div style={{padding:"10px 13px",fontFamily:"'JetBrains Mono',monospace",fontSize:13,color:"#fbbf24"}}>{no.total?fmtBs(Number(no.total),rate):"—"}</div></div>
              </div>
              <div style={{background:"#050f12",border:"1px solid #0a2028",borderRadius:10,padding:"12px"}}>
                <div style={{fontSize:11,fontWeight:600,color:"#2dcfe8",marginBottom:8}}>Abono inicial (opcional)</div>
                <div className="rg2" style={{gap:10}}>
                  <div className="field"><label>Monto (USD)</label><input type="number" min="0" step="0.01" placeholder="0.00" value={no.firstAmt} onChange={e=>sno("firstAmt",e.target.value)}/></div>
                  <div className="field"><label>Método</label>
                    <select value={no.firstMethod} onChange={e=>sno("firstMethod",e.target.value)}>
                      {Object.entries(METHOD_INFO).map(([id,m])=><option key={id} value={id}>{m.icon} {m.label} ({m.cur})</option>)}
                    </select>
                  </div>
                </div>
                {no.firstAmt>0 && methodCur(no.firstMethod)==="Bs" && <div style={{fontSize:10,color:"#fbbf24",marginTop:6,fontFamily:"'JetBrains Mono',monospace"}}>Recibirás Bs {(Number(no.firstAmt)*rate).toLocaleString("es-VE",{maximumFractionDigits:0})} (tasa {rate})</div>}
              </div>
              {err&&<div style={{background:"#2a0c0c",border:"1px solid #5a1a1a",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#f87171"}}>⚠️ {err}</div>}
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                <button className="btn-g" onClick={()=>setShowNew(false)}>Cancelar</button>
                <button className="btn-p" onClick={createOrder}><ICheck/>Crear apartado</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal abonar */}
      {payFor && (
        <div className="ov" onClick={e=>{if(e.target===e.currentTarget)setPayFor(null);}}>
          <div className="modal" style={{maxWidth:400}}>
            <div style={{fontSize:17,fontWeight:700,color:"#fff"}}>💰 Abonar — orden #{payFor.orderNumber}</div>
            <div style={{fontSize:12,color:"#3a5070",marginBottom:14}}>{payFor.customer} · faltan <strong style={{color:"#fbbf24"}}>{fmtUSD(orderBalance(payFor))}</strong> ({fmtBs(orderBalance(payFor),rate)})</div>
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <div className="rg2" style={{gap:10}}>
                <div className="field"><label>Monto (USD)</label><input autoFocus type="number" min="0" step="0.01" placeholder="0.00" value={ab.amount} onChange={e=>setAb(p=>({...p,amount:e.target.value}))}/></div>
                <div className="field"><label>Fecha</label><input type="date" value={ab.date} onChange={e=>setAb(p=>({...p,date:e.target.value}))}/></div>
              </div>
              <div className="field"><label>Método de pago</label>
                <select value={ab.method} onChange={e=>setAb(p=>({...p,method:e.target.value}))}>
                  {Object.entries(METHOD_INFO).map(([id,m])=><option key={id} value={id}>{m.icon} {m.label} ({m.cur})</option>)}
                </select>
              </div>
              {ab.amount>0 && methodCur(ab.method)==="Bs" && <div style={{fontSize:11,color:"#fbbf24",fontFamily:"'JetBrains Mono',monospace"}}>= Bs {(Number(ab.amount)*rate).toLocaleString("es-VE",{maximumFractionDigits:0})} a tasa {rate}</div>}
              {Number(ab.amount)>=orderBalance(payFor)-0.001 && Number(ab.amount)>0 && <div style={{fontSize:11,color:"#34d399"}}>✓ Con este abono la orden queda PAGADA — podrás marcarla como entregada</div>}
              {err&&<div style={{background:"#2a0c0c",border:"1px solid #5a1a1a",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#f87171"}}>⚠️ {err}</div>}
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                <button className="btn-g" onClick={()=>setPayFor(null)}>Cancelar</button>
                <button className="btn-p" onClick={addPayment}><ICheck/>Registrar abono</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Cierre de caja mensual: resumen + HTML descargable + registro ────────────
function CierreTab({ sales, expenses, orders, rate, dynProfiles, profile }) {
  const [month, setMonth]   = useState(today().slice(0,7));
  const [saved, setSaved]   = useState(false);

  const monthName = m => {
    const [y,mm] = m.split("-");
    const names = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
    return `${names[parseInt(mm)-1]} ${y}`;
  };

  const mSales    = sales.filter(s => s.date?.slice(0,7) === month);
  const mOrders   = orders.filter(o => (o.createdDate || o.createdAt || "").slice(0,7) === month);
  const abonosMes = orders.flatMap(o => (o.payments||[]).map(p => ({...p, customer:o.customer, orderNumber:o.orderNumber})))
                          .filter(p => p.date?.slice(0,7) === month);

  const ventasDirectas = mSales.reduce((s,v)=>s+v.total,0);
  const facturado  = ventasDirectas + mOrders.reduce((s,o)=>s+(o.total||0),0);
  const cobrado    = ventasDirectas + abonosMes.reduce((s,p)=>s+p.amount,0);
  const unidades   = mSales.reduce((s,v)=>s+v.qty,0);
  const clientes   = new Set([...mSales.map(s=>s.saleId), ...mOrders.map(o=>o.id)]).size;
  const deudores   = orders.filter(o => o.status!=="entregado" && orderBalance(o)>0)
                           .sort((a,b)=>orderBalance(b)-orderBalance(a));
  const porCobrar  = deudores.reduce((s,o)=>s+orderBalance(o),0);

  const flow = moneyIn(sales, orders, month+"-01", month+"-31");

  const mExpenses  = expenses.filter(e => (e.month || e.date?.slice(0,7)) === month);
  const gastosTotal= mExpenses.reduce((s,e)=>s+e.amount,0);
  const byCat = EXPENSE_CATS.map(c => ({
    ...c, items: mExpenses.filter(e=>e.cat===c.id),
    total: mExpenses.filter(e=>e.cat===c.id).reduce((s,e)=>s+e.amount,0),
  })).filter(c=>c.total>0);

  const utilidad  = cobrado - gastosTotal;
  const margen    = cobrado>0 ? (utilidad/cobrado*100) : 0;
  const alCobrar  = utilidad + porCobrar;

  const buildHTML = () => {
    const rows = arr => arr.map(e=>`<div class="row"><span class="row-name">${e.note||e.label||e.cat||"—"}</span><span class="row-amount">$${e.amount.toLocaleString("en-US",{minimumFractionDigits:2})}</span></div>`).join("");
    const deudoresHTML = deudores.map(o=>`<div class="deuda-card"><div class="nombre">${o.customer}</div><div class="orden">Orden #${o.orderNumber}</div><div class="monto">$${orderBalance(o).toLocaleString("en-US")}</div></div>`).join("");
    const metodosHTML = Object.entries(flow.byMethod).map(([m,v])=>{
      const info = METHOD_INFO[m]||{label:m,icon:"💳",cur:"USD"};
      const val = info.cur==="Bs" ? `Bs ${(v.bs||v.usd*rate).toLocaleString("es-VE",{maximumFractionDigits:0})} <small>($${v.usd.toFixed(2)})</small>` : `$${v.usd.toLocaleString("en-US",{minimumFractionDigits:2})}`;
      return `<div class="row"><span class="row-name">${info.icon} ${info.label} (${info.cur})</span><span class="row-amount">${val}</span></div>`;
    }).join("");
    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Cierre de Caja ${monthName(month)} — OptiLatina</title>
<style>
  body{font-family:Georgia,serif;background:#f0ead9;color:#1e3a2f;margin:0;padding:30px 16px}
  .page{max-width:820px;margin:0 auto}
  .header{text-align:center;padding:26px;background:#173325;color:#f0ead9;border-radius:16px;margin-bottom:22px}
  .header h1{margin:0;font-size:30px;letter-spacing:.04em}
  .header .sub{opacity:.75;font-size:14px;margin-top:6px}
  .metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:22px}
  .metric{background:#fff;border-radius:14px;padding:18px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.06)}
  .metric-label{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#6a7a68}
  .metric-value{font-size:26px;font-weight:700;margin-top:6px}
  .metric-sub{font-size:11px;color:#8a9a88;margin-top:3px}
  .section{background:#fff;border-radius:14px;padding:20px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,.06)}
  .section-title{font-size:15px;font-weight:700;border-bottom:2px solid #173325;padding-bottom:8px;margin-bottom:12px;display:flex;justify-content:space-between}
  .row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px dashed #e0d8c4;font-size:14px}
  .row-amount{font-weight:700}
  .gt{background:#173325;color:#f0ead9;border-radius:14px;padding:22px;text-align:center;margin-bottom:16px}
  .gt .amt{font-size:34px;font-weight:700}
  .gt .lbl{font-size:12px;text-transform:uppercase;letter-spacing:.12em;opacity:.8}
  .deuda-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}
  .deuda-card{background:#fdf6e3;border:1px solid #e6d8b8;border-radius:10px;padding:12px;text-align:center}
  .deuda-card .nombre{font-weight:700;font-size:13px}
  .deuda-card .orden{font-size:11px;color:#8a7a58;margin:3px 0}
  .deuda-card .monto{font-size:17px;font-weight:700;color:#a05a1a}
  .footer{text-align:center;font-size:11px;color:#8a9a88;margin-top:24px}
</style></head><body><div class="page">
  <div class="header"><h1>🔒 Cierre de Caja — OptiLatina</h1>
    <div class="sub">📅 ${monthName(month)} &nbsp;·&nbsp; Generado el ${new Date().toLocaleDateString("es-VE",{day:"numeric",month:"long",year:"numeric"})} &nbsp;·&nbsp; ✅ Por ${profile.name}</div></div>
  <div class="metrics">
    <div class="metric"><div class="metric-label">Total facturado</div><div class="metric-value">$${facturado.toLocaleString("en-US",{maximumFractionDigits:0})}</div><div class="metric-sub">${clientes} operaciones · ${unidades} artículos</div></div>
    <div class="metric"><div class="metric-label">Total cobrado</div><div class="metric-value" style="color:#1a7a4a">$${cobrado.toLocaleString("en-US",{maximumFractionDigits:0})}</div><div class="metric-sub">Ventas + abonos recibidos</div></div>
    <div class="metric"><div class="metric-label">Por cobrar</div><div class="metric-value" style="color:#a05a1a">$${porCobrar.toLocaleString("en-US",{maximumFractionDigits:0})}</div><div class="metric-sub">Pendiente clientes</div></div>
  </div>
  <div class="section"><div class="section-title"><span>💱 Dinero recibido por método</span><span>Bs ${flow.totBs.toLocaleString("es-VE",{maximumFractionDigits:0})} + $${flow.totUSD.toFixed(2)} + ${flow.totUSDT.toFixed(2)} USDT</span></div>${metodosHTML||'<div class="row"><span class="row-name">Sin movimientos</span></div>'}</div>
  ${byCat.map(c=>`<div class="section"><div class="section-title"><span>${c.icon} ${c.label}</span><span>$${c.total.toLocaleString("en-US",{minimumFractionDigits:2})}</span></div>${rows(c.items)}</div>`).join("")}
  <div class="gt"><div class="lbl">Utilidad neta — cierre de caja</div><div class="amt">$${utilidad.toLocaleString("en-US",{minimumFractionDigits:2})}</div>
    <div style="font-size:12px;opacity:.75;margin-top:6px">$${cobrado.toLocaleString("en-US",{maximumFractionDigits:0})} cobrado — $${gastosTotal.toLocaleString("en-US",{minimumFractionDigits:2})} gastos · Margen ${margen.toFixed(1)}%</div>
    <div style="font-size:13px;margin-top:10px">🎯 Ganancia total al cobrar todo: <strong>$${alCobrar.toLocaleString("en-US",{minimumFractionDigits:2})}</strong> ($${utilidad.toFixed(2)} actuales + $${porCobrar.toFixed(2)} por cobrar)</div></div>
  ${deudores.length?`<div class="section"><div class="section-title"><span>📋 Clientes con saldo pendiente</span><span>$${porCobrar.toLocaleString("en-US")}</span></div><div class="deuda-grid">${deudoresHTML}</div></div>`:""}
  <div class="footer">OptiLatina · Cierre de ${monthName(month)} · Tasa del día: Bs ${rate} por USD</div>
</div></body></html>`;
  };

  const download = () => {
    const blob = new Blob([buildHTML()], {type:"text/html;charset=utf-8"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cierre-optilatina-${month}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const guardar = async () => {
    await DB.set("cierres", month, {
      month, generatedAt:new Date().toISOString(), by:profile.name,
      facturado, cobrado, porCobrar, gastosTotal, utilidad, margen, alCobrar, unidades, clientes,
      flow: {totBs:flow.totBs, totUSD:flow.totUSD, totUSDT:flow.totUSDT},
      deudores: deudores.map(o=>({customer:o.customer, orderNumber:o.orderNumber, balance:orderBalance(o)})),
    });
    setSaved(true); setTimeout(()=>setSaved(false), 3000);
  };

  const Metric = ({label, value, sub, color="#2dcfe8"}) => (
    <div className="card-sm" style={{textAlign:"center"}}>
      <div style={{fontSize:10,color:"#2a4060",marginBottom:4,textTransform:"uppercase",letterSpacing:".08em"}}>{label}</div>
      <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:18,fontWeight:700,color}}>{value}</div>
      {sub&&<div style={{fontSize:10,color:"#1a4a50",marginTop:3}}>{sub}</div>}
    </div>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:10}}>
        <div>
          <h1 style={{fontSize:26,fontWeight:800,color:"#fff",letterSpacing:"-.02em"}}>Cierre de caja</h1>
          <div style={{color:"#1a4a50",fontSize:13,marginTop:2}}>Resumen mensual — descárgalo como registro</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"flex-end",flexWrap:"wrap"}}>
          <div className="field"><label>Mes</label><input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></div>
          <button className="btn-g" onClick={guardar}>{saved?"✓ Guardado":"💾 Guardar registro"}</button>
          <button className="btn-p" onClick={download}>⬇️ Descargar cierre (HTML)</button>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:11}}>
        <Metric label="Total facturado" value={fmtUSD(facturado)} sub={`${clientes} operaciones · ${unidades} artículos`} color="#60a5fa"/>
        <Metric label="Total cobrado" value={fmtUSD(cobrado)} sub="Ventas + abonos recibidos" color="#34d399"/>
        <Metric label="Por cobrar" value={fmtUSD(porCobrar)} sub={`${deudores.length} clientes pendientes`} color="#fbbf24"/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:11}}>
        <Metric label="Entró en Bs" value={`Bs ${flow.totBs.toLocaleString("es-VE",{maximumFractionDigits:0})}`} sub="Pago Móvil + Transferencia" color="#fbbf24"/>
        <Metric label="Entró en USD" value={fmtUSD(flow.totUSD)} sub="Efectivo + Zelle" color="#34d399"/>
        <Metric label="Entró en USDT" value={`${flow.totUSDT.toFixed(2)}`} sub="Cripto" color="#a78bfa"/>
      </div>

      <div className="card">
        <div style={{fontSize:13,fontWeight:700,color:"#f87171",marginBottom:10}}>🏢 Gastos del mes — {fmtUSD(gastosTotal)}</div>
        {byCat.length===0 ? <div style={{color:"#1e3050",fontSize:12}}>Sin gastos registrados este mes</div>
          : byCat.map(c=>(
            <div key={c.id} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:"1px solid #081820",fontSize:13}}>
              <span style={{color:"#b0c0d8"}}>{c.icon} {c.label} <span style={{color:"#1e3050",fontSize:11}}>({c.items.length})</span></span>
              <span style={{fontFamily:"'JetBrains Mono',monospace",color:"#f87171"}}>{fmtUSD(c.total)}</span>
            </div>
          ))}
      </div>

      <div className="card" style={{background:"#06231a",borderColor:"#14503a",textAlign:"center"}}>
        <div style={{fontSize:11,color:"#3a9a70",textTransform:"uppercase",letterSpacing:".1em"}}>Utilidad neta del mes</div>
        <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:30,fontWeight:700,color:utilidad>=0?"#34d399":"#f87171",marginTop:6}}>{fmtUSD(utilidad)}</div>
        <div style={{fontSize:11,color:"#2a7a55",marginTop:4}}>{fmtUSD(cobrado)} cobrado − {fmtUSD(gastosTotal)} gastos · Margen {margen.toFixed(1)}%</div>
        <div style={{fontSize:13,color:"#e2e8f4",marginTop:12}}>🎯 Ganancia total al cobrar todo: <strong style={{color:"#34d399",fontFamily:"'JetBrains Mono',monospace"}}>{fmtUSD(alCobrar)}</strong></div>
      </div>

      {deudores.length>0 && (
        <div className="card">
          <div style={{fontSize:13,fontWeight:700,color:"#fbbf24",marginBottom:12}}>📋 Clientes con saldo pendiente — {fmtUSD(porCobrar)}</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(170px,1fr))",gap:10}}>
            {deudores.map(o=>(
              <div key={o.id} style={{background:"#050f12",border:"1px solid #2a2010",borderRadius:10,padding:"11px",textAlign:"center"}}>
                <div style={{fontSize:13,fontWeight:700,color:"#e2e8f4"}}>{o.customer}</div>
                <div style={{fontSize:10,color:"#5a4a18",margin:"3px 0"}}>Orden #{o.orderNumber}</div>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:15,fontWeight:700,color:"#fbbf24"}}>{fmtUSD(orderBalance(o))}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GestionTab({ profilesData, savePD, payments, savePayments, dynProfiles, saveDynProfiles, setViewAs, switchTo, recovery = [] }) {
  const [pay, setPay] = useState(payments || DEFAULT_PAYMENTS);
  const [savingPay, setSavingPay] = useState(false);
  const [editProf, setEditProf] = useState(null);
  const [pf, setPf] = useState({});
  const [showNewStore, setShowNewStore] = useState(false);
  const [showNewAdmin, setShowNewAdmin] = useState(false);
  const [newStore, setNewStore] = useState({name:"OptiLatina",address:"",pin:"0000",color:"#8b5cf6",description:"",phone:""});
  const [newAdmin, setNewAdmin] = useState({name:"",pin:"0000",color:"#3b82f6",description:""});

  const sp = (s,k,v) => setPay(p=>({...p,[s]:{...p[s],[k]:v}}));
  const sn = (k,v) => setNewStore(p=>({...p,[k]:v}));
  const na = (k,v) => setNewAdmin(p=>({...p,[k]:v}));

  const handleSavePay = async () => { setSavingPay(true); await savePayments(pay); setSavingPay(false); };

  const openEditProf = p => { setPf({...p}); setEditProf(p.id); };
  const saveProf = async () => {
    await saveDynProfiles(dynProfiles.map(p=>p.id===editProf?pf:p));
    setEditProf(null);
  };
  const deleteProf = async id => {
    if (!confirm("¿Eliminar este perfil?")) return;
    await saveDynProfiles(dynProfiles.filter(p=>p.id!==id));
  };
  const addStore = async () => {
    if (!newStore.address) return;
    const st = {...newStore, id:"store_"+uid(), role:"store", storeName:newStore.name, email:"", photo:null};
    await saveDynProfiles([...dynProfiles, st]);
    setShowNewStore(false);
    setNewStore({name:"OptiLatina",address:"",pin:"0000",color:"#8b5cf6",description:"",phone:""});
  };
  const addAdmin = async () => {
    if (!newAdmin.name || newAdmin.pin.length !== 4) return;
    const ad = {...newAdmin, id:"admin_"+uid(), role:"admin", storeName:null, address:null, email:"", phone:"", photo:null};
    await saveDynProfiles([...dynProfiles, ad]);
    setShowNewAdmin(false);
    setNewAdmin({name:"",pin:"0000",color:"#3b82f6",description:""});
  };

  // ── Invitacion: genera contraseña temporal y prepara mensaje para compartir ──
  const [invite, setInvite] = useState(null); // {id,name,phone,email,pw}
  const [inviteCopied, setInviteCopied] = useState(false);
  const genTempPw = () => {
    const chars = "abcdefghjkmnpqrstuvwxyz23456789"; // sin caracteres confusos (0/O, 1/l)
    return Array.from({length:8},()=>chars[Math.floor(Math.random()*chars.length)]).join("");
  };
  const openInvite = async p => {
    const pw = genTempPw();
    await saveDynProfiles(dynProfiles.map(x => x.id===p.id ? {...x, password:pw} : x));
    setInvite({id:p.id, name:p.name, phone:p.phone, email:p.email, pw});
    setInviteCopied(false);
  };
  const inviteMsg = invite ? (
`Hola ${invite.name}! 👓 Te invito a la plataforma de OptiLatina.

Entra aquí: ${location.origin}
Usuario: ${invite.name}${invite.email?` (o tu correo ${invite.email})`:""}
Contraseña: ${invite.pw}

Marca "Recordar mi sesión" para no volver a escribirla.
Puedes cambiar tu contraseña cuando quieras en "Mi perfil".`) : "";
  const copyInvite = async () => {
    try { await navigator.clipboard.writeText(inviteMsg); setInviteCopied(true); setTimeout(()=>setInviteCopied(false),2500); } catch {}
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:22}}>
      <div>
        <h1 style={{fontSize:26,fontWeight:800,color:"#fff",letterSpacing:"-.02em"}}>Gestión</h1>
        <div style={{color:"#1a4a50",fontSize:13,marginTop:2}}>Perfiles, tiendas y métodos de cobro</div>
      </div>

      {/* Solicitudes de recuperación de acceso */}
      {recovery.length>0 && (
        <div className="card" style={{borderColor:"#6a4a10"}}>
          <div style={{fontSize:13,fontWeight:700,color:"#fbbf24",marginBottom:12}}>🔔 Solicitudes de recuperación de acceso</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {recovery.map(r=>{
              const match = dynProfiles.find(p =>
                p.email?.trim().toLowerCase() === r.user ||
                p.name?.trim().toLowerCase() === r.user
              );
              return (
                <div key={r.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap",background:"#050f12",borderRadius:12,padding:"12px 15px",border:"1px solid #2a2010"}}>
                  <div>
                    <div style={{fontSize:13,color:"#e2e8f4",fontFamily:"'JetBrains Mono',monospace"}}>{r.user}</div>
                    <div style={{fontSize:11,color:"#5a4a18",marginTop:2}}>
                      {r.date} · {match ? <>perfil: <strong style={{color:"#e8c96a"}}>{match.name}</strong></> : "no coincide con ningún perfil"}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:7}}>
                    {match && <button className="btn-p" style={{fontSize:12,padding:"6px 13px"}} onClick={async()=>{await openInvite(match); await DB.delete("recovery", r.id);}}>🔑 Restablecer e invitar</button>}
                    <button className="btn-g" style={{fontSize:12,padding:"6px 11px"}} onClick={()=>DB.delete("recovery", r.id)}>Descartar</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Perfiles */}
      <div className="card">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontSize:13,fontWeight:700,color:"#2dcfe8"}}>👥 Perfiles y tiendas</div>
          <div style={{display:"flex",gap:8}}>
            <button className="btn-p" style={{fontSize:12,padding:"7px 13px"}} onClick={()=>setShowNewStore(true)}><IPlus/>Nueva tienda</button>
            <button className="btn-p" style={{fontSize:12,padding:"7px 13px",background:"linear-gradient(135deg,#1d4ed8,#2563eb)"}} onClick={()=>setShowNewAdmin(true)}><IPlus/>Nuevo admin</button>
          </div>
        </div>

        {showNewAdmin && (
          <div style={{background:"#050f12",border:"1px solid #0a2028",borderRadius:12,padding:"16px",marginBottom:16,display:"flex",flexDirection:"column",gap:12}}>
            <div style={{fontSize:12,fontWeight:600,color:"#2dcfe8",marginBottom:4}}>👤 Nuevo perfil administrador</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
              <div className="field"><label>Nombre</label><input placeholder="Ej: Luis, Mariela…" value={newAdmin.name} onChange={e=>na("name",e.target.value)}/></div>
              <div className="field"><label>PIN (4 dígitos)</label><input type="password" maxLength={4} placeholder="••••" value={newAdmin.pin} onChange={e=>na("pin",e.target.value.replace(/\D/g,""))}/></div>
              <div className="field"><label>Color</label><input type="color" value={newAdmin.color} onChange={e=>na("color",e.target.value)} style={{height:40,padding:"2px 4px",cursor:"pointer"}}/></div>
              <div className="field" style={{gridColumn:"1/-1"}}><label>Descripción / Cargo</label><input placeholder="Ej: Encargado, Socio…" value={newAdmin.description} onChange={e=>na("description",e.target.value)}/></div>
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button className="btn-g" onClick={()=>setShowNewAdmin(false)}>Cancelar</button>
              <button className="btn-p" onClick={addAdmin}><ICheck/>Crear perfil admin</button>
            </div>
          </div>
        )}

        {showNewStore && (
          <div style={{background:"#050f12",border:"1px solid #0a2028",borderRadius:12,padding:"16px",marginBottom:16,display:"flex",flexDirection:"column",gap:12}}>
            <div style={{fontSize:12,fontWeight:600,color:"#fbbf24",marginBottom:4}}>🏪 Nueva tienda OptiLatina</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
              <div className="field"><label>Dirección / Nombre distintico</label><input placeholder="Ej: Centro, Nivel 3" value={newStore.address} onChange={e=>sn("address",e.target.value)}/></div>
              <div className="field"><label>PIN de acceso (4 dígitos)</label><input type="password" maxLength={4} placeholder="0000" value={newStore.pin} onChange={e=>sn("pin",e.target.value)}/></div>
              <div className="field"><label>Color identificador</label><input type="color" value={newStore.color} onChange={e=>sn("color",e.target.value)} style={{height:40,padding:"2px 4px",cursor:"pointer"}}/></div>
              <div className="field" style={{gridColumn:"1/-1"}}><label>Teléfono / Descripción</label><input placeholder="Descripción opcional" value={newStore.description} onChange={e=>sn("description",e.target.value)}/></div>
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button className="btn-g" onClick={()=>setShowNewStore(false)}>Cancelar</button>
              <button className="btn-p" onClick={addStore}><ICheck/>Crear tienda</button>
            </div>
          </div>
        )}

        {invite && (
          <div className="ov" onClick={e=>{if(e.target===e.currentTarget)setInvite(null);}}>
            <div className="modal" style={{maxWidth:420}}>
              <div style={{textAlign:"center",marginBottom:14}}>
                <div style={{fontSize:36}}>✉️</div>
                <div style={{fontSize:17,fontWeight:700,color:"#fff",marginTop:6}}>Invitación para {invite.name}</div>
                <div style={{fontSize:12,color:"#7a94a8",marginTop:4}}>Se creó una contraseña nueva para su acceso. Compártele este mensaje:</div>
              </div>
              <div style={{background:"#050f12",border:"1px solid #0a2028",borderRadius:10,padding:"12px 14px",fontSize:12,color:"#b0c0d8",whiteSpace:"pre-wrap",lineHeight:1.6,marginBottom:8}}>{inviteMsg}</div>
              <div style={{textAlign:"center",marginBottom:14}}>
                <span style={{fontSize:11,color:"#1a4a50"}}>Contraseña temporal: </span>
                <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:16,fontWeight:700,color:"#34d399",letterSpacing:".08em"}}>{invite.pw}</span>
              </div>
              <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
                <a href={phoneDigits(invite.phone) ? `https://wa.me/${phoneDigits(invite.phone)}?text=${encodeURIComponent(inviteMsg)}` : `https://api.whatsapp.com/send?text=${encodeURIComponent(inviteMsg)}`}
                  target="_blank" rel="noreferrer" className="btn-p" style={{textDecoration:"none",fontSize:13}}>📱 Enviar por WhatsApp</a>
                {invite.email&&<a href={`mailto:${invite.email}?subject=${encodeURIComponent("Invitación a OptiLatina")}&body=${encodeURIComponent(inviteMsg)}`}
                  className="btn-g" style={{textDecoration:"none",fontSize:13,display:"inline-flex",alignItems:"center"}}>✉️ Correo</a>}
                <button className="btn-g" style={{fontSize:13}} onClick={copyInvite}>{inviteCopied?"✓ Copiado":"📋 Copiar"}</button>
              </div>
              <div style={{fontSize:10,color:"#1a4a50",textAlign:"center",marginTop:12}}>Si vuelves a tocar "Invitar" se genera una contraseña nueva (sirve también para restablecer el acceso).</div>
              <div style={{display:"flex",justifyContent:"center",marginTop:12}}>
                <button className="btn-g" onClick={()=>setInvite(null)}>Cerrar</button>
              </div>
            </div>
          </div>
        )}

        {editProf && (
          <div className="ov" onClick={e=>{if(e.target===e.currentTarget)setEditProf(null);}}>
            <div className="modal" style={{maxWidth:400}}>
              <div style={{fontSize:17,fontWeight:700,color:"#fff",marginBottom:18,display:"flex",justifyContent:"space-between"}}>
                Editar perfil <button style={{background:"transparent",border:"none",color:"#2a4060",cursor:"pointer"}} onClick={()=>setEditProf(null)}><IClose/></button>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                <div className="field"><label>Nombre</label><input value={pf.name||""} onChange={e=>setPf(p=>({...p,name:e.target.value}))}/></div>
                <div className="field"><label>Descripción</label><input value={pf.description||""} onChange={e=>setPf(p=>({...p,description:e.target.value}))}/></div>
                <div className="field"><label>Teléfono</label><PhoneInput value={pf.phone||""} onChange={v=>setPf(p=>({...p,phone:v}))}/></div>
                <div className="field"><label>Email</label><input type="email" value={pf.email||""} onChange={e=>setPf(p=>({...p,email:e.target.value}))} placeholder="correo@ejemplo.com"/></div>
                {pf.role==="store"&&<div className="field"><label>Nombre de la tienda (marca)</label><input value={pf.storeName||""} onChange={e=>setPf(p=>({...p,storeName:e.target.value}))} placeholder="OptiLatina"/></div>}
                {pf.role==="store"&&<div className="field"><label>Dirección</label><input value={pf.address||""} onChange={e=>setPf(p=>({...p,address:e.target.value}))}/></div>}
                <div className="field"><label>PIN (4 dígitos)</label><input type="password" maxLength={4} value={pf.pin||""} onChange={e=>setPf(p=>({...p,pin:e.target.value}))}/></div>
                <div className="field"><label>Contraseña de acceso {pf.password?"(activa)":"(sin definir — usa PIN)"}</label>
                  <div style={{display:"flex",gap:6}}>
                    <input style={{flex:1,minWidth:0}} value={pf.password||""} onChange={e=>setPf(p=>({...p,password:e.target.value}))} placeholder="Vacío = entra con PIN"/>
                    {pf.password&&<button className="btn-d" style={{padding:"5px 10px",fontSize:11}} title="Quitar contraseña (vuelve al PIN)" onClick={()=>setPf(p=>({...p,password:""}))}>✕</button>}
                  </div>
                  <div style={{fontSize:10,color:"#1a4a50",marginTop:3}}>Si el usuario olvidó su acceso, escribe aquí una contraseña nueva y compártesela.</div>
                </div>
                <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                  <button className="btn-g" onClick={()=>setEditProf(null)}>Cancelar</button>
                  <button className="btn-p" onClick={saveProf}><ICheck/>Guardar</button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {dynProfiles.map(p=>(
            <div key={p.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#050f12",borderRadius:12,padding:"13px 16px",border:"1px solid #0a2028"}}>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                {p.photo ? <img src={p.photo} style={{width:40,height:40,borderRadius:p.role==="store"?9:"50%",objectFit:"cover",border:`2px solid ${p.color}30`}}/>
                  : <div style={{width:40,height:40,borderRadius:p.role==="store"?9:"50%",overflow:p.role==="store"?"hidden":"visible",background:`${p.color}15`,border:`2px solid ${p.color}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>{p.role==="store"?<Logo2 s={40}/>:p.name.slice(0,2)}</div>}
                <div>
                  <div style={{fontSize:14,fontWeight:600,color:"#e2e8f4"}}>{p.name} {p.address&&<span style={{color:p.color,fontWeight:400}}>— {p.address}</span>}</div>
                  <div style={{fontSize:11,color:"#1a4a50",marginTop:2}}>{p.role==="store"?"Tienda":"Admin"} · {p.email||p.phone||"Sin datos de contacto"}</div>
                </div>
              </div>
              <div style={{display:"flex",gap:7}}>
                {p.id!=="owner"&&<button className="btn-g" style={{padding:"5px 11px",fontSize:12,color:"#e8c96a",borderColor:"#4a3a10",display:"flex",alignItems:"center",gap:5}} title="Ver la app como este perfil (con barra para volver)" onClick={()=>setViewAs?.(p.id)}><IEye/> Ver</button>}
                {p.id!=="owner"&&<button className="btn-g" style={{padding:"5px 11px",fontSize:12,color:"#60a5fa",borderColor:"#1e3a60"}} title="Entrar de lleno a este perfil (para volver: Cambiar perfil o recargar)" onClick={()=>switchTo?.(p.id)}>→ Entrar</button>}
                {p.id!=="owner"&&<button className="btn-g" style={{padding:"5px 11px",fontSize:12,color:"#34d399",borderColor:"#14402a"}} title="Enviar invitación con contraseña nueva" onClick={()=>openInvite(p)}>✉️ Invitar</button>}
                <button className="btn-g" style={{padding:"5px 9px",fontSize:12}} onClick={()=>openEditProf(p)}><IEdit/></button>
                {p.id!=="owner"&&<button className="btn-d" style={{padding:"5px 9px",fontSize:12}} onClick={()=>deleteProf(p.id)}><ITrash/></button>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Métodos de pago */}
      <div className="card">
        <div style={{fontSize:13,fontWeight:700,color:"#2dcfe8",marginBottom:16}}>💳 Métodos de cobro</div>
        <div style={{display:"flex",flexDirection:"column",gap:18}}>
          <div>
            <div style={{fontSize:12,fontWeight:600,color:"#fbbf24",marginBottom:8}}>🔐 USDT</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div className="field"><label>Dirección wallet</label><input placeholder="TXxxxxxxxxxxxxxxxxxxxxxx" value={pay.usdt?.address||""} onChange={e=>sp("usdt","address",e.target.value)}/></div>
              <div className="field"><label>Red</label><select value={pay.usdt?.network||"TRC20"} onChange={e=>sp("usdt","network",e.target.value)}><option>TRC20</option><option>ERC20</option><option>BEP20</option></select></div>
            </div>
          </div>
          <div>
            <div style={{fontSize:12,fontWeight:600,color:"#a78bfa",marginBottom:8}}>💳 Zelle</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
              <div className="field"><label>Nombre</label><input value={pay.zelle?.name||""} onChange={e=>sp("zelle","name",e.target.value)}/></div>
              <div className="field"><label>Correo</label><input value={pay.zelle?.email||""} onChange={e=>sp("zelle","email",e.target.value)}/></div>
              <div className="field"><label>Teléfono</label><input value={pay.zelle?.phone||""} onChange={e=>sp("zelle","phone",e.target.value)}/></div>
            </div>
          </div>
          <div>
            <div style={{fontSize:12,fontWeight:600,color:"#fbbf24",marginBottom:8}}>🏦 Banco / Pago Móvil</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10}}>
              <div className="field"><label>Banco</label><input value={pay.bank?.bank||""} onChange={e=>sp("bank","bank",e.target.value)}/></div>
              <div className="field"><label>Titular</label><input value={pay.bank?.name||""} onChange={e=>sp("bank","name",e.target.value)}/></div>
              <div className="field"><label>Teléfono</label><input value={pay.bank?.phone||""} onChange={e=>sp("bank","phone",e.target.value)}/></div>
              <div className="field"><label>N° cuenta</label><input value={pay.bank?.account||""} onChange={e=>sp("bank","account",e.target.value)}/></div>
            </div>
          </div>
          <div style={{display:"flex",justifyContent:"flex-end"}}>
            <button className="btn-p" style={{minWidth:160}} onClick={handleSavePay} disabled={savingPay}><ICheck/>{savingPay?"Guardando...":"Guardar métodos"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── History Tab ───────────────────────────────────────────────────────────────
function HistTab({byDate,sortedDates,setDD}) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <h1 style={{fontSize:26,fontWeight:800,color:"#fff",letterSpacing:"-.02em"}}>Historial</h1>
      {sortedDates.length===0 ? <div className="card" style={{textAlign:"center",color:"#141e2e",padding:"60px 0"}}>Sin ventas registradas</div>
        : sortedDates.map(date=>{
            const ds=byDate[date],rev=ds.reduce((s,v)=>s+v.total,0),prof=ds.reduce((s,v)=>s+v.profit,0),items=ds.reduce((s,v)=>s+v.qty,0);
            return (
              <div key={date} className="card" style={{cursor:"pointer"}} onClick={()=>setDD(date)}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{fontSize:15,fontWeight:600,color:"#b0c0d8"}}>{new Date(date+"T12:00").toLocaleDateString("es-MX",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div>
                    <div style={{fontSize:12,color:"#1e3050",marginTop:2}}>{items} artículo(s)</div>
                  </div>
                  <div style={{display:"flex",gap:22,alignItems:"center"}}>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:10,color:"#1e3050"}}>INGRESOS</div>
                      <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:16,color:"#60a5fa"}}>{fmt(rev)}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:10,color:"#1e3050"}}>GANANCIA</div>
                      <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:16,color:"#34d399"}}>{fmt(prof)}</div>
                    </div>
                    <span style={{color:"#1e3050",fontSize:20}}>›</span>
                  </div>
                </div>
              </div>
            );
          })
      }
    </div>
  );
}

// ── Modals ────────────────────────────────────────────────────────────────────
function InvModal({item,inventory,saveInv,onClose,rate}) {
  const photoRef   = useRef(null);
  const [mode, setMode] = useState("normal");
  // Serials existentes como estado local: quitar uno no cierra el modal
  const [existingSerials, setExistingSerials] = useState(item?.serials || []);
  const [f,setF]=useState({
    name:item?.name??"", cat:item?.cat??CATS[0],
    cost:item?.cost??"", price:item?.price??"",
    isService:item?.isService??(item?.stock===999)??false,
    newSerials:"", qty:"", minStock:item?.minStock??3,
    photo:item?.photo??null, description:item?.description??"",
  });
  const [fastItems, setFastItems] = useState([{id:uid(),name:"",cat:CATS[0],cost:"",price:"",serials:"",qty:"",photo:null}]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const sf=(k,v)=>setF(p=>({...p,[k]:v}));
  const sfi=(id,k,v)=>setFastItems(its=>its.map(it=>it.id===id?{...it,[k]:v}:it));

  const parsedNew  = f.newSerials.split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean);
  const qtyNew     = Math.max(0, parseInt(f.qty) || 0);
  const allSerials = [...existingSerials,...parsedNew];

  // Serials de OTROS productos, para detectar codigos repetidos
  const otherSerials = new Set(
    inventory.filter(p => p.id !== item?.id).flatMap(p => p.serials || [])
  );
  const dupInOthers = parsedNew.filter(s => otherSerials.has(s));
  const dupInSelf   = parsedNew.filter((s,i) => existingSerials.includes(s) || parsedNew.indexOf(s) !== i);
  const nameExists  = !item && f.name.trim() !== "" &&
    inventory.some(p => p.name.trim().toLowerCase() === f.name.trim().toLowerCase());

  const handlePhoto = (e,target="main") => {
    const file=e.target.files?.[0]; if(!file) return;
    compressImage(file).then(data => {
      if(target==="main") sf("photo",data); else sfi(target,"photo",data);
    }).catch(()=>{});
  };

  const removeSer = ser => setExistingSerials(prev => prev.filter(x => x !== ser));
  const removeAutoOne = () => {
    setExistingSerials(prev => {
      const idx = prev.findIndex(isAutoCode);
      return idx === -1 ? prev : [...prev.slice(0,idx), ...prev.slice(idx+1)];
    });
  };

  const save2 = async () => {
    setErr("");
    if (!f.name.trim())  { setErr("Escribe el nombre del producto."); return; }
    if (f.price === "" || isNaN(Number(f.price))) { setErr("Escribe el precio de venta."); return; }
    if (Number(f.price) < 0 || (f.cost !== "" && Number(f.cost) < 0)) { setErr("El precio y el costo no pueden ser negativos."); return; }
    if (dupInSelf.length)   { setErr(`Código repetido: ${dupInSelf.join(", ")}`); return; }
    if (dupInOthers.length) { setErr(`Estos códigos ya existen en otro producto: ${dupInOthers.join(", ")}`); return; }
    setSaving(true);
    const it={...(item||{}), id:item?.id??uid(),name:f.name.trim(),cat:f.cat,cost:Number(f.cost)||0,price:Number(f.price),
      isService:f.isService,serials:f.isService?[]:[...allSerials,...genAutoCodes(qtyNew)],photo:f.photo,description:f.description,
      minStock:Math.max(0, parseInt(f.minStock) || 3)};
    await saveInv(item?inventory.map(p=>p.id===item.id?it:p):[...inventory,it]);
    setSaving(false); onClose();
  };

  const saveFast = async () => {
    setErr("");
    const rows = fastItems.filter(it => it.name.trim() || it.price !== "" || it.serials.trim() || it.qty !== "");
    if (!rows.length) { setErr("Agrega al menos un producto."); return; }
    const incomplete = rows.filter(it => !it.name.trim() || it.price === "" || isNaN(Number(it.price)));
    if (incomplete.length) { setErr(`Hay ${incomplete.length} producto(s) sin nombre o sin precio — complétalos o bórralos.`); return; }
    const seen = new Set(otherSerials);
    for (const it of rows) {
      for (const s of it.serials.split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean)) {
        if (seen.has(s)) { setErr(`El código "${s}" está repetido.`); return; }
        seen.add(s);
      }
    }
    setSaving(true);
    const newItems=rows.map(it=>({id:uid(),name:it.name.trim(),cat:it.cat,cost:Number(it.cost)||0,price:Number(it.price),
      isService:false,
      serials:[...it.serials.split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean), ...genAutoCodes(Math.max(0, parseInt(it.qty) || 0))],
      photo:it.photo,description:""}));
    await saveInv([...inventory,...newItems]);
    setSaving(false); onClose();
  };

  const g=Number(f.price)-Number(f.cost);
  const realSerials = existingSerials.filter(s => !isAutoCode(s));
  const autoCount   = existingSerials.length - realSerials.length;

  return (
    <div className="ov" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="modal" style={{maxWidth:600}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={{fontSize:17,fontWeight:700,color:"#fff"}}>{item?"Editar producto":"Agregar inventario"}</div>
          <button style={{background:"transparent",border:"none",color:"#2a4060",cursor:"pointer",fontSize:22}} onClick={onClose}>×</button>
        </div>

        {!item && (
          <div style={{display:"flex",gap:6,marginBottom:14}}>
            {[["normal","📦 Un producto"],["fast","⚡ Carga rápida (varios)"]].map(([m,l])=>(
              <button key={m} onClick={()=>setMode(m)}
                style={{flex:1,background:mode===m?"#0c2e35":"#071418",border:`1px solid ${mode===m?"#0e7a8c":"#0a2028"}`,borderRadius:9,padding:"8px",fontSize:12,color:mode===m?"#2dcfe8":"#2a4060",cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontWeight:mode===m?600:400}}>
                {l}
              </button>
            ))}
          </div>
        )}

        {(mode==="normal"||item) && (<>
          <div style={{display:"flex",gap:14,marginBottom:14}}>
            <div style={{flexShrink:0}}>
              <div onClick={()=>photoRef.current?.click()}
                style={{width:90,height:90,borderRadius:12,background:"#050f12",border:`2px dashed ${f.photo?"#0e7a8c":"#0a2028"}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",position:"relative"}}>
                {f.photo?<img src={f.photo} style={{width:"100%",height:"100%",objectFit:"cover"}} alt=""/>
                  :<div style={{textAlign:"center"}}><div style={{fontSize:28}}>📷</div><div style={{fontSize:9,color:"#1a4a50",marginTop:2}}>Foto del producto</div></div>}
                {f.photo&&<button onClick={e=>{e.stopPropagation();sf("photo",null);}} style={{position:"absolute",top:3,right:3,width:18,height:18,borderRadius:"50%",background:"#2a0c0c",border:"none",color:"#f87171",fontSize:10,cursor:"pointer"}}>✕</button>}
              </div>
              <input ref={photoRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>handlePhoto(e,"main")}/>
              <div style={{fontSize:9,color:"#1a4a50",textAlign:"center",marginTop:3}}>📷 Toca para foto</div>
            </div>
            <div style={{flex:1,display:"flex",flexDirection:"column",gap:9}}>
              <div className="field"><label>Nombre del producto</label>
                <input placeholder="Ej: Ray-Ban RB3025 Azul" value={f.name} onChange={e=>sf("name",e.target.value)} autoFocus/>
                {nameExists&&<div style={{fontSize:10,color:"#fbbf24",marginTop:3}}>⚠️ Ya existe un producto con este nombre — si es el mismo, mejor edítalo desde la lista</div>}
              </div>
              <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
                <div className="field" style={{flex:1}}><label>Categoría</label>
                  <select value={f.cat} onChange={e=>sf("cat",e.target.value)}>{CATS.map(c=><option key={c}>{c}</option>)}</select>
                </div>
                <label style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"#2a4060",marginBottom:3,cursor:"pointer",whiteSpace:"nowrap"}}>
                  <input type="checkbox" checked={f.isService} onChange={e=>sf("isService",e.target.checked)}/> Servicio
                </label>
              </div>
            </div>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
            <div className="field"><label>💰 Costo (USD)</label>
              <input type="number" min="0" step="0.01" placeholder="0.00" value={f.cost} onChange={e=>sf("cost",e.target.value)}/>
            </div>
            <div className="field"><label>🏷 Precio venta (USD)</label>
              <input type="number" min="0" step="0.01" placeholder="0.00" value={f.price} onChange={e=>sf("price",e.target.value)}/>
            </div>
          </div>

          {f.cost!==""&&f.price!==""&&(
            <div style={{background:"#040d10",border:"1px solid #0a2028",borderRadius:10,padding:"9px 14px",display:"flex",gap:14,flexWrap:"wrap",marginBottom:12}}>
              <div><div style={{fontSize:9,color:"#1e3050"}}>BS</div><div style={{fontFamily:"'JetBrains Mono',monospace",color:"#fbbf24",fontSize:12}}>{fmtBs(Number(f.price),rate)}</div></div>
              <div><div style={{fontSize:9,color:"#1e3050"}}>GANANCIA</div><div style={{fontFamily:"'JetBrains Mono',monospace",color:"#34d399",fontSize:12}}>{fmtUSD(g)}</div></div>
              <div><div style={{fontSize:9,color:"#1e3050"}}>MARGEN</div><div style={{fontFamily:"'JetBrains Mono',monospace",color:"#a78bfa",fontSize:12}}>{f.price>0?(((f.price-f.cost)/f.price)*100).toFixed(1):0}%</div></div>
              {!f.isService&&allSerials.length>0&&<div><div style={{fontSize:9,color:"#1e3050"}}>INV. TOTAL</div><div style={{fontFamily:"'JetBrains Mono',monospace",color:"#2dcfe8",fontSize:12}}>{fmtUSD(f.cost*allSerials.length)}</div></div>}
            </div>
          )}

          <div className="field" style={{marginBottom:12}}>
            <label>Descripción / Notas (opcional)</label>
            <input placeholder="Color, material, detalles…" value={f.description} onChange={e=>sf("description",e.target.value)}/>
          </div>

          {!f.isService && (
            <div style={{background:"#050f12",border:"1px solid #0a2028",borderRadius:12,padding:"12px",marginBottom:12}}>
              <div style={{fontSize:11,fontWeight:600,color:"#2dcfe8",marginBottom:8}}>📦 Stock — {allSerials.length + qtyNew} unidades en total</div>
              {(realSerials.length>0||autoCount>0)&&(
                <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:8}}>
                  {realSerials.map(ser=>(
                    <span key={ser} style={{background:"#071c22",border:"1px solid #0e3040",borderRadius:6,padding:"2px 8px",fontSize:10,color:"#4a9ab0",fontFamily:"'JetBrains Mono',monospace",display:"flex",alignItems:"center",gap:4}}>
                      {ser}{item&&<button onClick={()=>removeSer(ser)} style={{background:"transparent",border:"none",color:"#2a5060",cursor:"pointer",padding:0,fontSize:10}}>✕</button>}
                    </span>
                  ))}
                  {autoCount>0&&(
                    <span style={{background:"#0c1e14",border:"1px solid #14402a",borderRadius:6,padding:"2px 8px",fontSize:10,color:"#34d399",fontFamily:"'JetBrains Mono',monospace",display:"flex",alignItems:"center",gap:5}}>
                      {autoCount} unidad(es) sin código
                      {item&&<button onClick={removeAutoOne} title="Quitar una unidad" style={{background:"transparent",border:"none",color:"#2a6040",cursor:"pointer",padding:0,fontSize:10}}>−1</button>}
                    </span>
                  )}
                </div>
              )}
              <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:10,alignItems:"start"}}>
                <div className="field">
                  <label>Códigos de serie (uno por línea o separados por coma)</label>
                  <textarea value={f.newSerials} onChange={e=>sf("newSerials",e.target.value)} rows={3}
                    placeholder={"SN-001\nSN-002\nSN-003"}
                    style={{background:"#050e10",border:"1px solid #0d2a30",borderRadius:8,padding:"9px 12px",color:"#e2e8f4",fontFamily:"'JetBrains Mono',monospace",fontSize:11,resize:"vertical",outline:"none",width:"100%"}}
                  />
                  {parsedNew.length>0&&dupInSelf.length===0&&dupInOthers.length===0&&<div style={{fontSize:10,color:"#34d399",marginTop:3}}>✓ Se agregarán {parsedNew.length} código(s)</div>}
                  {dupInSelf.length>0&&<div style={{fontSize:10,color:"#f87171",marginTop:3}}>⚠️ Código repetido: {dupInSelf.join(", ")}</div>}
                  {dupInOthers.length>0&&<div style={{fontSize:10,color:"#f87171",marginTop:3}}>⚠️ Ya existe en otro producto: {dupInOthers.join(", ")}</div>}
                </div>
                <div className="field" style={{width:130}}>
                  <label>Sin código: cantidad</label>
                  <input type="number" min="0" step="1" placeholder="0" value={f.qty} onChange={e=>sf("qty",e.target.value)}/>
                  {qtyNew>0&&<div style={{fontSize:10,color:"#34d399",marginTop:3}}>✓ +{qtyNew} unidad(es)</div>}
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8,marginTop:8}}>
                <span style={{fontSize:10,color:"#fbbf24"}}>⚠ Avisar reposición cuando queden</span>
                <input type="number" min="0" step="1" value={f.minStock} onChange={e=>sf("minStock",e.target.value)}
                  style={{width:60,background:"#050e10",border:"1px solid #0d2a30",borderRadius:6,padding:"4px 8px",color:"#e2e8f4",fontFamily:"'JetBrains Mono',monospace",fontSize:12,outline:"none"}}/>
                <span style={{fontSize:10,color:"#1a4a50"}}>unidades o menos</span>
              </div>
              <div style={{fontSize:10,color:"#1a4a50",marginTop:6}}>Usa códigos para monturas con serial; usa cantidad para lentes de contacto, accesorios, etc.</div>
            </div>
          )}
          {err&&<div style={{background:"#2a0c0c",border:"1px solid #5a1a1a",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#f87171",marginBottom:10}}>⚠️ {err}</div>}
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <button className="btn-g" onClick={onClose}>Cancelar</button>
            <button className="btn-p" onClick={save2} disabled={saving} style={{minWidth:130}}>
              <ICheck/>{saving?"Guardando…":item?"Guardar cambios":"Agregar producto"}
            </button>
          </div>
        </>)}

        {mode==="fast"&&!item&&(<>
          <div style={{fontSize:11,color:"#1a4a50",marginBottom:12,lineHeight:1.5}}>Agrega varios productos de una sola vez. Foto + nombre + categoría + precios + códigos.</div>
          <div style={{display:"flex",flexDirection:"column",gap:10,maxHeight:"55vh",overflowY:"auto",paddingRight:2}}>
            {fastItems.map((it)=>{
              const touched = it.name.trim()||it.price!==""||it.serials.trim()||it.qty!=="";
              const incomplete = touched && (!it.name.trim()||it.price==="");
              const units = it.serials.split(/[\n,;]+/).filter(x=>x.trim()).length + Math.max(0, parseInt(it.qty)||0);
              const dupName = it.name.trim()!=="" && inventory.some(p=>p.name.trim().toLowerCase()===it.name.trim().toLowerCase());
              return (
              <div key={it.id} style={{background:"#050f12",border:`1px solid ${incomplete?"#5a1a1a":"#0a2028"}`,borderRadius:12,padding:"12px"}}>
                <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                  <label style={{cursor:"pointer",flexShrink:0}}>
                    <div style={{width:56,height:56,borderRadius:9,background:"#071418",border:`1px dashed ${it.photo?"#0e7a8c":"#0a2028"}`,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
                      {it.photo?<img src={it.photo} style={{width:"100%",height:"100%",objectFit:"cover"}} alt=""/>:<span style={{fontSize:20}}>📷</span>}
                    </div>
                    <input type="file" accept="image/*" capture="environment" style={{display:"none"}}
                      onChange={e=>handlePhoto(e, it.id)}/>
                  </label>
                  <div style={{flex:1,display:"grid",gridTemplateColumns:"2fr 1fr",gap:7}}>
                    <div className="field"><label style={{fontSize:9}}>Nombre</label>
                      <input placeholder="Nombre del producto" value={it.name} onChange={e=>sfi(it.id,"name",e.target.value)} style={{padding:"6px 9px",fontSize:12}}/>
                      {dupName&&<span style={{fontSize:9,color:"#fbbf24"}}>⚠️ ya existe</span>}</div>
                    <div className="field"><label style={{fontSize:9}}>Categoría</label>
                      <select value={it.cat} onChange={e=>sfi(it.id,"cat",e.target.value)} style={{padding:"6px 8px",fontSize:12}}>
                        {CATS.filter(c=>c!=="Servicio").map(c=><option key={c}>{c}</option>)}</select></div>
                    <div className="field"><label style={{fontSize:9}}>Costo USD</label>
                      <input type="number" min="0" step="0.01" placeholder="0.00" value={it.cost} onChange={e=>sfi(it.id,"cost",e.target.value)} style={{padding:"6px 9px",fontSize:12}}/></div>
                    <div className="field"><label style={{fontSize:9}}>Precio USD {incomplete&&<span style={{color:"#f87171"}}>*</span>}</label>
                      <input type="number" min="0" step="0.01" placeholder="0.00" value={it.price} onChange={e=>sfi(it.id,"price",e.target.value)} style={{padding:"6px 9px",fontSize:12}}/></div>
                    <div className="field"><label style={{fontSize:9}}>Códigos de serie (coma)</label>
                      <input placeholder="SN-001, SN-002" value={it.serials} onChange={e=>sfi(it.id,"serials",e.target.value)} style={{padding:"6px 9px",fontFamily:"'JetBrains Mono',monospace",fontSize:11}}/></div>
                    <div className="field"><label style={{fontSize:9}}>Sin código: cantidad</label>
                      <input type="number" min="0" step="1" placeholder="0" value={it.qty} onChange={e=>sfi(it.id,"qty",e.target.value)} style={{padding:"6px 9px",fontSize:12}}/>
                      {units>0&&<span style={{fontSize:9,color:"#34d399"}}>{units} pz en total</span>}</div>
                  </div>
                  <button onClick={()=>setFastItems(items=>items.filter(x=>x.id!==it.id))} style={{background:"transparent",border:"none",color:"#2a4060",cursor:"pointer",fontSize:18,padding:"2px 4px",flexShrink:0}}>×</button>
                </div>
              </div>
            );})}
          </div>
          {err&&<div style={{background:"#2a0c0c",border:"1px solid #5a1a1a",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#f87171",marginTop:10}}>⚠️ {err}</div>}
          <div style={{display:"flex",justifyContent:"space-between",marginTop:12,alignItems:"center"}}>
            <button className="btn-g" style={{fontSize:12}} onClick={()=>setFastItems(f=>[...f,{id:uid(),name:"",cat:CATS[0],cost:"",price:"",serials:"",qty:"",photo:null}])}><IPlus/> Otro producto</button>
            <div style={{display:"flex",gap:8}}>
              <button className="btn-g" onClick={onClose}>Cancelar</button>
              <button className="btn-p" onClick={saveFast} disabled={saving} style={{minWidth:150}}>
                <ICheck/>{saving?"Guardando…":`Guardar ${fastItems.filter(i=>i.name.trim()&&i.price!=="").length} producto(s)`}
              </button>
            </div>
          </div>
        </>)}
      </div>
    </div>
  );
}

function DayModal({date,sales,onClose,rate}) {
  const rev=sales.reduce((s,v)=>s+v.total,0),prof=sales.reduce((s,v)=>s+v.profit,0),items=sales.reduce((s,v)=>s+v.qty,0);
  return (
    <div className="ov" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="modal" style={{maxWidth:580}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <div style={{fontSize:17,fontWeight:700,color:"#fff"}}>{new Date(date+"T12:00").toLocaleDateString("es-MX",{weekday:"long",day:"numeric",month:"long"})}</div>
          <button style={{background:"transparent",border:"none",color:"#2a4060",cursor:"pointer"}} onClick={onClose}><IClose/></button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:16}}>
          <div className="card-sm" style={{textAlign:"center"}}>
            <div style={{fontSize:10,color:"#1e3050",marginBottom:3}}>INGRESOS</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:14,color:"#60a5fa",fontWeight:600}}>{fmtUSD(rev)}</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"#fbbf24",marginTop:1}}>{fmtBs(rev,rate)}</div>
          </div>
          <div className="card-sm" style={{textAlign:"center"}}>
            <div style={{fontSize:10,color:"#1e3050",marginBottom:3}}>GANANCIA</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:14,color:"#34d399",fontWeight:600}}>{fmtUSD(prof)}</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"#fbbf24",marginTop:1}}>{fmtBs(prof,rate)}</div>
          </div>
          <div className="card-sm" style={{textAlign:"center"}}>
            <div style={{fontSize:10,color:"#1e3050",marginBottom:3}}>ARTÍCULOS</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:16,color:"#a78bfa",fontWeight:600}}>{items}</div>
          </div>
        </div>
        <table>
          <thead><tr><th>Producto</th><th style={{textAlign:"center"}}>Cant.</th><th>Series</th><th style={{textAlign:"center"}}>Quién</th><th style={{textAlign:"right"}}>USD</th><th style={{textAlign:"right"}}>Bs</th><th style={{textAlign:"right"}}>Gan.</th></tr></thead>
          <tbody>
            {sales.map(s=>{
              const who=PROFILES.find(p=>p.id===s.registeredBy);
              return (
                <tr key={s.id}>
                  <td><div style={{color:"#b0c0d8",fontSize:13}}>{s.productName}</div>{s.note&&<div style={{fontSize:11,color:"#1e3050"}}>{s.note}</div>}</td>
                  <td style={{textAlign:"center",color:"#3a5070"}}>{s.qty}</td>
                  <td style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace",color:"#2a5060"}}>
                    {fmtSerials(s.serials)}
                  </td>
                  <td style={{textAlign:"center"}}>{who?<span style={{fontSize:11,color:who.color,background:`${who.color}15`,padding:"2px 8px",borderRadius:20}}>{who.name}</span>:"-"}</td>
                  <td style={{textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"#60a5fa"}}>{fmtUSD(s.total)}</td>
                  <td style={{textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"#fbbf24"}}>{fmtBs(s.total,rate)}</td>
                  <td style={{textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"#34d399"}}>{fmtUSD(s.profit)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{marginTop:14,display:"flex",justifyContent:"flex-end"}}><button className="btn-g" onClick={onClose}>Cerrar</button></div>
      </div>
    </div>
  );
}
