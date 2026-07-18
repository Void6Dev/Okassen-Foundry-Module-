/**
 * validate.js — валидация входного JSON до любого создания документов.
 *
 * Задача — поймать проблемы ЗАРАНЕЕ и объяснить их человеку понятным текстом,
 * а не дать Foundry молча создать кривой предмет или упасть с криптической ошибкой.
 */

import { resolveMechanic, validateChangeValue } from "./mechanics.js";
import { ITEM_HOOKS, ACTOR_HOOKS } from "./lifecycle.js";
import { itemTypes, actorTypes } from "./util.js";

/** Максимальная глубина вложенности _forge.nested (см. nested.js) */
const MAX_NESTED_DEPTH = 2;

/**
 * Проверить хуки жизненного цикла в блоке _forge.
 * @param {object} forge — блок _forge
 * @param {string} name — имя документа (для текстов ошибок)
 * @param {object} allowed — разрешённые хуки (ITEM_HOOKS или ACTOR_HOOKS)
 */
function validateForgeHooks(forge, name, allowed) {
  for (const key of Object.keys(ITEM_HOOKS)) {
    if (forge[key] == null) continue;
    if (!(key in allowed)) {
      throw new Error(game.i18n.format("OKASSEN.errors.actorBadHook", { name, hook: key }));
    }
    if (typeof forge[key] !== "string") {
      throw new Error(game.i18n.format("OKASSEN.errors.badHook", { name, hook: key }));
    }
  }
}

/**
 * Проверить блок эффектов _forge (общая часть для предметов и актёров).
 * @param {object} forge — блок _forge
 * @param {string} name — имя документа (для текстов ошибок)
 */
function validateForgeEffects(forge, name) {
  if (forge.effects != null && !Array.isArray(forge.effects)) {
    throw new Error(game.i18n.format("OKASSEN.errors.effectsNotArray", { name }));
  }
  for (const fx of forge.effects ?? []) {
    const fxName = fx.name ?? fx.label ?? "?";

    // Необязательные поля эффекта: проверяем тип, чтобы кривой JSON не создал
    // молча битый эффект (Foundry вычистит несовместимые поля без предупреждения).
    if (fx.applyTo != null) {
      if (!Array.isArray(fx.applyTo)) {
        throw new Error(game.i18n.format("OKASSEN.errors.applyToNotArray", { effect: fxName }));
      }
      for (const ref of fx.applyTo) {
        const ok = typeof ref === "string" || (ref && typeof ref === "object" && typeof ref.activity === "string");
        if (!ok) throw new Error(game.i18n.format("OKASSEN.errors.applyToBadRef", { effect: fxName }));
      }
    }
    if (fx.statuses != null && (!Array.isArray(fx.statuses) || fx.statuses.some(s => typeof s !== "string"))) {
      throw new Error(game.i18n.format("OKASSEN.errors.statusesBad", { effect: fxName }));
    }
    if (fx.flags != null && (typeof fx.flags !== "object" || Array.isArray(fx.flags))) {
      throw new Error(game.i18n.format("OKASSEN.errors.flagsBad", { effect: fxName }));
    }

    for (const ch of fx.changes ?? []) {
      if (ch.mechanic) {
        // resolveMechanic сам бросит понятную ошибку: перечислит доступные
        // механики, а для advantage.* объяснит, что нужен midi-qol.
        const defs = resolveMechanic(ch.mechanic);
        validateChangeValue(ch.mechanic, defs, ch);
      } else if (!(ch.key && ch.mode !== undefined)) {
        // Ни mechanic, ни сырой key+mode — запись бессмысленна.
        throw new Error(game.i18n.format("OKASSEN.errors.badChange", { effect: fxName }));
      }
      if (ch.value === undefined) {
        throw new Error(game.i18n.format("OKASSEN.errors.noValue", { effect: fxName }));
      }
    }
  }
}

/**
 * Валидация JSON АКТЁРА (НИП, персонаж). У актёра _forge поддерживает только
 * effects и extraFlags; вместо nested у актёров — стандартный массив items
 * (каждый элемент — обычный предмет, может иметь свой _forge).
 */
function validateActor(raw) {
  const forge = raw._forge;
  if (forge != null) {
    if (typeof forge !== "object" || Array.isArray(forge)) {
      throw new Error(game.i18n.format("OKASSEN.errors.badForge", { name: raw.name }));
    }
    if (forge.nested != null) {
      throw new Error(game.i18n.format("OKASSEN.errors.actorNoNested", { name: raw.name }));
    }
    if (forge.onUse != null) {
      throw new Error(game.i18n.format("OKASSEN.errors.actorNoOnUse", { name: raw.name }));
    }
    validateForgeHooks(forge, raw.name, ACTOR_HOOKS);
    validateForgeEffects(forge, raw.name);
  }

  // Предметы актёра: каждый валидируется как обычный предмет
  // (allowActor=false — актёр внутри актёра невозможен).
  if (raw.items != null && !Array.isArray(raw.items)) {
    throw new Error(game.i18n.format("OKASSEN.errors.itemsNotArray", { name: raw.name }));
  }
  for (const def of raw.items ?? []) validate(def, 0, { allowActor: false });

  return true;
}

/**
 * Проверить входной JSON. Бросает Error с человекочитаемым текстом при проблеме.
 * Сам определяет, предмет это или актёр (по type против типов системы).
 *
 * @param {object} raw — распарсенный JSON предмета или актёра (возможно, с _forge)
 * @param {number} [depth=0] — глубина рекурсии для вложенных предметов
 * @param {object} [opts]
 * @param {boolean} [opts.allowActor=true] — разрешён ли тип актёра (false внутри items)
 * @returns {true} — если всё в порядке
 */
export function validate(raw, depth = 0, { allowActor = true } = {}) {
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

  // --- Актёр? (npc, character, ...) — отдельная ветка валидации ---
  if (allowActor && actorTypes().includes(raw.type)) return validateActor(raw);

  // --- Тип предмета: сверяем с реально зарегистрированными типами системы ---
  const validTypes = itemTypes();
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
  validateForgeEffects(forge, raw.name);

  // --- onUse: строка-идентификатор или null ---
  if (forge.onUse != null && typeof forge.onUse !== "string") {
    throw new Error(game.i18n.format("OKASSEN.errors.badOnUse", { name: raw.name }));
  }

  // --- Хуки жизненного цикла (onEquip, onTurnStart и др.) ---
  validateForgeHooks(forge, raw.name, ITEM_HOOKS);

  // --- Вложенные предметы: рекурсивная проверка с ограничением глубины ---
  if (forge.nested != null && !Array.isArray(forge.nested)) {
    throw new Error(game.i18n.format("OKASSEN.errors.nestedNotArray", { name: raw.name }));
  }
  if (depth < MAX_NESTED_DEPTH) {
    for (const def of forge.nested ?? []) validate(def, depth + 1, { allowActor: false });
  }
  // Глубже MAX_NESTED_DEPTH не валидируем: nested.js всё равно проигнорирует
  // такие уровни с предупреждением.

  return true;
}
