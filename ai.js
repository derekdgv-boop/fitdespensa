// ai.js — Zero-Downtime AI Client for FitDespensa:
// - Uses Gemini 3.8 / active Gemini models first
// - Automatically adapts payloads (schema/systemInstruction) to Gemma-3 (27B/12B) when Gemini has 503 high demand
// - Built-in smart algorithmic advisor fallback if all Google endpoints are temporarily saturated
import { CATEGORY_NAMES, UNITS } from './constants.js?v=14';
import { DEFAULT_GEMINI_MODEL } from './firebase-config.js?v=7';

const KEY_STORAGE = 'fitdespensa_gemini_key';
const MODEL_STORAGE = 'fitdespensa_gemini_model';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const RETIRED_EXACT = new Set([
  'gemini-2.5-flash',
  'gemini-2.5-flash-001',
  'gemini-2.0-flash',
  'gemini-2.0-flash-001',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash-lite-001',
]);

function isDeprecatedModel(name) {
  const m = String(name || '').toLowerCase().replace(/^models\//, '');
  if (m.startsWith('gemini-1.')) return true;
  return RETIRED_EXACT.has(m);
}

function isUsableModel(name) {
  const m = String(name || '').toLowerCase().replace(/^models\//, '');
  if (isDeprecatedModel(m)) return false;
  if (!(m.startsWith('gemini-') || m.startsWith('gemma-3'))) return false;
  const blocked = ['tts', 'image', 'embedding', 'aqa', 'vision', 'computer-use', 'robotics', 'audio', 'live', 'thinking-exp', '1b', '4b'];
  return !blocked.some((b) => m.includes(b));
}

function rankModel(name) {
  const m = name.toLowerCase();
  if (m === 'gemini-3.8-flash') return 1;
  if (m.includes('3.8') && m.includes('flash-lite')) return 2;
  if (m.includes('3.') && m.includes('flash-lite')) return 3;
  if (m.includes('3.') && m.includes('flash')) return 4;
  if (m.includes('2.5-flash-lite')) return 5;
  if (m.includes('gemma-3-27b')) return 6;
  if (m.includes('gemma-3-12b')) return 7;
  if (m.includes('3.') && m.includes('pro')) return 8;
  if (m.includes('2.5-pro')) return 9;
  return 10;
}

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
    // Fallback in memory
  }
}

