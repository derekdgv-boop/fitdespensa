// nutrition.js — targets, pantry totals and food-log math (no DOM).
import { isFood, round } from './inventory.js';

export const MACROS = ['kcal', 'protein', 'carbs', 'fat'];
export const MACRO_INFO = {
  kcal: { label: 'Calorías', short: 'kcal', unit: 'kcal' },
  protein: { label: 'Proteína', short: 'P', unit: 'g' },
  carbs: { label: 'Carbohidratos', short: 'C', unit: 'g' },
  fat: { label: 'Grasas', short: 'G', unit: 'g' },
};

export const ACTIVITY_LEVELS = [
  { id: 'sedentario', label: 'Sedentario (poco o nada de ejercicio)', factor: 1.2 },
  { id: 'ligero', label: 'Ligero (1–3 días/semana)', factor: 1.375 },
  { id: 'moderado', label: 'Moderado (3–5 días/semana)', factor: 1.55 },
  { id: 'intenso', label: 'Intenso (6–7 días/semana)', factor: 1.725 },
  { id: 'atleta', label: 'Atleta (doble sesión)', factor: 1.9 },
];

export const GOALS = [
  { id: 'definicion', label: 'Definición', emoji: '🔥', kcalFactor: 0.8, proteinPerKg: 2.2 },
  { id: 'mantenimiento', label: 'Mantenimiento', emoji: '⚖️', kcalFactor: 1, proteinPerKg: 1.8 },
  { id: 'volumen', label: 'Volumen', emoji: '💪', kcalFactor: 1.1, proteinPerKg: 2 },
];

export const isProfileComplete = (p) =>
  Boolean(p) && p.weight > 0 && p.height > 0 && p.age > 0 && Boolean(p.sex) && Boolean(p.activity) && Boolean(p.goal);

/** Daily targets: Mifflin-St Jeor BMR × activity × goal factor; trainingDay adds +200 kcal (+50g carbs). */
export function calcTargets(p, { trainingDay = false } = {}) {
  if (!isProfileComplete(p)) return null;
  const act = ACTIVITY_LEVELS.find((a) => a.id === p.activity) || ACTIVITY_LEVELS[2];
  const goal = GOALS.find((g) => g.id === p.goal) || GOALS[1];
  const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === 'h' ? 5 : -161);
  const tdee = bmr * act.factor;
  const bonusKcal = trainingDay ? 200 : 0;
  const kcal = Math.round(((tdee * goal.kcalFactor) + bonusKcal) / 10) * 10;
  const protein = Math.round(p.weight * goal.proteinPerKg);
  const fat = Math.round(Math.max(p.weight * 0.8, (kcal * 0.25) / 9));
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  const auto = { kcal, protein, carbs, fat, bmr: Math.round(bmr), tdee: Math.round(tdee) };
  const c = p.custom || {};
  const pick = (k) => (Number(c[k]) > 0 ? Number(c[k]) + (trainingDay && k === 'kcal' ? 200 : trainingDay && k === 'carbs' ? 50 : 0) : auto[k]);
  return { kcal: pick('kcal'), protein: pick('protein'), carbs: pick('carbs'), fat: pick('fat'), auto, goal, trainingDay };
}

/** Dynamic hydration target based on body weight (35 ml/kg + 500 ml on training days), rounded to 250 ml. */
export function waterGoalMl(profile, trainingDay = false) {
  const weight = Number(profile?.weight) > 0 ? Number(profile.weight) : 70;
  const raw = weight * 35 + (trainingDay ? 500 : 0);
  return Math.max(2000, Math.min(5000, Math.round(raw / 250) * 250));
}

export const hasNutrition = (it) =>
  Number(it.servingsPerUnit) > 0 && MACROS.some((m) => it[m] !== null && it[m] !== undefined && it[m] !== '');

/** Macros available in stock (servings in stock × per-serving values). */
export function pantryTotals(items) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, withData: 0, missing: 0 };
  for (const it of items) {
    if (hasNutrition(it)) {
      const servings = it.qty * it.servingsPerUnit;
      MACROS.forEach((m) => { t[m] += servings * (Number(it[m]) || 0); });
      t.withData++;
    } else if (isFood(it)) {
      t.missing++;
    }
  }
  MACROS.forEach((m) => { t[m] = Math.round(t[m]); });
  return t;
}

export function coverageDays(totals, targets) {
  if (!targets) return null;
  return {
    protein: targets.protein > 0 ? totals.protein / targets.protein : null,
    kcal: targets.kcal > 0 ? totals.kcal / targets.kcal : null,
  };
}

export function logTotals(entries) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, satFat: 0, unsatFat: 0, sodium: 0 };
  entries.forEach((e) => {
    Object.keys(t).forEach((k) => { t[k] += Number(e[k]) || 0; });
  });
  Object.keys(t).forEach((k) => { t[k] = round(t[k], 1); });
  return t;
}

