// storage.js — IndexedDB (local mode) and Firebase Firestore (cloud sync).
// Manages: items (with compressed photos), user fitness profile, and daily food logs.
import { firebaseConfig, isFirebaseConfigured } from './firebase-config.js';
import { normalizeItem } from './inventory.js';
import { SAMPLE_ITEMS } from './constants.js';

const DB_NAME = 'fitdespensa_db';
const DB_VERSION = 2;
const LEGACY_LS_KEY = 'mi_despensa_items_v1';
const HOUSEHOLD_KEY = 'fitdespensa_household_code';
const LEGACY_HOUSEHOLD_KEY = 'mi_despensa_household_code';

function normalizeRecipe(r) {
  return {
    id: r.id || uid(),
    name: String(r.name || 'Receta sin nombre').trim().slice(0, 80),
    meal: r.meal || 'comida',
    servings: Math.max(1, Number(r.servings) || 1),
    kcal: Math.max(0, Math.round(Number(r.kcal) || 0)),
    protein: Math.max(0, Math.round((Number(r.protein) || 0) * 10) / 10),
    carbs: Math.max(0, Math.round((Number(r.carbs) || 0) * 10) / 10),
    fat: Math.max(0, Math.round((Number(r.fat) || 0) * 10) / 10),
    ingredients: Array.isArray(r.ingredients) ? r.ingredients : [],
    steps: String(r.steps || '').trim().slice(0, 1200),
    photo: typeof r.photo === 'string' && r.photo.startsWith('data:image/') ? r.photo : null,
    updatedAt: r.updatedAt || Date.now(),
  };
}

export function getHouseholdCode() {
  let code = localStorage.getItem(HOUSEHOLD_KEY) || localStorage.getItem(LEGACY_HOUSEHOLD_KEY);
  if (!code) {
    code = 'hogar-' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem(HOUSEHOLD_KEY, code);
  }
  return code;
}

export function setHouseholdCode(code) {
  const clean = String(code || '').trim().toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(0, 40);
  if (!clean) throw new Error('Código inválido');
  localStorage.setItem(HOUSEHOLD_KEY, clean);
  return clean;
}

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

// =========================================================================
// IndexedDB backend (supports photos without localStorage's ~5 MB limit)
// =========================================================================
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('items')) {
        db.createObjectStore('items', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('logs')) {
        const logStore = db.createObjectStore('logs', { keyPath: 'id' });
        logStore.createIndex('date', 'date', { unique: false });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('recipes')) {
        db.createObjectStore('recipes', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbTx(db, storeName, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req = fn(store);
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error || req?.error);
  });
}

