// ui.js — Pro rendering templates for FitDespensa views.
import { CATEGORIES, MEALS } from './constants.js';
import {
  STATUS_LABEL,
  catIcon,
  inShoppingList,
  normText,
  round,
  sortItems,
  statusOf,
  toBuy,
} from './inventory.js';
import {
  MACRO_INFO,
  calcTargets,
  coverageDays,
  hasNutrition,
  logTotals,
  pantryTotals,
  todayStr,
} from './nutrition.js';

export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Safe markdown-lite for Coach IA replies (**bold** and bullet lines). */
export function formatCoachText(raw) {
  return esc(raw)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^\s*[-•]\s+/gm, '• ');
}

const SVG_EDIT = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`;
const SVG_FORK = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>`;
const SVG_TRASH = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
const SVG_CHECK = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
const SVG_STAR = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;

// =========================================================================
// 0) LIVE TELEMETRY STRIP (Top of Coach IA)
// =========================================================================
export function renderLiveStrip({ items, profile, todayLogs, waterMl = 0, streak = 0 }) {
  const targets = calcTargets(profile);
  const eaten = logTotals(todayLogs);
  const lowCount = items.filter(inShoppingList).length;

  const protPct = targets?.protein > 0 ? Math.min(100, Math.round((eaten.protein / targets.protein) * 100)) : 0;
  const kcalPct = targets?.kcal > 0 ? Math.min(100, Math.round((eaten.kcal / targets.kcal) * 100)) : 0;
  const waterGoal = 2500;
  const waterPct = Math.min(100, Math.round((waterMl / waterGoal) * 100));

  return `
    <button type="button" class="live-pill" data-action="go-diary">
      <span class="live-pill-label">Proteína hoy</span>
      <span class="live-pill-val" style="color:var(--primary)">${Math.round(eaten.protein)}${targets ? ` / ${targets.protein}g` : 'g'}</span>
      <div class="progress-track"><div class="progress-fill" style="width:${protPct}%"></div></div>
    </button>
    <button type="button" class="live-pill" data-action="go-diary">
      <span class="live-pill-label">Calorías hoy</span>
      <span class="live-pill-val" style="color:var(--accent)">${Math.round(eaten.kcal)}${targets ? ` / ${targets.kcal}` : ' kcal'}</span>
      <div class="progress-track"><div class="progress-fill kcal" style="width:${kcalPct}%"></div></div>
    </button>
    <button type="button" class="live-pill" data-action="add-water-quick" title="Toca para sumar 250 ml">
      <span class="live-pill-label">Agua (+250 ml)</span>
      <span class="live-pill-val" style="color:var(--blue)">${(waterMl / 1000).toFixed(2)} / 2.5 L</span>
      <div class="progress-track"><div class="progress-fill carbs" style="width:${waterPct}%"></div></div>
    </button>
    <button type="button" class="live-pill" data-action="go-shopping">
      <span class="live-pill-label">${streak > 0 ? `Racha · ${streak}d 🔥` : 'Por comprar'}</span>
      <span class="live-pill-val" style="color:${lowCount ? 'var(--accent)' : 'var(--ok)'}">${lowCount}</span>
      <span class="live-pill-sub">${lowCount ? 'faltan en despensa' : 'despensa surtida'}</span>
    </button>
  `;
}

