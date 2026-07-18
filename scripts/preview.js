/**
 * preview.js — сухой прогон импорта: показать, ЧТО будет создано,
 * ничего не создавая в мире.
 *
 * Прогоняет каждый документ через validate + buildEffects (та же логика,
 * что при настоящем импорте) и собирает HTML-сводку: документы, развёрнутые
 * changes (реальные ключи и режимы), overTime, вложения, хуки — плюс
 * предупреждения о зависимостях и неизвестных полях схемы.
 */

import { validate } from "./validate.js";
import { buildEffects } from "./effects.js";
import { analyzeDependencies } from "./deps.js";
import { analyzeSchema } from "./schema.js";

import { escapeHtml } from "./util.js";

const esc = s => escapeHtml(s);

/** Имя режима AE по номеру (2 → ADD). */
function modeName(mode) {
  for (const [k, v] of Object.entries(CONST.ACTIVE_EFFECT_MODES)) {
    if (v === mode) return k;
  }
  return String(mode);
}

/** Сводка по эффектам документа (после разворачивания механик). */
function effectsHtml(forgeEffects) {
  let effects;
  try {
    effects = buildEffects(forgeEffects ?? []);
  } catch (err) {
    return `<p class="okassen-preview-error">${esc(err.message)}</p>`;
  }
  if (!effects.length) return "";

  const source = Array.isArray(forgeEffects) ? forgeEffects : [];
  const rows = effects.map((fx, i) => {
    const state = [
      fx.disabled ? game.i18n.localize("OKASSEN.preview.disabled") : null,
      fx.transfer ? game.i18n.localize("OKASSEN.preview.transfer") : null
    ].filter(Boolean).join(", ");

    const changes = fx.changes.map(ch =>
      `<li><code>${esc(ch.key)}</code> ${esc(modeName(ch.mode))} <code>${esc(ch.value)}</code></li>`
    ).join("");

    const overTime = (fx.flags?.okassen?.overTime ?? []).map(s =>
      `<li>⏳ ${esc(s.kind)} <code>${esc(s.formula)}</code> (${esc(s.type)}, ${esc(s.turn)})</li>`
    ).join("");

    // Привязка к активностям (applyTo) и состояния — из исходного описания.
    const applyTo = (source[i]?.applyTo ?? [])
      .map(r => (typeof r === "string" ? r : r?.activity)).filter(Boolean);
    const applyHtml = applyTo.length
      ? `<li>🔗 ${esc(game.i18n.localize("OKASSEN.preview.applyTo"))}: <code>${applyTo.map(esc).join(", ")}</code></li>`
      : "";
    const statusHtml = (fx.statuses ?? []).length
      ? `<li>◈ ${esc(game.i18n.localize("OKASSEN.preview.statuses"))}: <code>${fx.statuses.map(esc).join(", ")}</code></li>`
      : "";

    return `<li><strong>${esc(fx.name)}</strong>${state ? ` <em>(${state})</em>` : ""}
      <ul>${changes}${overTime}${applyHtml}${statusHtml}</ul></li>`;
  }).join("");

  return `<div><strong>${game.i18n.localize("OKASSEN.preview.effects")}:</strong><ul>${rows}</ul></div>`;
}

/** Хуки документа (_forge.onUse/onEquip/...) одной строкой. */
function hooksHtml(forge) {
  const keys = ["onUse", "onEquip", "onUnequip", "onCreate", "onDelete", "onTurnStart", "onTurnEnd"];
  const parts = keys
    .filter(k => typeof forge?.[k] === "string" && forge[k])
    .map(k => `${k} → <code>${esc(forge[k])}</code>`);
  if (!parts.length) return "";
  return `<p><strong>${game.i18n.localize("OKASSEN.preview.hooks")}:</strong> ${parts.join(", ")}</p>`;
}

/** Сводка по одному документу (рекурсивно для вложений и предметов актёра). */
function documentHtml(raw, depth = 0) {
  const name = esc(raw?.name ?? "?");
  const type = esc(raw?.type ?? "?");

  let validity = "";
  if (depth === 0) {
    try {
      validate(raw);
    } catch (err) {
      validity = `<p class="okassen-preview-error">✖ ${esc(err.message)}</p>`;
    }
  }

  const forge = raw?._forge ?? {};
  const nested = (forge.nested ?? [])
    .map(def => documentHtml(def, depth + 1)).join("");
  const items = (raw?.items ?? [])
    .map(def => documentHtml(def, depth + 1)).join("");

  return `<div class="okassen-preview-doc" style="margin-left:${depth * 14}px">
    <p><strong>${name}</strong> <code>${type}</code></p>
    ${validity}
    ${effectsHtml(forge.effects)}
    ${hooksHtml(forge)}
    ${nested ? `<div><strong>${game.i18n.localize("OKASSEN.preview.nested")}:</strong>${nested}</div>` : ""}
    ${items ? `<div><strong>${game.i18n.localize("OKASSEN.preview.items")}:</strong>${items}</div>` : ""}
  </div>`;
}

/**
 * Собрать HTML-сводку предпросмотра для уже препроцессированного входа.
 * Используется и диалогом, и вкладкой «Предпросмотр» окна импорта.
 * @param {object|Array} parsed — документ или массив документов
 * @returns {string} HTML блока .okassen-preview
 */
export function buildPreviewHtml(parsed) {
  const docs = Array.isArray(parsed) ? parsed : [parsed];
  const warnings = [...analyzeDependencies(parsed), ...analyzeSchema(parsed)];

  const warningsHtml = warnings.length
    ? `<div class="okassen-preview-warnings">${warnings.map(w => `<p>⚠ ${esc(w)}</p>`).join("")}</div>`
    : "";

  return `<div class="okassen-preview">
    <p class="okassen-preview-note">${game.i18n.format("OKASSEN.preview.note", { count: docs.length })}</p>
    ${warningsHtml}
    ${docs.map(d => documentHtml(d)).join("<hr>")}
  </div>`;
}

/**
 * Показать диалог предпросмотра для уже препроцессированного входа.
 * @param {object|Array} parsed — документ или массив документов
 */
export async function openPreviewDialog(parsed) {
  await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize("OKASSEN.preview.title"), icon: "fa-solid fa-eye" },
    position: { width: 560 },
    content: buildPreviewHtml(parsed),
    buttons: [{ action: "close", label: "OKASSEN.history.close", icon: "fa-solid fa-xmark", default: true }],
    rejectClose: false
  });
}
