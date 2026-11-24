// ai.js — Bulletproof Gemini REST client for FitDespensa:
// 1) Automatic full nutrition table recognition from product/label photos
// 2) Structured AI Pantry & Shopping Recommendations (works even on empty pantry)
// 3) Conversational & Multimodal Inventory Coach IA (photo + voice + text)
// Includes automatic model discovery/fallback and resilient JSON parsing.
import { CATEGORY_NAMES, UNITS } from './constants.js?v=14';
import { DEFAULT_GEMINI_MODEL } from './firebase-config.js?v=7';

const KEY_STORAGE = 'fitdespensa_gemini_key';
const MODEL_STORAGE = 'fitdespensa_gemini_model';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEPRECATED_MODELS = new Set(['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']);

const memFallback = { key: '', model: DEFAULT_GEMINI_MODEL };

function safeGet(k) {
  try {
    return localStorage.getItem(k) || '';
  } catch {
    return k === KEY_STORAGE ? memFallback.key : memFallback.model;
  }
}

function safeSet(k, v) {
  if (k === KEY_STORAGE) memFallback.key = v;
  if (k === MODEL_STORAGE) memFallback.model = v;
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {
    // Fallback in memory if browser blocks localStorage
  }
}

/** Extracts a clean Gemini API key even if the user pasted a curl snippet, quotes, or spaces. */
export function sanitizeApiKey(raw) {
  const str = String(raw || '').trim();
  const match = str.match(/AIza[A-Za-z0-9_-]{30,}/);
  if (match) return match[0];
  return str.replace(/^['"`]+|['"`]+$/g, '').replace(/\s+/g, '');
}

export function getGeminiConfig() {
  let savedModel = safeGet(MODEL_STORAGE).trim().replace(/^models\//, '');
  if (!savedModel || DEPRECATED_MODELS.has(savedModel)) {
    savedModel = DEFAULT_GEMINI_MODEL;
    safeSet(MODEL_STORAGE, savedModel);
  }
  return {
    apiKey: sanitizeApiKey(safeGet(KEY_STORAGE)),
    model: savedModel,
  };
}

export function setGeminiConfig({ apiKey, model }) {
  if (apiKey !== undefined) {
    safeSet(KEY_STORAGE, sanitizeApiKey(apiKey));
  }
  if (model !== undefined) {
    const cleanModel = String(model).trim().replace(/^models\//, '');
    safeSet(MODEL_STORAGE, cleanModel);
  }
}

export const hasGeminiKey = () => Boolean(getGeminiConfig().apiKey);

export async function listGeminiModels() {
  const { apiKey } = getGeminiConfig();
  if (!apiKey) throw new Error('Primero pega tu API key de Gemini.');
  const res = await fetch(`${API_BASE}?key=${encodeURIComponent(apiKey)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `Error ${res.status} al validar tu clave en Google`);
  }
  return (data.models || [])
    .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
    .map((m) => String(m.name || '').replace(/^models\//, ''))
    .filter((name) => name.includes('gemini'));
}

function pickBestFlashModel(models, exclude = '') {
  const pool = models.filter((m) => m !== exclude && !DEPRECATED_MODELS.has(m));
  return (
    pool.find((m) => m === 'gemini-3.8-flash') ||
    pool.find((m) => m.includes('3.') && m.includes('flash')) ||
    pool.find((m) => m.includes('flash')) ||
    pool[0] ||
    models[0] ||
    null
  );
}

async function rawGenerate(apiKey, model, body) {
  const cleanModel = model.replace(/^models\//, '');
  const url = `${API_BASE}/${encodeURIComponent(cleanModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function callGemini(body) {
  const { apiKey, model } = getGeminiConfig();
  if (!apiKey) {
    throw new Error('Falta tu API Key de Gemini en este dispositivo/navegador. Ábrela en Ajustes → IA (Gemini).');
  }

  let attempt = await rawGenerate(apiKey, model, body);
  if (!attempt.ok) {
    const errMsg = String(attempt.data?.error?.message || '');
    const isModelError =
      attempt.status === 404 ||
      errMsg.toLowerCase().includes('no longer available') ||
      errMsg.toLowerCase().includes('not found') ||
      errMsg.toLowerCase().includes('not supported');

    if (isModelError) {
      try {
        const available = await listGeminiModels();
        const fallback = pickBestFlashModel(available, model);
        if (fallback && fallback !== model) {
          setGeminiConfig({ model: fallback });
          attempt = await rawGenerate(apiKey, fallback, body);
        }
      } catch {
        // Keep original error if listing models also fails
      }
    }
  }

  if (!attempt.ok) {
    const msg = attempt.data?.error?.message || `Error ${attempt.status} al consultar Gemini`;
    throw new Error(msg);
  }
  return attempt.data;
}

function extractTextFromResponse(res) {
  const parts = res?.candidates?.[0]?.content?.parts || [];
  return parts
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('\n')
    .trim();
}

function parseJsonResponse(res, fallbackError) {
  const raw = extractTextFromResponse(res);
  if (!raw) throw new Error(fallbackError);
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }
    throw new Error('La respuesta de IA no tuvo formato válido. Intenta de nuevo.');
  }
}

export async function connectAndVerifyGemini(rawKey, preferredModel = '') {
  const cleanKey = sanitizeApiKey(rawKey);
  if (!cleanKey) {
    throw new Error('Pega primero tu API Key (empieza con AIza...) en el campo de arriba.');
  }
  setGeminiConfig({ apiKey: cleanKey, model: preferredModel || undefined });

  // 1) List available models for this exact key to pick a guaranteed-valid model
  const models = await listGeminiModels();
  if (!models.length) {
    throw new Error('La clave es válida pero no tiene modelos Gemini habilitados en Google AI Studio.');
  }
  const current = getGeminiConfig().model;
  const chosen = models.includes(current) ? current : pickBestFlashModel(models) || models[0];
  setGeminiConfig({ apiKey: cleanKey, model: chosen });

  // 2) Run a lightweight generation test
  await testGeminiConnection();
  return { apiKey: cleanKey, model: chosen, availableCount: models.length };
}

export async function testGeminiConnection() {
  const res = await callGemini({
    contents: [{ role: 'user', parts: [{ text: 'Responde solo OK' }] }],
  });
  if (!res?.candidates?.[0]) {
    throw new Error('Respuesta vacía de Gemini. Revisa el modelo seleccionado.');
  }
  return true;
}

// =========================================================================
// 1) Product / Nutrition Label Photo Auto-Fill
// =========================================================================
const PRODUCT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING', description: 'Nombre claro y corto del producto en español' },
    category: { type: 'STRING', description: `Categoría exacta de: ${CATEGORY_NAMES.join(', ')}` },
    unit: { type: 'STRING', description: `Unidad exacta de: ${UNITS.join(', ')}` },
    serving: { type: 'STRING', description: 'Descripción de 1 porción, ej. "1 scoop (30 g)" o "100 g"' },
    servingsPerUnit: { type: 'NUMBER', description: 'Cantidad aproximada de porciones por envase/unidad' },
    kcal: { type: 'NUMBER', description: 'Calorías por porción' },
    protein: { type: 'NUMBER', description: 'Gramos de proteína por porción' },
    proteinType: { type: 'STRING', description: 'animal, vegetal o suplemento' },
    carbs: { type: 'NUMBER', description: 'Gramos totales de carbohidratos por porción' },
    carbType: { type: 'STRING', description: 'complejo, simple o fibroso' },
    fiber: { type: 'NUMBER', description: 'Gramos de fibra dietética por porción' },
    sugar: { type: 'NUMBER', description: 'Gramos de azúcares por porción' },
    fat: { type: 'NUMBER', description: 'Gramos totales de grasa por porción' },
    satFat: { type: 'NUMBER', description: 'Gramos de grasa saturada por porción' },
    unsatFat: { type: 'NUMBER', description: 'Gramos de grasas saludables/insaturadas por porción' },
    sodium: { type: 'NUMBER', description: 'Miligramos (mg) de sodio por porción' },
  },
  required: ['name', 'category', 'unit', 'kcal', 'protein', 'carbs', 'fat'],
};

export async function recognizeProduct(photoDataUrl) {
  const match = String(photoDataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) throw new Error('Foto inválida para analizar.');

  const [, mimeType, data] = match;
  const prompt = [
    'Analiza esta foto de un alimento, empaque o tabla nutrimental.',
    'Extrae o estima con alta precisión TODOS los valores de su tabla nutrimental por porción en español:',
    `categoría (elige una de: ${CATEGORY_NAMES.join(', ')}), unidad (elige una de: ${UNITS.join(', ')}),`,
    'calorías, proteína y su tipo (animal/vegetal/suplemento), carbohidratos y su tipo (complejo/simple/fibroso),',
    'fibra, azúcares, grasas totales, grasas saturadas, grasas insaturadas/saludables y sodio (mg).',
    'Si se ve la tabla nutrimental impresa, copia los números exactos. Si es un alimento fresco, usa valores estándar USDA.',
    'Si es un artículo de limpieza/hogar (no comestible), deja todos los macros en 0 y servingsPerUnit en 1.',
  ].join(' ');

  const res = await callGemini({
    contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType, data } }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: PRODUCT_SCHEMA,
      temperature: 0.15,
    },
  });

  return parseJsonResponse(res, 'Gemini no devolvió datos del producto.');
}

// =========================================================================
// 2) Structured AI Inventory Recommendations
// =========================================================================
const RECOMMENDATIONS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    headline: { type: 'STRING', description: 'Diagnóstico breve y motivador de 1 línea sobre la despensa' },
    insights: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          badge: { type: 'STRING' },
          title: { type: 'STRING' },
          detail: { type: 'STRING' },
        },
        required: ['badge', 'title', 'detail'],
      },
    },
    suggestedPurchases: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          category: { type: 'STRING' },
          unit: { type: 'STRING' },
          qty: { type: 'NUMBER' },
          reason: { type: 'STRING' },
        },
        required: ['name', 'category', 'unit', 'qty', 'reason'],
      },
    },
  },
  required: ['headline', 'insights', 'suggestedPurchases'],
};

