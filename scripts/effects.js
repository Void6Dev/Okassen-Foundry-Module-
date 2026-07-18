/**
 * effects.js — сборка данных ActiveEffect из блока _forge.effects.
 *
 * На входе — «дружелюбный» формат автора кампании, на выходе — массив данных,
 * который можно передать прямо в Item.create({ ..., effects: [...] }) (Foundry v13
 * умеет создавать эмбеддед-эффекты вместе с предметом).
 */

import { resolveMechanic, validateChangeValue } from "./mechanics.js";
import { buildOverTime } from "./overtime.js";

/**
 * Собрать один change из записи автора.
 * Поддерживаются два формата:
 *  1) { mechanic: "ac.bonus", value: 1, priority? } — через словарь механик;
 *  2) { key: "system....", mode: 2, value: "...", priority? } — «сырой» обход
 *     словаря (escape hatch) для случаев, которых в словаре нет.
 *
 * Особые механики словаря:
 *  - special: "overTime" — не AE-change: либо midi-ключ, либо запись
 *    в overTimeSpecs (флаг эффекта, встроенный обработчик хода);
 *  - dynamicKey — ключ содержит «*», подставляется value записи, а значением
 *    change становится def.fixedValue (например proficiency.tool.add).
 *  - поле type записи у damage-механик приклеивает тип урона к формуле:
 *    value "1d4" + type "fire" → "1d4[fire]".
 *
 * @param {object} change — запись из _forge.effects[].changes[]
 * @param {string} effectName — имя эффекта (для текста ошибки)
 * @param {Array<object>} overTimeSpecs — накопитель overTime-спецификаций эффекта
 * @returns {Array<{key: string, mode: number, value: string, priority: number|null}>}
 */
