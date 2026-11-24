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


// 0ms Instant Fitness Food Database (USDA / SMAE values per serving)
export const QUICK_FOOD_DB = [
  ...SAMPLE_ITEMS.filter((i) => i.kcal != null),
  { name: 'Claras de huevo', category: 'Lácteos y huevo', unit: 'L', serving: '100 ml (3 claras)', servingsPerUnit: 10, kcal: 52, protein: 11, proteinType: 'animal', carbs: 0.7, carbType: 'simple', fiber: 0, sugar: 0.7, fat: 0.2, satFat: 0, unsatFat: 0.1, sodium: 166 },
  { name: 'Carne molida magra (90/10)', category: 'Proteínas', unit: 'kg', serving: '100 g cruda', servingsPerUnit: 10, kcal: 176, protein: 20, proteinType: 'animal', carbs: 0, carbType: 'complejo', fiber: 0, sugar: 0, fat: 10, satFat: 4, unsatFat: 5, sodium: 66 },
  { name: 'Salmón', category: 'Proteínas', unit: 'kg', serving: '100 g', servingsPerUnit: 10, kcal: 208, protein: 20, proteinType: 'animal', carbs: 0, carbType: 'complejo', fiber: 0, sugar: 0, fat: 13, satFat: 3, unsatFat: 9, sodium: 59 },
  { name: 'Tilapia / Pescado blanco', category: 'Proteínas', unit: 'kg', serving: '100 g', servingsPerUnit: 10, kcal: 96, protein: 20, proteinType: 'animal', carbs: 0, carbType: 'complejo', fiber: 0, sugar: 0, fat: 1.7, satFat: 0.6, unsatFat: 0.9, sodium: 52 },
  { name: 'Pechuga de pavo', category: 'Proteínas', unit: 'paquetes', serving: '3 rebanadas (60 g)', servingsPerUnit: 5, kcal: 62, protein: 12, proteinType: 'animal', carbs: 1.5, carbType: 'simple', fiber: 0, sugar: 1, fat: 0.8, satFat: 0.2, unsatFat: 0.5, sodium: 420 },
  { name: 'Queso panela', category: 'Lácteos y huevo', unit: 'paquetes', serving: '40 g', servingsPerUnit: 10, kcal: 82, protein: 7.5, proteinType: 'animal', carbs: 1, carbType: 'simple', fiber: 0, sugar: 1, fat: 5.4, satFat: 3.4, unsatFat: 1.8, sodium: 160 },
  { name: 'Queso cottage', category: 'Lácteos y huevo', unit: 'botes', serving: '100 g', servingsPerUnit: 4, kcal: 98, protein: 11, proteinType: 'animal', carbs: 3.4, carbType: 'simple', fiber: 0, sugar: 2.7, fat: 4.3, satFat: 1.7, unsatFat: 2, sodium: 364 },
  { name: 'Leche deslactosada light', category: 'Lácteos y huevo', unit: 'L', serving: '1 vaso (250 ml)', servingsPerUnit: 4, kcal: 95, protein: 8, proteinType: 'animal', carbs: 12, carbType: 'simple', fiber: 0, sugar: 12, fat: 1.5, satFat: 1, unsatFat: 0.5, sodium: 125 },
  { name: 'Tofu firme', category: 'Proteínas', unit: 'paquetes', serving: '100 g', servingsPerUnit: 4, kcal: 144, protein: 17, proteinType: 'vegetal', carbs: 3, carbType: 'complejo', fiber: 2, sugar: 0.6, fat: 8.7, satFat: 1.3, unsatFat: 7, sodium: 14 },
  { name: 'Lentejas', category: 'Carbohidratos', unit: 'kg', serving: '50 g crudas', servingsPerUnit: 20, kcal: 176, protein: 12, proteinType: 'vegetal', carbs: 30, carbType: 'complejo', fiber: 5.5, sugar: 1, fat: 0.6, satFat: 0.1, unsatFat: 0.4, sodium: 3 },
  { name: 'Frijol negro', category: 'Carbohidratos', unit: 'kg', serving: '50 g crudo', servingsPerUnit: 20, kcal: 170, protein: 10.8, proteinType: 'vegetal', carbs: 31, carbType: 'complejo', fiber: 7.5, sugar: 1, fat: 0.7, satFat: 0.2, unsatFat: 0.4, sodium: 5 },
  { name: 'Camote', category: 'Carbohidratos', unit: 'kg', serving: '150 g', servingsPerUnit: 6.6, kcal: 129, protein: 2.4, proteinType: 'vegetal', carbs: 30, carbType: 'complejo', fiber: 4.5, sugar: 6, fat: 0.2, satFat: 0, unsatFat: 0.1, sodium: 82 },
  { name: 'Papa', category: 'Carbohidratos', unit: 'kg', serving: '150 g', servingsPerUnit: 6.6, kcal: 116, protein: 3, proteinType: 'vegetal', carbs: 26, carbType: 'complejo', fiber: 3.3, sugar: 1.2, fat: 0.2, satFat: 0, unsatFat: 0.1, sodium: 9 },
  { name: 'Tortilla de maíz', category: 'Carbohidratos', unit: 'kg', serving: '2 piezas (60 g)', servingsPerUnit: 16, kcal: 128, protein: 3.4, proteinType: 'vegetal', carbs: 27, carbType: 'complejo', fiber: 3.8, sugar: 0.5, fat: 1.6, satFat: 0.2, unsatFat: 1.2, sodium: 26 },
  { name: 'Pan integral', category: 'Carbohidratos', unit: 'paquetes', serving: '2 rebanadas (56 g)', servingsPerUnit: 12, kcal: 140, protein: 6, proteinType: 'vegetal', carbs: 24, carbType: 'complejo', fiber: 4, sugar: 3, fat: 2, satFat: 0.4, unsatFat: 1.4, sodium: 230 },
  { name: 'Pasta integral', category: 'Carbohidratos', unit: 'paquetes', serving: '80 g cruda', servingsPerUnit: 6.2, kcal: 280, protein: 11, proteinType: 'vegetal', carbs: 56, carbType: 'complejo', fiber: 6.5, sugar: 2, fat: 2, satFat: 0.4, unsatFat: 1.4, sodium: 10 },
  { name: 'Manzana', category: 'Frutas y verduras', unit: 'pzas', serving: '1 pieza mediana', servingsPerUnit: 1, kcal: 95, protein: 0.5, proteinType: 'vegetal', carbs: 25, carbType: 'simple', fiber: 4.4, sugar: 19, fat: 0.3, satFat: 0.1, unsatFat: 0.1, sodium: 2 },
  { name: 'Fresas', category: 'Frutas y verduras', unit: 'kg', serving: '150 g', servingsPerUnit: 6.6, kcal: 48, protein: 1, proteinType: 'vegetal', carbs: 11.5, carbType: 'fibroso', fiber: 3, sugar: 7.3, fat: 0.4, satFat: 0, unsatFat: 0.3, sodium: 2 },
  { name: 'Espinaca', category: 'Frutas y verduras', unit: 'paquetes', serving: '100 g', servingsPerUnit: 3, kcal: 23, protein: 2.9, proteinType: 'vegetal', carbs: 3.6, carbType: 'fibroso', fiber: 2.2, sugar: 0.4, fat: 0.4, satFat: 0.1, unsatFat: 0.2, sodium: 79 },
  { name: 'Almendras', category: 'Grasas saludables', unit: 'botes', serving: '30 g (23 almendras)', servingsPerUnit: 16, kcal: 173, protein: 6.3, proteinType: 'vegetal', carbs: 6.5, carbType: 'fibroso', fiber: 3.8, sugar: 1.3, fat: 15, satFat: 1.1, unsatFat: 13.2, sodium: 0 },
  { name: 'Aceite de oliva extra virgen', category: 'Grasas saludables', unit: 'botellas', serving: '1 cda (14 g)', servingsPerUnit: 50, kcal: 119, protein: 0, proteinType: 'vegetal', carbs: 0, carbType: 'simple', fiber: 0, sugar: 0, fat: 13.5, satFat: 1.9, unsatFat: 11.4, sodium: 0 },
];