// =========================================================================
// RECIPES GRID
// =========================================================================
export function renderRecipes(recipes) {
  if (!recipes.length) {
    return `
      <div class="empty-state" style="grid-column: 1 / -1">
        <h3>Aún no tienes recetas guardadas</h3>
        <p>Pídele al Coach IA que guarde tus comidas ya hechas como receta, o toca la estrella en cualquier comida de tu Diario.</p>
        <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
          <button type="button" class="btn btn-primary btn-sm" data-action="go-coach">Pedir al Coach IA</button>
          <button type="button" class="btn btn-ghost btn-sm" data-action="new-recipe">+ Crear manual</button>
        </div>
      </div>
    `;
  }

  return recipes
    .map((r) => {
      const mealObj = MEALS.find((m) => m.id === r.meal) || MEALS[1];
      const media = r.photo
        ? `<img src="${r.photo}" alt="${esc(r.name)}" loading="lazy" />`
        : `<span style="font-size:2.4rem;">${mealObj.icon}</span>`;
      const ingText = r.ingredients?.length ? r.ingredients.join(' · ') : r.steps || 'Sin ingredientes detallados';

      return `
        <article class="recipe-card">
          <div class="recipe-media">
            ${media}
            <span class="recipe-meal-badge">${esc(mealObj.label)}</span>
          </div>
          <div class="recipe-body">
            <h3 class="item-name">${esc(r.name)}</h3>
            <div class="macro-tags">
              <span class="macro-tag prot">${r.protein}g PRO</span>
              <span class="macro-tag kcal">${r.kcal} kcal</span>
              ${r.carbs ? `<span class="macro-tag">C ${r.carbs}g</span>` : ''}
              ${r.fat ? `<span class="macro-tag">G ${r.fat}g</span>` : ''}
            </div>
            <div class="recipe-ing">${esc(ingText)}</div>
            <div class="recipe-footer">
              <button type="button" class="btn btn-primary btn-sm flex-1" data-action="eat-recipe" data-id="${esc(r.id)}">
                ${SVG_FORK}
                <span>Comí esto</span>
              </button>
              <button type="button" class="icon-btn icon-btn-sm" data-action="edit-recipe" data-id="${esc(r.id)}" title="Editar receta">${SVG_EDIT}</button>
              <button type="button" class="icon-btn icon-btn-sm" data-action="delete-recipe" data-id="${esc(r.id)}" title="Eliminar receta">${SVG_TRASH}</button>
            </div>
          </div>
        </article>
      `;
    })
    .join('');
}

function renderRing(label, value, target, unit, color) {
  const r = 39;
  const circ = 2 * Math.PI * r;
  const pct = target > 0 ? Math.min(1, value / target) : 0;
  const offset = circ * (1 - pct);
  const pctLabel = target > 0 ? `${Math.round((value / target) * 100)}% de meta` : 'Configura tu perfil';

  return `
    <div class="ring-box">
      <div class="ring-wrap">
        <svg class="ring-svg" viewBox="0 0 98 98" aria-hidden="true">
          <circle class="ring-track" cx="49" cy="49" r="${r}"></circle>
          <circle class="ring-fill" cx="49" cy="49" r="${r}"
            stroke="${color}"
            stroke-dasharray="${circ.toFixed(1)}"
            stroke-dashoffset="${offset.toFixed(1)}"></circle>
        </svg>
        <div class="ring-center">
          <span class="ring-val">${Math.round(value)}</span>
          <span class="ring-unit">${target > 0 ? `/ ${target} ${unit}` : unit}</span>
        </div>
      </div>
      <strong style="font-size:0.86rem;">${label}</strong>
      <span class="muted" style="font-size:0.72rem;">${pctLabel}</span>
    </div>
  `;
}

