// ui.js — Pure inventory & AI recommendations rendering templates for FitDespensa.
import { CATEGORIES } from './constants.js?v=13';
import {
  STATUS_LABEL,
  catIcon,
  inShoppingList,
  normText,
  round,
  sortItems,
  statusOf,
  toBuy,
} from './inventory.js?v=13';
import {
  calcTargets,
  coverageDays,
  hasNutrition,
  pantrySubtypeBreakdown,
  pantryTotals,
} from './nutrition.js?v=13';

export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export function formatCoachText(raw) {
  return esc(raw)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^\s*[-•]\s+/gm, '• ');
}

const SVG_EDIT = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`;
const SVG_CART = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>`;
const SVG_CHECK = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;

const PROT_LABELS = { animal: 'Animal', vegetal: 'Vegetal', suplemento: 'Supl.' };
const CARB_LABELS = { complejo: 'Complejo', simple: 'Simple', fibroso: 'Fibroso' };

// =========================================================================
// 1) PANTRY OVERVIEW STRIP (Top of Mi Despensa)
// =========================================================================
export function renderPantryOverview({ items, profile }) {
  const targets = calcTargets(profile);
  const totals = pantryTotals(items);
  const cov = coverageDays(totals, targets);
  const lowItems = items.filter(inShoppingList);
  const outCount = items.filter((it) => statusOf(it) === 'out').length;
  const weeklyPct = cov?.protein != null ? Math.min(100, Math.round((cov.protein / 7) * 100)) : 0;

  return `
    <button type="button" class="live-pill" data-action="go-shopping">
      <span class="live-pill-label">Por comprar</span>
      <span class="live-pill-val" style="color:${lowItems.length ? 'var(--accent)' : 'var(--ok)'}">${lowItems.length}</span>
      <span class="live-pill-sub">${outCount ? `${outCount} agotados` : lowItems.length ? 'bajos de stock' : 'todo surtido'}</span>
    </button>
    <button type="button" class="live-pill" data-action="${targets ? 'go-coach' : 'open-settings'}">
      <span class="live-pill-label">Proteína en casa</span>
      <span class="live-pill-val" style="color:var(--primary)">${cov?.protein != null ? `${cov.protein.toFixed(1)} días` : `${totals.protein} g`}</span>
      <div class="progress-track"><div class="progress-fill" style="width:${weeklyPct}%"></div></div>
    </button>
    <button type="button" class="live-pill" data-action="toggle-quality">
      <span class="live-pill-label">Stock total</span>
      <span class="live-pill-val">${items.length} prod.</span>
      <span class="live-pill-sub num">${totals.kcal.toLocaleString('es-MX')} kcal · ${totals.fiber}g fibra</span>
    </button>
    <button type="button" class="live-pill" style="border-color:rgba(163,230,53,0.35); background:var(--primary-soft);" data-action="new-item">
      <span class="live-pill-label" style="color:var(--primary)">Subir producto</span>
      <span class="live-pill-val" style="color:var(--primary)">📷 Foto / Código</span>
      <span class="live-pill-sub">Autocompleta tabla nutrimental</span>
    </button>
  `;
}

export function renderLiveStrip({ items, profile }) {
  const targets = calcTargets(profile);
  const totals = pantryTotals(items);
  const cov = coverageDays(totals, targets);
  const lowCount = items.filter(inShoppingList).length;
  const weeklyPct = cov?.protein != null ? Math.min(100, Math.round((cov.protein / 7) * 100)) : 0;

  return `
    <button type="button" class="live-pill" data-action="go-catalog">
      <span class="live-pill-label">Reserva proteína</span>
      <span class="live-pill-val" style="color:var(--primary)">${cov?.protein != null ? `${cov.protein.toFixed(1)} días` : `${totals.protein} g`}</span>
      <div class="progress-track"><div class="progress-fill" style="width:${weeklyPct}%"></div></div>
    </button>
    <button type="button" class="live-pill" data-action="go-shopping">
      <span class="live-pill-label">Lista de compras</span>
      <span class="live-pill-val" style="color:${lowCount ? 'var(--accent)' : 'var(--ok)'}">${lowCount}</span>
      <span class="live-pill-sub">${lowCount ? 'faltan por surtir' : 'despensa completa'}</span>
    </button>
    <button type="button" class="live-pill" data-action="go-catalog">
      <span class="live-pill-label">En inventario</span>
      <span class="live-pill-val">${items.length} prod.</span>
      <span class="live-pill-sub num">${totals.kcal.toLocaleString('es-MX')} kcal totales</span>
    </button>
    <button type="button" class="live-pill" data-action="open-settings">
      <span class="live-pill-label">Objetivo fitness</span>
      <span class="live-pill-val">${targets ? esc(targets.goal.label) : 'Configurar'}</span>
      <span class="live-pill-sub">${targets ? `${targets.protein}g P/día` : 'Toca para definir'}</span>
    </button>
  `;
}

