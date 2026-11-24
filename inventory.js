// inventory.js — pure inventory rules (no DOM).
import { CATEGORIES, CATEGORY_NAMES, LEGACY_CATEGORIES, UNITS } from './constants.js';

export const STATUS_LABEL = { out: 'Agotado', low: 'Por acabarse', ok: 'Suficiente' };
const STATUS_ORDER = { out: 0, low: 1, ok: 2 };

export const round = (n, decimals = 2) => {
  const f = 10 ** decimals;
  return Math.round((Number(n) || 0) * f) / f;
};
export const stepFor = (unit) => (unit === 'kg' || unit === 'L' ? 0.5 : unit === 'g' || unit === 'ml' ? 100 : 1);
export const statusOf = (it) => (it.qty <= 0 ? 'out' : it.qty <= it.min ? 'low' : 'ok');
export const inShoppingList = (it) => statusOf(it) !== 'ok' || Boolean(it.needBuy);
// Suggest buying back up to twice the minimum (at least one step).
export const toBuy = (it) => round(Math.max(stepFor(it.unit), it.min * 2 - it.qty));
export const sortItems = (a, b) =>
  STATUS_ORDER[statusOf(a)] - STATUS_ORDER[statusOf(b)] || a.name.localeCompare(b.name, 'es');
export const catIcon = (name) => (CATEGORIES.find((c) => c.name === name) || CATEGORIES[CATEGORIES.length - 1]).icon;
export const isFood = (it) => (CATEGORIES.find((c) => c.name === it.category) || { food: true }).food;
export const normText = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const numOrNull = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Math.max(0, Number(v)));

export function normalizeItem(it) {
  const category = LEGACY_CATEGORIES[it.category] || it.category;
  return {
    ...it,
    name: String(it.name ?? '').trim().slice(0, 60) || 'Sin nombre',
    category: CATEGORY_NAMES.includes(category) ? category : 'Despensa',
    unit: UNITS.includes(it.unit) ? it.unit : 'pzas',
    qty: Math.max(0, round(it.qty, 4)),
    min: Math.max(0, round(it.min, 4)),
    serving: it.serving ? String(it.serving).trim().slice(0, 40) : '',
    servingsPerUnit: numOrNull(it.servingsPerUnit),
    kcal: numOrNull(it.kcal),
    protein: numOrNull(it.protein),
    carbs: numOrNull(it.carbs),
    fat: numOrNull(it.fat),
    photo: typeof it.photo === 'string' && it.photo.startsWith('data:image/') ? it.photo : null,
    needBuy: Boolean(it.needBuy),
  };
}