// =========================================================================
// 1) PANEL (Bento Dashboard)
// =========================================================================
export function renderPanel({ items, profile, todayLogs }) {
  const targets = calcTargets(profile);
  const totals = pantryTotals(items);
  const cov = coverageDays(totals, targets);
  const eaten = logTotals(todayLogs);
  const lowItems = items.filter(inShoppingList).sort(sortItems);

  const topProtein = [...items]
    .filter((it) => it.qty > 0 && Number(it.protein) > 0)
    .sort((a, b) => Number(b.protein) - Number(a.protein))
    .slice(0, 4);

  const profileBanner = !targets
    ? `
      <div class="banner banner-accent">
        <div>
          <strong>Personaliza tus metas fitness</strong>
          <p class="muted small-note">Ingresa tu peso, estatura y objetivo para calcular tu proteína diaria y los días que cubre tu despensa.</p>
        </div>
        <button type="button" class="btn btn-primary btn-sm" data-action="open-settings">Configurar perfil</button>
      </div>
    `
    : '';

  const daysText = cov?.protein != null ? `${cov.protein.toFixed(1)} días` : `${totals.protein} g`;
  const weeklyPct = cov?.protein != null ? Math.min(100, Math.round((cov.protein / 7) * 100)) : 0;

  const carbsPct = targets?.carbs > 0 ? Math.min(100, Math.round((eaten.carbs / targets.carbs) * 100)) : 0;
  const fatPct = targets?.fat > 0 ? Math.min(100, Math.round((eaten.fat / targets.fat) * 100)) : 0;

  const alertsHtml = lowItems.length
    ? lowItems
        .slice(0, 5)
        .map((it) => {
          const st = statusOf(it);
          const thumb = it.photo ? `<img src="${it.photo}" alt="" />` : catIcon(it.category);
          return `
            <div class="data-row">
              <div class="row-thumb">${thumb}</div>
              <div class="row-info">
                <span class="row-title">${esc(it.name)}</span>
                <span class="row-sub num">${round(it.qty, 2)} / mín ${it.min} ${esc(it.unit)}</span>
              </div>
              <span class="status-pill status-${st}">${STATUS_LABEL[st]}</span>
              <button type="button" class="btn btn-ghost btn-xs" data-action="mark-bought" data-id="${esc(it.id)}" title="Marcar comprado">${SVG_CHECK}</button>
            </div>
          `;
        })
        .join('')
    : `<p class="muted small-note">Tu despensa está al día. No hay artículos por debajo de su mínimo.</p>`;

  const topProteinHtml = topProtein.length
    ? topProtein
        .map((it) => {
          const thumb = it.photo ? `<img src="${it.photo}" alt="" />` : catIcon(it.category);
          return `
            <div class="data-row">
              <div class="row-thumb">${thumb}</div>
              <div class="row-info">
                <span class="row-title">${esc(it.name)}</span>
                <span class="row-sub">${esc(it.serving || '1 porción')} · ${round(it.qty, 2)} ${esc(it.unit)} disp.</span>
              </div>
              <span class="macro-tag prot">${it.protein}g PRO</span>
              <button type="button" class="btn btn-ghost btn-xs" data-action="quick-log" data-id="${esc(it.id)}" title="Registrar en diario">${SVG_FORK}</button>
            </div>
          `;
        })
        .join('')
    : `<p class="muted small-note">Agrega información nutrimental a tus productos para ver tus mejores fuentes de proteína.</p>`;

  return `
    ${profileBanner}
    <div class="bento-top">
      <div class="card hero-card">
        <div>
          <span class="eyebrow">Cobertura de proteína en despensa</span>
          <div class="kpi-big">${daysText}</div>
          <p class="muted small-note">
            ${
              cov?.protein != null
                ? `Tienes ${totals.protein.toLocaleString('es-MX')} g de proteína en casa frente a tu meta de ${targets.protein} g/día.`
                : 'Proteína total disponible en tu inventario actual.'
            }
          </p>
        </div>

        ${
          cov?.protein != null
            ? `
              <div class="weekly-bar-wrap">
                <div class="weekly-bar-head">
                  <span>Reserva semanal (7 días)</span>
                  <strong class="num">${weeklyPct}%</strong>
                </div>
                <div class="progress-track">
                  <div class="progress-fill" style="width:${weeklyPct}%"></div>
                </div>
              </div>
            `
            : ''
        }

        <div class="stat-strip">
          <div class="stat-cell">
            <span>Energía en stock</span>
            <strong>${totals.kcal.toLocaleString('es-MX')} kcal</strong>
          </div>
          <div class="stat-cell">
            <span>Productos</span>
            <strong>${items.length}</strong>
          </div>
          <div class="stat-cell">
            <span>Por comprar</span>
            <strong style="color:${lowItems.length ? 'var(--accent)' : 'var(--ok)'}">${lowItems.length}</strong>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div>
            <h3 class="card-title">Progreso de hoy</h3>
            <span class="muted small-note">${targets ? `Objetivo: ${targets.goal.label}` : 'Sin objetivo configurado'}</span>
          </div>
          <button type="button" class="btn btn-ghost btn-xs" data-action="go-diary">Abrir diario</button>
        </div>

        <div class="rings-row">
          ${renderRing('Proteína', eaten.protein, targets?.protein || 0, 'g', 'var(--primary)')}
          ${renderRing('Calorías', eaten.kcal, targets?.kcal || 0, 'kcal', 'var(--accent)')}
        </div>

        <div class="mini-macro-row">
          <div>
            <div class="weekly-bar-head" style="margin-bottom:5px;">
              <span>Carbohidratos</span>
              <strong class="num">${Math.round(eaten.carbs)}${targets ? `/${targets.carbs}g` : 'g'}</strong>
            </div>
            <div class="progress-track"><div class="progress-fill carbs" style="width:${carbsPct}%"></div></div>
          </div>
          <div>
            <div class="weekly-bar-head" style="margin-bottom:5px;">
              <span>Grasas</span>
              <strong class="num">${Math.round(eaten.fat)}${targets ? `/${targets.fat}g` : 'g'}</strong>
            </div>
            <div class="progress-track"><div class="progress-fill fat" style="width:${fatPct}%"></div></div>
          </div>
        </div>
      </div>
    </div>

    <div class="bento-bottom">
      <div class="card">
        <div class="card-head">
          <h3 class="card-title">Alertas de reposición (${lowItems.length})</h3>
          <button type="button" class="btn btn-ghost btn-xs" data-action="go-shopping">Ver lista</button>
        </div>
        <div class="list-stack">${alertsHtml}</div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3 class="card-title">Top proteína disponible</h3>
          <button type="button" class="btn btn-ghost btn-xs" data-action="go-coach">Ideas con Coach IA</button>
        </div>
        <div class="list-stack">${topProteinHtml}</div>
      </div>
    </div>
  `;
}

