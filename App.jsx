import { useState, useEffect, useCallback, useRef } from "react";

// ══════════════════════════════════════════════════════════════════════════════
// FIREBASE DATABASE LAYER — Firestore (tiempo real + offline incluido)
// ══════════════════════════════════════════════════════════════════════════════
// 🔧  REEMPLAZA CON TU CONFIGURACIÓN DE FIREBASE
//     Firebase Console → Tu proyecto → Configuración → Apps web → firebaseConfig
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBNdhAeQSE1fklt4h8YCUVRb3SirYiraGE",
  authDomain:        "optilatina-c3c95.firebaseapp.com",
  projectId:         "optilatina-c3c95",
  storageBucket:     "optilatina-c3c95.firebasestorage.app",
  messagingSenderId: "212208578793",
  appId:             "1:212208578793:web:2081484a79b03f33afc078",
};

const CONFIGURED = true; // Firebase configurado ✓

// ── Firebase imports (npm, via Vite) ─────────────────────────────────────────
import {
  initializeApp, getApps,
} from "firebase/app";
import {
  getFirestore, enableIndexedDbPersistence,
  collection, doc, getDocs, setDoc, deleteDoc,
  onSnapshot, query, orderBy, writeBatch, getDoc,
} from "firebase/firestore";

// Inicializar solo una vez
const firebaseApp = getApps().length
  ? getApps()[0]
  : initializeApp(FIREBASE_CONFIG);

const db = CONFIGURED ? getFirestore(firebaseApp) : null;

