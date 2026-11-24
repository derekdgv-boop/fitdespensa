// ai.js — Gemini REST client for FitDespensa:
// 1) Product photo recognition (structured JSON output)
// 2) Fitness & pantry Coach IA with function calling (read & mutate inventory/log)
import { CATEGORY_NAMES, MEAL_IDS, UNITS } from './constants.js';
import { DEFAULT_GEMINI_MODEL } from './firebase-config.js?v=7';

const KEY_STORAGE = 'fitdespensa_gemini_key';
const MODEL_STORAGE = 'fitdespensa_gemini_model';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEPRECATED_MODELS = new Set(['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']);

export function getGeminiConfig() {
  let savedModel = (localStorage.getItem(MODEL_STORAGE) || '').trim().replace(/^models\//, '');
  if (!savedModel || DEPRECATED_MODELS.has(savedModel)) {
    savedModel = DEFAULT_GEMINI_MODEL;
    localStorage.setItem(MODEL_STORAGE, savedModel);
  }
  return {
    apiKey: (localStorage.getItem(KEY_STORAGE) || '').trim(),
    model: savedModel,
  };
}

export function setGeminiConfig({ apiKey, model }) {
  if (apiKey !== undefined) {
    const clean = String(apiKey).trim();
    if (clean) localStorage.setItem(KEY_STORAGE, clean);
    else localStorage.removeItem(KEY_STORAGE);
  }
  if (model !== undefined) {
    const cleanModel = String(model).trim();
    if (cleanModel) localStorage.setItem(MODEL_STORAGE, cleanModel);
    else localStorage.removeItem(MODEL_STORAGE);
  }
}

export const hasGeminiKey = () => Boolean(getGeminiConfig().apiKey);

async function callGemini(body) {
  const { apiKey, model } = getGeminiConfig();
  if (!apiKey) {
    throw new Error('Configura tu API key de Gemini en Ajustes para usar la IA.');
  }
  const cleanModel = model.replace(/^models\//, '');
  const url = `${API_BASE}/${encodeURIComponent(cleanModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `Error ${res.status} al consultar Gemini`;
    throw new Error(msg);
  }
  return data;
}

export async function testGeminiConnection() {
  const res = await callGemini({
    contents: [{ role: 'user', parts: [{ text: 'Responde solo OK' }] }],
  });
  const candidate = res?.candidates?.[0];
  if (!candidate) {
    throw new Error('Respuesta vacía de Gemini. Revisa el modelo seleccionado.');
  }
  return true;
}

export async function listGeminiModels() {
  const { apiKey } = getGeminiConfig();
  if (!apiKey) throw new Error('Primero pega tu API key de Gemini.');
  const res = await fetch(`${API_BASE}?key=${encodeURIComponent(apiKey)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `Error ${res.status} al listar modelos`);
  }
  return (data.models || [])
    .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
    .map((m) => String(m.name || '').replace(/^models\//, ''))
    .filter((name) => name.includes('gemini'));
}

// =========================================================================
// 1) Product photo scanner
// =========================================================================
const PRODUCT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING', description: 'Nombre claro y corto del producto en español' },
    category: { type: 'STRING', enum: CATEGORY_NAMES },
    unit: { type: 'STRING', enum: UNITS },
    serving: { type: 'STRING', description: 'Descripción de 1 porción, ej. "1 scoop (30 g)" o "100 g"' },
    servingsPerUnit: { type: 'NUMBER', description: 'Cantidad aproximada de porciones por unidad/envase' },
    kcal: { type: 'NUMBER', description: 'Calorías por porción' },
    protein: { type: 'NUMBER', description: 'Gramos de proteína por porción' },
    carbs: { type: 'NUMBER', description: 'Gramos de carbohidratos por porción' },
    fat: { type: 'NUMBER', description: 'Gramos de grasa por porción' },
  },
  required: ['name', 'category', 'unit'],
};

export async function recognizeProduct(photoDataUrl) {
  const match = String(photoDataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) throw new Error('Foto inválida para analizar.');

  const [, mimeType, data] = match;
  const prompt = [
    'Analiza esta foto de un producto de despensa o alimento (puede ser el envase, el alimento o su tabla nutrimental).',
    'Devuelve sus datos en español para un inventario fitness.',
    'Si se ve la tabla nutrimental, úsala con precisión; si no, estima valores estándar realistas por porción.',
    'Si es un artículo de limpieza/hogar (no comestible), deja kcal/protein/carbs/fat en 0 y servingsPerUnit en 1.',
  ].join(' ');

  const res = await callGemini({
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data } },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: PRODUCT_SCHEMA,
      temperature: 0.2,
    },
  });

  const text = res?.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;
  if (!text) throw new Error('Gemini no devolvió datos del producto.');
  return JSON.parse(text);
}

