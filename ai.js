// ai.js — Gemini REST client for FitDespensa (100% Inventory + AI Recommendations):
// 1) Automatic full nutrition table recognition from product/label photos
// 2) Structured AI Pantry & Shopping Recommendations
// 3) Conversational & Multimodal Inventory Coach IA (photo + voice + text)
import { CATEGORY_NAMES, UNITS } from './constants.js?v=13';
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
  if (!res?.candidates?.[0]) {
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
// 1) Product / Nutrition Label Photo Auto-Fill
// =========================================================================
const PRODUCT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING', description: 'Nombre claro y corto del producto en español' },
    category: { type: 'STRING', enum: CATEGORY_NAMES },
    unit: { type: 'STRING', enum: UNITS },
    serving: { type: 'STRING', description: 'Descripción de 1 porción, ej. "1 scoop (30 g)" o "100 g"' },
    servingsPerUnit: { type: 'NUMBER', description: 'Cantidad aproximada de porciones por envase/unidad' },
    kcal: { type: 'NUMBER', description: 'Calorías por porción' },
    protein: { type: 'NUMBER', description: 'Gramos de proteína por porción' },
    proteinType: { type: 'STRING', enum: ['animal', 'vegetal', 'suplemento'] },
    carbs: { type: 'NUMBER', description: 'Gramos totales de carbohidratos por porción' },
    carbType: { type: 'STRING', enum: ['complejo', 'simple', 'fibroso'] },
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

  const text = res?.candidates?.[0]?.content?.parts?.find((p) => p.text && !p.thought)?.text;
  if (!text) throw new Error('Gemini no devolvió datos del producto.');
  return JSON.parse(text);
}

// =========================================================================
// 2) Structured AI Inventory Recommendations
// =========================================================================
const RECOMMENDATIONS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    headline: { type: 'STRING', description: 'Diagnóstico breve y motivador de 1 línea sobre el estado actual de la despensa' },
    insights: {
      type: 'ARRAY',
      description: '3 recomendaciones accionables basadas en el inventario actual y objetivo fitness',
      items: {
        type: 'OBJECT',
        properties: {
          badge: { type: 'STRING', description: 'Etiqueta corta, ej. "Proteína", "Balance", "Ahorro", "Combinación"' },
          title: { type: 'STRING', description: 'Título corto y directo' },
          detail: { type: 'STRING', description: 'Explicación práctica de 1-2 oraciones usando los productos reales' },
        },
        required: ['badge', 'title', 'detail'],
      },
    },
    suggestedPurchases: {
      type: 'ARRAY',
      description: 'De 2 a 4 alimentos fitness recomendados para comprar que complementen lo que falta en la despensa',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          category: { type: 'STRING', enum: CATEGORY_NAMES },
          unit: { type: 'STRING', enum: UNITS },
          qty: { type: 'NUMBER', description: 'Cantidad recomendada a comprar' },
          reason: { type: 'STRING', description: 'Por qué conviene agregarlo según el objetivo y los macros actuales' },
        },
        required: ['name', 'category', 'unit', 'qty', 'reason'],
      },
    },
  },
  required: ['headline', 'insights', 'suggestedPurchases'],
};

export async function generatePantryRecommendations({ inventorySummary, focus = 'general' }) {
  const focusMap = {
    general: 'Analiza el balance general de la despensa, qué se está acabando, calidad de proteínas/carbos/grasas y qué conviene comprar.',
    shopping: 'Enfócate en optimizar la próxima compra del súper según el objetivo fitness (definición/mantenimiento/volumen) y los huecos nutricionales.',
    meals: 'Recomienda combinaciones rápidas y altas en proteína que se pueden preparar HOY usando únicamente lo que hay con stock > 0, y qué ingrediente clave falta.',
  };

  const prompt = [
    'Eres un experto en nutrición deportiva y gestión inteligente de despensa.',
    focusMap[focus] || focusMap.general,
    'Datos reales del inventario y perfil del usuario:',
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

  const text = res?.candidates?.[0]?.content?.parts?.find((p) => p.text && !p.thought)?.text;
  if (!text) throw new Error('No se pudieron generar recomendaciones.');
  return JSON.parse(text);
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
            category: { type: 'STRING', enum: CATEGORY_NAMES },
            unit: { type: 'STRING', enum: UNITS },
            qty: { type: 'NUMBER' },
            min: { type: 'NUMBER' },
            needBuy: { type: 'BOOLEAN', description: 'True si se agrega con qty 0 directo para comprar' },
            serving: { type: 'STRING' },
            servingsPerUnit: { type: 'NUMBER' },
            kcal: { type: 'NUMBER' },
            protein: { type: 'NUMBER' },
            proteinType: { type: 'STRING', enum: ['animal', 'vegetal', 'suplemento'] },
            carbs: { type: 'NUMBER' },
            carbType: { type: 'STRING', enum: ['complejo', 'simple', 'fibroso'] },
            fiber: { type: 'NUMBER' },
            sugar: { type: 'NUMBER' },
            fat: { type: 'NUMBER' },
            satFat: { type: 'NUMBER' },
            unsatFat: { type: 'NUMBER' },
            sodium: { type: 'NUMBER' },
            attachChatPhoto: { type: 'BOOLEAN', description: 'True si el usuario adjuntó foto del producto' },
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
            delta: { type: 'NUMBER', description: 'Cambio relativo (ej. -2 si se gastaron 2, +3 si compró 3)' },
            setQty: { type: 'NUMBER', description: 'Cantidad exacta nueva' },
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
    text: 'Inventario actualizado. ¿Necesitas otra recomendación?',
    actions,
    history: contents,
  };
}