// =========================================================================
// 2) CATÁLOGO
// =========================================================================
export function renderCategoryChips(activeCategory, items) {
  const counts = new Map();
  items.forEach((it) => counts.set(it.category, (counts.get(it.category) || 0) + 1));

  const allChip = `<button type="button" class="chip ${activeCategory === 'Todas' ? 'active' : ''}" data-cat="Todas">Todas · ${items.length}</button>`;
  const rest = CATEGORIES.map((c) => {
    const n = counts.get(c.name) || 0;
    return `<button type="button" class="chip ${activeCategory === c.name ? 'active' : ''}" data-cat="${esc(c.name)}">${esc(c.name)}${n ? ` · ${n}` : ''}</button>`;
  }).join('');

  return allChip + rest;
}

export function renderCatalog({ items, search, category, stockFilter, viewMode }) {
  const q = normText(search);
  const filtered = items
    .filter((it) => {
      if (category !== 'Todas' && it.category !== category) return false;
      if (stockFilter === 'low' && !inShoppingList(it)) return false;
      if (q && !normText(it.name).includes(q) && !normText(it.category).includes(q)) return false;
      return true;
    })
    .sort(sortItems);

  if (!items.length) {
    return `
      <div class="empty-state" style="grid-column: 1 / -1">
        <h3>Tu despensa está vacía</h3>
        <p>Agrega tus productos con foto y macros, o carga un catálogo fitness de ejemplo para explorar la app.</p>
        <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
          <button type="button" class="btn btn-primary btn-sm" data-action="new-item">Agregar producto</button>
          <button type="button" class="btn btn-ghost btn-sm" data-action="seed-sample">Cargar ejemplo fitness</button>
        </div>
      </div>
    `;
  }

  if (!filtered.length) {
    return `
      <div class="empty-state" style="grid-column: 1 / -1">
        <h3>Sin coincidencias</h3>
        <p>Prueba ajustando tu búsqueda, el filtro de stock o la categoría seleccionada.</p>
      </div>
    `;
  }

  return filtered
    .map((it) => {
      const st = statusOf(it);
      const ratio = it.min > 0 ? Math.min(100, Math.round((it.qty / (it.min * 2)) * 100)) : it.qty > 0 ? 100 : 0;
      const media = it.photo
        ? `<img src="${it.photo}" alt="${esc(it.name)}" loading="lazy" />`
        : `<span class="item-fallback-ico" aria-hidden="true">${catIcon(it.category)}</span>`;

      const macros = hasNutrition(it)
        ? `
          <div class="macro-tags">
            ${it.protein != null ? `<span class="macro-tag prot">${it.protein}g PRO</span>` : ''}
            ${it.kcal != null ? `<span class="macro-tag kcal">${it.kcal} kcal</span>` : ''}
            ${it.serving ? `<span class="macro-tag">${esc(it.serving)}</span>` : ''}
          </div>
        `
        : '';

      return `
        <article class="item-card" data-id="${esc(it.id)}">
          <div class="item-media" data-action="edit-item" data-id="${esc(it.id)}" title="Ver o editar producto">
            ${media}
            <span class="status-pill status-${st}">${STATUS_LABEL[st]}</span>
            <span class="media-edit-chip" aria-hidden="true">${SVG_EDIT}</span>
          </div>
          <div class="item-body">
            <div class="item-head">
              <div>
                <h3 class="item-name">${esc(it.name)}</h3>
                <span class="item-cat">${esc(it.category)} · mín ${it.min} ${esc(it.unit)}</span>
              </div>
              <button type="button" class="icon-btn icon-btn-sm" data-action="quick-log" data-id="${esc(it.id)}" title="Registrar en diario">${SVG_FORK}</button>
            </div>
            ${macros}
            ${viewMode === 'grid' ? `<div class="stock-bar"><div class="stock-fill fill-${st}" style="width:${ratio}%"></div></div>` : ''}
            <div class="item-controls">
              <div class="stepper">
                <button type="button" class="step-btn" data-action="step-qty" data-dir="-1" data-id="${esc(it.id)}" aria-label="Restar">−</button>
                <span class="qty-text">${round(it.qty, 2)} ${esc(it.unit)}</span>
                <button type="button" class="step-btn" data-action="step-qty" data-dir="1" data-id="${esc(it.id)}" aria-label="Sumar">+</button>
              </div>
              <button type="button" class="btn btn-ghost btn-xs" data-action="edit-item" data-id="${esc(it.id)}">Editar</button>
            </div>
          </div>
        </article>
      `;
    })
    .join('');
}

