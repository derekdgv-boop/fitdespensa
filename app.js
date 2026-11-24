// app.js — FitDespensa AI-First orchestrator (Multimodal Coach, Voice, Recipes, Pantry)
import { CATEGORIES, MEALS, UNITS } from './constants.js';
import {
  STATUS_LABEL,
  inShoppingList,
  normText,
  round,
  sortItems,
  statusOf,
  stepFor,
  toBuy,
} from './inventory.js';
import {
  ACTIVITY_LEVELS,
  GOALS,
  addDays,
  calcTargets,
  consumeFromItem,
  coverageDays,
  defaultMeal,
  logTotals,
  pantryTotals,
  todayStr,
} from './nutrition.js';
import { getHouseholdCode, initStorage, setHouseholdCode } from './storage.js?v=8';
import { canUseWebcam, compressFile, dataUrlByteSize, isMobileDevice, startWebcam } from './camera.js?v=8';
import {
  getGeminiConfig,
  hasGeminiKey,
  listGeminiModels,
  recognizeProduct,
  runCoachTurn,
  setGeminiConfig,
  testGeminiConnection,
} from './ai.js?v=8';
import {
  esc,
  formatCoachText,
  formatDateHeading,
  renderCatalog,
  renderCategoryChips,
  renderDiaryMeals,
  renderDiarySummary,
  renderLiveStrip,
  renderRecipes,
  renderShoppingList,
} from './ui.js?v=8';