async function createLocalStore() {
  const db = await openDB();
  const itemListeners = new Set();
  const logListeners = new Map(); // date -> Set(cb)
  const profileListeners = new Set();
  const recipeListeners = new Set();
  const waterListeners = new Map(); // date -> Set(cb)
  const dayMetaListeners = new Map(); // date -> Set(cb)
  const weightListeners = new Set();

  // Migrate legacy localStorage data if present
  const existingItems = await idbTx(db, 'items', 'readonly', (s) => s.getAll());
  if (!existingItems.length) {
    const legacyRaw = localStorage.getItem(LEGACY_LS_KEY);
    if (legacyRaw) {
      try {
        const parsed = JSON.parse(legacyRaw);
        if (Array.isArray(parsed) && parsed.length) {
          await new Promise((resolve, reject) => {
            const tx = db.transaction('items', 'readwrite');
            const s = tx.objectStore('items');
            for (const raw of parsed) {
              const item = normalizeItem({ ...raw, id: raw.id || uid(), updatedAt: Date.now() });
              s.put(item);
            }
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
          });
          localStorage.removeItem(LEGACY_LS_KEY);
        }
      } catch {
        // Ignore corrupt legacy data
      }
    }
  }

  const emitItems = async () => {
    const raw = await idbTx(db, 'items', 'readonly', (s) => s.getAll());
    const items = raw.map(normalizeItem);
    itemListeners.forEach((cb) => cb(items));
  };

  const emitLogs = async (date) => {
    const cbs = logListeners.get(date);
    if (!cbs || !cbs.size) return;
    const entries = await getLogsByDate(date);
    cbs.forEach((cb) => cb(entries));
  };

  const emitProfile = async () => {
    const rec = await idbTx(db, 'meta', 'readonly', (s) => s.get('profile'));
    const profile = rec?.value || null;
    profileListeners.forEach((cb) => cb(profile));
  };

  const emitRecipes = async () => {
    const raw = await idbTx(db, 'recipes', 'readonly', (s) => s.getAll());
    const recipes = raw.map(normalizeRecipe).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    recipeListeners.forEach((cb) => cb(recipes));
  };

  const emitWater = async (date) => {
    const cbs = waterListeners.get(date);
    if (!cbs || !cbs.size) return;
    const rec = await idbTx(db, 'meta', 'readonly', (s) => s.get(`water_${date}`));
    const ml = Number(rec?.value) || 0;
    cbs.forEach((cb) => cb(ml));
  };

  const emitDayMeta = async (date) => {
    const cbs = dayMetaListeners.get(date);
    if (!cbs || !cbs.size) return;
    const rec = await idbTx(db, 'meta', 'readonly', (s) => s.get(`daymeta_${date}`));
    const val = rec?.value || { trainingDay: false, supplements: [] };
    cbs.forEach((cb) => cb(val));
  };

  const emitWeights = async () => {
    const all = await idbTx(db, 'meta', 'readonly', (s) => s.getAll());
    const list = (all || [])
      .filter((r) => String(r.key || '').startsWith('weight_'))
      .map((r) => ({ date: r.key.slice(7), kg: Number(r.value) }))
      .filter((r) => r.kg > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    weightListeners.forEach((cb) => cb(list));
  };

  const getLogsByDate = (date) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction('logs', 'readonly');
      const idx = tx.objectStore('logs').index('date');
      const req = idx.getAll(date);
      req.onsuccess = () => {
        const list = (req.result || []).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });

  return {
    mode: 'local',
    subscribeItems(cb) {
      itemListeners.add(cb);
      emitItems();
      return () => itemListeners.delete(cb);
    },
    async saveItem(data) {
      const item = normalizeItem({
        ...data,
        id: data.id || uid(),
        updatedAt: Date.now(),
      });
      await idbTx(db, 'items', 'readwrite', (s) => s.put(item));
      await emitItems();
      return item;
    },
    async deleteItem(id) {
      await idbTx(db, 'items', 'readwrite', (s) => s.delete(id));
      await emitItems();
    },
    async seedSampleItems() {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('items', 'readwrite');
        const s = tx.objectStore('items');
        for (const raw of SAMPLE_ITEMS) {
          s.put(normalizeItem({ ...raw, id: uid(), updatedAt: Date.now() }));
        }
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      await emitItems();
    },
    subscribeProfile(cb) {
      profileListeners.add(cb);
      emitProfile();
      return () => profileListeners.delete(cb);
    },
    async saveProfile(profile) {
      await idbTx(db, 'meta', 'readwrite', (s) => s.put({ key: 'profile', value: profile }));
      await emitProfile();
      return profile;
    },
    subscribeLogs(date, cb) {
      if (!logListeners.has(date)) logListeners.set(date, new Set());
      logListeners.get(date).add(cb);
      emitLogs(date);
      return () => {
        const set = logListeners.get(date);
        if (set) {
          set.delete(cb);
          if (!set.size) logListeners.delete(date);
        }
      };
    },
    async getLogs(date) {
      return getLogsByDate(date);
    },
    async addLog(entry) {
      const rec = {
        ...entry,
        id: entry.id || uid(),
        createdAt: entry.createdAt || Date.now(),
      };
      await idbTx(db, 'logs', 'readwrite', (s) => s.put(rec));
      await emitLogs(rec.date);
      return rec;
    },
    async deleteLog(id, date) {
      await idbTx(db, 'logs', 'readwrite', (s) => s.delete(id));
      if (date) await emitLogs(date);
    },
    subscribeRecipes(cb) {
      recipeListeners.add(cb);
      emitRecipes();
      return () => recipeListeners.delete(cb);
    },
    async saveRecipe(data) {
      const rec = normalizeRecipe({ ...data, id: data.id || uid(), updatedAt: Date.now() });
      await idbTx(db, 'recipes', 'readwrite', (s) => s.put(rec));
      await emitRecipes();
      return rec;
    },
    async deleteRecipe(id) {
      await idbTx(db, 'recipes', 'readwrite', (s) => s.delete(id));
      await emitRecipes();
    },
    subscribeWater(date, cb) {
      if (!waterListeners.has(date)) waterListeners.set(date, new Set());
      waterListeners.get(date).add(cb);
      emitWater(date);
      return () => {
        const set = waterListeners.get(date);
        if (set) {
          set.delete(cb);
          if (!set.size) waterListeners.delete(date);
        }
      };
    },
    async setWater(date, ml) {
      const clean = Math.max(0, Math.min(10000, Math.round(Number(ml) || 0)));
      await idbTx(db, 'meta', 'readwrite', (s) => s.put({ key: `water_${date}`, value: clean }));
      await emitWater(date);
      return clean;
    },
    async getLoggedDates() {
      const all = await idbTx(db, 'logs', 'readonly', (s) => s.getAll());
      return [...new Set((all || []).map((e) => e.date).filter(Boolean))];
    },
    async getAllLogs() {
      return (await idbTx(db, 'logs', 'readonly', (s) => s.getAll())) || [];
    },
    subscribeDayMeta(date, cb) {
      if (!dayMetaListeners.has(date)) dayMetaListeners.set(date, new Set());
      dayMetaListeners.get(date).add(cb);
      emitDayMeta(date);
      return () => {
        const set = dayMetaListeners.get(date);
        if (set) {
          set.delete(cb);
          if (!set.size) dayMetaListeners.delete(date);
        }
      };
    },
    async saveDayMeta(date, data) {
      const clean = {
        trainingDay: Boolean(data?.trainingDay),
        supplements: Array.isArray(data?.supplements) ? data.supplements : [],
      };
      await idbTx(db, 'meta', 'readwrite', (s) => s.put({ key: `daymeta_${date}`, value: clean }));
      await emitDayMeta(date);
      return clean;
    },
    subscribeWeights(cb) {
      weightListeners.add(cb);
      emitWeights();
      return () => weightListeners.delete(cb);
    },
    async saveWeight(date, kg) {
      const clean = Math.round(Number(kg) * 10) / 10;
      if (!(clean > 20 && clean < 300)) throw new Error('Peso inválido');
      await idbTx(db, 'meta', 'readwrite', (s) => s.put({ key: `weight_${date}`, value: clean }));
      await emitWeights();
      return { date, kg: clean };
    },
  };
}

