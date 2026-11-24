// app.js — FitDespensa orchestrator (100% Inventory + AI Recommendations)
import { CATEGORIES, UNITS } from './constants.js?v=13';
import {
  STATUS_LABEL,
  inShoppingList,
  normText,
  round,
  sortItems,
  statusOf,
  stepFor,
  toBuy,
} from './inventory.js?v=13';
import {
  ACTIVITY_LEVELS,
  GOALS,
  calcTargets,
  coverageDays,
  lookupBarcode,
  pantrySubtypeBreakdown,
  pantryTotals,
} from './nutrition.js?v=13';
import { getHouseholdCode, initStorage, setHouseholdCode } from './storage.js?v=13';
import { canUseWebcam, compressFile, dataUrlByteSize, isMobileDevice, startBarcodeScanner, startWebcam } from './camera.js?v=13';
import {
  connectAndVerifyGemini,
  generatePantryRecommendations,
  getGeminiConfig,
  hasGeminiKey,
  listGeminiModels,
  recognizeProduct,
  runCoachTurn,
  setGeminiConfig,
} from './ai.js?v=16';
import {
  esc,
  formatCoachText,
  renderAiRecommendations,
  renderCatalog,
  renderCategoryChips,
  renderLiveStrip,
  renderPantryOverview,
  renderPantryQuality,
  renderShoppingList,
} from './ui.js?v=14';