// =========================================================================
// 3) DIARIO DE COMIDAS
// =========================================================================
export function formatDateHeading(dateStr) {
  const today = todayStr();
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const formatted = dt.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
  const label = dateStr === today ? 'Hoy' : formatted.charAt(0).toUpperCase() + formatted.slice(1);
  return { label, sub: dateStr };
}

export function renderDiarySummary(entries, profile, { waterMl = 0, streak = 0, recipes = [], items = [] } = {}) {
  const totals = logTotals(entries);
  const targets = calcTargets(profile);

  // Cal AI / MacroFactor Hero Calorie Ring
  const kcalTarget = targets?.kcal || 0;
  const kcalRemaining = kcalTarget > 0 ? Math.max(0, Math.round(kcalTarget - totals.kcal)) : Math.round(totals.kcal);
  const kcalOver = kcalTarget > 0 && totals.kcal > kcalTarget ? Math.round(totals.kcal - kcalTarget) : 0;
  const r = 52;
  const circ = 2 * Math.PI * r;
  const pct = kcalTarget > 0 ? Math.min(1, totals.kcal / kcalTarget) : 0;
  const offset = circ * (1 - pct);

  const macroRow = (key, cls) => {
    const info = MACRO_INFO[key];
    const val = Math.round(totals[key]);
    const tgt = targets?.[key] || 0;
    const mpct = tgt > 0 ? Math.min(100, Math.round((val / tgt) * 100)) : 0;
    const rem = tgt > 0 ? Math.max(0, Math.round(tgt - val)) : null;
    return `
      <div class="hero-macro-row">
        <div class="hero-macro-head">
          <strong>${info.label}</strong>
          <span class="num"><strong>${val}</strong>${tgt ? ` / ${tgt}g` : 'g'}${rem != null ? ` · <span class="muted">faltan ${rem}g</span>` : ''}</span>
        </div>
        <div class="progress-track"><div class="progress-fill ${cls}" style="width:${mpct}%"></div></div>
      </div>
    `;
  };

  // Yazio-style Water Tracker (10 glasses x 250 ml = 2.5 L)
  const glassesFilled = Math.min(10, Math.floor(waterMl / 250));
  const glassesHtml = Array.from({ length: 10 }, (_, idx) => {
    const filled = idx < glassesFilled;
    const targetMl = (idx + 1) * 250;
    return `<button type="button" class="water-drop ${filled ? 'filled' : ''}" data-action="set-water" data-ml="${targetMl}" title="${targetMl} ml" aria-label="${targetMl} ml">💧</button>`;
  }).join('');

  // Quick-log chips (saved recipes + top protein pantry items)
  const quickChips = [
    ...recipes.slice(0, 4).map(
      (rec) => `<button type="button" class="quick-chip recipe" data-action="eat-recipe" data-id="${esc(rec.id)}">★ ${esc(rec.name)} · ${rec.protein}g P</button>`
    ),
    ...items
      .filter((it) => it.qty > 0 && Number(it.protein) >= 5)
      .sort((a, b) => Number(b.protein) - Number(a.protein))
      .slice(0, 5)
      .map(
        (it) => `<button type="button" class="quick-chip" data-action="quick-eat-item" data-id="${esc(it.id)}">+ ${esc(it.name)} · ${it.protein}g P</button>`
      ),
  ].join('');

  return `
    <div class="diary-hero card">
      <div class="diary-hero-left">
        <div class="cal-ring-wrap">
          <svg class="cal-ring-svg" viewBox="0 0 124 124" aria-hidden="true">
            <circle class="ring-track" cx="62" cy="62" r="${r}"></circle>
            <circle class="ring-fill" cx="62" cy="62" r="${r}"
              stroke="${kcalOver ? 'var(--danger)' : 'var(--primary)'}"
              stroke-dasharray="${circ.toFixed(1)}"
              stroke-dashoffset="${offset.toFixed(1)}"></circle>
          </svg>
          <div class="ring-center">
            <span class="cal-ring-num num">${kcalOver ? `+${kcalOver}` : kcalRemaining}</span>
            <span class="ring-unit">${kcalTarget ? (kcalOver ? 'kcal extra' : 'kcal restantes') : 'kcal hoy'}</span>
          </div>
        </div>
        <div class="diary-hero-meta">
          <span class="num">${Math.round(totals.kcal)} consumidas${kcalTarget ? ` · meta ${kcalTarget}` : ''}</span>
          ${streak > 0 ? `<span class="streak-pill">🔥 Racha ${streak} ${streak === 1 ? 'día' : 'días'}</span>` : ''}
        </div>
      </div>

      <div class="diary-hero-right">
        ${macroRow('protein', '')}
        ${macroRow('carbs', 'carbs')}
        ${macroRow('fat', 'fat')}
      </div>
    </div>

    <div class="water-card card">
      <div class="water-head">
        <div>
          <strong>💧 Hidratación</strong>
          <span class="muted small-note num"> · ${(waterMl / 1000).toFixed(2)} / 2.50 L</span>
        </div>
        <div style="display:flex; gap:6px;">
          <button type="button" class="btn btn-ghost btn-xs" data-action="step-water" data-dir="-250">−250 ml</button>
          <button type="button" class="btn btn-primary btn-xs" data-action="step-water" data-dir="250">+250 ml</button>
        </div>
      </div>
      <div class="water-drops">${glassesHtml}</div>
    </div>

    ${
      quickChips
        ? `
          <div class="quick-log-wrap">
            <span class="eyebrow">Registro rápido (1 toque)</span>
            <div class="quick-log-strip">${quickChips}</div>
          </div>
        `
        : ''
    }
  `;
}