// =========================================================================
// 2) Coach IA with function calling
// =========================================================================
const COACH_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'get_inventory',
        description: 'Obtiene todos los artículos actuales de la despensa con cantidad, mínimo, unidad, estado y macros por porción.',
      },
      {
        name: 'get_shopping_list',
        description: 'Obtiene los artículos agotados, por acabarse o marcados para comprar, con cantidad sugerida.',
      },
      {
        name: 'get_profile_and_today',
        description: 'Obtiene el perfil fitness del usuario, sus metas diarias de macros, días de cobertura de proteína en despensa y lo que ha comido hoy.',
      },
      {
        name: 'get_recipes',
        description: 'Obtiene todas las recetas y comidas guardadas del usuario con sus macros e ingredientes.',
      },
      {
        name: 'save_recipe',
        description: 'Guarda una comida ya hecha o una receta recomendada en "Mis Recetas" para poder registrarla después con 1 toque.',
        parameters: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING', description: 'Nombre atractivo y claro de la receta' },
            meal: { type: 'STRING', enum: MEAL_IDS, description: 'Momento ideal del día' },
            kcal: { type: 'NUMBER', description: 'Calorías totales por porción' },
            protein: { type: 'NUMBER', description: 'Gramos de proteína por porción' },
            carbs: { type: 'NUMBER', description: 'Gramos de carbohidratos por porción' },
            fat: { type: 'NUMBER', description: 'Gramos de grasa por porción' },
            ingredients: {
              type: 'ARRAY',
              items: { type: 'STRING' },
              description: 'Lista corta de ingredientes con cantidades (ej. "150 g pechuga de pollo", "1 taza arroz")',
            },
            steps: { type: 'STRING', description: 'Preparación breve en 2-4 líneas' },
            attachChatPhoto: { type: 'BOOLEAN', description: 'True si el usuario adjuntó una foto de este platillo en este mensaje' },
          },
          required: ['name', 'kcal', 'protein'],
        },
      },
      {
        name: 'log_recipe',
        description: 'Registra en el diario de hoy una receta ya guardada en "Mis Recetas".',
        parameters: {
          type: 'OBJECT',
          properties: {
            recipeName: { type: 'STRING', description: 'Nombre de la receta guardada' },
            servings: { type: 'NUMBER', description: 'Número de porciones (default 1)' },
            meal: { type: 'STRING', enum: MEAL_IDS },
          },
          required: ['recipeName'],
        },
      },
      {
        name: 'add_item',
        description: 'Agrega un nuevo producto al inventario de la despensa.',
        parameters: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING' },
            category: { type: 'STRING', enum: CATEGORY_NAMES },
            unit: { type: 'STRING', enum: UNITS },
            qty: { type: 'NUMBER' },
            min: { type: 'NUMBER' },
            serving: { type: 'STRING' },
            servingsPerUnit: { type: 'NUMBER' },
            kcal: { type: 'NUMBER' },
            protein: { type: 'NUMBER' },
            carbs: { type: 'NUMBER' },
            fat: { type: 'NUMBER' },
            attachChatPhoto: { type: 'BOOLEAN', description: 'True si el usuario envió foto de este producto' },
          },
          required: ['name', 'qty'],
        },
      },
      {
        name: 'update_quantity',
        description: 'Actualiza la cantidad de un artículo existente en la despensa (sumando/restando delta o fijando nueva cantidad).',
        parameters: {
          type: 'OBJECT',
          properties: {
            itemName: { type: 'STRING', description: 'Nombre del artículo en la despensa' },
            delta: { type: 'NUMBER', description: 'Cambio relativo en unidades del artículo (ej. -3 o +2)' },
            setQty: { type: 'NUMBER', description: 'Cantidad exacta nueva (alternativa a delta)' },
          },
          required: ['itemName'],
        },
      },
      {
        name: 'set_minimum',
        description: 'Cambia el mínimo de alerta de un artículo para saber cuándo volver a comprarlo.',
        parameters: {
          type: 'OBJECT',
          properties: {
            itemName: { type: 'STRING' },
            min: { type: 'NUMBER' },
          },
          required: ['itemName', 'min'],
        },
      },
      {
        name: 'log_food',
        description: 'Registra una comida en el diario de hoy. Si el producto existe en la despensa, descuenta automáticamente las porciones del inventario.',
        parameters: {
          type: 'OBJECT',
          properties: {
            itemName: { type: 'STRING', description: 'Nombre del alimento o producto de la despensa' },
            servings: { type: 'NUMBER', description: 'Número de porciones consumidas (ej. 1, 2, 1.5)' },
            meal: { type: 'STRING', enum: MEAL_IDS, description: 'Momento del día' },
            deductInventory: { type: 'BOOLEAN', description: 'Si descontar de la despensa (default true)' },
            kcal: { type: 'NUMBER', description: 'Solo si el alimento no está en despensa' },
            protein: { type: 'NUMBER', description: 'Solo si el alimento no está en despensa' },
            carbs: { type: 'NUMBER', description: 'Solo si el alimento no está en despensa' },
            fat: { type: 'NUMBER', description: 'Solo si el alimento no está en despensa' },
          },
          required: ['itemName', 'servings'],
        },
      },
    ],
  },
];