const SVG_SUN = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`;
const SVG_MOON = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`;
const SVG_CAMERA_PLACEHOLDER = `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" class="muted"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;

const WELCOME_MSG = {
  role: 'ai',
  text: '¡Hola! Soy tu **Asistente IA de Inventario** en FitDespensa.\n\n• **Manda foto** de un producto o tabla nutrimental → lo agrego a tu despensa con sus macros completos\n• **Dime qué se acabó o qué compraste** → actualizo tu stock y tu lista de compras\n• **Pídeme recomendaciones** → analizo tu inventario, tus tipos de proteína/carbos/grasas y te sugiero qué comprar o qué preparar con lo que tienes',
};

// =========================================================================
// State
// =========================================================================
const state = {
  store: null,
  items: [],
  profile: null,
  activeTab: 'catalog',
  search: '',
  category: 'Todas',
  stockFilter: 'all',
  viewMode: localStorage.getItem('fitdespensa_view') || 'grid',
  aiRecs: null,
  aiRecsError: null,
  aiRecsAdded: new Set(),
  aiRecsBusy: false,
  barcodeScanner: null,
  currentPhoto: null,
  pendingChatPhoto: null,
  activeTurnPhoto: null,
  webcam: null,
  speechRec: null,
  chatHistory: [],
  chatUi: [WELCOME_MSG],
  chatBusy: false,
};

const $ = (id) => document.getElementById(id);

// =========================================================================
// Theme & Toasts
// =========================================================================
function initTheme() {
  const saved = localStorage.getItem('fitdespensa_theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const icon = theme === 'dark' ? SVG_SUN : SVG_MOON;
  $('themeBtn').innerHTML = icon;
  $('themeBtnMobile').innerHTML = icon;
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute('content', theme === 'dark' ? '#070a0f' : '#f5f7f9');
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('fitdespensa_theme', next);
  applyTheme(next);
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// =========================================================================
// Rendering
// =========================================================================
function renderAll() {
  const shopCount = state.items.filter(inShoppingList).length;
  for (const id of ['shoppingBadge', 'shoppingBadgeMobile']) {
    const b = $(id);
    b.textContent = shopCount;
    b.classList.toggle('hidden', shopCount === 0);
  }

  const targets = calcTargets(state.profile);
  const totals = pantryTotals(state.items);
  const cov = coverageDays(totals, targets);
  $('sidebarCoverageVal').textContent =
    cov?.protein != null ? `${cov.protein.toFixed(1)} días de proteína` : `${totals.protein} g en stock`;

  $('pantryOverviewStrip').innerHTML = renderPantryOverview({
    items: state.items,
    profile: state.profile,
  });

  $('pantryQualityContent').innerHTML = renderPantryQuality(state.items);

  $('categoryChips').innerHTML = renderCategoryChips(state.category, state.items);
  const catList = $('catalogList');
  catList.className = state.viewMode === 'list' ? 'catalog-list' : 'catalog-grid';
  catList.innerHTML = renderCatalog({
    items: state.items,
    search: state.search,
    category: state.category,
    stockFilter: state.stockFilter,
    viewMode: state.viewMode,
  });

  $('shoppingList').innerHTML = renderShoppingList(state.items);
  renderRecsPanels();

  $('liveSummaryStrip').innerHTML = renderLiveStrip({
    items: state.items,
    profile: state.profile,
  });

  const keyReady = hasGeminiKey();
  $('coachKeyBanner').classList.toggle('hidden', keyReady);
  $('coachStatusSub').textContent = keyReady
    ? `${getGeminiConfig().model} · Sube foto, dicta por voz o pide recomendaciones`
    : 'Configura tu clave de Gemini en Ajustes';

  renderChat();
}

function renderRecsPanels() {
  const body = $('aiRecsBody');
  const shopBox = $('shoppingAiBox');

  if (!hasGeminiKey()) {
    const promptKey = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
        <span class="muted small-note">🔑 Falta tu API Key de Gemini en este navegador/dispositivo para activar la IA.</span>
        <button type="button" class="btn btn-primary btn-xs" data-action="open-ai-settings">Configurar clave gratis</button>
      </div>
    `;
    body.classList.remove('hidden');
    body.innerHTML = promptKey;
    shopBox.classList.add('hidden');
    return;
  }

  if (state.aiRecsBusy) {
    const loading = `<div class="muted small-note">✨ Gemini está analizando tu inventario y metas fitness...</div>`;
    body.classList.remove('hidden');
    body.innerHTML = loading;
    if (state.activeTab === 'shopping') {
      shopBox.classList.remove('hidden');
      shopBox.innerHTML = `<div class="card">${loading}</div>`;
    }
    return;
  }

  if (state.aiRecsError) {
    const errHtml = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
        <span style="color:var(--danger); font-size:0.83rem;">⚠️ ${esc(state.aiRecsError)}</span>
        <button type="button" class="btn btn-ghost btn-xs" data-action="open-ai-settings">Revisar clave / modelo</button>
      </div>
    `;
    body.classList.remove('hidden');
    body.innerHTML = errHtml;
    if (state.activeTab === 'shopping') {
      shopBox.classList.remove('hidden');
      shopBox.innerHTML = `<div class="card">${errHtml}</div>`;
    }
    return;
  }

  if (!state.aiRecs) {
    body.classList.add('hidden');
    shopBox.classList.add('hidden');
    return;
  }

  state.items.filter(inShoppingList).forEach((it) => state.aiRecsAdded.add(normText(it.name)));

  const html = renderAiRecommendations(state.aiRecs, state.aiRecsAdded);
  body.classList.remove('hidden');
  body.innerHTML = html;

  if (state.activeTab === 'shopping') {
    shopBox.classList.remove('hidden');
    shopBox.innerHTML = `<div class="card ai-recs-card">${html}</div>`;
  }
}

function renderChat() {
  const box = $('chatMessages');
  box.innerHTML = '';
  for (const entry of state.chatUi) {
    if (entry.type === 'action') {
      const card = document.createElement('div');
      card.className = 'action-card';
      const labelEl = document.createElement('span');
      labelEl.textContent = entry.label;
      card.appendChild(labelEl);

      if (entry.undo && !entry.undone) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-ghost btn-xs';
        btn.textContent = 'Deshacer';
        btn.onclick = async () => {
          btn.disabled = true;
          try {
            await entry.undo();
            entry.undone = true;
            entry.label += ' (deshecho)';
            renderChat();
            toast('Cambio deshecho');
          } catch (err) {
            toast('No se pudo deshacer: ' + err.message);
            btn.disabled = false;
          }
        };
        card.appendChild(btn);
      }
      box.appendChild(card);
    } else {
      const bubble = document.createElement('div');
      bubble.className = `msg ${entry.role === 'user' ? 'msg-user' : 'msg-ai'}`;
      if (entry.photo) {
        const img = document.createElement('img');
        img.src = entry.photo;
        img.className = 'msg-photo';
        img.alt = 'Foto enviada';
        bubble.appendChild(img);
      }
      if (entry.text) {
        const span = document.createElement('div');
        if (entry.role === 'ai') span.innerHTML = formatCoachText(entry.text);
        else span.textContent = entry.text;
        bubble.appendChild(span);
      }
      box.appendChild(bubble);
    }
  }
  if (state.chatBusy) {
    const typing = document.createElement('div');
    typing.className = 'msg msg-ai';
    typing.innerHTML = `<div class="typing-dots" aria-label="Pensando"><span></span><span></span><span></span></div>`;
    box.appendChild(typing);
  }
  box.scrollTop = box.scrollHeight;
}

function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('[data-tab]').forEach((t) => {
    const active = t.dataset.tab === tab;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.view').forEach((v) => {
    v.classList.toggle('active', v.id === `view-${tab}`);
  });
  renderAll();
}

function switchSettingsTab(stab) {
  document.querySelectorAll('.stab').forEach((b) => b.classList.toggle('active', b.dataset.stab === stab));
  document.querySelectorAll('.stab-panel').forEach((p) => p.classList.toggle('active', p.dataset.stabPanel === stab));
}

// =========================================================================
// AI Recommendations Trigger
// =========================================================================
function buildInventorySummaryPayload() {
  const targets = calcTargets(state.profile);
  const totals = pantryTotals(state.items);
  const subtypes = pantrySubtypeBreakdown(state.items);
  const cov = coverageDays(totals, targets);
  return {
    goal: targets?.goal?.label || state.profile?.goal || 'mantenimiento',
    dailyTargets: targets ? { kcal: targets.kcal, protein: targets.protein, carbs: targets.carbs, fat: targets.fat } : null,
    pantryTotals: totals,
    pantrySubtypes: subtypes,
    proteinCoverageDays: cov?.protein != null ? round(cov.protein, 1) : null,
    items: state.items.map((i) => ({
      name: i.name,
      category: i.category,
      qty: i.qty,
      min: i.min,
      unit: i.unit,
      status: STATUS_LABEL[statusOf(i)],
      protein: i.protein,
      proteinType: i.proteinType,
      carbs: i.carbs,
      carbType: i.carbType,
      fiber: i.fiber,
      fat: i.fat,
    })),
  };
}

async function requestAiRecommendations(focus = 'general') {
  if (!hasGeminiKey()) {
    toast('Pega tu API key de Gemini en Ajustes → IA para usar las recomendaciones.');
    openSettingsModal('ai');
    return;
  }
  if (state.aiRecsBusy) return;

  state.aiRecsBusy = true;
  state.aiRecsError = null;
  renderRecsPanels();
  try {
    state.aiRecs = await generatePantryRecommendations({
      inventorySummary: buildInventorySummaryPayload(),
      focus,
    });
  } catch (err) {
    state.aiRecsError = err.message || String(err);
    toast('Error de IA: ' + state.aiRecsError);
  } finally {
    state.aiRecsBusy = false;
    renderRecsPanels();
  }
}

async function addSuggestedPurchase(idx) {
  const sug = state.aiRecs?.suggestedPurchases?.[idx];
  if (!sug) return;
  const existing = findByName(state.items, sug.name);
  if (existing) {
    await state.store.saveItem({ ...existing, needBuy: true });
  } else {
    await state.store.saveItem({
      name: sug.name,
      category: sug.category || 'Despensa',
      unit: sug.unit || 'pzas',
      qty: 0,
      min: Math.max(1, round((Number(sug.qty) || 1) / 2, 2)),
      needBuy: true,
    });
  }
  state.aiRecsAdded.add(normText(sug.name));
  renderAll();
  toast(`"${sug.name}" agregado a tu lista de compras`);
}

// =========================================================================
// Chat Photo Attachment & Voice Dictation
// =========================================================================
function setPendingChatPhoto(dataUrl) {
  state.pendingChatPhoto = dataUrl || null;
  if (state.pendingChatPhoto) {
    $('chatAttachPreview').src = state.pendingChatPhoto;
    $('chatAttachBar').classList.remove('hidden');
  } else {
    $('chatAttachBar').classList.add('hidden');
    $('chatAttachPreview').removeAttribute('src');
  }
}

function toggleVoiceInput() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    toast('Tu navegador no soporta dictado por voz. Prueba en Chrome o Safari.');
    return;
  }
  const btn = $('chatVoiceBtn');
  if (state.speechRec) {
    state.speechRec.stop();
    return;
  }

  const rec = new SpeechRec();
  rec.lang = 'es-MX';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  state.speechRec = rec;
  btn.classList.add('listening');
  toast('Escuchando... habla ahora');

  rec.onresult = (e) => {
    const transcript = e.results?.[0]?.[0]?.transcript || '';
    if (transcript) {
      $('chatInput').value = transcript;
      $('chatInput').focus();
    }
  };
  rec.onerror = (e) => {
    if (e.error !== 'aborted') toast('No se pudo escuchar: ' + e.error);
  };
  rec.onend = () => {
    state.speechRec = null;
    btn.classList.remove('listening');
  };
  rec.start();
}

// =========================================================================
// Item Modal + Camera + Automatic AI Nutrition Table Scan
// =========================================================================
function populateStaticSelects() {
  $('itemCategory').innerHTML = CATEGORIES.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
  $('itemUnit').innerHTML = UNITS.map((u) => `<option value="${esc(u)}">${esc(u)}</option>`).join('');
  $('profActivity').innerHTML = ACTIVITY_LEVELS.map((a) => `<option value="${esc(a.id)}">${esc(a.label)}</option>`).join('');
  $('profGoal').innerHTML = GOALS.map((g) => `<option value="${esc(g.id)}">${esc(g.label)}</option>`).join('');
}

function setModalPhoto(dataUrl) {
  state.currentPhoto = dataUrl || null;
  const preview = $('itemPhotoPreview');
  if (state.currentPhoto) {
    preview.innerHTML = `<img src="${state.currentPhoto}" alt="Vista previa" />`;
    const kb = Math.max(1, Math.round(dataUrlByteSize(state.currentPhoto) / 1024));
    $('photoMeta').textContent = `Foto lista (${kb} KB comprimida)`;
    $('removePhotoBtn').classList.remove('hidden');
    $('scanPhotoBtn').classList.remove('hidden');
  } else {
    preview.innerHTML = SVG_CAMERA_PLACEHOLDER;
    $('photoMeta').textContent = 'Al subir foto, Gemini autocompleta la tabla nutrimental automáticamente';
    $('removePhotoBtn').classList.add('hidden');
    $('scanPhotoBtn').classList.add('hidden');
  }
}

function openItemModal(item = null) {
  $('itemForm').reset();
  $('itemId').value = item?.id || '';
  $('itemModalTitle').textContent = item ? 'Editar producto' : 'Nuevo producto';
  $('itemName').value = item?.name || '';
  $('itemCategory').value = item?.category || CATEGORIES[0].name;
  $('itemUnit').value = item?.unit || 'pzas';
  $('itemQty').value = item?.qty ?? 1;
  $('itemMin').value = item?.min ?? 1;
  $('itemNeedBuy').checked = Boolean(item?.needBuy);
  $('itemServing').value = item?.serving || '';
  $('itemServingsPerUnit').value = item?.servingsPerUnit ?? '';
  $('itemKcal').value = item?.kcal ?? '';
  $('itemSodium').value = item?.sodium ?? '';
  $('itemProtein').value = item?.protein ?? '';
  $('itemProteinType').value = item?.proteinType || 'animal';
  $('itemCarbs').value = item?.carbs ?? '';
  $('itemCarbType').value = item?.carbType || 'complejo';
  $('itemFiber').value = item?.fiber ?? '';
  $('itemSugar').value = item?.sugar ?? '';
  $('itemFat').value = item?.fat ?? '';
  $('itemSatFat').value = item?.satFat ?? '';
  $('itemUnsatFat').value = item?.unsatFat ?? '';
  $('deleteItemBtn').classList.toggle('hidden', !item);
  setModalPhoto(item?.photo || null);
  $('itemModal').classList.remove('hidden');
}

async function handlePhotoFile(file, target = 'item') {
  if (!file) return;
  try {
    const dataUrl = await compressFile(file);
    if (target === 'chat') {
      setPendingChatPhoto(dataUrl);
    } else {
      setModalPhoto(dataUrl);
      if (hasGeminiKey()) {
        toast('Foto cargada · autocompletando tabla nutrimental...');
        scanCurrentPhoto();
      } else {
        toast('Foto agregada (configura Gemini en Ajustes para autocompletar macros)');
      }
    }
  } catch (err) {
    toast(err.message);
  }
}

async function openCameraFlow() {
  if (isMobileDevice() || !canUseWebcam()) {
    $('cameraFileInput').click();
    return;
  }
  try {
    $('cameraModal').classList.remove('hidden');
    state.webcam = await startWebcam($('cameraVideo'));
  } catch (err) {
    closeCameraModal();
    toast(err.message || 'Usando selector de archivo');
    $('cameraFileInput').click();
  }
}

function closeCameraModal() {
  if (state.webcam) {
    state.webcam.stop();
    state.webcam = null;
  }
  if (state.barcodeScanner) {
    state.barcodeScanner.stop();
    state.barcodeScanner = null;
  }
  $('capturePhotoBtn').classList.remove('hidden');
  $('cameraModalTitle').textContent = 'Capturar foto';
  $('cameraModal').classList.add('hidden');
}

async function scanCurrentPhoto() {
  if (!state.currentPhoto) return;
  if (!hasGeminiKey()) {
    toast('Configura tu API key de Gemini en Ajustes primero.');
    openSettingsModal('ai');
    return;
  }
  const btn = $('scanPhotoBtn');
  btn.disabled = true;
  btn.textContent = '✨ Analizando tabla...';
  $('photoMeta').textContent = 'Gemini está leyendo la tabla nutrimental...';
  try {
    const data = await recognizeProduct(state.currentPhoto);
    if (data.name) $('itemName').value = data.name;
    if (data.category) $('itemCategory').value = data.category;
    if (data.unit) $('itemUnit').value = data.unit;
    if (data.serving) $('itemServing').value = data.serving;
    if (data.servingsPerUnit != null) $('itemServingsPerUnit').value = data.servingsPerUnit;
    if (data.kcal != null) $('itemKcal').value = data.kcal;
    if (data.protein != null) $('itemProtein').value = data.protein;
    if (data.proteinType) $('itemProteinType').value = data.proteinType;
    if (data.carbs != null) $('itemCarbs').value = data.carbs;
    if (data.carbType) $('itemCarbType').value = data.carbType;
    if (data.fiber != null) $('itemFiber').value = data.fiber;
    if (data.sugar != null) $('itemSugar').value = data.sugar;
    if (data.fat != null) $('itemFat').value = data.fat;
    if (data.satFat != null) $('itemSatFat').value = data.satFat;
    if (data.unsatFat != null) $('itemUnsatFat').value = data.unsatFat;
    if (data.sodium != null) $('itemSodium').value = data.sodium;
    $('nutritionDetails').open = true;
    $('photoMeta').textContent = 'Tabla nutrimental autocompletada con Gemini';
    toast('¡Tabla nutrimental autocompletada!');
  } catch (err) {
    $('photoMeta').textContent = 'Error al escanear: ' + err.message;
    toast('Error al escanear: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ Re-escanear tabla con IA';
  }
}

// =========================================================================
// Settings & Profile Modal
// =========================================================================
function readProfileDraft() {
  return {
    sex: $('profSex').value,
    age: Number($('profAge').value) || 0,
    height: Number($('profHeight').value) || 0,
    weight: Number($('profWeight').value) || 0,
    activity: $('profActivity').value,
    goal: $('profGoal').value,
    custom: {
      kcal: Number($('customKcal').value) || 0,
      protein: Number($('customProtein').value) || 0,
      carbs: Number($('customCarbs').value) || 0,
      fat: Number($('customFat').value) || 0,
    },
  };
}

function updateProfilePreview() {
  const targets = calcTargets(readProfileDraft());
  const box = $('profileTargetsPreview');
  if (!targets) {
    box.textContent = 'Completa edad, estatura y peso para calcular tu meta diaria.';
    return;
  }
  box.innerHTML = `
    <strong>Meta diaria (${targets.goal.label}):</strong>
    <span class="num">${targets.kcal} kcal · <strong>${targets.protein} g proteína</strong> · ${targets.carbs} g carbs · ${targets.fat} g grasas</span>
  `;
}

function openSettingsModal(initialTab = 'ai') {
  const p = state.profile || {};
  $('profSex').value = p.sex || 'h';
  $('profAge').value = p.age || '';
  $('profHeight').value = p.height || '';
  $('profWeight').value = p.weight || '';
  $('profActivity').value = p.activity || 'moderado';
  $('profGoal').value = p.goal || 'mantenimiento';
  $('customKcal').value = p.custom?.kcal || '';
  $('customProtein').value = p.custom?.protein || '';
  $('customCarbs').value = p.custom?.carbs || '';
  $('customFat').value = p.custom?.fat || '';
  updateProfilePreview();

  const gem = getGeminiConfig();
  $('geminiKeyInput').value = gem.apiKey;
  $('geminiModelInput').value = gem.model;

  $('householdCodeInput').value = getHouseholdCode();
  $('storageStatusText').textContent =
    state.store?.mode === 'cloud'
      ? `Conectado a Firebase Firestore (código de hogar: ${getHouseholdCode()}).`
      : 'Modo local activo (IndexedDB). Pega tus credenciales en firebase-config.js si deseas sincronizar entre dispositivos.';

  switchSettingsTab(initialTab);
  $('settingsModal').classList.remove('hidden');
}

// =========================================================================
// Coach IA Tool Executor (100% Inventory + Undo)
// =========================================================================
function findByName(list, name) {
  const target = normText(name);
  if (!target) return null;
  return (
    list.find((i) => normText(i.name) === target) ||
    list.find((i) => normText(i.name).includes(target)) ||
    list.find((i) => target.includes(normText(i.name))) ||
    null
  );
}

async function executeCoachTool(name, args) {
  if (name === 'get_inventory') {
    return {
      result: {
        items: state.items.map((i) => ({
          name: i.name,
          category: i.category,
          qty: i.qty,
          min: i.min,
          unit: i.unit,
          status: STATUS_LABEL[statusOf(i)],
          serving: i.serving,
          servingsPerUnit: i.servingsPerUnit,
          kcal: i.kcal,
          protein: i.protein,
          proteinType: i.proteinType,
          carbs: i.carbs,
          carbType: i.carbType,
          fiber: i.fiber,
          sugar: i.sugar,
          fat: i.fat,
          satFat: i.satFat,
          unsatFat: i.unsatFat,
        })),
      },
    };
  }

  if (name === 'get_shopping_list') {
    const list = state.items.filter(inShoppingList).sort(sortItems);
    return {
      result: {
        count: list.length,
        items: list.map((i) => ({
          name: i.name,
          qty: i.qty,
          min: i.min,
          unit: i.unit,
          suggestedBuy: toBuy(i),
          status: STATUS_LABEL[statusOf(i)],
        })),
      },
    };
  }

  if (name === 'get_pantry_analytics') {
    return { result: buildInventorySummaryPayload() };
  }

  if (name === 'add_item') {
    const saved = await state.store.saveItem({
      name: args.name,
      category: args.category || 'Despensa',
      unit: args.unit || 'pzas',
      qty: args.qty ?? 1,
      min: args.min ?? 1,
      needBuy: Boolean(args.needBuy),
      serving: args.serving || '',
      servingsPerUnit: args.servingsPerUnit ?? null,
      kcal: args.kcal ?? null,
      protein: args.protein ?? null,
      proteinType: args.proteinType || 'animal',
      carbs: args.carbs ?? null,
      carbType: args.carbType || 'complejo',
      fiber: args.fiber ?? null,
      sugar: args.sugar ?? null,
      fat: args.fat ?? null,
      satFat: args.satFat ?? null,
      unsatFat: args.unsatFat ?? null,
      sodium: args.sodium ?? null,
      photo: args.attachChatPhoto ? state.activeTurnPhoto : null,
    });
    return {
      result: { ok: true, item: { name: saved.name, qty: saved.qty, unit: saved.unit } },
      action: {
        type: 'action',
        label: `Agregado a despensa: "${saved.name}" (${saved.qty} ${saved.unit})`,
        undo: () => state.store.deleteItem(saved.id),
      },
    };
  }

  if (name === 'update_quantity') {
    const item = findByName(state.items, args.itemName);
    if (!item) return { result: { ok: false, error: `No encontré "${args.itemName}" en la despensa.` } };
    const prev = { ...item };
    const nextQty =
      args.setQty != null
        ? Math.max(0, round(args.setQty, 4))
        : Math.max(0, round(item.qty + (Number(args.delta) || 0), 4));
    await state.store.saveItem({ ...item, qty: nextQty, needBuy: nextQty > item.min ? false : item.needBuy });
    return {
      result: { ok: true, name: item.name, previousQty: prev.qty, newQty: nextQty, unit: item.unit },
      action: {
        type: 'action',
        label: `${item.name}: ${round(prev.qty, 2)} → ${round(nextQty, 2)} ${item.unit}`,
        undo: () => state.store.saveItem(prev),
      },
    };
  }

  if (name === 'set_minimum') {
    const item = findByName(state.items, args.itemName);
    if (!item) return { result: { ok: false, error: `No encontré "${args.itemName}" en la despensa.` } };
    const prev = { ...item };
    const nextMin = Math.max(0, round(args.min, 4));
    await state.store.saveItem({ ...item, min: nextMin });
    return {
      result: { ok: true, name: item.name, min: nextMin, unit: item.unit },
      action: {
        type: 'action',
        label: `Mínimo de ${item.name} actualizado a ${nextMin} ${item.unit}`,
        undo: () => state.store.saveItem(prev),
      },
    };
  }

  if (name === 'mark_for_shopping') {
    const item = findByName(state.items, args.itemName);
    if (!item) return { result: { ok: false, error: `No encontré "${args.itemName}" en la despensa.` } };
    const prev = { ...item };
    await state.store.saveItem({ ...item, needBuy: Boolean(args.needBuy) });
    return {
      result: { ok: true, name: item.name, needBuy: Boolean(args.needBuy) },
      action: {
        type: 'action',
        label: `${item.name}: ${args.needBuy ? 'enviado a compras' : 'quitado de compras'}`,
        undo: () => state.store.saveItem(prev),
      },
    };
  }

  return { result: { ok: false, error: `Herramienta desconocida: ${name}` } };
}

async function sendChatMessage(text) {
  const clean = text.trim();
  const photo = state.pendingChatPhoto;
  if ((!clean && !photo) || state.chatBusy) return;
  if (!hasGeminiKey()) {
    toast('Agrega tu Gemini API Key en Ajustes para usar el Asistente IA.');
    openSettingsModal('ai');
    return;
  }

  setPendingChatPhoto(null);
  state.activeTurnPhoto = photo;
  state.chatUi.push({ role: 'user', text: clean || '📷 Foto enviada', photo });
  state.chatBusy = true;
  $('chatSendBtn').disabled = true;
  renderChat();

  try {
    const res = await runCoachTurn(state.chatHistory, clean, executeCoachTool, photo);
    state.chatHistory = res.history;
    for (const act of res.actions) {
      state.chatUi.push(act);
    }
    state.chatUi.push({ role: 'ai', text: res.text });
  } catch (err) {
    state.chatUi.push({ role: 'ai', text: `Error: ${err.message}` });
  } finally {
    state.activeTurnPhoto = null;
    state.chatBusy = false;
    $('chatSendBtn').disabled = false;
    renderChat();
  }
}

// =========================================================================
// Shopping export
// =========================================================================
function buildShoppingText() {
  const list = state.items.filter(inShoppingList).sort(sortItems);
  if (!list.length) return '';
  const lines = ['Lista de compras — FitDespensa', ''];
  list.forEach((it) => {
    lines.push(`• ${it.name}: comprar ${toBuy(it)} ${it.unit} (quedan ${round(it.qty, 2)})`);
  });
  return lines.join('\n');
}

// =========================================================================
// Event Wiring
// =========================================================================
function bindEvents() {
  $('themeBtn').addEventListener('click', toggleTheme);
  $('themeBtnMobile').addEventListener('click', toggleTheme);
  $('settingsBtn').addEventListener('click', () => openSettingsModal('profile'));
  $('settingsBtnMobile').addEventListener('click', () => openSettingsModal('profile'));
  $('openSettingsFromCoach').addEventListener('click', () => openSettingsModal('ai'));

  document.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.querySelectorAll('.stab').forEach((btn) => {
    btn.addEventListener('click', () => switchSettingsTab(btn.dataset.stab));
  });

  $('sidebarAddBtn').addEventListener('click', () => openItemModal(null));
  $('mobileAddBtn').addEventListener('click', () => openItemModal(null));
  $('catalogAddBtn').addEventListener('click', () => openItemModal(null));

  // AI Recommendations triggers
  $('askRecsBtn').addEventListener('click', () => {
    $('pantryAiRecsBox').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    requestAiRecommendations('general');
  });
  document.querySelectorAll('[data-rec-focus]').forEach((btn) => {
    btn.addEventListener('click', () => requestAiRecommendations(btn.dataset.recFocus));
  });
  $('aiSuggestShoppingBtn').addEventListener('click', () => requestAiRecommendations('shopping'));

  // Chat photo & voice
  $('chatPhotoBtn').addEventListener('click', () => $('chatPhotoInput').click());
  $('chatPhotoInput').addEventListener('change', (e) => {
    handlePhotoFile(e.target.files?.[0], 'chat');
    e.target.value = '';
  });
  $('removeChatPhotoBtn').addEventListener('click', () => setPendingChatPhoto(null));
  $('chatVoiceBtn').addEventListener('click', toggleVoiceInput);

  $('searchInput').addEventListener('input', (e) => {
    state.search = e.target.value;
    renderAll();
  });

  document.querySelectorAll('[data-stock-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.stockFilter = btn.dataset.stockFilter;
      document.querySelectorAll('[data-stock-filter]').forEach((b) =>
        b.classList.toggle('active', b.dataset.stockFilter === state.stockFilter)
      );
      renderAll();
    });
  });

  document.querySelectorAll('[data-view-mode]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.viewMode === state.viewMode);
    btn.addEventListener('click', () => {
      state.viewMode = btn.dataset.viewMode;
      localStorage.setItem('fitdespensa_view', state.viewMode);
      document.querySelectorAll('[data-view-mode]').forEach((b) =>
        b.classList.toggle('active', b.dataset.viewMode === state.viewMode)
      );
      renderAll();
    });
  });

  $('categoryChips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-cat]');
    if (!chip) return;
    state.category = chip.dataset.cat;
    renderAll();
  });

  document.querySelector('.main').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id, dir, idx } = btn.dataset;

    if (action === 'open-settings') openSettingsModal('profile');
    else if (action === 'open-ai-settings') openSettingsModal('ai');
    else if (action === 'close-recs') {
      state.aiRecs = null;
      state.aiRecsError = null;
      renderRecsPanels();
    } else if (action === 'go-catalog') switchTab('catalog');
    else if (action === 'go-shopping') switchTab('shopping');
    else if (action === 'go-coach') switchTab('coach');
    else if (action === 'toggle-quality') {
      const det = $('pantryQualityDetails');
      det.open = !det.open;
      if (det.open) det.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else if (action === 'new-item') openItemModal(null);
    else if (action === 'seed-sample') {
      await state.store.seedSampleItems();
      toast('Despensa fitness de ejemplo cargada');
    } else if (action === 'edit-item') {
      const it = state.items.find((x) => x.id === id);
      if (it) openItemModal(it);
    } else if (action === 'toggle-cart') {
      const it = state.items.find((x) => x.id === id);
      if (!it) return;
      const next = !it.needBuy;
      await state.store.saveItem({ ...it, needBuy: next });
      toast(next ? `"${it.name}" añadido a compras` : `"${it.name}" desmarcado`);
    } else if (action === 'step-qty') {
      const it = state.items.find((x) => x.id === id);
      if (!it) return;
      const step = stepFor(it.unit);
      const nextQty = Math.max(0, round(it.qty + Number(dir) * step, 4));
      await state.store.saveItem({ ...it, qty: nextQty, needBuy: nextQty > it.min ? false : it.needBuy });
    } else if (action === 'mark-bought') {
      const it = state.items.find((x) => x.id === id);
      if (!it) return;
      const bought = toBuy(it);
      await state.store.saveItem({ ...it, qty: round(it.qty + bought, 4), needBuy: false });
      toast(`+${bought} ${it.unit} de ${it.name}`);
    } else if (action === 'add-rec-buy') {
      await addSuggestedPurchase(Number(idx));
    }
  });

  $('copyListBtn').addEventListener('click', async () => {
    const text = buildShoppingText();
    if (!text) return toast('No hay artículos por comprar');
    await navigator.clipboard.writeText(text);
    toast('Lista copiada al portapapeles');
  });
  $('whatsappBtn').addEventListener('click', () => {
    const text = buildShoppingText();
    if (!text) return toast('No hay artículos por comprar');
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  });

  $('coachSuggestions').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-prompt]');
    if (!chip) return;
    sendChatMessage(chip.dataset.prompt);
  });
  $('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const val = $('chatInput').value;
    $('chatInput').value = '';
    sendChatMessage(val);
  });
  $('clearChatBtn').addEventListener('click', () => {
    state.chatHistory = [];
    state.chatUi = [WELCOME_MSG];
    setPendingChatPhoto(null);
    renderChat();
    toast('Conversación reiniciada');
  });

  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => $(btn.dataset.closeModal).classList.add('hidden'));
  });
  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        if (backdrop.id === 'cameraModal') closeCameraModal();
        else backdrop.classList.add('hidden');
      }
    });
  });

  $('takePhotoBtn').addEventListener('click', openCameraFlow);
  $('galleryPhotoBtn').addEventListener('click', () => $('galleryFileInput').click());
  $('cameraFileInput').addEventListener('change', (e) => {
    handlePhotoFile(e.target.files?.[0], 'item');
    e.target.value = '';
  });
  $('galleryFileInput').addEventListener('change', (e) => {
    handlePhotoFile(e.target.files?.[0], 'item');
    e.target.value = '';
  });
  $('removePhotoBtn').addEventListener('click', () => setModalPhoto(null));
  $('scanPhotoBtn').addEventListener('click', scanCurrentPhoto);

  $('scanBarcodeBtn').addEventListener('click', async () => {
    try {
      $('cameraModalTitle').textContent = 'Escanear código de barras';
      $('capturePhotoBtn').classList.add('hidden');
      $('cameraModal').classList.remove('hidden');
      state.barcodeScanner = await startBarcodeScanner($('cameraVideo'), (code) => {
        closeCameraModal();
        $('itemBarcode').value = code;
        $('barcodeLookupBtn').click();
      });
    } catch (err) {
      closeCameraModal();
      toast(err.message);
    }
  });

  $('barcodeLookupBtn').addEventListener('click', async () => {
    const code = $('itemBarcode').value.trim();
    if (!code) return toast('Escribe un código de barras');
    const btn = $('barcodeLookupBtn');
    btn.disabled = true;
    btn.textContent = 'Buscando...';
    try {
      const p = await lookupBarcode(code);
      if (p.name) $('itemName').value = p.name;
      if (p.serving) $('itemServing').value = p.serving;
      if (p.kcal != null) $('itemKcal').value = p.kcal;
      if (p.protein != null) $('itemProtein').value = p.protein;
      if (p.carbs != null) $('itemCarbs').value = p.carbs;
      if (p.fiber != null) $('itemFiber').value = p.fiber;
      if (p.sugar != null) $('itemSugar').value = p.sugar;
      if (p.fat != null) $('itemFat').value = p.fat;
      if (p.satFat != null) $('itemSatFat').value = p.satFat;
      if (p.unsatFat != null) $('itemUnsatFat').value = p.unsatFat;
      if (p.sodium != null) $('itemSodium').value = p.sodium;
      $('nutritionDetails').open = true;
      toast(`Tabla nutrimental cargada: ${p.name}`);
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Buscar';
    }
  });

  $('closeCameraBtn').addEventListener('click', closeCameraModal);
  $('cancelCameraBtn').addEventListener('click', closeCameraModal);
  $('capturePhotoBtn').addEventListener('click', () => {
    if (!state.webcam) return;
    try {
      const dataUrl = state.webcam.capture();
      setModalPhoto(dataUrl);
      closeCameraModal();
      if (hasGeminiKey()) {
        toast('Foto capturada · autocompletando tabla nutrimental...');
        scanCurrentPhoto();
      } else {
        toast('Foto capturada');
      }
    } catch (err) {
      toast(err.message);
    }
  });

  $('itemForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('itemId').value || undefined;
    await state.store.saveItem({
      id,
      name: $('itemName').value,
      category: $('itemCategory').value,
      unit: $('itemUnit').value,
      qty: $('itemQty').value,
      min: $('itemMin').value,
      needBuy: $('itemNeedBuy').checked,
      serving: $('itemServing').value,
      servingsPerUnit: $('itemServingsPerUnit').value,
      kcal: $('itemKcal').value,
      protein: $('itemProtein').value,
      proteinType: $('itemProteinType').value,
      carbs: $('itemCarbs').value,
      carbType: $('itemCarbType').value,
      fiber: $('itemFiber').value,
      sugar: $('itemSugar').value,
      fat: $('itemFat').value,
      satFat: $('itemSatFat').value,
      unsatFat: $('itemUnsatFat').value,
      sodium: $('itemSodium').value,
      photo: state.currentPhoto,
    });
    $('itemModal').classList.add('hidden');
    toast(id ? 'Producto actualizado' : 'Producto agregado');
  });

  $('deleteItemBtn').addEventListener('click', async () => {
    const id = $('itemId').value;
    if (!id) return;
    await state.store.deleteItem(id);
    $('itemModal').classList.add('hidden');
    toast('Producto eliminado');
  });

  $('profileForm').addEventListener('input', updateProfilePreview);
  $('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await state.store.saveProfile(readProfileDraft());
    toast('Meta fitness guardada');
  });

  $('toggleKeyVisBtn').addEventListener('click', () => {
    const inp = $('geminiKeyInput');
    const isHidden = inp.type === 'password';
    inp.type = isHidden ? 'text' : 'password';
    $('toggleKeyVisBtn').textContent = isHidden ? 'Ocultar' : 'Ver';
  });

  async function runGeminiConnect(closeOnSuccess = false) {
    const out = $('geminiTestResult');
    const saveBtn = $('saveGeminiBtn');
    const testBtn = $('testGeminiBtn');
    out.classList.remove('hidden');
    out.innerHTML = '⏳ Validando tu API Key y detectando el modelo compatible en Google...';
    saveBtn.disabled = true;
    testBtn.disabled = true;

    try {
      const info = await connectAndVerifyGemini($('geminiKeyInput').value, $('geminiModelInput').value);
      $('geminiKeyInput').value = info.apiKey;
      $('geminiModelInput').value = info.model;
      state.aiRecsError = null;
      renderAll();
      out.innerHTML = `<strong style="color:var(--ok)">✅ ¡Conectado con éxito!</strong> Modelo activo: <code>${esc(info.model)}</code>.`;
      toast('¡IA de Gemini conectada y lista!');
      if (closeOnSuccess) {
        setTimeout(() => {
          $('settingsModal').classList.add('hidden');
          requestAiRecommendations('general');
        }, 800);
      }
    } catch (err) {
      renderAll();
      const msg = String(err.message || err);
      let hint = 'Verifica que copiaste la clave completa (empieza con <code>AIza...</code>) desde Google AI Studio.';
      if (msg.toLowerCase().includes('referer') || msg.toLowerCase().includes('blocked')) {
        hint = 'Tu clave tiene restricciones de sitio web en Google Cloud/AI Studio. Quita las restricciones de HTTP Referrer o agrega <code>https://derekdgv-boop.github.io/*</code>.';
      } else if (msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('network')) {
        hint = 'El navegador o red bloqueó la conexión a <code>generativelanguage.googleapis.com</code>. Pruébalo directo en Chrome o Safari.';
      }
      out.innerHTML = `<strong style="color:var(--danger)">❌ No se pudo conectar:</strong> ${esc(msg)}<div class="muted small-note" style="margin-top:6px;">💡 ${hint}</div>`;
    } finally {
      saveBtn.disabled = false;
      testBtn.disabled = false;
    }
  }

  $('geminiForm').addEventListener('submit', (e) => {
    e.preventDefault();
    runGeminiConnect(true);
  });

  $('testGeminiBtn').addEventListener('click', () => {
    runGeminiConnect(false);
  });

  $('detectModelsBtn').addEventListener('click', async () => {
    setGeminiConfig({ apiKey: $('geminiKeyInput').value });
    const btn = $('detectModelsBtn');
    const out = $('geminiTestResult');
    out.classList.remove('hidden');
    out.textContent = 'Consultando modelos disponibles para tu clave...';
    btn.disabled = true;
    try {
      const models = await listGeminiModels();
      if (!models.length) {
        out.innerHTML = `<strong style="color:var(--danger)">Sin modelos disponibles</strong> para esta API key.`;
        return;
      }
      const listEl = $('geminiModelSuggestions');
      listEl.innerHTML = models.map((m) => `<option value="${esc(m)}"></option>`).join('');
      const preferred =
        models.find((m) => m === 'gemini-3.8-flash') ||
        models.find((m) => m.includes('3.') && m.includes('flash')) ||
        models.find((m) => m.includes('flash') && !m.includes('2.5-flash') && !m.includes('2.0-flash')) ||
        models[0];
      $('geminiModelInput').value = preferred;
      setGeminiConfig({ model: preferred });
      renderAll();
      out.innerHTML = `<strong style="color:var(--ok)">${models.length} modelos detectados.</strong> Seleccionado: <code>${esc(preferred)}</code>. Pulsa <strong>Probar conexión</strong>.`;
    } catch (err) {
      out.innerHTML = `<strong style="color:var(--danger)">Error al detectar modelos:</strong> ${esc(err.message)}`;
    } finally {
      btn.disabled = false;
    }
  });

  $('saveHouseholdBtn').addEventListener('click', () => {
    try {
      setHouseholdCode($('householdCodeInput').value);
      toast('Código guardado. Recargando...');
      setTimeout(() => location.reload(), 600);
    } catch (err) {
      toast(err.message);
    }
  });

  $('seedDataBtn').addEventListener('click', async () => {
    await state.store.seedSampleItems();
    toast('Productos fitness de ejemplo agregados');
  });
}

// =========================================================================
// Boot
// =========================================================================
async function boot() {
  initTheme();
  populateStaticSelects();
  bindEvents();

  state.store = await initStorage();
  const modeText = state.store.mode === 'cloud' ? `Nube · ${getHouseholdCode()}` : 'Local · IndexedDB';
  $('syncBadge').textContent = modeText;
  $('syncBadgeMobile').textContent = state.store.mode === 'cloud' ? 'Nube' : 'Local';

  state.store.subscribeItems((items) => {
    state.items = items;
    renderAll();
  });

  state.store.subscribeProfile((profile) => {
    state.profile = profile;
    renderAll();
  });
}

boot();