export function renderDiaryMeals(entries) {
  return MEALS.map((meal) => {
    const list = entries.filter((e) => (e.meal || 'snack') === meal.id);
    const sub = logTotals(list);
    const rows = list.length
      ? list
          .map(
            (e) => `
              <div class="log-row">
                <div>
                  <strong style="font-size:0.9rem;">${esc(e.name)}</strong>
                  <div class="muted small-note num">
                    ${round(e.servings, 2)} porc. · ${Math.round(e.kcal || 0)} kcal · P ${round(e.protein || 0, 1)}g · C ${round(e.carbs || 0, 1)}g · G ${round(e.fat || 0, 1)}g
                  </div>
                </div>
                <div style="display:flex; gap:6px;">
                  <button type="button" class="icon-btn icon-btn-sm" data-action="save-log-recipe" data-id="${esc(e.id)}" title="Guardar como receta">${SVG_STAR}</button>
                  <button type="button" class="icon-btn icon-btn-sm" data-action="delete-log" data-id="${esc(e.id)}" title="Eliminar registro">${SVG_TRASH}</button>
                </div>
              </div>
            `
          )
          .join('')
      : `<p class="muted small-note" style="padding:2px 0;">Sin alimentos registrados aquí todavía.</p>`;

    return `
      <div class="card meal-group">
        <div class="card-head" style="margin-bottom:${list.length ? '10px' : '4px'};">
          <div>
            <h3 class="card-title">${meal.icon} ${meal.label}</h3>
            <span class="muted small-note num">${list.length ? `${Math.round(sub.kcal)} kcal · ${round(sub.protein, 1)}g proteína` : '0 kcal'}</span>
          </div>
          <button type="button" class="btn btn-ghost btn-xs" data-action="open-log-meal" data-meal="${meal.id}">+ Agregar</button>
        </div>
        ${rows}
      </div>
    `;
  }).join('');
}

