// ai.js — Ultra-Fast Hybrid AI Engine for FitDespensa (v21):
// - ⚡ Groq Cloud (0.3s LPU speed: llama-3.3-70b-versatile + llama-4-scout vision)
// - 🚀 Fast Google Gemini (thinkingBudget: 0 for <1s latency + Gemma-3-27b-it failover)
// - 🧠 0ms Smart Recommendations Cache + Local Algorithmic Fallback
import { CATEGORY_NAMES, UNITS } from './constants.js?v=21';
import { DEFAULT_GEMINI_MODEL } from './firebase-config.js?v=7';

const PROVIDER_STORAGE = 'fitdespensa_ai_provider'; // 'groq' | 'gemini'
const GROQ_KEY_STORAGE = 'fitdespensa_groq_key';
const GROQ_MODEL_STORAGE = 'fitdespensa_groq_model';
const GEMINI_KEY_STORAGE = 'fitdespensa_gemini_key';
const GEMINI_MODEL_STORAGE = 'fitdespensa_gemini_model';

const GROQ_API_BASE = 'https://api.groq.com/openai/v1';
const DEFAULT_GROQ_TEXT_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_GROQ_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const RETIRED_EXACT = new Set([
  'gemini-2.5-flash',
  'gemini-2.5-flash-001',
  'gemini-2.0-flash',
  'gemini-2.0-flash-001',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash-lite-001',
]);

const memStore = {};
const recsCache = new Map();

function safeGet(k) {
  try {
    return localStorage.getItem(k) || memStore[k] || '';
  } catch {
    return memStore[k] || '';
  }
}

function safeSet(k, v) {
  if (v) memStore[k] = v;
  else delete memStore[k];
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {
    // Ignore storage quota/privacy blocks
  }
}