// =========================================================================
// Firebase Firestore backend (when firebase-config.js has real credentials)
// =========================================================================
async function createFirestoreStore(householdCode) {
  const FIREBASE_VER = '11.0.2';
  const [appMod, authMod, fsMod] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VER}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VER}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VER}/firebase-firestore.js`),
  ]);

  const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  if (!auth.currentUser) {
    await authMod.signInAnonymously(auth);
  }
  const db = fsMod.getFirestore(app);
  const itemsCol = () => fsMod.collection(db, 'households', householdCode, 'items');
  const logsCol = () => fsMod.collection(db, 'households', householdCode, 'logs');
  const recipesCol = () => fsMod.collection(db, 'households', householdCode, 'recipes');
  const profileDoc = () => fsMod.doc(db, 'households', householdCode, 'meta', 'profile');

  return {
    mode: 'cloud',
    householdCode,
    subscribeItems(cb) {
      return fsMod.onSnapshot(itemsCol(), (snap) => {
        const items = snap.docs.map((d) => normalizeItem({ ...d.data(), id: d.id }));
        cb(items);
      });
    },
    async saveItem(data) {
      const id = data.id || uid();
      const item = normalizeItem({ ...data, id, updatedAt: Date.now() });
      const { id: _ignore, ...payload } = item;
      await fsMod.setDoc(fsMod.doc(itemsCol(), id), payload);
      return item;
    },
    async deleteItem(id) {
      await fsMod.deleteDoc(fsMod.doc(itemsCol(), id));
    },
    async seedSampleItems() {
      const batch = fsMod.writeBatch(db);
      for (const raw of SAMPLE_ITEMS) {
        const id = uid();
        const item = normalizeItem({ ...raw, id, updatedAt: Date.now() });
        const { id: _ignore, ...payload } = item;
        batch.set(fsMod.doc(itemsCol(), id), payload);
      }
      await batch.commit();
    },
    subscribeProfile(cb) {
      return fsMod.onSnapshot(profileDoc(), (snap) => {
        cb(snap.exists() ? snap.data() : null);
      });
    },
    async saveProfile(profile) {
      await fsMod.setDoc(profileDoc(), profile);
      return profile;
    },
    subscribeLogs(date, cb) {
      const q = fsMod.query(logsCol(), fsMod.where('date', '==', date));
      return fsMod.onSnapshot(q, (snap) => {
        const list = snap.docs
          .map((d) => ({ ...d.data(), id: d.id }))
          .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        cb(list);
      });
    },
    async getLogs(date) {
      const q = fsMod.query(logsCol(), fsMod.where('date', '==', date));
      const snap = await fsMod.getDocs(q);
      return snap.docs
        .map((d) => ({ ...d.data(), id: d.id }))
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    },
    async addLog(entry) {
      const id = entry.id || uid();
      const rec = { ...entry, id, createdAt: entry.createdAt || Date.now() };
      const { id: _ignore, ...payload } = rec;
      await fsMod.setDoc(fsMod.doc(logsCol(), id), payload);
      return rec;
    },
    async deleteLog(id) {
      await fsMod.deleteDoc(fsMod.doc(logsCol(), id));
    },
    subscribeRecipes(cb) {
      return fsMod.onSnapshot(recipesCol(), (snap) => {
        const list = snap.docs
          .map((d) => normalizeRecipe({ ...d.data(), id: d.id }))
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        cb(list);
      });
    },
    async saveRecipe(data) {
      const id = data.id || uid();
      const rec = normalizeRecipe({ ...data, id, updatedAt: Date.now() });
      const { id: _ignore, ...payload } = rec;
      await fsMod.setDoc(fsMod.doc(recipesCol(), id), payload);
      return rec;
    },
    async deleteRecipe(id) {
      await fsMod.deleteDoc(fsMod.doc(recipesCol(), id));
    },
    subscribeWater(date, cb) {
      const docRef = fsMod.doc(db, 'households', householdCode, 'meta', `water_${date}`);
      return fsMod.onSnapshot(docRef, (snap) => {
        cb(snap.exists() ? Number(snap.data()?.ml) || 0 : 0);
      });
    },
    async setWater(date, ml) {
      const clean = Math.max(0, Math.min(10000, Math.round(Number(ml) || 0)));
      const docRef = fsMod.doc(db, 'households', householdCode, 'meta', `water_${date}`);
      await fsMod.setDoc(docRef, { ml: clean, updatedAt: Date.now() });
      return clean;
    },
    async getLoggedDates() {
      const snap = await fsMod.getDocs(logsCol());
      return [...new Set(snap.docs.map((d) => d.data()?.date).filter(Boolean))];
    },
    async getAllLogs() {
      const snap = await fsMod.getDocs(logsCol());
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
    },
    subscribeDayMeta(date, cb) {
      const docRef = fsMod.doc(db, 'households', householdCode, 'meta', `daymeta_${date}`);
      return fsMod.onSnapshot(docRef, (snap) => {
        cb(snap.exists() ? snap.data() : { trainingDay: false, supplements: [] });
      });
    },
    async saveDayMeta(date, data) {
      const clean = {
        trainingDay: Boolean(data?.trainingDay),
        supplements: Array.isArray(data?.supplements) ? data.supplements : [],
      };
      const docRef = fsMod.doc(db, 'households', householdCode, 'meta', `daymeta_${date}`);
      await fsMod.setDoc(docRef, clean);
      return clean;
    },
    subscribeWeights(cb) {
      const col = fsMod.collection(db, 'households', householdCode, 'weights');
      return fsMod.onSnapshot(col, (snap) => {
        const list = snap.docs
          .map((d) => ({ date: d.id, kg: Number(d.data()?.kg) }))
          .filter((r) => r.kg > 0)
          .sort((a, b) => a.date.localeCompare(b.date));
        cb(list);
      });
    },
    async saveWeight(date, kg) {
      const clean = Math.round(Number(kg) * 10) / 10;
      if (!(clean > 20 && clean < 300)) throw new Error('Peso inválido');
      const docRef = fsMod.doc(db, 'households', householdCode, 'weights', date);
      await fsMod.setDoc(docRef, { kg: clean, updatedAt: Date.now() });
      return { date, kg: clean };
    },
  };
}

export async function initStorage() {
  if (isFirebaseConfigured()) {
    try {
      return await createFirestoreStore(getHouseholdCode());
    } catch (err) {
      console.warn('Firebase no disponible, usando modo local (IndexedDB):', err);
    }
  }
  return createLocalStore();
}