// =========================================================================
// 4) LISTA DE COMPRAS
// =========================================================================
export function renderShoppingList(items) {
  const list = items.filter(inShoppingList).sort(sortItems);
  if (!list.length) {
    return `
      <div class="empty-state">
        <h3>Tu despensa está surtida</h3>
        <p>En cuanto algún producto baje de su mínimo de alerta aparecerá aquí automáticamente.</p>
      </div>
    `;
  }

  return list
    .map((it) => {
      const st = statusOf(it);
      const buy = toBuy(it);
      const thumb = it.photo ? `<img src="${it.photo}" alt="${esc(it.name)}" />` : catIcon(it.category);
      return `
        <div class="shop-row">
          <div class="row-thumb">${thumb}</div>
          <div class="row-info">
            <span class="row-title">${esc(it.name)}</span>
            <span class="row-sub num">
              Stock: ${round(it.qty, 2)} ${esc(it.unit)} (mín ${it.min}) · Sugerido comprar <strong>${buy} ${esc(it.unit)}</strong>
            </span>
          </div>
          <span class="status-pill status-${st}">${STATUS_LABEL[st]}</span>
          <button type="button" class="btn btn-primary btn-sm" data-action="mark-bought" data-id="${esc(it.id)}">
            ${SVG_CHECK}
            <span>Comprado</span>
          </button>
        </div>
      `;
    })
    .join('');
}