function buildChanges(change, effectName, overTimeSpecs) {
  if (change.mechanic) {
    const defs = resolveMechanic(change.mechanic);
    validateChangeValue(change.mechanic, defs, change);

    return defs.flatMap(def => {
      // Урон/лечение «во времени»: midi-ключ или флаг эффекта.
      if (def.special === "overTime") {
        const { change: aeChange, spec } = buildOverTime(def.kind, change, effectName);
        if (spec) overTimeSpecs.push(spec);
        return aeChange ? [aeChange] : [];
      }

      // Динамический ключ: «*» заменяется значением записи
      // (proficiency.tool.add: value "thief" → system.tools.thief.value = 1).
      if (def.dynamicKey) {
        return [{
          key: def.key.replace("*", String(change.value)),
          mode: def.mode,
          value: String(def.fixedValue ?? 1),
          priority: change.priority ?? def.priority ?? null
        }];
      }

      // Типизированный урон: "1d4" + type "fire" → "1d4[fire]".
      let value = String(change.value);
      if (change.type && def.damageTyped) {
        const types = CONFIG.DND5E?.damageTypes ?? {};
        if (!(change.type in types)) {
          throw new Error(game.i18n.format("OKASSEN.errors.badSetValue", {
            mechanic: change.mechanic,
            value: String(change.type),
            allowed: Object.keys(types).sort().join(", ")
          }));
        }
        value = `${value}[${change.type}]`;
      }

      // Foundry хранит значения changes строками; формулы типа "1d4" уже строки,
      // числа приводим явно.
      return [{
        key: def.key,
        mode: def.mode,
        value,
        priority: change.priority ?? def.priority ?? null
      }];
    });
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

/** Уже готовый _id документа Foundry (ровно 16 буквенно-цифровых символов)? */
function isValidId(id) {
  return typeof id === "string" && /^[A-Za-z0-9]{16}$/.test(id);
}

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Детерминированный 16-символьный id из произвольной строки-семени.
 * Нужен, чтобы одна и та же способность при повторном импорте («Заменить»)
 * получала ТОТ ЖЕ _id эффекта — и ссылки активностей на него
 * (system.activities.<id>.effects) не рвались, и макросы находили эффект.
 *
 * @param {string} seed
 * @returns {string} — строка [A-Za-z0-9]{16}
 */
function idFromSeed(seed) {
  const s = String(seed);
  let x = 0x811c9dc5 >>> 0;
  let y = 0x01000193 >>> 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    x = Math.imul(x ^ c, 0x01000193) >>> 0;
    y = (Math.imul(y + c, 0x85ebca6b) >>> 0) ^ (x >>> 3);
    y >>>= 0;
  }
  let out = "";
  x = x || 1;
  y = y || 2;
  for (let i = 0; i < 16; i++) {
    out += ID_ALPHABET[((i & 1) ? y : x) % ID_ALPHABET.length];
    x = (Math.imul(x, 0x01000193) + 0x9e3779b9) >>> 0;
    y = (Math.imul(y, 0x85ebca6b) + 0x7f4a7c15) >>> 0;
  }
  return out;
}

/**
 * Вычислить _id эффекта из его forge-описания.
 * Приоритет: явный _id → slug `id` → (если есть applyTo) производный от имени.
 * Возвращает null, когда стабильный id не нужен (Foundry присвоит случайный).
 *
 * @param {object} fx — запись _forge.effects[]
 * @param {number} index — позиция в массиве (для уникальности производного id)
 * @returns {string|null}
 */
function effectId(fx, index) {
  if (fx._id != null) return isValidId(fx._id) ? fx._id : idFromSeed(fx._id);
  if (fx.id != null) return idFromSeed(String(fx.id));
  if (Array.isArray(fx.applyTo) && fx.applyTo.length) {
    return idFromSeed(`${fx.label ?? fx.name ?? "effect"}#${index}`);
  }
  return null;
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
 *  - _id / id: стабильный id эффекта (нужен для applyTo и для round-trip экспорта)
 *  - statuses: массив id состояний (иконки condition на токене)
 *  - tint: цвет-оттенок иконки эффекта
 *  - flags: произвольные флаги (напр. flags.dae.specialDuration, flags.midi-qol.*)
 *
 * @param {Array<object>} forgeEffects — _forge.effects или []
 * @returns {Array<object>} — массив данных ActiveEffect (пустой, если эффектов нет)
 */
export function buildEffects(forgeEffects = []) {
  if (!Array.isArray(forgeEffects)) return [];

  return forgeEffects.map((fx, i) => {
    const name = fx.name ?? fx.label ?? `Effect ${i + 1}`;
    const overTimeSpecs = [];
    const data = {
      name,
      img: fx.img ?? fx.icon ?? "icons/svg/aura.svg",
      disabled: fx.disabled ?? false,
      transfer: fx.transfer ?? true,
      changes: (fx.changes ?? []).flatMap(ch => buildChanges(ch, name, overTimeSpecs))
    };
    // Необязательные поля — только если заданы, чтобы не засорять документ.
    const _id = effectId(fx, i);
    if (_id) data._id = _id;
    if (fx.duration) data.duration = fx.duration;
    if (fx.description) data.description = fx.description;
    if (typeof fx.tint === "string" && fx.tint) data.tint = fx.tint;
    if (Array.isArray(fx.statuses) && fx.statuses.length) data.statuses = [...fx.statuses];
    // Произвольные флаги автора (DAE/midi/свои). Кладём ДО overTime, чтобы
    // встроенная overTime-спецификация ниже не была затёрта.
    if (fx.flags && typeof fx.flags === "object" && !Array.isArray(fx.flags)) {
      data.flags = foundry.utils.mergeObject(data.flags ?? {}, foundry.utils.deepClone(fx.flags));
    }
    // overTime без midi: спецификации живут во флаге эффекта, их читает
    // встроенный обработчик хода (см. overtime.js). Требует включённый модуль.
    if (overTimeSpecs.length) {
      foundry.utils.setProperty(data, "flags.okassen.overTime", overTimeSpecs);
    }
    return data;
  });
}

/**
 * Связать эффекты с активностями предмета. Для каждого forge-эффекта с полем
 * `applyTo` (список id активностей) добавляет его _id в
 * `system.activities.<id>.effects`. После этого dnd5e (и MidiQOL) сам накладывает
 * эффект на цель активности; для save-активности MidiQOL вешает его на тех, кто
 * ПРОВАЛИЛ спасбросок.
 *
 * Мутирует `data` на месте. Вызывать после buildEffects и ДО создания предмета:
 * _id эффектов уже известны (детерминированы), а ссылка — это просто строка,
 * которую dnd5e разрешит по коллекции эффектов предмета.
 *
 * Формат элемента applyTo:
 *  - строка — id активности ("prdxpenta0000001");
 *  - объект — { activity: "<id>", ...доп.поля } (доп.поля идут в запись effects,
 *    напр. onSave/level — dnd5e вычистит незнакомые).
 *
 * @param {object} data — данные предмета (с data.effects и data.system.activities)
 * @param {Array<object>} forgeEffects — исходный _forge.effects (ради applyTo)
 */
export function linkActivityEffects(data, forgeEffects = []) {
  const activities = data.system?.activities;
  if (!activities || typeof activities !== "object") return;
  if (!Array.isArray(data.effects) || !Array.isArray(forgeEffects)) return;

  forgeEffects.forEach((fx, i) => {
    const refs = fx?.applyTo;
    if (!Array.isArray(refs) || !refs.length) return;
    const built = data.effects[i];
    if (!built?._id) return;

    for (const ref of refs) {
      const actId = typeof ref === "string" ? ref : ref?.activity;
      if (!actId) continue;
      const activity = activities[actId];
      if (!activity) {
        console.warn(`[okassen] applyTo: активность "${actId}" не найдена в предмете "${data.name}" — эффект "${built.name}" не привязан`);
        continue;
      }
      if (!Array.isArray(activity.effects)) activity.effects = [];
      if (activity.effects.some(e => e?._id === built._id)) continue;
      const extra = (ref && typeof ref === "object") ? { ...ref } : {};
      delete extra.activity;
      activity.effects.push({ _id: built._id, ...extra });
    }
  });
}