export async function generatePantryRecommendations({ inventorySummary, focus = 'general' }) {
  const isEmpty = !inventorySummary?.items?.length;
  const focusMap = {
    general: isEmpty
      ? 'La despensa está vacía todavía. Recomienda un kit base ideal de compras fitness según el objetivo del usuario.'
      : 'Analiza el balance general de la despensa, qué se está acabando, calidad de proteínas/carbos/grasas y qué conviene comprar.',
    shopping: 'Enfócate en optimizar la próxima compra del súper según el objetivo fitness (definición/mantenimiento/volumen) y los huecos nutricionales.',
    meals: isEmpty
      ? 'Sugiere 3 combinaciones fitness básicas que podrá preparar en cuanto compre sus básicos de despensa.'
      : 'Recomienda 3 combinaciones rápidas y altas en proteína que se pueden preparar HOY usando únicamente lo que hay con stock > 0, y qué ingrediente clave falta.',
  };

  const prompt = [
    'Eres un experto en nutrición deportiva y gestión inteligente de despensa en español.',
    focusMap[focus] || focusMap.general,
    `Usa categorías de: ${CATEGORY_NAMES.join(', ')} y unidades de: ${UNITS.join(', ')}.`,
    'Datos actuales del inventario y perfil:',
    JSON.stringify(inventorySummary),
  ].join('\n');

  const res = await callGemini({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RECOMMENDATIONS_SCHEMA,
      temperature: 0.35,
    },
  });

  return parseJsonResponse(res, 'No se pudieron generar recomendaciones.');
}

