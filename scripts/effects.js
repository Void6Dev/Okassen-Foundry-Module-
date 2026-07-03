/**
 * effects.js — сборка данных ActiveEffect из блока _forge.effects.
 *
 * На входе — «дружелюбный» формат автора кампании, на выходе — массив данных,
 * который можно передать прямо в Item.create({ ..., effects: [...] }) (Foundry v13
 * умеет создавать эмбеддед-эффекты вместе с предметом).
 */

import { resolveMechanic, validateChangeValue } from "./mechanics.js";

/**
 * Собрать один change из записи автора.
 * Поддерживаются два формата:
 *  1) { mechanic: "ac.bonus", value: 1, priority? } — через словарь механик;
 *  2) { key: "system....", mode: 2, value: "...", priority? } — «сырой» обход
 *     словаря (escape hatch) для случаев, которых в словаре нет.
 *
 * @param {object} change — запись из _forge.effects[].changes[]
 * @param {string} effectName — имя эффекта (для текста ошибки)
 * @returns {Array<{key: string, mode: number, value: string, priority: number|null}>}
 */
function buildChanges(change, effectName) {
  if (change.mechanic) {
    const defs = resolveMechanic(change.mechanic);
    validateChangeValue(change.mechanic, defs, change.value);
    // Одна механика может развернуться в несколько changes (например damage.spell.bonus)
    return defs.map(def => ({
      key: def.key,
      mode: def.mode,
      // Foundry хранит значения changes строками; формулы типа "1d4" уже строки,
      // числа приводим явно.
      value: String(change.value),
      priority: change.priority ?? def.priority ?? null
    }));
  }

  // Сырой формат: key + mode как есть.
  if (change.key && change.mode !== undefined) {
    return [{
      key: change.key,
      mode: Number(change.mode),
      value: String(change.value),
      priority: change.priority ?? null
    }];
  }

  throw new Error(game.i18n.format("OKASSEN.errors.badChange", { effect: effectName }));
}

/**
 * Собрать массив данных ActiveEffect для v13 из _forge.effects.
 *
 * Маппинг «дружелюбных» полей на схему v13:
 *  - label → name (в v13 у ActiveEffect поле называется name; поддерживаем оба)
 *  - icon → img (аналогично; поддерживаем оба)
 *  - disabled: по умолчанию false
 *  - transfer: по умолчанию true (эффект переносится на носителя при экипировке)
 *  - duration: передаётся как есть, если задан (обычный объект длительности Foundry)
 *
 * @param {Array<object>} forgeEffects — _forge.effects или []
 * @returns {Array<object>} — массив данных ActiveEffect (пустой, если эффектов нет)
 */
export function buildEffects(forgeEffects = []) {
  if (!Array.isArray(forgeEffects)) return [];

  return forgeEffects.map((fx, i) => {
    const name = fx.name ?? fx.label ?? `Effect ${i + 1}`;
    const data = {
      name,
      img: fx.img ?? fx.icon ?? "icons/svg/aura.svg",
      disabled: fx.disabled ?? false,
      transfer: fx.transfer ?? true,
      changes: (fx.changes ?? []).flatMap(ch => buildChanges(ch, name))
    };
    // Необязательные поля — только если заданы, чтобы не засорять документ.
    if (fx.duration) data.duration = fx.duration;
    if (fx.description) data.description = fx.description;
    return data;
  });
}