const SYSTEM_INSTRUCTION = {
  parts: [
    {
      text: [
        'Eres el Coach IA de FitDespensa: un asistente conversacional súper fácil de usar para nutrición fitness, despensa y recetas en español.',
        'Tu objetivo es que el usuario NO tenga que llenar formularios: tú haces el trabajo por él usando tus herramientas.',
        'Reglas clave:',
        '1. Si el usuario manda una FOTO de un platillo o comida preparada: identifica el platillo, estima sus macros realistas (kcal, proteína, carbs, grasas) y regístralo con log_food; si pide guardarlo como receta (o es un buen platillo casero), ofrécele guardarlo o usa save_recipe con attachChatPhoto=true.',
        '2. Si el usuario manda una FOTO de un producto empaquetado o despensa: extrae nombre, categoría, unidad y macros, y agrégalo con add_item (attachChatPhoto=true).',
        '3. Si el usuario dice qué comió (ej. "comí 3 huevos con avena", "me comí mi receta de pollo"): usa log_food (o log_recipe si coincide con una receta guardada). Si dice que compró algo, usa update_quantity o add_item.',
        '4. Si el usuario pide ideas de comida, consulta primero get_inventory, get_profile_and_today y get_recipes. Nunca inventes productos que no tiene. Al final pregunta brevemente si quiere guardar la idea en "Mis Recetas" o registrarla.',
        '5. Sé cercano, directo, claro y breve (usa negritas y viñetas cortas). No des diagnósticos médicos.',
      ].join('\n'),
    },
  ],
};

/**
 * Runs a conversational turn (text + optional compressed JPEG photo) with function-calling loop.
 * `history` is an array of Gemini content objects ({ role, parts }).
 * `executor(name, args)` returns { result, action? }.
 */
export async function runCoachTurn(history, userText, executor, photoDataUrl = null) {
  const userParts = [];
  if (userText) userParts.push({ text: userText });
  if (photoDataUrl) {
    const match = String(photoDataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (match) {
      userParts.push({ inlineData: { mimeType: match[1], data: match[2] } });
      if (!userText) {
        userParts.unshift({
          text: 'Analiza esta foto: si es un platillo/comida lista, estima sus macros y pregúntame o regístrala; si es un producto de despensa, agrégalo a mi inventario.',
        });
      }
    }
  }

  const contents = [...history, { role: 'user', parts: userParts }];
  const actions = [];

  for (let step = 0; step < 6; step++) {
    const res = await callGemini({
      systemInstruction: SYSTEM_INSTRUCTION,
      contents,
      tools: COACH_TOOLS,
      generationConfig: { temperature: 0.4 },
    });

    const candidate = res?.candidates?.[0];
    const modelContent = candidate?.content;
    if (!modelContent?.parts?.length) {
      throw new Error('El coach no pudo generar una respuesta.');
    }

    contents.push(modelContent);

    const calls = modelContent.parts.filter((p) => p.functionCall);
    if (!calls.length) {
      const replyText = modelContent.parts
        .filter((p) => p.text && !p.thought)
        .map((p) => p.text)
        .join('\n')
        .trim();
      return { text: replyText || 'Listo.', actions, history: contents };
    }

    const responseParts = [];
    for (const part of calls) {
      const { name, args } = part.functionCall;
      let outcome;
      try {
        outcome = await executor(name, args || {});
      } catch (err) {
        outcome = { result: { ok: false, error: err.message || String(err) } };
      }
      if (outcome?.action) actions.push(outcome.action);
      responseParts.push({
        functionResponse: {
          name,
          response: outcome?.result ?? { ok: true },
        },
      });
    }

    contents.push({ role: 'user', parts: responseParts });
  }

  return {
    text: 'Se realizaron varias acciones. ¿Necesitas algo más?',
    actions,
    history: contents,
  };
}
