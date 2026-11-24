// constants.js — shared catalog definitions.

export const CATEGORIES = [
  { name: 'Proteínas', icon: '🥩', food: true },
  { name: 'Lácteos y huevo', icon: '🥚', food: true },
  { name: 'Carbohidratos', icon: '🍚', food: true },
  { name: 'Frutas y verduras', icon: '🥦', food: true },
  { name: 'Grasas saludables', icon: '🥑', food: true },
  { name: 'Suplementos', icon: '💊', food: true },
  { name: 'Snacks fit', icon: '🍫', food: true },
  { name: 'Bebidas', icon: '🥤', food: true },
  { name: 'Despensa', icon: '🥫', food: true },
  { name: 'Hogar y limpieza', icon: '🧽', food: false },
];
export const CATEGORY_NAMES = CATEGORIES.map((c) => c.name);

// Categories used by the first version of the app.
export const LEGACY_CATEGORIES = {
  Refrigerador: 'Lácteos y huevo',
  Carnes: 'Proteínas',
  Limpieza: 'Hogar y limpieza',
  Higiene: 'Hogar y limpieza',
  Hogar: 'Hogar y limpieza',
  Comida: 'Despensa',
  Otros: 'Despensa',
};

export const UNITS = ['pzas', 'kg', 'g', 'L', 'ml', 'paquetes', 'latas', 'botellas', 'botes', 'rollos'];

export const MEALS = [
  { id: 'desayuno', label: 'Desayuno', icon: '🌅' },
  { id: 'comida', label: 'Comida', icon: '🍽️' },
  { id: 'cena', label: 'Cena', icon: '🌙' },
  { id: 'snack', label: 'Snack', icon: '🍎' },
  { id: 'entreno', label: 'Pre/Post entreno', icon: '🏋️' },
];
export const MEAL_IDS = MEALS.map((m) => m.id);

// Nutrition values are per serving.
export const SAMPLE_ITEMS = [
  { name: 'Pechuga de pollo', category: 'Proteínas', unit: 'kg', qty: 1.5, min: 1, serving: '100 g', servingsPerUnit: 10, kcal: 165, protein: 31, carbs: 0, fat: 3.6 },
  { name: 'Huevo', category: 'Lácteos y huevo', unit: 'pzas', qty: 8, min: 6, serving: '1 pieza', servingsPerUnit: 1, kcal: 72, protein: 6.3, carbs: 0.4, fat: 4.8 },
  { name: 'Proteína whey', category: 'Suplementos', unit: 'botes', qty: 0.2, min: 0.25, serving: '1 scoop (30 g)', servingsPerUnit: 33, kcal: 120, protein: 24, carbs: 3, fat: 1.5 },
  { name: 'Yogur griego natural', category: 'Lácteos y huevo', unit: 'botes', qty: 1, min: 1, serving: '170 g', servingsPerUnit: 5.9, kcal: 100, protein: 17, carbs: 6, fat: 0.7 },
  { name: 'Atún en agua', category: 'Proteínas', unit: 'latas', qty: 4, min: 3, serving: '1 lata (140 g)', servingsPerUnit: 1, kcal: 130, protein: 28, carbs: 0, fat: 1 },
  { name: 'Avena', category: 'Carbohidratos', unit: 'kg', qty: 0.8, min: 0.5, serving: '40 g', servingsPerUnit: 25, kcal: 150, protein: 5, carbs: 27, fat: 2.5 },
  { name: 'Arroz integral', category: 'Carbohidratos', unit: 'kg', qty: 2, min: 1, serving: '50 g crudo', servingsPerUnit: 20, kcal: 180, protein: 4, carbs: 38, fat: 1.4 },
  { name: 'Plátano', category: 'Frutas y verduras', unit: 'pzas', qty: 0, min: 3, serving: '1 pieza', servingsPerUnit: 1, kcal: 105, protein: 1.3, carbs: 27, fat: 0.4 },
  { name: 'Brócoli', category: 'Frutas y verduras', unit: 'kg', qty: 0.5, min: 0.5, serving: '100 g', servingsPerUnit: 10, kcal: 34, protein: 2.8, carbs: 7, fat: 0.4 },
  { name: 'Aguacate', category: 'Grasas saludables', unit: 'pzas', qty: 3, min: 2, serving: '1/2 pieza', servingsPerUnit: 2, kcal: 120, protein: 1.5, carbs: 6, fat: 11 },
  { name: 'Crema de cacahuate', category: 'Grasas saludables', unit: 'botes', qty: 1, min: 0.25, serving: '2 cdas (32 g)', servingsPerUnit: 14, kcal: 190, protein: 8, carbs: 7, fat: 16 },
  { name: 'Creatina monohidratada', category: 'Suplementos', unit: 'botes', qty: 1, min: 0.2, serving: '5 g', servingsPerUnit: 60, kcal: 0, protein: 0, carbs: 0, fat: 0 },
  { name: 'Papel higiénico', category: 'Hogar y limpieza', unit: 'rollos', qty: 6, min: 4 },
];