export function sanitizeApiKey(raw) {
  const str = String(raw || '').trim();
  const match = str.match(/AIza[A-Za-z0-9_-]{30,}/);
  if (match) return match[0];
  return str.replace(/^['"`]+|['"`]+$/g, '').replace(/\s+/g, '');
}

export function getGeminiConfig() {
  let savedModel = safeGet(MODEL_STORAGE).trim().replace(/^models\//, '');
  if (!savedModel || isDeprecatedModel(savedModel)) {
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

let cachedModelsList = null;

export async function listGeminiModels() {
  const { apiKey } = getGeminiConfig();
  if (!apiKey) throw new Error('Primero pega tu API key de Gemini.');

  const allModels = [];
  let pageToken = '';
  for (let page = 0; page < 5; page++) {
    const tokenParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
    const res = await fetch(`${API_BASE}?pageSize=100${tokenParam}&key=${encodeURIComponent(apiKey)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error?.message || `Error ${res.status} al validar tu clave en Google`);
    }
    if (Array.isArray(data.models)) allModels.push(...data.models);
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  const list = allModels
    .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
    .map((m) => String(m.name || '').replace(/^models\//, ''))
    .filter(isUsableModel)
    .sort((a, b) => rankModel(a) - rankModel(b));
  if (list.length) cachedModelsList = list;
  return list;
}

function isOverloadedError(status, msg) {
  const m = String(msg || '').toLowerCase();
  return (
    status === 503 ||
    status === 429 ||
    m.includes('high demand') ||
    m.includes('overloaded') ||
    m.includes('try again later') ||
    m.includes('resource exhausted')
  );
}

/**
 * Adapts Gemini payloads so Gemma-3 models (which don't accept systemInstruction,
 * responseSchema, or tools) can seamlessly serve requests during Gemini 503 spikes!
 */
function adaptBodyForModel(modelName, body) {
  if (!String(modelName).toLowerCase().startsWith('gemma-')) {
    return body;
  }
  const sysText = body.systemInstruction?.parts?.map((p) => p.text).join('\n') || '';
  const schemaHint = body.generationConfig?.responseSchema
    ? `\nIMPORTANTE: Responde ÚNICAMENTE con un objeto JSON válido (sin texto adicional ni bloques markdown) que cumpla esta estructura: ${JSON.stringify(body.generationConfig.responseSchema)}`
    : '';

  const clonedContents = (body.contents || [])
    .filter((c) => !c.parts?.some((p) => p.functionCall || p.functionResponse))
    .map((c, idx) => {
      const parts = (c.parts || []).filter((p) => p.text || p.inlineData).map((p) => ({ ...p }));
      if (idx === 0 && (sysText || schemaHint)) {
        parts.unshift({ text: `${sysText}${schemaHint}\n\n` });
      }
      return { role: c.role === 'model' ? 'model' : 'user', parts };
    })
    .filter((c) => c.parts.length > 0);

  return {
    contents: clonedContents,
    generationConfig: {
      temperature: body.generationConfig?.temperature ?? 0.3,
    },
  };
}

async function rawGenerate(apiKey, model, body) {
  const cleanModel = model.replace(/^models\//, '');
  const url = `${API_BASE}/${encodeURIComponent(cleanModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const adapted = adaptBodyForModel(cleanModel, body);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(adapted),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data, usedModel: cleanModel };
}

async function callGemini(body, { requireTools = false } = {}) {
  const { apiKey, model } = getGeminiConfig();
  if (!apiKey) {
    throw new Error('Falta tu API Key de Gemini en Ajustes → IA (Gemini).');
  }

  let attempt = await rawGenerate(apiKey, model, body);
  if (attempt.ok) return attempt.data;

  // Sweep across ALL available models (including Gemma-3-27b-it which runs on an uncongested cluster!)
  let pool = [];
  try {
    const available = cachedModelsList || (await listGeminiModels());
    pool = available.filter((m) => m !== model);
  } catch {
    pool = ['gemma-3-27b-it', 'gemma-3-12b-it', 'gemini-3.8-flash'];
  }

  for (const candidateModel of pool) {
    if (requireTools && candidateModel.startsWith('gemma-')) continue;
    const backupAttempt = await rawGenerate(apiKey, candidateModel, body);
    if (backupAttempt.ok) {
      // Save working model if it's Gemini, or use Gemma seamlessly for this turn
      if (candidateModel.startsWith('gemini-')) {
        setGeminiConfig({ model: candidateModel });
      }
      return backupAttempt.data;
    }
  }

  // If requireTools was true and all Gemini models had 503, fall back to Gemma conversational mode without tools!
  if (requireTools) {
    const gemmaModels = pool.filter((m) => m.startsWith('gemma-'));
    for (const gm of gemmaModels) {
      const backupAttempt = await rawGenerate(apiKey, gm, body);
      if (backupAttempt.ok) return backupAttempt.data;
    }
  }

  const msg = attempt.data?.error?.message || `Error ${attempt.status} al consultar Gemini`;
  const err = new Error(msg);
  err.isOverloaded = isOverloadedError(attempt.status, msg);
  throw err;
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
  const cleanPref = String(preferredModel || '').trim().replace(/^models\//, '');
  const targetModel = !cleanPref || isDeprecatedModel(cleanPref) ? DEFAULT_GEMINI_MODEL : cleanPref;
  setGeminiConfig({ apiKey: cleanKey, model: targetModel });

  // Validate key against Google's models endpoint first (instant, never has 503 congestion!)
  const models = await listGeminiModels();
  if (!models.length) {
    throw new Error('La clave no tiene modelos habilitados en Google AI Studio.');
  }

  // Pick a live uncongested model
  let activeModel = models.includes(targetModel) ? targetModel : models[0];
  try {
    const probe = await rawGenerate(cleanKey, activeModel, {
      contents: [{ role: 'user', parts: [{ text: 'OK' }] }],
    });
    if (!probe.ok) {
      for (const m of models) {
        if (m === activeModel) continue;
        const p2 = await rawGenerate(cleanKey, m, {
          contents: [{ role: 'user', parts: [{ text: 'OK' }] }],
        });
        if (p2.ok) {
          activeModel = m;
          break;
        }
      }
    }
  } catch {
    // Key was already validated by listGeminiModels()
  }

  setGeminiConfig({ apiKey: cleanKey, model: activeModel });
  return { apiKey: cleanKey, model: activeModel };
}

export async function testGeminiConnection() {
  const { apiKey } = getGeminiConfig();
  await connectAndVerifyGemini(apiKey, getGeminiConfig().model);
  return true;
}

// =========================================================================
// 1) Product / Nutrition Label Photo Auto-Fill
// =========================================================================
const PRODUCT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    category: { type: 'STRING' },
    unit: { type: 'STRING' },
    serving: { type: 'STRING' },
    servingsPerUnit: { type: 'NUMBER' },
    kcal: { type: 'NUMBER' },
    protein: { type: 'NUMBER' },
    proteinType: { type: 'STRING' },
    carbs: { type: 'NUMBER' },
    carbType: { type: 'STRING' },
    fiber: { type: 'NUMBER' },
    sugar: { type: 'NUMBER' },
    fat: { type: 'NUMBER' },
    satFat: { type: 'NUMBER' },
    unsatFat: { type: 'NUMBER' },
    sodium: { type: 'NUMBER' },
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
// 2) Structured AI Inventory Recommendations (+ Smart Local Backup on 503)
// =========================================================================
const RECOMMENDATIONS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    headline: { type: 'STRING' },
    insights: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { badge: { type: 'STRING' }, title: { type: 'STRING' }, detail: { type: 'STRING' } },
        required: ['badge', 'title', 'detail'],
      },
    },
    suggestedPurchases: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' }, category: { type: 'STRING' }, unit: { type: 'STRING' }, qty: { type: 'NUMBER' }, reason: { type: 'STRING' } },
        required: ['name', 'category', 'unit', 'qty', 'reason'],
      },
    },
  },
  required: ['headline', 'insights', 'suggestedPurchases'],
};

function buildLocalFallbackRecommendations(inv, focus) {
  const items = inv?.items || [];
  const low = items.filter((i) => i.status !== 'Suficiente');
  const days = inv?.proteinCoverageDays;
  const goal = String(inv?.goal || 'mantenimiento').toLowerCase();
  const sub = inv?.pantrySubtypes || { protein: {}, carbs: {}, fat: {} };

  const headline = !items.length
    ? `Arma tu despensa base para ${goal}: prioriza proteínas magras, carbos complejos y fibra.`
    : days != null
      ? `Tu despensa cubre ${days} días de proteína (${inv.pantryTotals?.protein || 0}g en stock) · ${low.length} artículos por reponer.`
      : `Tienes ${items.length} productos (${inv?.pantryTotals?.protein || 0}g de proteína total) y ${low.length} por comprar.`;

  const inStockNames = items.filter((i) => i.qty > 0).map((i) => i.name);
  const insights = [
    {
      badge: low.length ? 'Reposición' : 'Stock al día',
      title: low.length ? `${low.length} productos bajos o agotados` : 'Niveles óptimos de inventario',
      detail: low.length
        ? `Prioriza reponer: ${low.slice(0, 4).map((i) => i.name).join(', ')} para no cortar tu plan semanal.`
        : 'Todos tus productos están por encima de su mínimo configurado.',
    },
    {
      badge: 'Calidad Macros',
      title: 'Distribución de fuentes en casa',
      detail: `Proteína: ${sub.protein?.animal || 0}g animal, ${sub.protein?.vegetal || 0}g vegetal, ${sub.protein?.suplemento || 0}g supl. · Fibra total: ${inv?.pantryTotals?.fiber || 0}g.`,
    },
    {
      badge: focus === 'meals' ? 'En tu cocina' : 'Estrategia',
      title: focus === 'meals' && inStockNames.length ? 'Combina tu stock disponible' : `Enfoque ${inv?.goal || 'Fitness'}`,
      detail:
        focus === 'meals' && inStockNames.length
          ? `Armado rápido con tu stock actual: combina ${inStockNames.slice(0, 3).join(' + ')} para una comida completa en macros.`
          : goal.includes('defin')
            ? 'Prioriza proteínas magras y verduras fibrosas de alta saciedad en tu próxima compra.'
            : 'Asegura suficientes carbohidratos complejos (avena, arroz, papa) para sostener tus entrenamientos.',
    },
  ];

  const existingSet = new Set(items.filter((i) => i.qty > i.min).map((i) => i.name.toLowerCase()));
  const baseCatalog = [
    { name: 'Pechuga de pollo', category: 'Proteínas', unit: 'kg', qty: 2, reason: 'Base proteica magra (31g P por 100g) para toda la semana.' },
    { name: 'Atún en agua', category: 'Proteínas', unit: 'latas', qty: 6, reason: 'Proteína rápida no perecedera para emergencias.' },
    { name: 'Huevo', category: 'Lácteos y huevo', unit: 'pzas', qty: 18, reason: 'Proteína de alto valor biológico y grasas saludables.' },
    { name: 'Avena', category: 'Carbohidratos', unit: 'kg', qty: 1, reason: 'Carbohidrato complejo rico en fibra soluble.' },
    { name: 'Brócoli', category: 'Frutas y verduras', unit: 'kg', qty: 1, reason: 'Aporta micronutrientes, fibra y volumen con pocas calorías.' },
    { name: 'Yogur griego natural', category: 'Lácteos y huevo', unit: 'botes', qty: 2, reason: 'Excelente fuente de proteína rápida y probióticos.' },
  ];
  const suggestedPurchases = baseCatalog.filter((b) => !existingSet.has(b.name.toLowerCase())).slice(0, 4);

  return { headline, insights, suggestedPurchases };
}

export async function generatePantryRecommendations({ inventorySummary, focus = 'general' }) {
  const isEmpty = !inventorySummary?.items?.length;
  const focusMap = {
    general: isEmpty
      ? 'La despensa está vacía todavía. Recomienda un kit base ideal de compras fitness según el objetivo del usuario.'
      : 'Analiza el balance general de la despensa, qué se está acabando, calidad de proteínas/carbos/grasas y qué conviene comprar.',
    shopping: 'Enfócate en optimizar la próxima compra del súper según el objetivo fitness y los huecos nutricionales.',
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

  try {
    const res = await callGemini({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RECOMMENDATIONS_SCHEMA,
        temperature: 0.35,
      },
    });
    return parseJsonResponse(res, 'No se pudieron generar recomendaciones.');
  } catch (err) {
    if (err?.isOverloaded) {
      return buildLocalFallbackRecommendations(inventorySummary, focus);
    }
    throw err;
  }
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
        description: 'Agrega un nuevo producto al inventario de la despensa.',
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
            proteinType: { type: 'STRING' },
            carbs: { type: 'NUMBER' },
            carbType: { type: 'STRING' },
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
        description: 'Actualiza el stock de un artículo existente en la despensa.',
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
        description: 'Cambia el mínimo de alerta de un artículo.',
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
        description: 'Marca o desmarca un artículo para incluirlo en la lista de compras.',
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
        'Enfócate 100% en gestionar el inventario de la despensa fitness, autocompletar tablas nutrimentales y dar recomendaciones inteligentes de compra y uso del stock.',
        'Sé directo, claro y conciso con viñetas cortas.',
      ].join('\n'),
    },
  ],
};