// Habilitar persistencia offline (cache local automático)
if (db) {
  enableIndexedDbPersistence(db).catch(() => {
    // Puede fallar si hay varias pestañas abiertas — no es crítico
  });
}

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
    const [inventory, sales, expenses, deposits, investments,
           rate, payments, profilesData, dynProfiles] = await Promise.all([
      DB.getAll("inventory", "name"),
      DB.getAll("sales",     "date"),
      DB.getAll("expenses",  "createdAt"),
      DB.getAll("deposits",  "date"),
      DB.getAll("investments","date"),
      DB.getSetting("rate"),
      DB.getSetting("payments"),
      DB.getSetting("profilesData"),
      DB.getSetting("dynProfiles"),
    ]);
    return { inventory, sales, expenses, deposits, investments,
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
const save = async () => {};
const useIsMobile = () => {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  useEffect(() => {
    const fn = () => setM(window.innerWidth < 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return m;
};
const g = {
  col1: { display: "grid", gridTemplateColumns: "1fr", gap: 13 },
  col2: (m) => ({ display: "grid", gridTemplateColumns: m ? "1fr" : "1fr 1fr", gap: 13 }),
  col3: (m) => ({ display: "grid", gridTemplateColumns: m ? "1fr 1fr" : "1fr 1fr 1fr", gap: 13 }),
  col4: (m) => ({ display: "grid", gridTemplateColumns: m ? "1fr 1fr" : "repeat(4,1fr)", gap: 13 }),
  colAuto: (min = 175) => ({ display: "grid", gridTemplateColumns: `repeat(auto-fit,minmax(${min}px,1fr))`, gap: 13 }),
};


// ── Demo sales ────────────────────────────────────────────────────────────────
const DS = (date,product,cat,cost,price,qty,pay,by) => ({
  id:uid(), saleId:uid(), date, note:"", paymentMethod:pay, registeredBy:by,
  productId:uid(), productName:product, cat, cost, price, qty,
  total:+(price*qty).toFixed(2), profit:+((price-cost)*qty).toFixed(2)
});
const DEMO_SALES = [
  // Diciembre 2024
  DS("2024-12-02","Montura Ray-Ban RB5154","Montura",14,30,2,"efectivo","local"),
  DS("2024-12-02","Estuche de lujo","Accesorio",1.5,4,3,"efectivo","local"),
  DS("2024-12-03","Lente Antirreflejante","Lente",5,12,2,"pagoMovil","rene"),
  DS("2024-12-04","Ajuste y limpieza","Servicio",0,2,5,"efectivo","local"),
  DS("2024-12-05","Montura Oakley OX8046","Montura",20,45,1,"zelle","local"),
  DS("2024-12-05","Lente Progresivo Hoya","Lente",10,25,1,"usdt","owner"),
  DS("2024-12-06","Lente de Contacto Acuvue (caja)","Lente de contacto",7,13,2,"efectivo","local"),
  DS("2024-12-07","Lente Antirreflejante","Lente",5,12,3,"efectivo","local"),
  DS("2024-12-09","Montura Ray-Ban RB5154","Montura",14,30,1,"transferencia","rene"),
  DS("2024-12-09","Estuche de lujo","Accesorio",1.5,4,4,"efectivo","local"),
  DS("2024-12-10","Lente Progresivo Hoya","Lente",10,25,2,"usdt","owner"),
  DS("2024-12-11","Ajuste y limpieza","Servicio",0,2,6,"efectivo","local"),
  DS("2024-12-12","Montura Oakley OX8046","Montura",20,45,2,"efectivo","local"),
  DS("2024-12-12","Lente de Contacto Acuvue (caja)","Lente de contacto",7,13,1,"zelle","local"),
  DS("2024-12-13","Montura Ray-Ban RB5154","Montura",14,30,1,"efectivo","local"),
  DS("2024-12-14","Lente Antirreflejante","Lente",5,12,4,"pagoMovil","rene"),
  DS("2024-12-16","Lente Progresivo Hoya","Lente",10,25,3,"usdt","owner"),
  DS("2024-12-16","Estuche de lujo","Accesorio",1.5,4,5,"efectivo","local"),
  DS("2024-12-17","Montura Oakley OX8046","Montura",20,45,1,"zelle","local"),
  DS("2024-12-18","Ajuste y limpieza","Servicio",0,2,4,"efectivo","local"),
  DS("2024-12-18","Lente de Contacto Acuvue (caja)","Lente de contacto",7,13,3,"efectivo","local"),
  DS("2024-12-19","Montura Ray-Ban RB5154","Montura",14,30,2,"transferencia","rene"),
  DS("2024-12-20","Lente Antirreflejante","Lente",5,12,2,"efectivo","local"),
  DS("2024-12-20","Lente Progresivo Hoya","Lente",10,25,1,"usdt","owner"),
  DS("2024-12-21","Montura Oakley OX8046","Montura",20,45,1,"efectivo","local"),
  DS("2024-12-21","Estuche de lujo","Accesorio",1.5,4,6,"efectivo","local"),
  DS("2024-12-23","Montura Ray-Ban RB5154","Montura",14,30,3,"zelle","local"),
  DS("2024-12-23","Lente de Contacto Acuvue (caja)","Lente de contacto",7,13,2,"pagoMovil","rene"),
  DS("2024-12-24","Lente Progresivo Hoya","Lente",10,25,2,"usdt","owner"),
  DS("2024-12-24","Lente Antirreflejante","Lente",5,12,5,"efectivo","local"),
  DS("2024-12-24","Ajuste y limpieza","Servicio",0,2,8,"efectivo","local"),
  DS("2024-12-26","Montura Oakley OX8046","Montura",20,45,2,"efectivo","local"),
  DS("2024-12-26","Estuche de lujo","Accesorio",1.5,4,4,"efectivo","local"),
  DS("2024-12-27","Montura Ray-Ban RB5154","Montura",14,30,1,"transferencia","rene"),
  DS("2024-12-27","Lente Progresivo Hoya","Lente",10,25,1,"usdt","owner"),
  DS("2024-12-28","Lente de Contacto Acuvue (caja)","Lente de contacto",7,13,2,"efectivo","local"),
  DS("2024-12-28","Lente Antirreflejante","Lente",5,12,3,"efectivo","local"),
  DS("2024-12-30","Montura Ray-Ban RB5154","Montura",14,30,2,"zelle","local"),
  DS("2024-12-30","Ajuste y limpieza","Servicio",0,2,5,"efectivo","local"),
  DS("2024-12-31","Montura Oakley OX8046","Montura",20,45,1,"efectivo","local"),
  DS("2024-12-31","Estuche de lujo","Accesorio",1.5,4,3,"efectivo","local"),
  // Enero 2025
  DS("2025-01-06","Montura Ray-Ban RB5154","Montura",14,30,1,"efectivo","local"),
  DS("2025-01-06","Lente Antirreflejante","Lente",5,12,2,"efectivo","local"),
  DS("2025-01-09","Lente Progresivo Hoya","Lente",10,25,1,"usdt","owner"),
  DS("2025-01-13","Montura Oakley OX8046","Montura",20,45,1,"zelle","local"),
  DS("2025-01-14","Estuche de lujo","Accesorio",1.5,4,3,"efectivo","local"),
  DS("2025-01-17","Ajuste y limpieza","Servicio",0,2,4,"efectivo","local"),
  DS("2025-01-20","Lente de Contacto Acuvue (caja)","Lente de contacto",7,13,2,"pagoMovil","rene"),
  DS("2025-01-22","Montura Ray-Ban RB5154","Montura",14,30,1,"efectivo","local"),
  DS("2025-01-24","Lente Progresivo Hoya","Lente",10,25,2,"usdt","owner"),
  DS("2025-01-28","Lente Antirreflejante","Lente",5,12,3,"efectivo","local"),
  DS("2025-01-30","Montura Oakley OX8046","Montura",20,45,1,"zelle","local"),
  DS("2025-02-03","Lente Progresivo Hoya","Lente",10,25,1,"efectivo","local"),
  DS("2025-02-03","Ajuste y limpieza","Servicio",0,2,2,"efectivo","local"),
  DS("2025-02-05","Montura Ray-Ban RB5154","Montura",14,30,2,"usdt","owner"),
  DS("2025-02-07","Estuche de lujo","Accesorio",1.5,4,4,"efectivo","local"),
  DS("2025-02-10","Lente de Contacto Acuvue (caja)","Lente de contacto",7,13,1,"pagoMovil","rene"),
  DS("2025-02-12","Lente Antirreflejante","Lente",5,12,2,"transferencia","rene"),
  DS("2025-02-14","Montura Oakley OX8046","Montura",20,45,1,"zelle","local"),
  DS("2025-02-17","Lente Progresivo Hoya","Lente",10,25,1,"efectivo","local"),
  DS("2025-02-19","Montura Ray-Ban RB5154","Montura",14,30,1,"efectivo","local"),
  DS("2025-02-21","Lente de Contacto Acuvue (caja)","Lente de contacto",7,13,2,"usdt","owner"),
  DS("2025-02-24","Ajuste y limpieza","Servicio",0,2,5,"efectivo","local"),
  DS("2025-02-26","Montura Oakley OX8046","Montura",20,45,1,"efectivo","local"),
  DS("2025-03-03","Lente Progresivo Hoya","Lente",10,25,2,"usdt","owner"),
  DS("2025-03-05","Montura Ray-Ban RB5154","Montura",14,30,1,"efectivo","local"),
  DS("2025-03-06","Lente Antirreflejante","Lente",5,12,4,"efectivo","local"),
  DS("2025-03-10","Estuche de lujo","Accesorio",1.5,4,2,"pagoMovil","rene"),
  DS("2025-03-12","Montura Oakley OX8046","Montura",20,45,2,"zelle","local"),
  DS("2025-03-14","Lente Progresivo Hoya","Lente",10,25,1,"efectivo","local"),
  DS("2025-03-17","Ajuste y limpieza","Servicio",0,2,3,"efectivo","local"),
  DS("2025-03-18","Montura Ray-Ban RB5154","Montura",14,30,2,"usdt","owner"),
  DS("2025-03-20","Lente de Contacto Acuvue (caja)","Lente de contacto",7,13,3,"transferencia","rene"),
  DS("2025-03-24","Lente Antirreflejante","Lente",5,12,2,"efectivo","local"),
  DS("2025-03-27","Montura Oakley OX8046","Montura",20,45,1,"efectivo","local"),
  DS("2025-03-31","Lente Progresivo Hoya","Lente",10,25,2,"usdt","owner"),
  DS("2025-04-02","Montura Ray-Ban RB5154","Montura",14,30,1,"efectivo","local"),
  DS("2025-04-04","Estuche de lujo","Accesorio",1.5,4,5,"efectivo","local"),
  DS("2025-04-07","Lente Progresivo Hoya","Lente",10,25,3,"usdt","owner"),
  DS("2025-04-09","Lente de Contacto Acuvue (caja)","Lente de contacto",7,13,2,"zelle","local"),
  DS("2025-04-11","Montura Oakley OX8046","Montura",20,45,1,"efectivo","local"),
  DS("2025-04-14","Lente Antirreflejante","Lente",5,12,3,"pagoMovil","rene"),
  DS("2025-04-16","Ajuste y limpieza","Servicio",0,2,6,"efectivo","local"),
  DS("2025-04-18","Montura Ray-Ban RB5154","Montura",14,30,2,"transferencia","rene"),
  DS("2025-04-22","Lente Progresivo Hoya","Lente",10,25,1,"usdt","owner"),
  DS("2025-04-24","Montura Oakley OX8046","Montura",20,45,1,"efectivo","local"),
  DS("2025-04-28","Lente de Contacto Acuvue (caja)","Lente de contacto",7,13,1,"efectivo","local"),
  DS("2025-04-30","Lente Antirreflejante","Lente",5,12,2,"efectivo","local"),
  DS("2025-05-02","Montura Ray-Ban RB5154","Montura",14,30,1,"efectivo","local"),
  DS("2025-05-05","Lente Progresivo Hoya","Lente",10,25,2,"usdt","owner"),
  DS("2025-05-07","Montura Oakley OX8046","Montura",20,45,1,"zelle","local"),
  DS("2025-05-09","Ajuste y limpieza","Servicio",0,2,4,"efectivo","local"),
  DS("2025-05-12","Lente Antirreflejante","Lente",5,12,3,"efectivo","local"),
  DS("2025-05-14","Estuche de lujo","Accesorio",1.5,4,3,"pagoMovil","rene"),
  DS("2025-05-16","Lente de Contacto Acuvue (caja)","Lente de contacto",7,13,2,"transferencia","rene"),
  DS("2025-05-19","Montura Ray-Ban RB5154","Montura",14,30,3,"usdt","owner"),
  DS("2025-05-21","Lente Progresivo Hoya","Lente",10,25,1,"efectivo","local"),
  DS("2025-05-23","Montura Oakley OX8046","Montura",20,45,2,"efectivo","local"),
  DS("2025-05-27","Lente Antirreflejante","Lente",5,12,4,"efectivo","local"),
  DS("2025-05-29","Ajuste y limpieza","Servicio",0,2,2,"efectivo","local"),
];;

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
.nav-btn{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;border:none;background:transparent;color:#2a5a60;font-family:'Outfit',sans-serif;font-size:14px;font-weight:500;transition:all .2s;width:100%;text-align:left;cursor:pointer}
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
.ov{position:fixed;inset:0;background:rgba(0,0,0,.8);backdrop-filter:blur(4px);z-index:100;display:flex;align-items:center;justify-content:center;padding:20px}
.modal{background:#071c22;border:1px solid #0d2a30;border-radius:20px;padding:28px;width:100%;max-width:500px;max-height:85vh;overflow-y:auto}
.badge{display:inline-block;padding:3px 9px;border-radius:20px;font-size:11px;font-weight:600}
.bb{background:#0d2a38;color:#2dcfe8}.bg{background:#0f2820;color:#34d399}.ba{background:#2a1e08;color:#fbbf24}.br{background:#2a0c0c;color:#f87171}.bv{background:#1e1440;color:#a78bfa}
.prod-card{background:#071418;border:1px solid #0d2a30;border-radius:12px;padding:13px 14px;cursor:pointer;transition:all .18s;text-align:left;color:#e2e8f4;font-family:'Outfit',sans-serif;width:100%}
.prod-card:hover{border-color:#1a5060;background:#091c22}
.prod-card.sel{border-color:#0e7a8c;background:#071e25}
.qty-btn{background:#081820;border:1px solid #0d2a40;color:#e2e8f4;width:36px;height:36px;border-radius:8px;font-size:18px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background .15s}
.qty-btn:hover{background:#0d2a40}
@keyframes popin{0%{transform:scale(.85);opacity:0}60%{transform:scale(1.04)}100%{transform:scale(1);opacity:1}}
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
}
`;

// ══════════════════════════════════════════════════════════════════════════════
const DEFAULT_PAYMENTS = { usdt:{address:"",network:"TRC20"}, zelle:{email:"",phone:"",name:""}, bank:{bank:"",account:"",phone:"",name:""} };
const DEFAULT_PROFILES_DATA = { owner:{name:"Mi perfil",email:"",phone:""}, rene:{name:"René",email:"",phone:""}, local:{name:"Tienda",email:"",phone:""} };
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
const PROFIT_SPLIT = { owner:0.55, rene:0.45 };
const IMoney = () => <Svg d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>;
const ITag   = () => <Svg d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" s={16}/>;
const IBarcode=() => <Svg d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" s={16}/>;

export default function App() {
  const [profile,      setProfile]      = useState(null);
  const [inventory,    setInventory]    = useState([]);
  const [sales,        setSales]        = useState([]);
  const [deposits,     setDeposits]     = useState([]);
  const [expenses,     setExpenses]     = useState([]);
  const [investments,  setInvestments]  = useState([]);
  const [rate,         setRateState]    = useState(36.5);
  const [payments,     setPayments]     = useState(DEFAULT_PAYMENTS);
  const [profilesData, setProfilesData] = useState(DEFAULT_PROFILES_DATA);
  const [dynProfiles,  setDynProfiles]  = useState(DEFAULT_DYN_PROFILES);
  const [storeFilter,  setStoreFilter]  = useState("all"); // "all" | storeId
  const [loading,      setLoading]      = useState(true);

  useEffect(() => {
    (async () => {
      if (!CONFIGURED) {
        setInventory(DEMO_INV); setSales([]); setLoading(false); return;
      }
      const data = await dbLoadAll();
      if (data) {
        setInventory(data.inventory?.length ? data.inventory : DEMO_INV);
        setSales(data.sales ?? []);
        setDeposits(data.deposits ?? []);
        setExpenses(data.expenses ?? []);
        setInvestments(data.investments ?? []);
        if (data.rate         !== null) setRateState(data.rate);
        if (data.payments     !== null) setPayments(data.payments);
        if (data.profilesData !== null) setProfilesData(data.profilesData);
        if (data.dynProfiles  !== null) setDynProfiles(data.dynProfiles);
      } else {
        setInventory(DEMO_INV);
      }
      setLoading(false);
    })();
  }, []);

  // Realtime listeners — Firebase onSnapshot sincroniza automáticamente entre dispositivos
  useEffect(() => {
    if (!profile || !CONFIGURED) return;
    const unsubs = [
      DB.listen("inventory",   d => setInventory(d.length ? d : DEMO_INV)),
      DB.listen("sales",       d => setSales(d)),
      DB.listen("expenses",    d => setExpenses(d)),
      DB.listen("deposits",    d => setDeposits(d)),
      DB.listen("investments", d => setInvestments(d)),
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

  const saveDeposits    = useCallback(async d => { setDeposits(d);    await dbSaveDeposits(d);    }, []);
  const saveExpenses    = useCallback(async d => { setExpenses(d);    await dbSaveExpenses(d);    }, []);
  const saveInvestments = useCallback(async d => { setInvestments(d); await dbSaveInvestments(d); }, []);
  const saveRate        = useCallback(async r => { setRateState(r);   await dbSaveSetting("rate", r); }, []);
  const savePayments    = useCallback(async d => { setPayments(d);    await dbSaveSetting("payments", d); }, []);
  const savePD          = useCallback(async d => { setProfilesData(d);await dbSaveSetting("profilesData", d); }, []);
  const saveDynProfiles = useCallback(async d => { setDynProfiles(d); await dbSaveSetting("dynProfiles", d); }, []);

  if (loading) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#040d10",fontFamily:"'Outfit',sans-serif",color:"#1a4a50",fontSize:16}}>
      <style>{CSS}</style>
      <div style={{textAlign:"center",maxWidth:460,padding:24}}>
        <div style={{marginBottom:12}}><Logo s={60}/></div>
        {CONFIGURED
          ? <><div style={{color:"#2dcfe8",fontSize:18,fontWeight:700,marginBottom:6}}>Optilatina</div><div>Conectando con Firebase…</div></>
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

  if (!profile) return <LoginScreen onSelect={setProfile} dynProfiles={dynProfiles} />;
  const p = dynProfiles.find(x => x.id === profile);
  const shared = { inventory, sales, rate, deposits, expenses, investments, payments, profilesData, dynProfiles, storeFilter, setStoreFilter, saveInv, saveSal, saveRate, saveDeposits, savePayments, savePD, saveExpenses, saveInvestments, saveDynProfiles, onLogout:()=>setProfile(null) };
  return p?.role === "store"
    ? <StoreView  profile={p} {...shared} />
    : <AdminView  profile={p} {...shared} />;
}

// ── Login ─────────────────────────────────────────────────────────────────────
function LoginScreen({ onSelect, dynProfiles }) {
  const [pending, setPending] = useState(null);
  const [pin,     setPin]     = useState("");
  const [shake,   setShake]   = useState(false);

  const handleSelect = p => { setPending(p); setPin(""); };

  const handleDigit = d => {
    if (shake) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) {
      if (next === (pending.pin || "0000")) {
        onSelect(pending.id); setPending(null); setPin("");
      } else {
        setShake(true);
        setTimeout(() => { setShake(false); setPin(""); }, 700);
      }
    }
  };
  const handleBack = () => { if (!shake) setPin(p => p.slice(0,-1)); };

  const adminProfiles = dynProfiles.filter(p=>p.role==="admin");
  const storeProfiles = dynProfiles.filter(p=>p.role==="store");

  return (
    <div style={{minHeight:"100vh",background:"#040d10",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,fontFamily:"'Outfit',sans-serif"}}>
      <style>{CSS + `
        @keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}
        .shake{animation:shake .5s ease}
        .pin-key{background:#071418;border:1px solid #0d2a30;border-radius:14px;width:72px;height:72px;font-size:22px;font-weight:600;color:#e2e8f4;font-family:'Outfit',sans-serif;cursor:pointer;transition:all .15s;display:flex;align-items:center;justify-content:center}
        .pin-key:hover{background:#0c2030;border-color:#1a5060}
        .pin-key:active{transform:scale(.93);background:#0d2840}
        .profile-card{background:#071418;border:1px solid #0d2a30;border-radius:20px;padding:26px 22px;cursor:pointer;transition:all .25s;display:flex;flex-direction:column;align-items:center;gap:12px;min-width:155px}
        .profile-card:hover{transform:translateY(-5px);border-color:#1a5060;box-shadow:0 20px 60px rgba(0,0,0,.5)}
      `}</style>
      {!pending ? (
        <>
          <div style={{textAlign:"center",marginBottom:40}}>
            <div style={{width:80,height:80,margin:"0 auto 14px",borderRadius:18,overflow:"hidden",boxShadow:"0 0 40px #0e7a8c40"}}><Logo s={80}/></div>
            <div style={{fontSize:28,fontWeight:800,color:"#fff",letterSpacing:"-.02em"}}>Optilatina</div>
            <div style={{fontSize:13,color:"#1a4a50",marginTop:4}}>Selecciona tu perfil para continuar</div>
          </div>
          {adminProfiles.length>0 && (
            <div style={{marginBottom:24}}>
              <div style={{fontSize:10,color:"#1a4060",textTransform:"uppercase",letterSpacing:".12em",marginBottom:12,textAlign:"center"}}>Administradores</div>
              <div style={{display:"flex",gap:16,flexWrap:"wrap",justifyContent:"center"}}>
                {adminProfiles.map(p=>(
                  <div key={p.id} className="profile-card" onClick={()=>handleSelect(p)}>
                    {p.photo ? <img src={p.photo} style={{width:60,height:60,borderRadius:"50%",objectFit:"cover",border:`2px solid ${p.color}40`}}/>
                      : <div style={{width:60,height:60,borderRadius:"50%",background:`${p.color}18`,border:`2px solid ${p.color}35`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,fontWeight:700,color:p.color}}>{p.name.slice(0,2)}</div>}
                    <div style={{textAlign:"center"}}>
                      <div style={{fontSize:17,fontWeight:700,color:"#e2e8f4"}}>{p.name}</div>
                      {p.description&&<div style={{fontSize:11,color:`${p.color}99`,marginTop:2}}>{p.description}</div>}
                    </div>
                    <div style={{background:`${p.color}12`,color:p.color,borderRadius:20,padding:"4px 14px",fontSize:11,fontWeight:600,border:`1px solid ${p.color}25`}}>🔒 Admin</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {storeProfiles.length>0 && (
            <div>
              <div style={{fontSize:10,color:"#1a4060",textTransform:"uppercase",letterSpacing:".12em",marginBottom:12,textAlign:"center"}}>Tiendas</div>
              <div style={{display:"flex",gap:16,flexWrap:"wrap",justifyContent:"center"}}>
                {storeProfiles.map(p=>(
                  <div key={p.id} className="profile-card" onClick={()=>handleSelect(p)}>
                    {p.photo ? <img src={p.photo} style={{width:60,height:60,borderRadius:12,objectFit:"cover",border:`2px solid ${p.color}40`}}/>
                      : p.storeLogo
                        ? <img src={p.storeLogo} style={{width:60,height:60,borderRadius:12,objectFit:"cover",border:`2px solid ${p.color}35`}} alt="logo"/>
                        : <div style={{width:60,height:60,borderRadius:12,overflow:"hidden",border:`2px solid ${p.color}35`}}><Logo2 s={60}/></div>}
                    <div style={{textAlign:"center"}}>
                      <div style={{fontSize:13,fontWeight:800,color:"#e2e8f4",letterSpacing:"-.01em"}}>{p.storeName||"Optilatina"}</div>
                      <div style={{fontSize:14,color:p.color,fontWeight:600,marginTop:2}}>{p.address}</div>
                    </div>
                    <div style={{background:`${p.color}12`,color:p.color,borderRadius:20,padding:"4px 14px",fontSize:11,fontWeight:600,border:`1px solid ${p.color}25`}}>🔒 Tienda</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:28}}>
          <div style={{textAlign:"center"}}>
            {pending.role==="store"
              ? <div style={{width:68,height:68,borderRadius:14,background:`${pending.color}18`,border:`2px solid ${pending.color}35`,overflow:"hidden",margin:"0 auto 12px"}}><Logo2 s={68}/></div>
              : <div style={{width:68,height:68,borderRadius:"50%",background:`${pending.color}18`,border:`2px solid ${pending.color}35`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,fontWeight:700,color:pending.color,margin:"0 auto 12px"}}>{pending.name.slice(0,2)}</div>}
            <div style={{fontSize:20,fontWeight:700,color:"#fff"}}>
              {pending.role==="store" ? `${pending.storeName||"Optilatina"} — ${pending.address}` : pending.name}
            </div>
            <div style={{fontSize:13,color:"#1a4a50",marginTop:4}}>PIN de acceso</div>
          </div>
          <div className={shake?"shake":""} style={{display:"flex",gap:14}}>
            {[0,1,2,3].map(i=>(<div key={i} style={{width:16,height:16,borderRadius:"50%",background:i<pin.length?pending.color:"#141e30",border:`2px solid ${i<pin.length?pending.color:"#1e2e45"}`,transition:"all .15s"}}/>))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,72px)",gap:10,opacity:shake?.4:1,transition:"opacity .15s"}}>
            {[1,2,3,4,5,6,7,8,9].map(n=>(<button key={n} className="pin-key" onClick={()=>handleDigit(String(n))} disabled={shake}>{n}</button>))}
            <button className="pin-key" style={{background:"transparent",border:"1px solid #0a2028",color:"#1a4a50",fontSize:13}} onClick={()=>{setPending(null);setPin("");}}>←</button>
            <button className="pin-key" onClick={()=>handleDigit("0")} disabled={shake}>0</button>
            <button className="pin-key" style={{background:"transparent",border:"1px solid #0a2028",color:shake?"#1a4a50":"#2dcfe8",fontSize:18}} onClick={handleBack} disabled={shake}>⌫</button>
          </div>
          {shake&&<div style={{color:"#f87171",fontSize:13,marginTop:-16}}>PIN incorrecto</div>}
        </div>
      )}
    </div>
  );
}

// ── Store View (pantalla tienda) ──────────────────────────────────────────────
function StoreView({ profile, inventory, sales, rate, payments, dynProfiles, saveInv, saveSal, onLogout }) {
  const [lines,      setLines]     = useState([]);
  const [note,       setNote]      = useState("");
  const [method,     setMethod]    = useState("cash");
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
    {id:"cash",  label:"Efectivo",   icon:"💵", currency:"USD", detail:null},
    {id:"usdt",  label:"USDT",       icon:"₮",  currency:"USD", detail:payments?.usdt?.address  ? `${payments.usdt.network} · ${payments.usdt.address}` : null},
    {id:"zelle", label:"Zelle",      icon:"💸", currency:"USD", detail:payments?.zelle?.name    ? `${payments.zelle.name} — ${payments.zelle.email||payments.zelle.phone}` : null},
    {id:"bank",  label:"Pago Móvil", icon:"📱", currency:"Bs",  detail:payments?.bank?.name     ? `${payments.bank.bank} · ${payments.bank.phone} · ${payments.bank.name}` : null},
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
        assignedSerials = prodInv.serials.slice(0, r.qty);
        prodInv.serials = prodInv.serials.slice(r.qty);
      }
      const lineLabCost = labC / resolved.length;
      const isBank = method === "bank"; // Pago Móvil = Bs
      newSales.push({
        id:uid(), saleId, date:today(), note, paymentMethod:method,
        registeredBy:profile.id, storeId:profile.id,
        productId:r.product.id, productName:r.product.name, cat:r.product.cat,
        cost:r.product.cost, price:r.product.price, qty:r.qty,
        total:r.subtotal + lineLabCost, profit:r.profit,
        totalBs: isBank ? (r.subtotal + lineLabCost) * rate : null, // Bs amount for pago móvil
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
  const filteredInv = inventory.filter(p => {
    if (p.isService ? false : getStock(p) < 1) return false;
    if (searchQ) return p.name.toLowerCase().includes(searchQ.toLowerCase());
    return catF === "Todos" || p.cat === catF;
  });

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
    <div style={{fontFamily:"'Outfit',sans-serif",background:"#040d10",color:"#e2e8f4",display:"flex",flexDirection:"column",height:isMobile?"auto":"100vh",minHeight:"100vh",overflow:isMobile?"auto":"hidden"}}>
      <style>{CSS}</style>

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
              <div style={{fontSize:isMobile?14:16,fontWeight:800,color:"#fff",letterSpacing:"-.01em"}}>{profile.storeName||"Optilatina"}</div>
              <div style={{fontSize:isMobile?11:13,fontWeight:600,color:profile.color,marginTop:1}}>{profile.address}</div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
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
                          <div style={{fontSize:9,color:stock<3?"#f87171":stock<6?"#fbbf24":"#1a4a50",fontWeight:600}}>{stock} pz</div>
                          {stock<3 && <div style={{fontSize:8,color:"#f87171"}}>⚠ bajo</div>}
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
function AdminView({ profile, inventory, sales, rate, deposits, expenses, investments, payments, profilesData, dynProfiles, storeFilter, setStoreFilter, saveInv, saveSal, saveRate, saveDeposits, savePayments, savePD, saveExpenses, saveInvestments, saveDynProfiles, onLogout }) {
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
  const lowStock      = inventory.filter(p=>!p.isService&&getStock(p)<3);

  const handleRateSave = async () => {
    const r = parseFloat(rateInput);
    if (!isNaN(r) && r > 0) { await saveRate(r); setEditRate(false); }
  };

  const isMobile = useIsMobile();

  const NAV_ITEMS = [
    {id:"dash",    I:IHome,   l:"Inicio"},
    {id:"stats",   I:IStats,  l:"Stats"},
    {id:"finanzas",I:IMoney,  l:"Finanzas"},
    {id:"caja",    I:ICash,   l:"Caja"},
    {id:"inv",     I:IBox,    l:"Inventario"},
    {id:"history", I:IChart,  l:"Historial"},
  ];
  const SIDE_EXTRA = [
    {id:"week",    I:IWeek,   l:"Esta semana"},
    {id:"miperfil",I:IGear,   l:"Mi perfil"},
    ...(profile.id==="owner" ? [{id:"ajustes",I:IUsers,l:"Gestión"}] : []),
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
              <div style={{fontSize:10,color:profile.color}}>Administrador</div>
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
              <div style={{fontSize:11,color:`${profile.color}99`}}>Administrador</div>
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
            {id:"stats",   I:IStats,  l:"Estadísticas"},
            {id:"week",    I:IWeek,   l:"Esta semana"},
            {id:"finanzas",I:IMoney,  l:"Finanzas"},
            {id:"caja",    I:ICash,   l:"Caja"},
            {id:"inv",     I:IBox,    l:"Inventario"},
            {id:"history", I:IChart,  l:"Historial"},
            {id:"miperfil",I:IGear,   l:"Mi perfil"},
            ...(profile.id==="owner" ? [{id:"ajustes",I:IUsers,l:"Gestión"}] : []),
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
          {/* Logout — siempre visible */}
          <button
            className="btn-g"
            style={{marginTop:12,width:"100%",fontSize:12,padding:"9px 10px",display:"flex",alignItems:"center",gap:6,justifyContent:"center",borderColor:"#1a3040",color:"#4a8090"}}
            onClick={onLogout}
          >
            <ILogout/>Cambiar perfil
          </button>
        </div>
      </aside>

      <main className={isMobile?"mob-main":""} style={{flex:1,overflow:"auto",padding:"24px"}}>
        {tab==="dash"     && <DashTab    {...{todayRev,todayProf,todayItems,weekRev,weekProf,totalInvested,totalRetail,inventory,byDate,sortedDates,lowStock,setDD,rate,storeFilter,storeProfiles,isMobile}} />}
        {tab==="stats"    && <StatsTab   {...{sales:filteredSales,expenses,rate,isMobile,profile}} />}
        {tab==="week"     && <WeekTab    {...{byDate,sortedDates,weekRev,weekProf,ws,setDD,rate,dynProfiles,isMobile}} />}
        {tab==="finanzas" && <FinanzasTab {...{sales:filteredSales,expenses,investments,inventory,rate,saveExpenses,saveInvestments,profile,isMobile}} />}
        {tab==="caja"     && <CajaTab    {...{sales:filteredSales,deposits,saveDeposits,rate,payments,isMobile}} />}
        {tab==="inv"      && <InvTab     {...{inventory,saveInv,totalInvested,totalRetail,setInvModal,rate,isMobile}} />}
        {tab==="history"  && <HistTab    {...{byDate,sortedDates,setDD,storeFilter}} />}
        {tab==="miperfil" && <ProfileSettingsTab profile={profile} dynProfiles={dynProfiles} saveDynProfiles={saveDynProfiles}/>}
        {tab==="ajustes"  && profile.id==="owner" && <GestionTab {...{profilesData,savePD,payments,savePayments,dynProfiles,saveDynProfiles}} />}
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
  const [showInvForm, setShowInvForm] = useState(false);
  const [ef, setEf] = useState({cat:"alquiler", amount:"", month:today().slice(0,7), note:""});
  const [ivf, setIvf]= useState({date:today(), description:"", amount:"", note:""});

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

  // ── Investment totals ──
  const totalInvested    = investments.reduce((s,i)=>s+i.amount,0);
  const currentStockVal  = inventory.reduce((s,p)=>s+(p.isService?0:p.cost*getStock(p)),0);

  const saveExp = async () => {
    if (!ef.amount) return;
    await saveExpenses([...expenses,{id:uid(),cat:ef.cat,amount:+ef.amount,month:ef.month,date:ef.date||ef.month,note:ef.note}]);
    setShowExpForm(false); setEf({cat:"alquiler",amount:"",month:today().slice(0,7),note:""});
  };
  const saveInv2 = async () => {
    if (!ivf.amount||!ivf.description) return;
    await saveInvestments([...investments,{id:uid(),date:ivf.date,description:ivf.description,amount:+ivf.amount,note:ivf.note}]);
    setShowInvForm(false); setIvf({date:today(),description:"",amount:"",note:""});
  };
  const delExp = async id => await saveExpenses(expenses.filter(e=>e.id!==id));
  const delInv = async id => await saveInvestments(investments.filter(i=>i.id!==id));

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
          <div style={{color:"#1a4a50",fontSize:13,marginTop:2}}>Inversiones · Gastos fijos · Distribución de ganancias</div>
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

      {/* ── Historial de inversiones ── */}
      <div className="card">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div>
            <div style={{fontSize:13,fontWeight:700,color:"#fbbf24"}}>💰 Historial de inversiones</div>
            <div style={{fontSize:11,color:"#1a4a50",marginTop:2}}>
              Total invertido: <span style={{fontFamily:"'JetBrains Mono',monospace",color:"#fbbf24"}}>{fmtUSD(totalInvested)}</span>
              &nbsp;·&nbsp; Valor actual en tienda: <span style={{fontFamily:"'JetBrains Mono',monospace",color:"#2dcfe8"}}>{fmtUSD(currentStockVal)}</span>
            </div>
          </div>
          <button className="btn-p" style={{fontSize:12,padding:"7px 14px"}} onClick={()=>setShowInvForm(true)}><IPlus/>Registrar inversión</button>
        </div>

        {showInvForm && (
          <div style={{background:"#050f12",border:"1px solid #0a2028",borderRadius:12,padding:"16px",marginBottom:16,display:"flex",flexDirection:"column",gap:12}}>
            <div style={{fontSize:11,color:"#1a4a50",lineHeight:1.7}}>
              💡 Registra aquí cada vez que compres mercancía o inviertas dinero en la óptica. Esto es tu <strong style={{color:"#fbbf24"}}>base de inversión</strong>, no ganancia.
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div className="field"><label>Fecha</label><input type="date" value={ivf.date} onChange={e=>setIvf(f=>({...f,date:e.target.value}))}/></div>
              <div className="field"><label>Monto invertido (USD)</label><input type="number" min="0" placeholder="0.00" value={ivf.amount} onChange={e=>setIvf(f=>({...f,amount:e.target.value}))}/></div>
            </div>
            <div className="field"><label>Descripción</label><input placeholder="Ej: Compra lentes Hoya x10 pares" value={ivf.description} onChange={e=>setIvf(f=>({...f,description:e.target.value}))}/></div>
            <div className="field"><label>Nota (opcional)</label><input placeholder="Ej: Proveedor Luis, factura #123" value={ivf.note} onChange={e=>setIvf(f=>({...f,note:e.target.value}))}/></div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button className="btn-g" onClick={()=>setShowInvForm(false)}>Cancelar</button>
              <button className="btn-p" onClick={saveInv2}><ICheck/>Guardar</button>
            </div>
          </div>
        )}

        {investments.length===0
          ? <div style={{color:"#0d2a30",textAlign:"center",padding:"20px 0",fontSize:13}}>Sin inversiones registradas</div>
          : <table>
              <thead><tr><th>Fecha</th><th>Descripción</th><th>Nota</th><th style={{textAlign:"right"}}>USD</th><th style={{textAlign:"right"}}>Bs</th><th></th></tr></thead>
              <tbody>
                {[...investments].sort((a,b)=>b.date.localeCompare(a.date)).map(i=>(
                  <tr key={i.id}>
                    <td style={{color:"#4a8090",fontSize:12,whiteSpace:"nowrap"}}>{i.date}</td>
                    <td style={{color:"#a0c8d0"}}>{i.description}</td>
                    <td style={{color:"#1a4a50",fontSize:12}}>{i.note||"—"}</td>
                    <td style={{textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontSize:13,color:"#fbbf24"}}>{fmtUSD(i.amount)}</td>
                    <td style={{textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"#a08020"}}>{fmtBs(i.amount,rate)}</td>
                    <td><button className="btn-d" style={{padding:"3px 8px",fontSize:11}} onClick={()=>delInv(i.id)}>✕</button></td>
                  </tr>
                ))}
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

  const buildData = () => { /* eslint-disable-line */
    const buckets = {};
    sales.forEach(s => {
      let key;
      if (period === "day")   key = s.date;
      else if (period === "week") {
        const d = new Date(s.date+"T12:00"), w = new Date(d);
        w.setDate(d.getDate()-d.getDay()); key = w.toISOString().slice(0,10);
      } else if (period === "month") key = s.date.slice(0,7);
      else key = s.date.slice(0,4);
      if (!buckets[key]) buckets[key] = {rev:0,profit:0,items:0};
      buckets[key].rev    += s.total;
      buckets[key].profit += s.profit;
      buckets[key].items  += s.qty;
    });
    const limit = period==="day"?30 : period==="week"?16 : period==="month"?12 : 10;
    return Object.keys(buckets).sort().slice(-limit)
      .map(k => ({key:k, lbl:fmtLabel(k,period), ...buckets[k]}));
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

              {/* Areas */}
              <path d={areaPath(revPath,data.length)}  fill="url(#fillRev)"/>
              <path d={areaPath(profPath,data.length)} fill="url(#fillProf)"/>

              {/* Lines */}
              <path d={revPath}  fill="none" stroke="#2dcfe8" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" filter="url(#gR)"/>
              <path d={revPath}  fill="none" stroke="#7af0ff" strokeWidth="0.9" strokeLinejoin="round" strokeLinecap="round" opacity=".45"/>
              <path d={profPath} fill="none" stroke="#34d399" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" filter="url(#gP)"/>

              {/* Hover zones */}
              {data.map((d,i)=>{
                const x=xOf(i,data.length);
                const ry=yOf(d.rev,maxRev), py=yOf(d.profit,maxRev);
                const zW=innerW/Math.max(data.length,1);
                return (
                  <g key={i} onMouseEnter={()=>setHover(i)} style={{cursor:"crosshair"}}>
                    <rect x={x-zW/2} y={padT} width={zW} height={innerH} fill="transparent"/>
                    {hover===i && <>
                      <line x1={x} x2={x} y1={padT} y2={padT+innerH} stroke="#0e7a8c" strokeWidth="1" strokeDasharray="3,3" opacity=".7"/>
                      <circle cx={x} cy={ry} r="4.5" fill="#2dcfe8" stroke="#030b0e" strokeWidth="1.5" filter="url(#gR)"/>
                      <circle cx={x} cy={py} r="3.5" fill="#34d399" stroke="#030b0e" strokeWidth="1.5" filter="url(#gP)"/>
                    </>}
                  </g>
                );
              })}

              {/* X labels — day name + date */}
              {data.map((d,i)=>{
                const x=xOf(i,data.length);
                const step=data.length>20?Math.ceil(data.length/12):1;
                const show=i%step===0||i===data.length-1;
                // For daily: split label into two lines (day name + "date mon")
                const parts = period==="day" ? d.lbl.split(" ") : [d.lbl];
                return show ? (
                  <g key={i}>
                    {parts.length===3
                      ? <>
                          <text x={x} y={chartH-14} textAnchor="middle" fontSize="9" fill={hover===i?"#2dcfe8":"#2dcfe8"} fontFamily="'JetBrains Mono',monospace" fontWeight="700">{parts[0]}</text>
                          <text x={x} y={chartH-4}  textAnchor="middle" fontSize="8.5" fill="#1a4055" fontFamily="'JetBrains Mono',monospace">{parts[1]} {parts[2]}</text>
                        </>
                      : <text x={x} y={chartH-6} textAnchor="middle" fontSize={data.length>20?7.5:9} fill="#1a4055" fontFamily="'JetBrains Mono',monospace">{d.lbl}</text>
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

function DashTab({todayRev,todayProf,todayItems,weekRev,weekProf,totalInvested,totalRetail,inventory,byDate,sortedDates,lowStock,setDD,rate,storeFilter,storeProfiles,isMobile}) {
  const last7=sortedDates.slice(0,7).reverse();
  const maxR=Math.max(1,...last7.map(d=>byDate[d].reduce((s,v)=>s+v.total,0)));
  const storeLabel = storeFilter==="all" ? "Todas las tiendas" : (storeProfiles?.find(s=>s.id===storeFilter)?.address || storeFilter);
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
          {l:"Ventas hoy",    usd:todayRev,  s:`${todayItems} artículos`, c:"#60a5fa"},
          {l:"Ganancia hoy",  usd:todayProf, s:todayRev>0?`Margen ${((todayProf/todayRev)*100).toFixed(0)}%`:"Sin ventas", c:"#34d399"},
          {l:"Ventas semana", usd:weekRev,   s:"Lunes → hoy",  c:"#a78bfa"},
          {l:"Gan. semana",   usd:weekProf,  s:weekRev>0?`Margen ${((weekProf/weekRev)*100).toFixed(0)}%`:"Sin ventas",   c:"#fbbf24"},
        ].map(({l,usd,s,c})=>(
          <div key={l} className="card" style={{borderTop:`2px solid ${c}22`}}>
            <div style={{fontSize:10,color:"#2a4060",textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>{l}</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:20,fontWeight:700,color:c}}>{fmtUSD(usd)}</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"#fbbf24",marginTop:2}}>{fmtBs(usd,rate)}</div>
            <div style={{fontSize:11,color:"#2a4060",marginTop:3}}>{s}</div>
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
  const filtered=inventory.filter(p=>(filter==="Todos"||p.cat===filter)&&(search===""||p.name.toLowerCase().includes(search.toLowerCase())));
  const del=async id=>{if(!confirm("¿Eliminar?"))return;await saveInv(inventory.filter(p=>p.id!==id));};
  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <h1 style={{fontSize:26,fontWeight:800,color:"#fff",letterSpacing:"-.02em"}}>Inventario</h1>
        <button className="btn-p" onClick={()=>setInvModal("new")}><IPlus/>Agregar</button>
      </div>
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
function CajaTab({ sales, deposits, saveDeposits, rate, payments }) {
  const [showDeposit, setShowDeposit] = useState(false);
  const [depAmount,   setDepAmount]   = useState("");
  const [depNote,     setDepNote]     = useState("");
  const [depDate,     setDepDate]     = useState(today());

  const cashSales   = sales.filter(s=>s.paymentMethod==="cash"||s.paymentMethod==="efectivo");
  const totalCash   = cashSales.reduce((s,v)=>s+v.total,0);
  const totalDep    = deposits.reduce((s,d)=>s+d.amount,0);
  const saldoCaja   = totalCash - totalDep;

  // By payment method breakdown
  const byMethod = PAY_METHODS.map(m=>{
    const ms = sales.filter(s=>s.paymentMethod===m.id||(m.id==="efectivo"&&s.paymentMethod==="cash"));
    return {...m, total:ms.reduce((s,v)=>s+v.total,0), count:ms.reduce((s,v)=>s+v.qty,0)};
  }).filter(m=>m.total>0);

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
    photo:       live.photo || null,
    storeLogo:   live.storeLogo || null,   // logo personalizado de la tienda
  });
  const [saved,    setSaved]    = useState(false);
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
    const r = new FileReader();
    r.onload = ev => sf("photo", ev.target.result);
    r.readAsDataURL(file);
  };
  const handleStoreLogo = e => {
    const file = e.target.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = ev => sf("storeLogo", ev.target.result);
    r.readAsDataURL(file);
  };

  const handleSave = async () => {
    setPinErr(""); setSaving(true);
    if (f.pin && f.pin !== f.pinConfirm) { setPinErr("Los PINs no coinciden"); setSaving(false); return; }
    if (f.pin && (f.pin.length !== 4 || !/^\d{4}$/.test(f.pin))) { setPinErr("El PIN debe ser de 4 dígitos numéricos"); setSaving(false); return; }
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
    } : p);
    await saveDynProfiles(updated);
    setSaving(false); setSaved(true);
    setF(p => ({...p, pin:"", pinConfirm:""}));
    setTimeout(() => setSaved(false), 2500);
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
          <div className="field"><label>Teléfono</label><input value={f.phone} onChange={e=>sf("phone",e.target.value)} placeholder="+58 412 000 0000"/></div>
          <div className="field"><label>Correo electrónico</label><input type="email" value={f.email} onChange={e=>sf("email",e.target.value)} placeholder="tu@correo.com"/></div>
          {isStore && <div className="field"><label>Dirección / Ubicación</label><input value={f.address} onChange={e=>sf("address",e.target.value)} placeholder="Ej: Chinita, Local 12"/></div>}
          <div className="field" style={{gridColumn:"1/-1"}}><label>Descripción</label><input value={f.description} onChange={e=>sf("description",e.target.value)} placeholder="Descripción corta"/></div>
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
function GestionTab({ profilesData, savePD, payments, savePayments, dynProfiles, saveDynProfiles }) {
  const [pay, setPay] = useState(payments || DEFAULT_PAYMENTS);
  const [savingPay, setSavingPay] = useState(false);
  const [editProf, setEditProf] = useState(null);
  const [pf, setPf] = useState({});
  const [showNewStore, setShowNewStore] = useState(false);
  const [showNewAdmin, setShowNewAdmin] = useState(false);
  const [newStore, setNewStore] = useState({name:"Optilatina",address:"",pin:"0000",color:"#8b5cf6",description:"",phone:""});
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
    setNewStore({name:"Optilatina",address:"",pin:"0000",color:"#8b5cf6",description:"",phone:""});
  };
  const addAdmin = async () => {
    if (!newAdmin.name || newAdmin.pin.length !== 4) return;
    const ad = {...newAdmin, id:"admin_"+uid(), role:"admin", storeName:null, address:null, email:"", phone:"", photo:null};
    await saveDynProfiles([...dynProfiles, ad]);
    setShowNewAdmin(false);
    setNewAdmin({name:"",pin:"0000",color:"#3b82f6",description:""});
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:22}}>
      <div>
        <h1 style={{fontSize:26,fontWeight:800,color:"#fff",letterSpacing:"-.02em"}}>Gestión</h1>
        <div style={{color:"#1a4a50",fontSize:13,marginTop:2}}>Perfiles, tiendas y métodos de cobro</div>
      </div>

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
            <div style={{fontSize:12,fontWeight:600,color:"#fbbf24",marginBottom:4}}>🏪 Nueva tienda Optilatina</div>
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

        {editProf && (
          <div className="ov" onClick={e=>{if(e.target===e.currentTarget)setEditProf(null);}}>
            <div className="modal" style={{maxWidth:400}}>
              <div style={{fontSize:17,fontWeight:700,color:"#fff",marginBottom:18,display:"flex",justifyContent:"space-between"}}>
                Editar perfil <button style={{background:"transparent",border:"none",color:"#2a4060",cursor:"pointer"}} onClick={()=>setEditProf(null)}><IClose/></button>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                <div className="field"><label>Nombre</label><input value={pf.name||""} onChange={e=>setPf(p=>({...p,name:e.target.value}))}/></div>
                <div className="field"><label>Descripción</label><input value={pf.description||""} onChange={e=>setPf(p=>({...p,description:e.target.value}))}/></div>
                <div className="field"><label>Teléfono</label><input value={pf.phone||""} onChange={e=>setPf(p=>({...p,phone:e.target.value}))}/></div>
                <div className="field"><label>Email</label><input value={pf.email||""} onChange={e=>setPf(p=>({...p,email:e.target.value}))}/></div>
                {pf.role==="store"&&<div className="field"><label>Dirección</label><input value={pf.address||""} onChange={e=>setPf(p=>({...p,address:e.target.value}))}/></div>}
                <div className="field"><label>PIN (4 dígitos)</label><input type="password" maxLength={4} value={pf.pin||""} onChange={e=>setPf(p=>({...p,pin:e.target.value}))}/></div>
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
  const existingSerials = item?.serials || [];
  const photoRef   = useRef(null);
  const [mode, setMode] = useState("normal");
  const [f,setF]=useState({
    name:item?.name??"", cat:item?.cat??CATS[0],
    cost:item?.cost??"", price:item?.price??"",
    isService:item?.isService??(item?.stock===999)??false,
    newSerials:"", photo:item?.photo??null, description:item?.description??"",
  });
  const [fastItems, setFastItems] = useState([{id:uid(),name:"",cat:CATS[0],cost:"",price:"",serials:"",photo:null}]);
  const [saving, setSaving] = useState(false);

  const sf=(k,v)=>setF(p=>({...p,[k]:v}));
  const sfi=(id,k,v)=>setFastItems(its=>its.map(it=>it.id===id?{...it,[k]:v}:it));

  const parsedNew  = f.newSerials.split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean);
  const allSerials = [...existingSerials,...parsedNew];

  const handlePhoto = (e,target="main") => {
    const file=e.target.files?.[0]; if(!file) return;
    const r=new FileReader();
    r.onload=ev=>{if(target==="main")sf("photo",ev.target.result);else sfi(target,"photo",ev.target.result);};
    r.readAsDataURL(file);
  };

  const removeSer = ser => {
    const upd={...item,serials:existingSerials.filter(x=>x!==ser)};
    saveInv(inventory.map(p=>p.id===item.id?upd:p));
    onClose();
  };

  const save2 = async () => {
    if(!f.name||f.price==="") return;
    setSaving(true);
    const it={id:item?.id??uid(),name:f.name,cat:f.cat,cost:Number(f.cost)||0,price:Number(f.price),
      isService:f.isService,serials:f.isService?[]:allSerials,photo:f.photo,description:f.description};
    await saveInv(item?inventory.map(p=>p.id===item.id?it:p):[...inventory,it]);
    setSaving(false); onClose();
  };

  const saveFast = async () => {
    const valid=fastItems.filter(it=>it.name&&it.price); if(!valid.length) return;
    setSaving(true);
    const newItems=valid.map(it=>({id:uid(),name:it.name,cat:it.cat,cost:Number(it.cost)||0,price:Number(it.price),
      isService:false,serials:it.serials.split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean),photo:it.photo,description:""}));
    await saveInv([...inventory,...newItems]);
    setSaving(false); onClose();
  };

  const g=Number(f.price)-Number(f.cost);

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
              <div style={{fontSize:11,fontWeight:600,color:"#2dcfe8",marginBottom:8}}>🔢 Códigos de serie — {allSerials.length} unidades</div>
              {existingSerials.length>0&&(
                <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:8}}>
                  {existingSerials.map(ser=>(
                    <span key={ser} style={{background:"#071c22",border:"1px solid #0e3040",borderRadius:6,padding:"2px 8px",fontSize:10,color:"#4a9ab0",fontFamily:"'JetBrains Mono',monospace",display:"flex",alignItems:"center",gap:4}}>
                      {ser}{item&&<button onClick={()=>removeSer(ser)} style={{background:"transparent",border:"none",color:"#2a5060",cursor:"pointer",padding:0,fontSize:10}}>✕</button>}
                    </span>
                  ))}
                </div>
              )}
              <div className="field">
                <label>Nuevos códigos (uno por línea o separados por coma)</label>
                <textarea value={f.newSerials} onChange={e=>sf("newSerials",e.target.value)} rows={3}
                  placeholder={"SN-001\nSN-002\nSN-003"}
                  style={{background:"#050e10",border:"1px solid #0d2a30",borderRadius:8,padding:"9px 12px",color:"#e2e8f4",fontFamily:"'JetBrains Mono',monospace",fontSize:11,resize:"vertical",outline:"none",width:"100%"}}
                />
                {parsedNew.length>0&&<div style={{fontSize:10,color:"#34d399",marginTop:3}}>✓ Se agregarán {parsedNew.length} código(s)</div>}
              </div>
            </div>
          )}
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
            {fastItems.map((it)=>(
              <div key={it.id} style={{background:"#050f12",border:"1px solid #0a2028",borderRadius:12,padding:"12px"}}>
                <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                  <label style={{cursor:"pointer",flexShrink:0}}>
                    <div style={{width:56,height:56,borderRadius:9,background:"#071418",border:`1px dashed ${it.photo?"#0e7a8c":"#0a2028"}`,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
                      {it.photo?<img src={it.photo} style={{width:"100%",height:"100%",objectFit:"cover"}} alt=""/>:<span style={{fontSize:20}}>📷</span>}
                    </div>
                    <input type="file" accept="image/*" capture="environment" style={{display:"none"}}
                      onChange={e=>{const file=e.target.files?.[0];if(!file)return;const r=new FileReader();r.onload=ev=>sfi(it.id,"photo",ev.target.result);r.readAsDataURL(file);}}/>
                  </label>
                  <div style={{flex:1,display:"grid",gridTemplateColumns:"2fr 1fr",gap:7}}>
                    <div className="field"><label style={{fontSize:9}}>Nombre</label>
                      <input placeholder="Nombre del producto" value={it.name} onChange={e=>sfi(it.id,"name",e.target.value)} style={{padding:"6px 9px",fontSize:12}}/></div>
                    <div className="field"><label style={{fontSize:9}}>Categoría</label>
                      <select value={it.cat} onChange={e=>sfi(it.id,"cat",e.target.value)} style={{padding:"6px 8px",fontSize:12}}>
                        {CATS.filter(c=>c!=="Servicio").map(c=><option key={c}>{c}</option>)}</select></div>
                    <div className="field"><label style={{fontSize:9}}>Costo USD</label>
                      <input type="number" min="0" step="0.01" placeholder="0.00" value={it.cost} onChange={e=>sfi(it.id,"cost",e.target.value)} style={{padding:"6px 9px",fontSize:12}}/></div>
                    <div className="field"><label style={{fontSize:9}}>Precio USD</label>
                      <input type="number" min="0" step="0.01" placeholder="0.00" value={it.price} onChange={e=>sfi(it.id,"price",e.target.value)} style={{padding:"6px 9px",fontSize:12}}/></div>
                    <div className="field" style={{gridColumn:"1/-1"}}><label style={{fontSize:9}}>Códigos de serie (separados por coma)</label>
                      <input placeholder="SN-001, SN-002" value={it.serials} onChange={e=>sfi(it.id,"serials",e.target.value)} style={{padding:"6px 9px",fontFamily:"'JetBrains Mono',monospace",fontSize:11}}/>
                      {it.serials&&<span style={{fontSize:9,color:"#34d399",marginLeft:4}}>{it.serials.split(/[\n,;]+/).filter(x=>x.trim()).length} pz</span>}</div>
                  </div>
                  <button onClick={()=>setFastItems(items=>items.filter(x=>x.id!==it.id))} style={{background:"transparent",border:"none",color:"#2a4060",cursor:"pointer",fontSize:18,padding:"2px 4px",flexShrink:0}}>×</button>
                </div>
              </div>
            ))}
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:12,alignItems:"center"}}>
            <button className="btn-g" style={{fontSize:12}} onClick={()=>setFastItems(f=>[...f,{id:uid(),name:"",cat:CATS[0],cost:"",price:"",serials:"",photo:null}])}><IPlus/> Otro producto</button>
            <div style={{display:"flex",gap:8}}>
              <button className="btn-g" onClick={onClose}>Cancelar</button>
              <button className="btn-p" onClick={saveFast} disabled={saving} style={{minWidth:150}}>
                <ICheck/>{saving?"Guardando…":`Guardar ${fastItems.filter(i=>i.name&&i.price).length} producto(s)`}
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
                    {s.serials?.length ? s.serials.join(", ") : "—"}
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