function isDeprecatedGemini(name) {
  const m = String(name || '').toLowerCase().replace(/^models\//, '');
  return m.startsWith('gemini-1.') || RETIRED_EXACT.has(m);
}

/** Auto-cleans Groq (gsk_...) or Gemini (AIza...) keys from pasted snippets. */
export function sanitizeApiKey(raw) {
  const str = String(raw || '').trim();
  const groqMatch = str.match(/gsk_[A-Za-z0-9_-]{20,}/);
  if (groqMatch) return groqMatch[0];
  const gemMatch = str.match(/AIza[A-Za-z0-9_-]{30,}/);
  if (gemMatch) return gemMatch[0];
  return str.replace(/^['"`]+|['"`]+$/g, '').replace(/\s+/g, '');
}

export function detectProviderFromKey(key) {
  const clean = sanitizeApiKey(key);
  if (clean.startsWith('gsk_')) return 'groq';
  if (clean.startsWith('AIza')) return 'gemini';
  return null;
}

export function getAiConfig() {
  const groqKey = sanitizeApiKey(safeGet(GROQ_KEY_STORAGE));
  const geminiKey = sanitizeApiKey(safeGet(GEMINI_KEY_STORAGE));
  let provider = safeGet(PROVIDER_STORAGE);
  if (provider !== 'groq' && provider !== 'gemini') {
    provider = groqKey ? 'groq' : 'gemini';
  }
  // If chosen provider has no key but the other does, auto-use the configured one
  if (provider === 'groq' && !groqKey && geminiKey) provider = 'gemini';
  if (provider === 'gemini' && !geminiKey && groqKey) provider = 'groq';

  let geminiModel = safeGet(GEMINI_MODEL_STORAGE).trim().replace(/^models\//, '');
  if (!geminiModel || isDeprecatedGemini(geminiModel)) {
    geminiModel = DEFAULT_GEMINI_MODEL;
  }
  const groqModel = safeGet(GROQ_MODEL_STORAGE).trim() || DEFAULT_GROQ_TEXT_MODEL;

  return {
    provider,
    groqKey,
    groqModel,
    geminiKey,
    geminiModel,
    apiKey: provider === 'groq' ? groqKey : geminiKey,
    model: provider === 'groq' ? groqModel : geminiModel,
  };
}

// Backward-compatible alias
export const getGeminiConfig = getAiConfig;

export function setAiConfig({ provider, apiKey, model }) {
  const cleanKey = apiKey !== undefined ? sanitizeApiKey(apiKey) : undefined;
  const inferred = cleanKey ? detectProviderFromKey(cleanKey) : null;
  const targetProv = inferred || provider || getAiConfig().provider;

  if (targetProv === 'groq' || targetProv === 'gemini') {
    safeSet(PROVIDER_STORAGE, targetProv);
  }
  if (cleanKey !== undefined) {
    safeSet(targetProv === 'groq' ? GROQ_KEY_STORAGE : GEMINI_KEY_STORAGE, cleanKey);
  }
  if (model !== undefined) {
    const cleanModel = String(model).trim().replace(/^models\//, '');
    if (cleanModel) {
      safeSet(targetProv === 'groq' ? GROQ_MODEL_STORAGE : GEMINI_MODEL_STORAGE, cleanModel);
    }
  }
}

export const setGeminiConfig = setAiConfig;

export const hasGeminiKey = () => {
  const cfg = getAiConfig();
  return Boolean(cfg.groqKey || cfg.geminiKey);
};

// =========================================================================
// GROQ CLOUD CLIENT (0.3s LPU Inference: OpenAI-compatible REST)
// =========================================================================
async function callGroqChat({ messages, model, jsonMode = false, tools = null, temperature = 0.25 }) {
  const { groqKey, groqModel } = getAiConfig();
  if (!groqKey) throw new Error('Falta tu API Key de Groq (gsk_...).');

  const body = {
    model: model || groqModel || DEFAULT_GROQ_TEXT_MODEL,
    messages,
    temperature,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const res = await fetch(`${GROQ_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${groqKey}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Automatic vision/model fallback on Groq if model ID changes
    if (model !== DEFAULT_GROQ_TEXT_MODEL && !tools && !messages.some((m) => Array.isArray(m.content))) {
      const retry = await fetch(`${GROQ_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groqKey}`,
        },
        body: JSON.stringify({ ...body, model: DEFAULT_GROQ_TEXT_MODEL }),
      });
      const rData = await retry.json().catch(() => ({}));
      if (retry.ok) return rData;
    }
    throw new Error(data?.error?.message || `Error ${res.status} en Groq`);
  }
  return data;
}

export async function listGroqModels(explicitKey = '') {
  const key = sanitizeApiKey(explicitKey) || getAiConfig().groqKey;
  if (!key) throw new Error('Primero pega tu API Key de Groq (empieza con gsk_...).');
  const res = await fetch(`${GROQ_API_BASE}/models`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `Error ${res.status} al validar clave de Groq`);
  }
  return (data.data || [])
    .map((m) => m.id)
    .filter((id) => id && !id.includes('whisper') && !id.includes('tts') && !id.includes('guard'));
}

// =========================================================================
// FAST GOOGLE GEMINI CLIENT (thinkingBudget: 0 + Gemma-3 failover)
// =========================================================================
let cachedGeminiModels = null;

function isUsableGeminiModel(name) {
  const m = String(name || '').toLowerCase().replace(/^models\//, '');
  if (isDeprecatedGemini(m)) return false;
  if (!(m.startsWith('gemini-') || m.startsWith('gemma-3'))) return false;
  const blocked = ['tts', 'image', 'embedding', 'aqa', 'vision', 'computer-use', 'robotics', 'audio', 'live', 'thinking-exp', '1b', '4b'];
  return !blocked.some((b) => m.includes(b));
}

function rankGeminiModel(name) {
  const m = name.toLowerCase();
  if (m.includes('3.8') && m.includes('flash-lite')) return 1;
  if (m === 'gemini-3.8-flash') return 2;
  if (m.includes('3.') && m.includes('flash-lite')) return 3;
  if (m.includes('2.5-flash-lite')) return 4;
  if (m.includes('3.') && m.includes('flash')) return 5;
  if (m.includes('gemma-3-27b')) return 6;
  if (m.includes('gemma-3-12b')) return 7;
  return 9;
}

export async function listGeminiModels(explicitKey = '') {
  const cfg = getAiConfig();
  if (cfg.provider === 'groq' && !explicitKey) {
    return listGroqModels();
  }
  const apiKey = sanitizeApiKey(explicitKey) || cfg.geminiKey;
  if (!apiKey) throw new Error('Primero pega tu API key de Gemini.');

  const allModels = [];
  let pageToken = '';
  for (let page = 0; page < 4; page++) {
    const tokenParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
    const res = await fetch(`${GEMINI_API_BASE}?pageSize=100${tokenParam}&key=${encodeURIComponent(apiKey)}`);
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
    .filter(isUsableGeminiModel)
    .sort((a, b) => rankGeminiModel(a) - rankGeminiModel(b));
  if (list.length) cachedGeminiModels = list;
  return list;
}

function adaptBodyForGeminiOrGemma(modelName, body, disableThinking = true) {
  const m = String(modelName).toLowerCase();
  if (m.startsWith('gemma-')) {
    const sysText = body.systemInstruction?.parts?.map((p) => p.text).join('\n') || '';
    const schemaHint = body.generationConfig?.responseSchema
      ? `\nIMPORTANTE: Responde ÚNICAMENTE con un objeto JSON válido (sin markdown) con esta estructura: ${JSON.stringify(body.generationConfig.responseSchema)}`
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
      generationConfig: { temperature: body.generationConfig?.temperature ?? 0.25 },
    };
  }

  // Fast Gemini: disable slow thinking tokens (`thinkingBudget: 0`) for <1s responses!
  if (disableThinking && m.includes('flash')) {
    return {
      ...body,
      generationConfig: {
        ...(body.generationConfig || {}),
        thinkingConfig: { thinkingBudget: 0 },
      },
    };
  }
  return body;
}

async function rawGeminiGenerate(apiKey, model, body) {
  const cleanModel = model.replace(/^models\//, '');
  const url = `${GEMINI_API_BASE}/${encodeURIComponent(cleanModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  let res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(adaptBodyForGeminiOrGemma(cleanModel, body, true)),
  });
  let data = await res.json().catch(() => ({}));

  // If this specific Gemini version doesn't accept thinkingConfig, retry cleanly without it
  if (!res.ok && res.status === 400 && String(data?.error?.message || '').toLowerCase().includes('thinking')) {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(adaptBodyForGeminiOrGemma(cleanModel, body, false)),
    });
    data = await res.json().catch(() => ({}));
  }
  return { ok: res.ok, status: res.status, data };
}

async function callGemini(body, { requireTools = false } = {}) {
  const { geminiKey, geminiModel } = getAiConfig();
  if (!geminiKey) throw new Error('Falta tu API Key de Gemini.');

  let attempt = await rawGeminiGenerate(geminiKey, geminiModel, body);
  if (attempt.ok) return attempt.data;

  let pool = [];
  try {
    const available = cachedGeminiModels || (await listGeminiModels(geminiKey));
    pool = available.filter((m) => m !== geminiModel);
  } catch {
    pool = ['gemma-3-27b-it', 'gemma-3-12b-it', 'gemini-3.8-flash'];
  }

  for (const candidateModel of pool) {
    if (requireTools && candidateModel.startsWith('gemma-')) continue;
    const backup = await rawGeminiGenerate(geminiKey, candidateModel, body);
    if (backup.ok) return backup.data;
  }

  if (requireTools) {
    for (const gm of pool.filter((m) => m.startsWith('gemma-'))) {
      const backup = await rawGeminiGenerate(geminiKey, gm, body);
      if (backup.ok) return backup.data;
    }
  }

  const msg = attempt.data?.error?.message || `Error ${attempt.status} al consultar Gemini`;
  const err = new Error(msg);
  err.isOverloaded = attempt.status === 503 || attempt.status === 429 || msg.toLowerCase().includes('high demand');
  throw err;
}

function parseCleanJson(rawText, fallbackError) {
  const raw = String(rawText || '').trim();
  if (!raw) throw new Error(fallbackError);
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first !== -1 && last > first) return JSON.parse(cleaned.slice(first, last + 1));
    throw new Error('Formato JSON inválido devuelto por la IA.');
  }
}

function extractGeminiText(res) {
  return (res?.candidates?.[0]?.content?.parts || [])
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('\n')
    .trim();
}

// =========================================================================
// Unified Connect & Verify (Groq OR Gemini)
// =========================================================================
export async function connectAndVerifyAi(rawKey, preferredModel = '', explicitProvider = '') {
  const cleanKey = sanitizeApiKey(rawKey);
  if (!cleanKey) {
    throw new Error('Pega primero tu API Key en el campo de arriba.');
  }
  const provider = detectProviderFromKey(cleanKey) || explicitProvider || getAiConfig().provider;

  if (provider === 'groq') {
    const models = await listGroqModels(cleanKey);
    const chosen =
      preferredModel && models.includes(preferredModel)
        ? preferredModel
        : models.find((m) => m === DEFAULT_GROQ_TEXT_MODEL) ||
          models.find((m) => m.includes('llama-4-scout')) ||
          models[0] ||
          DEFAULT_GROQ_TEXT_MODEL;
    setAiConfig({ provider: 'groq', apiKey: cleanKey, model: chosen });
    return { provider: 'groq', apiKey: cleanKey, model: chosen };
  }

  const cleanPref = String(preferredModel || '').trim().replace(/^models\//, '');
  const targetModel = !cleanPref || isDeprecatedGemini(cleanPref) ? DEFAULT_GEMINI_MODEL : cleanPref;
  const models = await listGeminiModels(cleanKey);
  if (!models.length) throw new Error('La clave no tiene modelos habilitados en Google AI Studio.');
  const chosen = models.includes(targetModel) ? targetModel : models[0];
  setAiConfig({ provider: 'gemini', apiKey: cleanKey, model: chosen });
  return { provider: 'gemini', apiKey: cleanKey, model: chosen };
}

export const connectAndVerifyGemini = connectAndVerifyAi;

// =========================================================================
// 1) Product / Nutrition Label Photo Auto-Fill (Groq Llama-4 Vision OR Gemini)
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
    'Devuelve ÚNICAMENTE un JSON válido con sus valores nutrimentales por porción en español:',
    `{ "name": "...", "category": "una de [${CATEGORY_NAMES.join(', ')}]", "unit": "una de [${UNITS.join(', ')}]",`,
    '"serving": "ej. 100 g o 1 scoop (30 g)", "servingsPerUnit": numero, "kcal": numero,',
    '"protein": numero, "proteinType": "animal|vegetal|suplemento",',
    '"carbs": numero, "carbType": "complejo|simple|fibroso", "fiber": numero, "sugar": numero,',
    '"fat": numero, "satFat": numero, "unsatFat": numero, "sodium": numero_mg }.',
    'Si se ve la tabla nutrimental impresa, copia los números exactos; si es fresco, usa valores estándar USDA.',
  ].join(' ');

  const cfg = getAiConfig();
  if (cfg.provider === 'groq' && cfg.groqKey) {
    try {
      const groqRes = await callGroqChat({
        model: DEFAULT_GROQ_VISION_MODEL,
        jsonMode: true,
        temperature: 0.15,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: photoDataUrl } },
            ],
          },
        ],
      });
      const content = groqRes?.choices?.[0]?.message?.content;
      return parseCleanJson(content, 'Groq no devolvió datos de la foto.');
    } catch (err) {
      if (!cfg.geminiKey) throw err;
      // Seamless fallback to Gemini if Groq vision fails
    }
  }

  const res = await callGemini({
    contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType, data } }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: PRODUCT_SCHEMA,
      temperature: 0.15,
    },
  });
  return parseCleanJson(extractGeminiText(res), 'No se pudieron leer datos del producto.');
}