// =========================================================================
// 2) PANTRY MACRO SUBTYPE BREAKDOWN (In-stock nutrition quality)
// =========================================================================
export function renderPantryQuality(items) {
  const totals = pantryTotals(items);
  const sub = pantrySubtypeBreakdown(items);

  const segBar = (segments) => {
    const sum = segments.reduce((a, s) => a + s.val, 0);
    if (!sum) return `<div class="seg-track"></div>`;
    return `<div class="seg-track">${segments
      .filter((s) => s.val > 0)
      .map((s) => `<div class="seg-part" style="width:${(s.val / sum) * 100}%; background:${s.color}" title="${s.label}: ${s.val}g"></div>`)
      .join('')}</div>`;
  };

  return `
    <div class="subtype-grid">
      <div class="subtype-col">
        <div class="subtype-head"><strong>Proteína en stock</strong><span class="num">${totals.protein}g</span></div>
        ${segBar([
          { label: 'Animal', val: sub.protein.animal, color: 'var(--primary)' },
          { label: 'Vegetal', val: sub.protein.vegetal, color: '#34d399' },
          { label: 'Suplemento', val: sub.protein.suplemento, color: '#a78bfa' },
        ])}
        <div class="subtype-legend num">
          <span><i style="background:var(--primary)"></i>Animal ${sub.protein.animal}g</span>
          <span><i style="background:#34d399"></i>Vegetal ${sub.protein.vegetal}g</span>
          <span><i style="background:#a78bfa"></i>Supl. ${sub.protein.suplemento}g</span>
        </div>
      </div>

      <div class="subtype-col">
        <div class="subtype-head"><strong>Carbohidratos en stock</strong><span class="num">${totals.carbs}g</span></div>
        ${segBar([
          { label: 'Complejos', val: sub.carbs.complejo, color: 'var(--blue)' },
          { label: 'Fibrosos', val: sub.carbs.fibroso, color: '#22c55e' },
          { label: 'Simples', val: sub.carbs.simple, color: 'var(--accent)' },
        ])}
        <div class="subtype-legend num">
          <span><i style="background:var(--blue)"></i>Complejos ${sub.carbs.complejo}g</span>
          <span><i style="background:#22c55e"></i>Fibrosos ${sub.carbs.fibroso}g</span>
          <span><i style="background:var(--accent)"></i>Simples ${sub.carbs.simple}g</span>
        </div>
        <div class="muted small-note num">Fibra disponible: <strong>${sub.carbs.fiber}g</strong> · Azúcares: <strong>${sub.carbs.sugar}g</strong></div>
      </div>

      <div class="subtype-col">
        <div class="subtype-head"><strong>Grasas en stock</strong><span class="num">${totals.fat}g</span></div>
        ${segBar([
          { label: 'Saludables', val: sub.fat.unsat, color: '#facc15' },
          { label: 'Saturadas', val: sub.fat.sat, color: 'var(--danger)' },
        ])}
        <div class="subtype-legend num">
          <span><i style="background:#facc15"></i>Saludables ${sub.fat.unsat}g</span>
          <span><i style="background:var(--danger)"></i>Saturadas ${sub.fat.sat}g</span>
        </div>
      </div>
    </div>
  `;
}

