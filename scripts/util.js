/**
 * util.js — мелкие помощники без зависимостей от нестабильных API ядра.
 *
 * Появился при переходе на Foundry 14 / dnd5e 5.x: часть привычных вызовов
 * там убрана или переехала, и мы больше на них не опираемся:
 *  - foundry.utils.escapeHTML — заменён локальным escapeHtml (ядру не доверяем);
 *  - game.documentTypes.{Item,Actor} — убран; типы берём из CONFIG.*.dataModels,
 *    которые в dnd5e 5.x и есть источник истины по зарегистрированным типам.
 */

/** Экранировать HTML-спецсимволы (не зависит от foundry.utils). */
export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

/** Зарегистрированные типы предметов системы (без служебного "base"). */
export function itemTypes() {
  return Object.keys(CONFIG.Item?.dataModels ?? {}).filter(t => t !== "base");
}

/** Зарегистрированные типы актёров системы (без служебного "base"). */
export function actorTypes() {
  return Object.keys(CONFIG.Actor?.dataModels ?? {}).filter(t => t !== "base");
}

/** Это тип актёра? (npc, character, group, vehicle...) */
export function isActorType(type) {
  return typeof type === "string" && actorTypes().includes(type);
}