// =========================================================================
// 3) Conversational & Multimodal Inventory Coach IA
// =========================================================================
const COACH_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'get_inventory',
        description: 'Obtiene todos los productos actuales de la despensa con cantidad, mínimo, unidad, estado y macros detallados.',
      },
      {
        name: 'get_shopping_list',
        description: 'Obtiene la lista de compras actual (productos agotados, por acabarse o marcados para comprar).',
      },
      {
        name: 'get_pantry_analytics',
        description: 'Obtiene el perfil fitness del usuario, metas diarias, días de cobertura de proteína en casa y desglose de tipos de proteína/carbos/grasas en despensa.',
      },
      {
        name: 'add_item',
        description: 'Agrega un nuevo producto al inventario de la despensa (con su tabla nutrimental estimada o leída).',
        parameters: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING' },
            category: { type: 'STRING', description: `Una de: ${CATEGORY_NAMES.join(', ')}` },
            unit: { type: 'STRING', description: `Una de: ${UNITS.join(', ')}` },
            qty: { type: 'NUMBER' },
            min: { type: 'NUMBER' },
            needBuy: { type: 'BOOLEAN' },
            serving: { type: 'STRING' },
            servingsPerUnit: { type: 'NUMBER' },
            kcal: { type: 'NUMBER' },
            protein: { type: 'NUMBER' },
            proteinType: { type: 'STRING', description: 'animal, vegetal o suplemento' },
            carbs: { type: 'NUMBER' },
            carbType: { type: 'STRING', description: 'complejo, simple o fibroso' },
            fiber: { type: 'NUMBER' },
            sugar: { type: 'NUMBER' },
            fat: { type: 'NUMBER' },
            satFat: { type: 'NUMBER' },
            unsatFat: { type: 'NUMBER' },
            sodium: { type: 'NUMBER' },
            attachChatPhoto: { type: 'BOOLEAN' },
          },
          required: ['name', 'qty'],
        },
      },
      {
        name: 'update_quantity',
        description: 'Actualiza el stock de un artículo existente en la despensa (sumando compras o restando lo que se gastó).',
        parameters: {
          type: 'OBJECT',
          properties: {
            itemName: { type: 'STRING' },
            delta: { type: 'NUMBER' },
            setQty: { type: 'NUMBER' },
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
        name: 'mark_for_shopping',
        description: 'Marca o desmarca un artículo existente para incluirlo en la lista de compras.',
        parameters: {
          type: 'OBJECT',
          properties: {
            itemName: { type: 'STRING' },
            needBuy: { type: 'BOOLEAN' },
          },
          required: ['itemName', 'needBuy'],
        },
      },
    ],
  },
];