export async function runCoachTurn(history, userText, executor, photoDataUrl = null) {
  // Always inject live inventory context so even non-tool fallback models (like Gemma-3) answer with 100% real pantry data!
  let invSnap = null;
  try {
    invSnap = (await executor('get_pantry_analytics', {}))?.result || null;
  } catch {
    // ignore
  }

  const userParts = [];
  const contextNote = invSnap ? `[Contexto actual de mi despensa: ${JSON.stringify(invSnap)}]\n\n` : '';
  if (userText) userParts.push({ text: `${contextNote}${userText}` });
  if (photoDataUrl) {
    const match = String(photoDataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (match) {
      userParts.push({ inlineData: { mimeType: match[1], data: match[2] } });
      if (!userText) {
        userParts.unshift({
          text: `${contextNote}Analiza esta foto de producto o despensa: extrae su tabla nutrimental completa y agrégalo o actualiza mi inventario.`,
        });
      }
    }
  }

  const contents = [...history, { role: 'user', parts: userParts }];
  const actions = [];

  for (let step = 0; step < 6; step++) {
    const res = await callGemini(
      {
        systemInstruction: SYSTEM_INSTRUCTION,
        contents,
        tools: COACH_TOOLS,
        generationConfig: { temperature: 0.35 },
      },
      { requireTools: true }
    );

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