// =========================================================================
// 2) Structured AI Inventory Recommendations (0ms Cache + 0.3s Groq / Fast Gemini)
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
      detail: `Proteína: ${sub.protein?.animal || 0}g animal, ${sub.protein?.vegetal || 0}g vegetal, ${sub.protein?.suplemento || 0}g supl. · Fibra: ${inv?.pantryTotals?.fiber || 0}g.`,
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
    { name: 'Atún en agua', category: 'Proteínas', unit: 'latas', qty: 6, reason: 'Proteína rápida no perecedera.' },
    { name: 'Huevo', category: 'Lácteos y huevo', unit: 'pzas', qty: 18, reason: 'Proteína completa y grasas saludables.' },
    { name: 'Avena', category: 'Carbohidratos', unit: 'kg', qty: 1, reason: 'Carbohidrato complejo rico en fibra.' },
    { name: 'Brócoli', category: 'Frutas y verduras', unit: 'kg', qty: 1, reason: 'Fibra, micronutrientes y saciedad.' },
  ];
  return { headline, insights, suggestedPurchases: baseCatalog.filter((b) => !existingSet.has(b.name.toLowerCase())).slice(0, 4), speedBadge: 'Local · 0ms' };
}

export async function generatePantryRecommendations({ inventorySummary, focus = 'general', forceRefresh = false }) {
  const cacheKey = `${focus}::${JSON.stringify(inventorySummary)}`;
  if (!forceRefresh && recsCache.has(cacheKey)) {
    return { ...recsCache.get(cacheKey), speedBadge: 'Caché · 0.0s' };
  }

  const t0 = performance.now();
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
    'Responde ÚNICAMENTE con JSON válido con llaves exactas: { "headline": "...", "insights": [{ "badge": "...", "title": "...", "detail": "..." }], "suggestedPurchases": [{ "name": "...", "category": "...", "unit": "...", "qty": 1, "reason": "..." }] }.',
    `Usa categorías de: [${CATEGORY_NAMES.join(', ')}] y unidades de: [${UNITS.join(', ')}].`,
    'Datos actuales:',
    JSON.stringify(inventorySummary),
  ].join('\n');

  const cfg = getAiConfig();
  if (cfg.provider === 'groq' && cfg.groqKey) {
    try {
      const groqRes = await callGroqChat({
        jsonMode: true,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }],
      });
      const parsed = parseCleanJson(groqRes?.choices?.[0]?.message?.content, 'Respuesta vacía de Groq.');
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      const out = { ...parsed, speedBadge: `Groq · ${secs}s` };
      recsCache.set(cacheKey, out);
      return out;
    } catch (err) {
      if (!cfg.geminiKey) throw err;
    }
  }

  try {
    const res = await callGemini({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RECOMMENDATIONS_SCHEMA,
        temperature: 0.3,
      },
    });
    const parsed = parseCleanJson(extractGeminiText(res), 'No se pudieron generar recomendaciones.');
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    const out = { ...parsed, speedBadge: `Gemini · ${secs}s` };
    recsCache.set(cacheKey, out);
    return out;
  } catch (err) {
    if (err?.isOverloaded) {
      return buildLocalFallbackRecommendations(inventorySummary, focus);
    }
    throw err;
  }
}