const SVG_SUN = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`;
const SVG_MOON = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`;
const SVG_CAMERA_PLACEHOLDER = `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" class="muted"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;

const WELCOME_MSG = {
  role: 'ai',
  text: '¡Hola! Soy tu **Coach IA de FitDespensa**.\n\nSolo **escríbeme, háblame con el micrófono o mándame una foto**:\n• Foto de tu plato → estimo macros y lo subo a tu diario\n• «Me comí 3 huevos con avena» → lo registro y descuento de tu despensa\n• «Guarda esta comida como receta» → queda lista en **Mis Recetas** para repetirla en 1 toque',
};

// =========================================================================
// State
// =========================================================================
const state = {
  store: null,
  items: [],
  recipes: [],
  profile: null,
  activeTab: 'coach',
  mealsSub: 'today',
  search: '',
  category: 'Todas',
  stockFilter: 'all',
  viewMode: localStorage.getItem('fitdespensa_view') || 'grid',
  diaryDate: todayStr(),
  diaryLogs: [],
  todayLogs: [],
  unsubDiary: null,
  currentPhoto: null,
  currentRecipePhoto: null,
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

  $('liveSummaryStrip').innerHTML = renderLiveStrip({
    items: state.items,
    profile: state.profile,
    todayLogs: state.todayLogs,
  });

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

  const heading = formatDateHeading(state.diaryDate);
  $('diaryDateLabel').textContent = heading.label;
  $('diaryDateSub').textContent = heading.sub;
  $('diarySummary').innerHTML = renderDiarySummary(state.diaryLogs, state.profile);
  $('diaryMeals').innerHTML = renderDiaryMeals(state.diaryLogs);

  $('recipesCountBadge').textContent = state.recipes.length ? `(${state.recipes.length})` : '';
  $('recipesList').innerHTML = renderRecipes(state.recipes);

  $('shoppingList').innerHTML = renderShoppingList(state.items);

  const keyReady = hasGeminiKey();
  $('coachKeyBanner').classList.toggle('hidden', keyReady);
  $('coachStatusSub').textContent = keyReady
    ? `${getGeminiConfig().model} · Manda texto, voz o foto`
    : 'Configura tu clave de Gemini en Ajustes';

  renderChat();
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

      const btns = document.createElement('div');
      btns.className = 'action-card-actions';

      if (entry.saveRecipeData && !entry.recipeSaved) {
        const recBtn = document.createElement('button');
        recBtn.type = 'button';
        recBtn.className = 'btn btn-primary btn-xs';
        recBtn.textContent = '★ Guardar receta';
        recBtn.onclick = async () => {
          recBtn.disabled = true;
          await state.store.saveRecipe(entry.saveRecipeData);
          entry.recipeSaved = true;
          renderChat();
          toast('Guardada en Mis Recetas');
        };
        btns.appendChild(recBtn);
      }

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
        btns.appendChild(btn);
      }

      if (btns.childElementCount) card.appendChild(btns);
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

function switchMealsSub(sub) {
  state.mealsSub = sub;
  document.querySelectorAll('[data-meals-sub]').forEach((b) =>
    b.classList.toggle('active', b.dataset.mealsSub === sub)
  );
  $('subview-today').classList.toggle('hidden', sub !== 'today');
  $('subview-recipes').classList.toggle('hidden', sub !== 'recipes');
}

function switchSettingsTab(stab) {
  document.querySelectorAll('.stab').forEach((b) => b.classList.toggle('active', b.dataset.stab === stab));
  document.querySelectorAll('.stab-panel').forEach((p) => p.classList.toggle('active', p.dataset.stabPanel === stab));
}

// =========================================================================
// Diary subscription
// =========================================================================
function setDiaryDate(dateStr) {
  state.diaryDate = dateStr;
  if (state.unsubDiary) state.unsubDiary();
  if (dateStr === todayStr()) {
    state.diaryLogs = state.todayLogs;
    state.unsubDiary = null;
    renderAll();
    return;
  }
  state.unsubDiary = state.store.subscribeLogs(dateStr, (entries) => {
    state.diaryLogs = entries;
    renderAll();
  });
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
// Item Modal + Camera + AI Photo Scan
// =========================================================================
function populateStaticSelects() {
  $('itemCategory').innerHTML = CATEGORIES.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
  $('itemUnit').innerHTML = UNITS.map((u) => `<option value="${esc(u)}">${esc(u)}</option>`).join('');
  const mealOpts = MEALS.map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('');
  $('logMeal').innerHTML = mealOpts;
  $('recipeMeal').innerHTML = mealOpts;
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
    $('photoMeta').textContent = 'Se comprime automáticamente (~30 KB) junto al producto';
    $('removePhotoBtn').classList.add('hidden');
    $('scanPhotoBtn').classList.add('hidden');
  }
}

function setRecipeModalPhoto(dataUrl) {
  state.currentRecipePhoto = dataUrl || null;
  const preview = $('recipePhotoPreview');
  if (state.currentRecipePhoto) {
    preview.innerHTML = `<img src="${state.currentRecipePhoto}" alt="Foto receta" />`;
    $('removeRecipePhotoBtn').classList.remove('hidden');
  } else {
    preview.innerHTML = SVG_CAMERA_PLACEHOLDER;
    $('removeRecipePhotoBtn').classList.add('hidden');
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
  $('itemProtein').value = item?.protein ?? '';
  $('itemCarbs').value = item?.carbs ?? '';
  $('itemFat').value = item?.fat ?? '';
  $('deleteItemBtn').classList.toggle('hidden', !item);
  setModalPhoto(item?.photo || null);
  $('itemModal').classList.remove('hidden');
}

function openRecipeModal(recipe = null) {
  $('recipeForm').reset();
  $('recipeId').value = recipe?.id || '';
  $('recipeModalTitle').textContent = recipe?.id ? 'Editar receta' : 'Guardar receta';
  $('recipeName').value = recipe?.name || '';
  $('recipeMeal').value = recipe?.meal || defaultMeal();
  $('recipeKcal').value = recipe?.kcal ?? 0;
  $('recipeProtein').value = recipe?.protein ?? 0;
  $('recipeCarbs').value = recipe?.carbs ?? 0;
  $('recipeFat').value = recipe?.fat ?? 0;
  $('recipeIngredients').value = Array.isArray(recipe?.ingredients) ? recipe.ingredients.join('\n') : '';
  $('recipeSteps').value = recipe?.steps || '';
  $('deleteRecipeBtn').classList.toggle('hidden', !recipe?.id);
  setRecipeModalPhoto(recipe?.photo || null);
  $('recipeModal').classList.remove('hidden');
}

async function handlePhotoFile(file, target = 'item') {
  if (!file) return;
  try {
    const dataUrl = await compressFile(file);
    if (target === 'chat') {
      setPendingChatPhoto(dataUrl);
    } else if (target === 'recipe') {
      setRecipeModalPhoto(dataUrl);
      toast('Foto agregada a la receta');
    } else {
      setModalPhoto(dataUrl);
      toast('Foto agregada');
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
  btn.textContent = 'Analizando imagen...';
  try {
    const data = await recognizeProduct(state.currentPhoto);
    if (data.name) $('itemName').value = data.name;
    if (data.category) $('itemCategory').value = data.category;
    if (data.unit) $('itemUnit').value = data.unit;
    if (data.serving) $('itemServing').value = data.serving;
    if (data.servingsPerUnit != null) $('itemServingsPerUnit').value = data.servingsPerUnit;
    if (data.kcal != null) $('itemKcal').value = data.kcal;
    if (data.protein != null) $('itemProtein').value = data.protein;
    if (data.carbs != null) $('itemCarbs').value = data.carbs;
    if (data.fat != null) $('itemFat').value = data.fat;
    toast('Datos detectados con Gemini. Revisa y guarda.');
  } catch (err) {
    toast('Error al escanear: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ Autocompletar con Gemini';
  }
}

// =========================================================================
// Log Food Modal
// =========================================================================
function openLogModal(preselectedItemId = '', preselectedMeal = '') {
  $('logForm').reset();
  $('logMeal').value = preselectedMeal || defaultMeal();
  $('logServings').value = 1;

  const select = $('logItemSelect');
  const sorted = [...state.items].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  select.innerHTML =
    `<option value="">— Alimento manual (fuera de despensa) —</option>` +
    sorted
      .map(
        (it) =>
          `<option value="${esc(it.id)}">${esc(it.name)} (${round(it.qty, 2)} ${esc(it.unit)} · ${it.protein ?? 0}g PRO)</option>`
      )
      .join('');

  select.value = preselectedItemId || '';
  syncLogFormFromItem();
  $('logModal').classList.remove('hidden');
}

function syncLogFormFromItem() {
  const itemId = $('logItemSelect').value;
  const servings = Math.max(0.1, Number($('logServings').value) || 1);
  const item = state.items.find((i) => i.id === itemId);

  if (item) {
    const res = consumeFromItem(item, servings);
    $('logName').value = item.name;
    $('logKcal').value = res.macros.kcal;
    $('logProtein').value = res.macros.protein;
    $('logCarbs').value = res.macros.carbs;
    $('logFat').value = res.macros.fat;
    $('logDeductRow').classList.remove('hidden');
    $('logDeductLabel').textContent = `Descontar ${res.unitsUsed} ${item.unit} de "${item.name}"`;
  } else {
    $('logDeductRow').classList.add('hidden');
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
    box.textContent = 'Completa edad, estatura y peso para calcular tus metas diarias.';
    return;
  }
  box.innerHTML = `
    <strong>Meta diaria (${targets.goal.label}):</strong>
    <span class="num">${targets.kcal} kcal · <strong>${targets.protein} g proteína</strong> · ${targets.carbs} g carbs · ${targets.fat} g grasas</span>
    <div class="muted small-note">TMB ${targets.auto.bmr} kcal · Gasto estimado ${targets.auto.tdee} kcal</div>
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
// Coach IA Tool Executor (with Undo & Recipe quick-save)
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
          carbs: i.carbs,
          fat: i.fat,
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

  if (name === 'get_recipes') {
    return {
      result: {
        count: state.recipes.length,
        recipes: state.recipes.map((r) => ({
          name: r.name,
          meal: r.meal,
          kcal: r.kcal,
          protein: r.protein,
          carbs: r.carbs,
          fat: r.fat,
          ingredients: r.ingredients,
        })),
      },
    };
  }

  if (name === 'get_profile_and_today') {
    const targets = calcTargets(state.profile);
    const totals = pantryTotals(state.items);
    const cov = coverageDays(totals, targets);
    const eaten = logTotals(state.todayLogs);
    return {
      result: {
        profile: state.profile,
        dailyTargets: targets,
        pantryTotals: totals,
        coverageDays: cov,
        todayDate: todayStr(),
        eatenToday: eaten,
        remainingToday: targets
          ? {
              kcal: Math.round(targets.kcal - eaten.kcal),
              protein: round(targets.protein - eaten.protein, 1),
              carbs: round(targets.carbs - eaten.carbs, 1),
              fat: round(targets.fat - eaten.fat, 1),
            }
          : null,
        todayEntries: state.todayLogs.map((e) => ({
          meal: e.meal,
          name: e.name,
          servings: e.servings,
          kcal: e.kcal,
          protein: e.protein,
        })),
      },
    };
  }

  if (name === 'save_recipe') {
    const saved = await state.store.saveRecipe({
      name: args.name,
      meal: args.meal || defaultMeal(),
      kcal: args.kcal,
      protein: args.protein,
      carbs: args.carbs || 0,
      fat: args.fat || 0,
      ingredients: Array.isArray(args.ingredients) ? args.ingredients : [],
      steps: args.steps || '',
      photo: args.attachChatPhoto ? state.activeTurnPhoto : null,
    });
    return {
      result: { ok: true, recipe: { name: saved.name, kcal: saved.kcal, protein: saved.protein } },
      action: {
        type: 'action',
        label: `Receta guardada: "${saved.name}" (${saved.kcal} kcal · ${saved.protein}g PRO)`,
        undo: () => state.store.deleteRecipe(saved.id),
      },
    };
  }

  if (name === 'log_recipe') {
    const rec = findByName(state.recipes, args.recipeName);
    if (!rec) return { result: { ok: false, error: `No encontré la receta "${args.recipeName}".` } };
    const servings = Math.max(0.25, Number(args.servings) || 1);
    const date = todayStr();
    const entry = {
      date,
      meal: args.meal || rec.meal || defaultMeal(),
      itemId: null,
      recipeId: rec.id,
      name: rec.name,
      servings,
      kcal: round(rec.kcal * servings, 1),
      protein: round(rec.protein * servings, 1),
      carbs: round(rec.carbs * servings, 1),
      fat: round(rec.fat * servings, 1),
      unitsUsed: 0,
    };
    const savedLog = await state.store.addLog(entry);
    return {
      result: { ok: true, logged: entry },
      action: {
        type: 'action',
        label: `Registrada receta "${rec.name}" (${Math.round(entry.kcal)} kcal · ${entry.protein}g PRO)`,
        undo: () => state.store.deleteLog(savedLog.id, date),
      },
    };
  }

  if (name === 'add_item') {
    const saved = await state.store.saveItem({
      name: args.name,
      category: args.category || 'Despensa',
      unit: args.unit || 'pzas',
      qty: Number(args.qty) || 1,
      min: Number(args.min) || 1,
      serving: args.serving || '',
      servingsPerUnit: args.servingsPerUnit ?? null,
      kcal: args.kcal ?? null,
      protein: args.protein ?? null,
      carbs: args.carbs ?? null,
      fat: args.fat ?? null,
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

  if (name === 'log_food') {
    const servings = Math.max(0.1, Number(args.servings) || 1);
    const meal = args.meal || defaultMeal();
    const deduct = args.deductInventory !== false;
    const item = findByName(state.items, args.itemName);
    const date = todayStr();

    let prevItem = null;
    let entryPayload;
    if (item) {
      const calc = consumeFromItem(item, servings);
      entryPayload = {
        date,
        meal,
        itemId: item.id,
        name: item.name,
        servings,
        ...calc.macros,
        unitsUsed: deduct ? calc.unitsUsed : 0,
      };
      if (deduct) {
        prevItem = { ...item };
        await state.store.saveItem({ ...item, qty: calc.newQty });
      }
    } else {
      entryPayload = {
        date,
        meal,
        itemId: null,
        name: args.itemName,
        servings,
        kcal: round(Number(args.kcal) || 0, 1),
        protein: round(Number(args.protein) || 0, 1),
        carbs: round(Number(args.carbs) || 0, 1),
        fat: round(Number(args.fat) || 0, 1),
        unitsUsed: 0,
      };
    }

    const savedLog = await state.store.addLog(entryPayload);
    return {
      result: {
        ok: true,
        logged: entryPayload,
        deductedFromPantry: Boolean(prevItem),
        newPantryQty: prevItem ? consumeFromItem(prevItem, servings).newQty : null,
      },
      action: {
        type: 'action',
        label: `Registrado: ${entryPayload.name} (${Math.round(entryPayload.kcal)} kcal · ${entryPayload.protein}g PRO)${prevItem ? ' y descontado' : ''}`,
        saveRecipeData: {
          name: entryPayload.name,
          meal: entryPayload.meal,
          kcal: entryPayload.kcal,
          protein: entryPayload.protein,
          carbs: entryPayload.carbs,
          fat: entryPayload.fat,
          photo: state.activeTurnPhoto || null,
        },
        undo: async () => {
          await state.store.deleteLog(savedLog.id, date);
          if (prevItem) await state.store.saveItem(prevItem);
        },
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
    toast('Agrega tu Gemini API Key en Ajustes para usar el Coach IA.');
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

  document.querySelectorAll('[data-meals-sub]').forEach((btn) => {
    btn.addEventListener('click', () => switchMealsSub(btn.dataset.mealsSub));
  });

  document.querySelectorAll('.stab').forEach((btn) => {
    btn.addEventListener('click', () => switchSettingsTab(btn.dataset.stab));
  });

  $('sidebarAddBtn').addEventListener('click', () => openItemModal(null));
  $('mobileAddBtn').addEventListener('click', () => openItemModal(null));
  $('catalogAddBtn').addEventListener('click', () => openItemModal(null));
  $('newRecipeBtn').addEventListener('click', () => openRecipeModal(null));

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
    const { action, id, dir, meal } = btn.dataset;

    if (action === 'open-settings') openSettingsModal('profile');
    else if (action === 'go-diary') { switchTab('diary'); switchMealsSub('today'); }
    else if (action === 'go-catalog') switchTab('catalog');
    else if (action === 'go-shopping') switchTab('shopping');
    else if (action === 'go-coach') switchTab('coach');
    else if (action === 'new-item') openItemModal(null);
    else if (action === 'new-recipe') openRecipeModal(null);
    else if (action === 'open-log') openLogModal();
    else if (action === 'open-log-meal') openLogModal('', meal);
    else if (action === 'seed-sample') {
      await state.store.seedSampleItems();
      toast('Despensa fitness de ejemplo cargada');
    } else if (action === 'edit-item') {
      const it = state.items.find((x) => x.id === id);
      if (it) openItemModal(it);
    } else if (action === 'quick-log') {
      openLogModal(id);
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
    } else if (action === 'save-log-recipe') {
      const entry = state.diaryLogs.find((x) => x.id === id);
      if (entry) {
        openRecipeModal({
          name: entry.name,
          meal: entry.meal,
          kcal: Math.round(entry.kcal || 0),
          protein: round(entry.protein || 0, 1),
          carbs: round(entry.carbs || 0, 1),
          fat: round(entry.fat || 0, 1),
        });
      }
    } else if (action === 'delete-log') {
      const entry = state.diaryLogs.find((x) => x.id === id);
      await state.store.deleteLog(id, state.diaryDate);
      if (entry?.itemId && entry.unitsUsed > 0) {
        const it = state.items.find((x) => x.id === entry.itemId);
        if (it) {
          await state.store.saveItem({ ...it, qty: round(it.qty + entry.unitsUsed, 4) });
        }
      }
      toast('Registro eliminado');
    } else if (action === 'eat-recipe') {
      const rec = state.recipes.find((r) => r.id === id);
      if (!rec) return;
      await state.store.addLog({
        date: todayStr(),
        meal: rec.meal || defaultMeal(),
        itemId: null,
        recipeId: rec.id,
        name: rec.name,
        servings: 1,
        kcal: rec.kcal,
        protein: rec.protein,
        carbs: rec.carbs,
        fat: rec.fat,
        unitsUsed: 0,
      });
      toast(`"${rec.name}" registrada en tu diario de hoy`);
    } else if (action === 'edit-recipe') {
      const rec = state.recipes.find((r) => r.id === id);
      if (rec) openRecipeModal(rec);
    } else if (action === 'delete-recipe') {
      await state.store.deleteRecipe(id);
      toast('Receta eliminada');
    }
  });

  $('prevDayBtn').addEventListener('click', () => setDiaryDate(addDays(state.diaryDate, -1)));
  $('nextDayBtn').addEventListener('click', () => setDiaryDate(addDays(state.diaryDate, 1)));
  $('addLogBtn').addEventListener('click', () => openLogModal());

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

  // Recipe photo & form
  $('recipePhotoBtn').addEventListener('click', () => $('recipePhotoInput').click());
  $('recipePhotoInput').addEventListener('change', (e) => {
    handlePhotoFile(e.target.files?.[0], 'recipe');
    e.target.value = '';
  });
  $('removeRecipePhotoBtn').addEventListener('click', () => setRecipeModalPhoto(null));

  $('recipeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('recipeId').value || undefined;
    const ingredients = $('recipeIngredients')
      .value.split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    await state.store.saveRecipe({
      id,
      name: $('recipeName').value,
      meal: $('recipeMeal').value,
      kcal: $('recipeKcal').value,
      protein: $('recipeProtein').value,
      carbs: $('recipeCarbs').value,
      fat: $('recipeFat').value,
      ingredients,
      steps: $('recipeSteps').value,
      photo: state.currentRecipePhoto,
    });
    $('recipeModal').classList.add('hidden');
    toast(id ? 'Receta actualizada' : 'Receta guardada en Mis Recetas');
  });

  $('deleteRecipeBtn').addEventListener('click', async () => {
    const id = $('recipeId').value;
    if (!id) return;
    await state.store.deleteRecipe(id);
    $('recipeModal').classList.add('hidden');
    toast('Receta eliminada');
  });

  $('closeCameraBtn').addEventListener('click', closeCameraModal);
  $('cancelCameraBtn').addEventListener('click', closeCameraModal);
  $('capturePhotoBtn').addEventListener('click', () => {
    if (!state.webcam) return;
    try {
      const dataUrl = state.webcam.capture();
      setModalPhoto(dataUrl);
      closeCameraModal();
      toast('Foto capturada');
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
      carbs: $('itemCarbs').value,
      fat: $('itemFat').value,
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

  $('logItemSelect').addEventListener('change', syncLogFormFromItem);
  $('logServings').addEventListener('input', syncLogFormFromItem);
  $('logForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const itemId = $('logItemSelect').value || null;
    const servings = Math.max(0.1, Number($('logServings').value) || 1);
    const name = $('logName').value.trim();
    if (!name) return toast('Escribe el nombre del alimento');

    let unitsUsed = 0;
    if (itemId && $('logDeduct').checked) {
      const it = state.items.find((x) => x.id === itemId);
      if (it) {
        const calc = consumeFromItem(it, servings);
        unitsUsed = calc.unitsUsed;
        await state.store.saveItem({ ...it, qty: calc.newQty });
      }
    }

    await state.store.addLog({
      date: state.diaryDate,
      meal: $('logMeal').value,
      itemId,
      name,
      servings,
      kcal: Number($('logKcal').value) || 0,
      protein: Number($('logProtein').value) || 0,
      carbs: Number($('logCarbs').value) || 0,
      fat: Number($('logFat').value) || 0,
      unitsUsed,
    });
    $('logModal').classList.add('hidden');
    toast('Comida registrada');
  });

  $('profileForm').addEventListener('input', updateProfilePreview);
  $('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await state.store.saveProfile(readProfileDraft());
    toast('Perfil fitness guardado');
  });

  $('geminiForm').addEventListener('submit', (e) => {
    e.preventDefault();
    setGeminiConfig({
      apiKey: $('geminiKeyInput').value,
      model: $('geminiModelInput').value,
    });
    renderAll();
    toast('Configuración de Gemini guardada');
  });

  $('testGeminiBtn').addEventListener('click', async () => {
    setGeminiConfig({
      apiKey: $('geminiKeyInput').value,
      model: $('geminiModelInput').value,
    });
    renderAll();
    const btn = $('testGeminiBtn');
    const out = $('geminiTestResult');
    out.classList.remove('hidden');
    out.textContent = 'Probando conexión con Gemini...';
    btn.disabled = true;
    try {
      await testGeminiConnection();
      out.innerHTML = `<strong style="color:var(--ok)">Conexión exitosa</strong> con el modelo <code>${esc(getGeminiConfig().model)}</code>.`;
      toast('¡Conexión exitosa con Gemini!');
    } catch (err) {
      out.innerHTML = `<strong style="color:var(--danger)">Error de Gemini:</strong> ${esc(err.message)}<div class="muted small-note" style="margin-top:4px;">Si dice que el modelo no existe, pulsa <strong>Detectar</strong> para elegir uno disponible para tu clave.</div>`;
    } finally {
      btn.disabled = false;
    }
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

  state.store.subscribeRecipes((recipes) => {
    state.recipes = recipes;
    renderAll();
  });

  state.store.subscribeProfile((profile) => {
    state.profile = profile;
    renderAll();
  });

  state.store.subscribeLogs(todayStr(), (entries) => {
    state.todayLogs = entries;
    if (state.diaryDate === todayStr()) {
      state.diaryLogs = entries;
    }
    renderAll();
  });
}

boot();