/** Detailed breakdown of macro subtypes consumed from daily log entries. */
export function macroSubtypeBreakdown(entries) {
  const b = {
    protein: { animal: 0, vegetal: 0, suplemento: 0 },
    carbs: { complejo: 0, simple: 0, fibroso: 0, fiber: 0, sugar: 0 },
    fat: { unsat: 0, sat: 0 },
    sodium: 0,
  };
  for (const e of entries) {
    const p = Number(e.protein) || 0;
    const pt = ['animal', 'vegetal', 'suplemento'].includes(e.proteinType) ? e.proteinType : 'animal';
    b.protein[pt] += p;

    const c = Number(e.carbs) || 0;
    const ct = ['complejo', 'simple', 'fibroso'].includes(e.carbType) ? e.carbType : 'complejo';
    b.carbs[ct] += c;
    b.carbs.fiber += Number(e.fiber) || 0;
    b.carbs.sugar += Number(e.sugar) || 0;

    const f = Number(e.fat) || 0;
    const sat = Number(e.satFat) || 0;
    const unsat = e.unsatFat != null && e.unsatFat !== '' ? Number(e.unsatFat) || 0 : Math.max(0, f - sat);
    b.fat.sat += sat;
    b.fat.unsat += unsat;

    b.sodium += Number(e.sodium) || 0;
  }
  b.protein.animal = round(b.protein.animal, 1);
  b.protein.vegetal = round(b.protein.vegetal, 1);
  b.protein.suplemento = round(b.protein.suplemento, 1);
  b.carbs.complejo = round(b.carbs.complejo, 1);
  b.carbs.simple = round(b.carbs.simple, 1);
  b.carbs.fibroso = round(b.carbs.fibroso, 1);
  b.carbs.fiber = round(b.carbs.fiber, 1);
  b.carbs.sugar = round(b.carbs.sugar, 1);
  b.fat.sat = round(b.fat.sat, 1);
  b.fat.unsat = round(b.fat.unsat, 1);
  b.sodium = Math.round(b.sodium);
  return b;
}

/** Eating `servings` of an item: macros + subtypes eaten and inventory units used. */
export function consumeFromItem(item, servings) {
  const perUnit = Number(item.servingsPerUnit) > 0 ? Number(item.servingsPerUnit) : 1;
  const unitsUsed = round(servings / perUnit, 4);
  const scale = (k) => round(servings * (Number(item[k]) || 0), 1);
  const macros = {
    kcal: scale('kcal'),
    protein: scale('protein'),
    proteinType: item.proteinType || 'animal',
    carbs: scale('carbs'),
    carbType: item.carbType || 'complejo',
    fiber: scale('fiber'),
    sugar: scale('sugar'),
    fat: scale('fat'),
    satFat: scale('satFat'),
    unsatFat: item.unsatFat != null ? scale('unsatFat') : Math.max(0, round(scale('fat') - scale('satFat'), 1)),
    sodium: Math.round(servings * (Number(item.sodium) || 0)),
  };
  return { unitsUsed, newQty: Math.max(0, round(item.qty - unitsUsed, 4)), macros };
}

// ---------- Dates (local time, YYYY-MM-DD) ----------
const pad = (n) => String(n).padStart(2, '0');
export const todayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return todayStr(new Date(y, m - 1, d + n));
}
export function defaultMeal(date = new Date()) {
  const h = date.getHours();
  return h < 11 ? 'desayuno' : h < 16 ? 'comida' : h < 19 ? 'snack' : 'cena';
}

/** Consecutive days with at least one logged meal (counting up to today or yesterday). */
export function calcStreak(loggedDates, today = todayStr()) {
  const set = new Set(loggedDates || []);
  let streak = 0;
  let cursor = set.has(today) ? today : addDays(today, -1);
  while (set.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** Lookup product nutrition by barcode using Open Food Facts (free, no key needed). */
export async function lookupBarcode(barcode) {
  const clean = String(barcode || '').replace(/\D/g, '');
  if (clean.length < 6) throw new Error('Ingresa un código de barras válido (al menos 6 dígitos).');
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(clean)}.json`);
  if (!res.ok) throw new Error('No se pudo consultar Open Food Facts.');
  const data = await res.json();
  if (data.status !== 1 || !data.product) {
    throw new Error(`Producto no encontrado para el código ${clean}.`);
  }
  const p = data.product;
  const n = p.nutriments || {};
  const hasServ = n['energy-kcal_serving'] != null || n.proteins_serving != null;
  const pick = (k) => (hasServ ? n[`${k}_serving`] : n[`${k}_100g`]);
  const kcal = pick('energy-kcal');
  const protein = pick('proteins');
  const carbs = pick('carbohydrates');
  const fiber = pick('fiber');
  const sugar = pick('sugars');
  const fat = pick('fat');
  const satFat = pick('saturated-fat');
  const sodiumG = pick('sodium');

  const fatNum = fat != null ? round(Number(fat), 1) : null;
  const satNum = satFat != null ? round(Number(satFat), 1) : null;

  return {
    name: p.product_name_es || p.product_name || p.brands || `Producto ${clean}`,
    serving: p.serving_size || (hasServ ? '1 porción' : '100 g'),
    kcal: kcal != null ? Math.round(Number(kcal)) : null,
    protein: protein != null ? round(Number(protein), 1) : null,
    carbs: carbs != null ? round(Number(carbs), 1) : null,
    fiber: fiber != null ? round(Number(fiber), 1) : null,
    sugar: sugar != null ? round(Number(sugar), 1) : null,
    fat: fatNum,
    satFat: satNum,
    unsatFat: fatNum != null && satNum != null ? Math.max(0, round(fatNum - satNum, 1)) : null,
    sodium: sodiumG != null ? Math.round(Number(sodiumG) * 1000) : null,
  };
}