// =========================================================================
// 3) Conversational & Multimodal Inventory Coach IA (Groq 0.3s OR Fast Gemini)
// =========================================================================
const TOOL_DEFS = [
  {
    name: 'get_inventory',
    description: 'Obtiene todos los productos actuales de la despensa con cantidad, mínimo, unidad, estado y macros.',
  },
  {
    name: 'get_shopping_list',
    description: 'Obtiene la lista de compras actual.',
  },
  {
    name: 'get_pantry_analytics',
    description: 'Obtiene metas diarias, días de cobertura de proteína y desglose de tipos de proteína/carbos/grasas en despensa.',
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
];

const GEMINI_TOOLS = [{ functionDeclarations: TOOL_DEFS }];

function toOpenAiSchema(paramObj) {
  if (!paramObj) return { type: 'object', properties: {} };
  const props = {};
  for (const [k, v] of Object.entries(paramObj.properties || {})) {
    props[k] = { ...v, type: String(v.type || 'string').toLowerCase() };
  }
  return {
    type: 'object',
    properties: props,
    ...(paramObj.required ? { required: paramObj.required } : {}),
  };
}

const GROQ_TOOLS = TOOL_DEFS.map((t) => ({
  type: 'function',
  function: {
    name: t.name,
    description: t.description,
    parameters: toOpenAiSchema(t.parameters),
  },
}));

const SYSTEM_TEXT = [
  'Eres el Asistente IA experto en Nutrición Deportiva e Inventario de FitDespensa en español.',
  'Enfócate 100% en gestionar el inventario de la despensa fitness, autocompletar tablas nutrimentales y dar recomendaciones inteligentes de compra, tipos de proteína/carbos/grasas y aprovechamiento del stock.',
  'Usa las herramientas add_item, update_quantity, set_minimum o mark_for_shopping cuando el usuario agregue, compre o gaste productos.',
  'Sé rápido, directo, claro y conciso con viñetas cortas.',
].join('\n');

export async function runCoachTurn(history, userText, executor, photoDataUrl = null) {
  let invSnap = null;
  try {
    invSnap = (await executor('get_pantry_analytics', {}))?.result || null;
  } catch {
    // ignore
  }
  const contextNote = invSnap ? `[Inventario actual: ${JSON.stringify(invSnap)}]\n` : '';
  const cfg = getAiConfig();

  // ---- PATH A: ULTRA-FAST GROQ ----
  if (cfg.provider === 'groq' && cfg.groqKey) {
    const actions = [];
    const oaHistory = (history || [])
      .filter((h) => h._oa)
      .map((h) => h._oa);

    const userContent = photoDataUrl
      ? [
          {
            type: 'text',
            text: `${contextNote}${userText || 'Analiza esta foto de producto y agrégalo a mi inventario con sus macros.'}`,
          },
          { type: 'image_url', image_url: { url: photoDataUrl } },
        ]
      : `${contextNote}${userText}`;

    const messages = [{ role: 'system', content: SYSTEM_TEXT }, ...oaHistory, { role: 'user', content: userContent }];
    const useModel = photoDataUrl ? DEFAULT_GROQ_VISION_MODEL : cfg.groqModel;

    for (let step = 0; step < 5; step++) {
      const res = await callGroqChat({
        model: step === 0 ? useModel : cfg.groqModel,
        messages,
        tools: GROQ_TOOLS,
        temperature: 0.3,
      });
      const msg = res?.choices?.[0]?.message;
      if (!msg) throw new Error('Sin respuesta de Groq.');
      messages.push(msg);

      if (!msg.tool_calls?.length) {
        const nextHistory = [
          ...history,
          { _oa: { role: 'user', content: typeof userContent === 'string' ? userText : 'Foto enviada' } },
          { _oa: { role: 'assistant', content: msg.content || 'Listo.' } },
        ];
        return { text: (msg.content || 'Listo.').trim(), actions, history: nextHistory };
      }

      for (const tc of msg.tool_calls) {
        let parsedArgs = {};
        try {
          parsedArgs = JSON.parse(tc.function?.arguments || '{}');
        } catch {
          parsedArgs = {};
        }
        let outcome;
        try {
          outcome = await executor(tc.function.name, parsedArgs);
        } catch (err) {
          outcome = { result: { ok: false, error: err.message || String(err) } };
        }
        if (outcome?.action) actions.push(outcome.action);
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(outcome?.result ?? { ok: true }),
        });
      }
    }
    return { text: 'Inventario actualizado.', actions, history };
  }

  // ---- PATH B: FAST GEMINI ----
  const gemHistory = (history || []).filter((h) => h.parts);
  const userParts = [];
  if (userText) userParts.push({ text: `${contextNote}${userText}` });
  if (photoDataUrl) {
    const match = String(photoDataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (match) {
      userParts.push({ inlineData: { mimeType: match[1], data: match[2] } });
      if (!userText) {
        userParts.unshift({
          text: `${contextNote}Analiza esta foto de producto o despensa: extrae su tabla nutrimental completa y agrégalo a mi inventario.`,
        });
      }
    }
  }

  const contents = [...gemHistory, { role: 'user', parts: userParts }];
  const actions = [];

  for (let step = 0; step < 5; step++) {
    const res = await callGemini(
      {
        systemInstruction: { parts: [{ text: SYSTEM_TEXT }] },
        contents,
        tools: GEMINI_TOOLS,
        generationConfig: { temperature: 0.3 },
      },
      { requireTools: true }
    );

    const modelContent = res?.candidates?.[0]?.content;
    if (!modelContent?.parts?.length) throw new Error('El asistente no pudo generar una respuesta.');
    contents.push(modelContent);

    const calls = modelContent.parts.filter((p) => p.functionCall);
    if (!calls.length) {
      return { text: extractGeminiText(res) || 'Listo.', actions, history: contents };
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
        functionResponse: { name, response: outcome?.result ?? { ok: true } },
      });
    }
    contents.push({ role: 'user', parts: responseParts });
  }

  return { text: 'Inventario actualizado.', actions, history: contents };
}