const SYSTEM_INSTRUCTION = {
  parts: [
    {
      text: [
        'Eres el Asistente IA de Inventario y Nutrición de FitDespensa en español.',
        'La app está enfocada 100% en gestionar el inventario de la despensa fitness, autocompletar tablas nutrimentales y dar recomendaciones inteligentes de compra y uso del stock.',
        'Reglas:',
        '1. Consulta siempre get_inventory, get_pantry_analytics y get_shopping_list antes de dar recomendaciones. Nunca inventes productos que no están en la despensa.',
        '2. Si el usuario manda una FOTO de uno o varios productos o etiquetas: extrae su tabla nutrimental completa (incluyendo tipo de proteína animal/vegetal/suplemento, tipo de carbos complejo/simple/fibroso, fibra, azúcares, grasas saturadas/insaturadas y sodio) y agrégalos con add_item (attachChatPhoto=true).',
        '3. Si el usuario dice qué compró o qué se acabó (ej. "se acabó el pollo", "quedan 2 huevos", "compré 1 kg de avena"), actualiza el inventario de inmediato con update_quantity o add_item.',
        '4. Da recomendaciones proactivas sobre qué reponer, qué fuentes de proteína/carbos/grasas faltan para balancear su despensa según su objetivo, y cómo aprovechar lo que ya tiene en casa.',
        '5. Sé directo, claro y conciso con viñetas cortas.',
      ].join('\n'),
    },
  ],
};

export async function runCoachTurn(history, userText, executor, photoDataUrl = null) {
  const userParts = [];
  if (userText) userParts.push({ text: userText });
  if (photoDataUrl) {
    const match = String(photoDataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (match) {
      userParts.push({ inlineData: { mimeType: match[1], data: match[2] } });
      if (!userText) {
        userParts.unshift({
          text: 'Analiza esta foto de producto o despensa: extrae su tabla nutrimental completa y agrégalo o actualiza mi inventario.',
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
      generationConfig: { temperature: 0.35 },
    });

    const candidate = res?.candidates?.[0];
    const modelContent = candidate?.content;
    if (!modelContent?.parts?.length) {
      throw new Error('El asistente no pudo generar una respuesta.');
    }

    contents.push(modelContent);

    const calls = modelContent.parts.filter((p) => p.functionCall);
    if (!calls.length) {
      const replyText = extractTextFromResponse(res);
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
    text: 'Inventario actualizado. ¿Necesitas otra recomendación?',
    actions,
    history: contents,
  };
}
