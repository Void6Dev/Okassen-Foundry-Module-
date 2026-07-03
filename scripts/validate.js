/**
 * validate.js — валидация входного JSON до любого создания документов.
 *
 * Задача — поймать проблемы ЗАРАНЕЕ и объяснить их человеку понятным текстом,
 * а не дать Foundry молча создать кривой предмет или упасть с криптической ошибкой.
 */

import { resolveMechanic, validateChangeValue } from "./mechanics.js";

/** Максимальная глубина вложенности _forge.nested (см. nested.js) */
const MAX_NESTED_DEPTH = 2;

/**
 * Проверить входной JSON. Бросает Error с человекочитаемым текстом при проблеме.
 *
 * @param {object} raw — распарсенный JSON предмета (возможно, с _forge)
 * @param {number} [depth=0] — глубина рекурсии для вложенных предметов
 * @returns {true} — если всё в порядке
 */
export function validate(raw, depth = 0) {
  // --- Базовая форма ---
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(game.i18n.localize("OKASSEN.errors.notAnObject"));
  }
  if (!raw.name || typeof raw.name !== "string") {
    throw new Error(game.i18n.localize("OKASSEN.errors.noName"));
  }
  if (!raw.type || typeof raw.type !== "string") {
    throw new Error(game.i18n.format("OKASSEN.errors.noType", { name: raw.name }));
  }

  // --- Тип предмета: сверяем с реально зарегистрированными типами системы ---
  const validTypes = game.documentTypes.Item.filter(t => t !== "base");
  if (!validTypes.includes(raw.type)) {
    throw new Error(game.i18n.format("OKASSEN.errors.badType", {
      name: raw.name,
      type: raw.type,
      types: validTypes.join(", ")
    }));
  }

  // --- Блок _forge (необязателен) ---
  const forge = raw._forge;
  if (forge == null) return true;
  if (typeof forge !== "object" || Array.isArray(forge)) {
    throw new Error(game.i18n.format("OKASSEN.errors.badForge", { name: raw.name }));
  }

  // --- Эффекты ---
  if (forge.effects != null && !Array.isArray(forge.effects)) {
    throw new Error(game.i18n.format("OKASSEN.errors.effectsNotArray", { name: raw.name }));
  }
  for (const fx of forge.effects ?? []) {
    const fxName = fx.name ?? fx.label ?? "?";
    for (const ch of fx.changes ?? []) {
      if (ch.mechanic) {
        // resolveMechanic сам бросит понятную ошибку: перечислит доступные
        // механики, а для advantage.* объяснит, что нужен midi-qol.
        const defs = resolveMechanic(ch.mechanic);
        validateChangeValue(ch.mechanic, defs, ch.value);
      } else if (!(ch.key && ch.mode !== undefined)) {
        // Ни mechanic, ни сырой key+mode — запись бессмысленна.
        throw new Error(game.i18n.format("OKASSEN.errors.badChange", { effect: fxName }));
      }
      if (ch.value === undefined) {
        throw new Error(game.i18n.format("OKASSEN.errors.noValue", { effect: fxName }));
      }
    }
  }

  // --- onUse: строка-идентификатор или null ---
  if (forge.onUse != null && typeof forge.onUse !== "string") {
    throw new Error(game.i18n.format("OKASSEN.errors.badOnUse", { name: raw.name }));
  }

  // --- Вложенные предметы: рекурсивная проверка с ограничением глубины ---
  if (forge.nested != null && !Array.isArray(forge.nested)) {
    throw new Error(game.i18n.format("OKASSEN.errors.nestedNotArray", { name: raw.name }));
  }
  if (depth < MAX_NESTED_DEPTH) {
    for (const def of forge.nested ?? []) validate(def, depth + 1);
  }
  // Глубже MAX_NESTED_DEPTH не валидируем: nested.js всё равно проигнорирует
  // такие уровни с предупреждением.

  return true;
}
