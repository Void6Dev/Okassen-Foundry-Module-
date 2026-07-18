/**
 * export.js — обратная операция: готовый предмет → расширенный JSON.
 *
 * Сценарий: сгенерировали предмет, импортировали, подправили руками в листе
 * предмета — и экспортировали обратно эталонный JSON (поделиться, сохранить,
 * доработать во внешнем чате).
 *
 * Changes эффектов по возможности сворачиваются обратно в короткие механики
 * (через обратную карту словаря); незнакомые ключи экспортируются «сырыми»
 * (key + mode) — такой JSON модуль тоже принимает.
 */

import { MECHANICS, MIDI_MECHANICS } from "./mechanics.js";
import { ITEM_HOOKS, ACTOR_HOOKS } from "./lifecycle.js";

const MODULE_ID = "okassen";

/** Вернуть хуки из flags.okassen.hooks обратно в _forge-ключи (onEquip и др.). */
function exportHooks(doc, forge, allowed) {
  const hooks = doc.getFlag(MODULE_ID, "hooks") ?? {};
  for (const [forgeKey, hookKey] of Object.entries(allowed)) {
    if (typeof hooks[hookKey] === "string" && hooks[hookKey]) forge[forgeKey] = hooks[hookKey];
  }
}

/**
 * Обратная карта: "key|mode" → имя механики.
 * Составные механики (разворачивающиеся в несколько changes, например
 * damage.spell.bonus) в карту не попадают — их changes экспортируются сырыми,
 * иначе один change свернулся бы в механику, которая при импорте создаст два.
 */
const REVERSE = new Map();
for (const [name, def] of Object.entries(MECHANICS)) {
  const defs = Array.isArray(def) ? def : [def];
  if (defs.length !== 1) continue;
  // Особые механики (overTime) и динамические ключи (proficiency.tool.add)
  // однозначно не сворачиваются — их changes уходят в экспорт сырыми.
  if (defs[0].special || defs[0].dynamicKey || !defs[0].key) continue;
  REVERSE.set(`${defs[0].key}|${defs[0].mode}`, name);
}
// Курированные midi-механики: все OVERRIDE-флаги flags.midi-qol.* → короткая запись.
for (const [name, key] of Object.entries(MIDI_MECHANICS)) {
  REVERSE.set(`${key}|${CONST.ACTIVE_EFFECT_MODES.OVERRIDE}`, name);
}

/** Свернуть один change эффекта в запись для _forge (механика или сырой). */
function exportChange(ch) {
  const mech = REVERSE.get(`${ch.key}|${ch.mode}`);
  const out = mech
    ? { mechanic: mech, value: ch.value }
    : { key: ch.key, mode: ch.mode, value: ch.value };
  if (ch.priority !== null && ch.priority !== undefined) out.priority = ch.priority;
  return out;
}

/** Свернуть коллекцию эффектов документа в массив _forge.effects. */
function exportEffects(effects) {
  return effects.map(fx => {
    const changes = fx.changes.map(exportChange);

    // Встроенные overTime-спецификации (flags.okassen.overTime) — обратно
    // в механики damage.overTime / heal.overTime. midi-путь (сырой ключ
    // flags.midi-qol.OverTime) не сворачиваем — он экспортируется как есть.
    for (const spec of fx.flags?.[MODULE_ID]?.overTime ?? []) {
      const ch = {
        mechanic: spec.kind === "heal" ? "heal.overTime" : "damage.overTime",
        value: spec.formula
      };
      if (spec.kind !== "heal" && spec.type) ch.type = spec.type;
      if (spec.turn && spec.turn !== "start") ch.turn = spec.turn;
      changes.push(ch);
    }

    const data = {
      label: fx.name,
      icon: fx.img,
      disabled: fx.disabled,
      transfer: fx.transfer,
      changes
    };
    // Стабильный _id: сохраняет привязки активностей (system.activities.<id>.effects
    // ссылаются именно на этот id) при повторном импорте.
    if (fx.id) data._id = fx.id;
    if (fx.description) data.description = fx.description;

    // Длительность — если реально задана (rounds/seconds/turns).
    const dur = fx.duration ?? {};
    if (dur.rounds != null || dur.seconds != null || dur.turns != null) {
      data.duration = {};
      for (const k of ["rounds", "seconds", "turns"]) if (dur[k] != null) data.duration[k] = dur[k];
    }

    // Состояния и оттенок.
    const statuses = fx.statuses ? [...fx.statuses] : [];
    if (statuses.length) data.statuses = statuses;
    if (fx.tint) data.tint = fx.tint;

    // Проброшенные флаги — всё, кроме служебного okassen (overTime уже свёрнут
    // в механику выше; source/formatVersion сюда не попадают у эффектов).
    const fl = foundry.utils.deepClone(fx.flags ?? {});
    delete fl[MODULE_ID];
    if (!foundry.utils.isEmpty(fl)) data.flags = fl;

    return data;
  });
}