// =========================================================================
// 3) AI RECOMMENDATIONS PANEL
// =========================================================================
export function renderAiRecommendations(data, addedNames = new Set()) {
  if (!data) return '';
  const insightsHtml = (data.insights || [])
    .map(
      (ins) => `
        <div class="rec-insight-box">
          <span class="macro-tag prot" style="align-self:flex-start;">${esc(ins.badge)}</span>
          <strong>${esc(ins.title)}</strong>
          <p>${esc(ins.detail)}</p>
        </div>
      `
    )
    .join('');

  const buysHtml = (data.suggestedPurchases || [])
    .map((b, idx) => {
      const key = normText(b.name);
      const alreadyAdded = addedNames.has(key);
      return `
        <div class="rec-buy-row">
          <div style="flex:1; min-width:0;">
            <strong style="font-size:0.86rem; display:block;">${esc(b.name)} · <span class="num">${b.qty} ${esc(b.unit)}</span></strong>
            <span class="muted small-note">${esc(b.reason)}</span>
          </div>
          <button type="button" class="btn ${alreadyAdded ? 'btn-ghost' : 'btn-primary'} btn-xs"
            data-action="add-rec-buy" data-idx="${idx}" ${alreadyAdded ? 'disabled' : ''}>
            ${alreadyAdded ? '✓ En compras' : '+ A compras'}
          </button>
        </div>
      `;
    })
    .join('');

  return `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
      <div class="recs-headline">✨ ${esc(data.headline || '')}</div>
      <button type="button" class="icon-btn icon-btn-sm" data-action="close-recs" title="Ocultar recomendaciones" aria-label="Ocultar">✕</button>
    </div>
    <div class="recs-insights-grid">${insightsHtml}</div>
    ${
      buysHtml
        ? `
          <div>
            <span class="eyebrow" style="display:block; margin-bottom:8px;">Sugeridos para tu lista de compras (1 toque)</span>
            <div class="recs-buys-list">${buysHtml}</div>
          </div>
        `
        : ''
    }
  `;
}

// =========================================================================
// 4) CATÁLOGO DE DESPENSA
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
      if (stockFilter === 'out' && statusOf(it) !== 'out') return false;
      if (q && !normText(it.name).includes(q) && !normText(it.category).includes(q)) return false;
      return true;
    })
    .sort(sortItems);

  if (!items.length) {
    return `
      <div class="empty-state" style="grid-column: 1 / -1">
        <h3>Tu despensa está vacía</h3>
        <p>Toma foto de tus productos para autocompletar su tabla nutrimental, o carga la despensa fitness de ejemplo.</p>
        <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
          <button type="button" class="btn btn-primary btn-sm" data-action="new-item">+ Agregar producto</button>
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

      const inCart = inShoppingList(it);
      const pSubtype = it.protein > 0 ? ` · ${PROT_LABELS[it.proteinType] || 'Animal'}` : '';
      const cSubtype = it.carbs > 0 ? ` · ${CARB_LABELS[it.carbType] || 'Complejo'}` : '';

      const macros = hasNutrition(it)
        ? `
          <div class="macro-tags">
            ${it.protein != null ? `<span class="macro-tag prot">${it.protein}g P${pSubtype}</span>` : ''}
            ${it.carbs != null && it.carbs > 0 ? `<span class="macro-tag">${it.carbs}g C${cSubtype}</span>` : ''}
            ${it.fiber != null && it.fiber > 0 ? `<span class="macro-tag">${it.fiber}g fibra</span>` : ''}
            ${it.kcal != null ? `<span class="macro-tag kcal">${it.kcal} kcal</span>` : ''}
          </div>
        `
        : '';

      return `
        <article class="item-card" data-id="${esc(it.id)}">
          <div class="item-media" data-action="edit-item" data-id="${esc(it.id)}" title="Ver tabla nutrimental o editar">
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
              <button type="button" class="icon-btn icon-btn-sm cart-toggle-btn ${inCart ? 'active' : ''}"
                data-action="toggle-cart" data-id="${esc(it.id)}"
                title="${inCart ? 'Ya está en lista de compras' : 'Enviar a lista de compras'}">${SVG_CART}</button>
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
// 5) LISTA DE COMPRAS
// =========================================================================
export function renderShoppingList(items) {
  const list = items.filter(inShoppingList).sort(sortItems);
  if (!list.length) {
    return `
      <div class="empty-state">
        <h3>Tu despensa está surtida</h3>
        <p>Cuando un producto baje de su mínimo aparecerá aquí. También puedes pulsar «✨ Sugerir compras con IA» arriba.</p>
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
              Tienes ${round(it.qty, 2)} ${esc(it.unit)} (mín ${it.min}) · Comprar <strong>${buy} ${esc(it.unit)}</strong>
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
