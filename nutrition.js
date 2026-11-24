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

/** Daily targets: Mifflin-St Jeor BMR × activity × goal factor; custom values override. */
export function calcTargets(p) {
  if (!isProfileComplete(p)) return null;
  const act = ACTIVITY_LEVELS.find((a) => a.id === p.activity) || ACTIVITY_LEVELS[2];
  const goal = GOALS.find((g) => g.id === p.goal) || GOALS[1];
  const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === 'h' ? 5 : -161);
  const tdee = bmr * act.factor;
  const kcal = Math.round((tdee * goal.kcalFactor) / 10) * 10;
  const protein = Math.round(p.weight * goal.proteinPerKg);
  const fat = Math.round(Math.max(p.weight * 0.8, (kcal * 0.25) / 9));
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  const auto = { kcal, protein, carbs, fat, bmr: Math.round(bmr), tdee: Math.round(tdee) };
  const c = p.custom || {};
  const pick = (k) => (Number(c[k]) > 0 ? Number(c[k]) : auto[k]);
  return { kcal: pick('kcal'), protein: pick('protein'), carbs: pick('carbs'), fat: pick('fat'), auto, goal };
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
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  entries.forEach((e) => MACROS.forEach((m) => { t[m] += Number(e[m]) || 0; }));
  MACROS.forEach((m) => { t[m] = round(t[m], 1); });
  return t;
}

/** Eating `servings` of an item: macros eaten and inventory units used. */
export function consumeFromItem(item, servings) {
  const perUnit = Number(item.servingsPerUnit) > 0 ? Number(item.servingsPerUnit) : 1;
  const unitsUsed = round(servings / perUnit, 4);
  const macros = Object.fromEntries(MACROS.map((m) => [m, round(servings * (Number(item[m]) || 0), 1)]));
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