/**
 * Собрать расширенный JSON из АКТЁРА: сам актёр + его эффекты (_forge.effects),
 * prototypeToken и предметы (каждый — через buildForgeJson, со своим _forge).
 *
 * Предметы-«дети» вложений (с flags.okassen.parent) в items не попадают:
 * их пересоздаст блок _forge.nested их родителя — иначе при импорте они
 * задвоятся.
 */
async function buildActorForgeJson(actor) {
  const src = actor.toObject();
  const forge = {};

  if (actor.effects.size) forge.effects = exportEffects(actor.effects);
  exportHooks(actor, forge, ACTOR_HOOKS);

  // extraFlags: все флаги, кроме служебных okassen.*
  const flags = foundry.utils.deepClone(src.flags ?? {});
  if (flags[MODULE_ID]) {
    for (const k of ["source", "nested", "parent", "onUse", "hooks", "formatVersion"]) delete flags[MODULE_ID][k];
    if (foundry.utils.isEmpty(flags[MODULE_ID])) delete flags[MODULE_ID];
  }
  if (!foundry.utils.isEmpty(flags)) forge.extraFlags = flags;

  const out = { name: src.name, type: src.type, img: src.img, system: src.system };
  if (src.prototypeToken) out.prototypeToken = src.prototypeToken;

  const items = [];
  for (const it of actor.items) {
    if (it.getFlag(MODULE_ID, "parent")) continue; // ребёнок вложения — пропускаем
    items.push(await buildForgeJson(it));
  }
  if (items.length) out.items = items;
  if (!foundry.utils.isEmpty(forge)) out._forge = forge;
  return out;
}

/**
 * Собрать расширенный JSON из предмета ИЛИ актёра.
 *
 * @param {Item|Actor} item — документ (мировой или эмбеддед)
 * @param {number} [depth=0] — глубина рекурсии для вложенных предметов
 * @returns {Promise<object>} — объект в формате входа модуля (документ + _forge)
 */
export async function buildForgeJson(item, depth = 0) {
  if (item instanceof Actor) return buildActorForgeJson(item);

  const src = item.toObject();
  const forge = {};

  // --- Эффекты ---
  if (item.effects.size) forge.effects = exportEffects(item.effects);

  // --- Вложенные предметы: по uuid-ссылкам во флагах, глубина ≤ 2 ---
  const nestedUuids = item.getFlag(MODULE_ID, "nested") ?? [];
  if (Array.isArray(nestedUuids) && nestedUuids.length && depth < 2) {
    const nested = [];
    for (const uuid of nestedUuids) {
      const child = await fromUuid(uuid).catch(() => null);
      if (child instanceof Item) nested.push(await buildForgeJson(child, depth + 1));
      else console.warn(`[okassen] Экспорт: вложенный предмет ${uuid} не найден, пропущен`);
    }
    if (nested.length) forge.nested = nested;
  }

  // --- onUse и хуки жизненного цикла ---
  const onUse = item.getFlag(MODULE_ID, "onUse");
  if (onUse) forge.onUse = onUse;
  exportHooks(item, forge, ITEM_HOOKS);

  // --- extraFlags: все флаги, кроме служебных okassen.* ---
  const flags = foundry.utils.deepClone(src.flags ?? {});
  if (flags[MODULE_ID]) {
    for (const k of ["source", "nested", "parent", "onUse", "hooks", "formatVersion"]) delete flags[MODULE_ID][k];
    if (foundry.utils.isEmpty(flags[MODULE_ID])) delete flags[MODULE_ID];
  }
  if (!foundry.utils.isEmpty(flags)) forge.extraFlags = flags;

  // --- Итог: обычный предмет + _forge (если есть что класть) ---
  const out = { name: src.name, type: src.type, img: src.img, system: src.system };
  if (!foundry.utils.isEmpty(forge)) out._forge = forge;
  return out;
}

/**
 * МАССОВЫЙ экспорт: вся папка сайдбара (включая подпапки того же типа)
 * → массив расширенных JSON. Дети вложений пропускаются (их пересоздаст
 * _forge.nested родителя), как и при экспорте актёра.
 *
 * @param {Folder} folder — папка предметов или актёров
 * @returns {Promise<object[]>}
 */
export async function buildFolderForgeJson(folder) {
  const out = [];
  const walk = async f => {
    for (const doc of f.contents) {
      if (doc.getFlag?.(MODULE_ID, "parent")) continue; // ребёнок вложения
      out.push(await buildForgeJson(doc));
    }
    const subfolders = game.folders.filter(sub => sub.type === f.type && sub.folder?.id === f.id);
    for (const sub of subfolders) await walk(sub);
  };
  await walk(folder);
  return out;
}

/**
 * МАССОВЫЙ экспорт: весь компендиум предметов/актёров → массив расширенных JSON.
 * @param {CompendiumCollection} pack
 * @returns {Promise<object[]>}
 */
export async function buildPackForgeJson(pack) {
  const out = [];
  for (const doc of await pack.getDocuments()) {
    if (doc.getFlag?.(MODULE_ID, "parent")) continue; // ребёнок вложения
    out.push(await buildForgeJson(doc));
  }
  return out;
}
