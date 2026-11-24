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

export const PROTEIN_TYPES = [
  { id: 'animal', label: 'Animal' },
  { id: 'vegetal', label: 'Vegetal' },
  { id: 'suplemento', label: 'Suplemento' },
];

export const CARB_TYPES = [
  { id: 'complejo', label: 'Complejos' },
  { id: 'simple', label: 'Simples / Azúcares' },
  { id: 'fibroso', label: 'Fibrosos (verduras)' },
];

// Nutrition values are per serving (including detailed macro subtypes).
export const SAMPLE_ITEMS = [
  { name: 'Pechuga de pollo', category: 'Proteínas', unit: 'kg', qty: 1.5, min: 1, serving: '100 g', servingsPerUnit: 10, kcal: 165, protein: 31, proteinType: 'animal', carbs: 0, carbType: 'complejo', fiber: 0, sugar: 0, fat: 3.6, satFat: 1, unsatFat: 2.2, sodium: 74 },
  { name: 'Huevo', category: 'Lácteos y huevo', unit: 'pzas', qty: 8, min: 6, serving: '1 pieza', servingsPerUnit: 1, kcal: 72, protein: 6.3, proteinType: 'animal', carbs: 0.4, carbType: 'simple', fiber: 0, sugar: 0.2, fat: 4.8, satFat: 1.6, unsatFat: 2.7, sodium: 71 },
  { name: 'Proteína whey', category: 'Suplementos', unit: 'botes', qty: 0.2, min: 0.25, serving: '1 scoop (30 g)', servingsPerUnit: 33, kcal: 120, protein: 24, proteinType: 'suplemento', carbs: 3, carbType: 'simple', fiber: 0, sugar: 1, fat: 1.5, satFat: 0.5, unsatFat: 0.8, sodium: 130 },
  { name: 'Yogur griego natural', category: 'Lácteos y huevo', unit: 'botes', qty: 1, min: 1, serving: '170 g', servingsPerUnit: 5.9, kcal: 100, protein: 17, proteinType: 'animal', carbs: 6, carbType: 'simple', fiber: 0, sugar: 6, fat: 0.7, satFat: 0.4, unsatFat: 0.2, sodium: 60 },
  { name: 'Atún en agua', category: 'Proteínas', unit: 'latas', qty: 4, min: 3, serving: '1 lata (140 g)', servingsPerUnit: 1, kcal: 130, protein: 28, proteinType: 'animal', carbs: 0, carbType: 'complejo', fiber: 0, sugar: 0, fat: 1, satFat: 0.2, unsatFat: 0.6, sodium: 320 },
  { name: 'Avena', category: 'Carbohidratos', unit: 'kg', qty: 0.8, min: 0.5, serving: '40 g', servingsPerUnit: 25, kcal: 150, protein: 5, proteinType: 'vegetal', carbs: 27, carbType: 'complejo', fiber: 4, sugar: 1, fat: 2.5, satFat: 0.5, unsatFat: 1.8, sodium: 2 },
  { name: 'Arroz integral', category: 'Carbohidratos', unit: 'kg', qty: 2, min: 1, serving: '50 g crudo', servingsPerUnit: 20, kcal: 180, protein: 4, proteinType: 'vegetal', carbs: 38, carbType: 'complejo', fiber: 2, sugar: 0.4, fat: 1.4, satFat: 0.3, unsatFat: 1, sodium: 3 },
  { name: 'Plátano', category: 'Frutas y verduras', unit: 'pzas', qty: 0, min: 3, serving: '1 pieza', servingsPerUnit: 1, kcal: 105, protein: 1.3, proteinType: 'vegetal', carbs: 27, carbType: 'simple', fiber: 3.1, sugar: 14, fat: 0.4, satFat: 0.1, unsatFat: 0.2, sodium: 1 },
  { name: 'Brócoli', category: 'Frutas y verduras', unit: 'kg', qty: 0.5, min: 0.5, serving: '100 g', servingsPerUnit: 10, kcal: 34, protein: 2.8, proteinType: 'vegetal', carbs: 7, carbType: 'fibroso', fiber: 2.6, sugar: 1.7, fat: 0.4, satFat: 0.1, unsatFat: 0.2, sodium: 33 },
  { name: 'Aguacate', category: 'Grasas saludables', unit: 'pzas', qty: 3, min: 2, serving: '1/2 pieza', servingsPerUnit: 2, kcal: 120, protein: 1.5, proteinType: 'vegetal', carbs: 6, carbType: 'fibroso', fiber: 5, sugar: 0.5, fat: 11, satFat: 1.6, unsatFat: 8.8, sodium: 5 },
  { name: 'Crema de cacahuate', category: 'Grasas saludables', unit: 'botes', qty: 1, min: 0.25, serving: '2 cdas (32 g)', servingsPerUnit: 14, kcal: 190, protein: 8, proteinType: 'vegetal', carbs: 7, carbType: 'complejo', fiber: 2, sugar: 2, fat: 16, satFat: 3, unsatFat: 12, sodium: 120 },
  { name: 'Creatina monohidratada', category: 'Suplementos', unit: 'botes', qty: 1, min: 0.2, serving: '5 g', servingsPerUnit: 60, kcal: 0, protein: 0, proteinType: 'suplemento', carbs: 0, carbType: 'simple', fiber: 0, sugar: 0, fat: 0, satFat: 0, unsatFat: 0, sodium: 0 },
  { name: 'Papel higiénico', category: 'Hogar y limpieza', unit: 'rollos', qty: 6, min: 4 },
];
