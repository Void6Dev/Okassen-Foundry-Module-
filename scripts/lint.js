/**
 * lint.js — живая проверка _forge прямо в редакторе.
 *
 * Статус-строка редактора проверяла только СИНТАКСИС JSON: «скобка не
 * закрыта». Смысловые ошибки («такой механики нет», «обработчик не
 * зарегистрирован», «applyTo ссылается на несуществующую активность»)
 * всплывали только при импорте — по одной за попытку, потому что
 * validate() бросает исключение на первой же.
 *
 * Здесь — обход, который НЕ останавливается на первой проблеме и собирает
 * всё сразу, с указанием строки в тексте редактора.
 *
 * Уровни:
 *   "error" — импорт упадёт (validate бросит) либо механика не существует;
 *   "warn"  — импорт пройдёт, но часть логики молча не сработает.
 */

import { resolveMechanic, validateChangeValue } from "./mechanics.js";
import { ITEM_HOOKS, ACTOR_HOOKS } from "./lifecycle.js";
import { hasHandler } from "./onuse.js";
import { analyzeDependencies } from "./deps.js";
import { analyzeSchema } from "./schema.js";
import { validate } from "./validate.js";
import { getSetting } from "./settings.js";
import { isActorType } from "./util.js";

/**
 * Номер строки, в которой впервые встречается фрагмент. Ищем сначала
 * в кавычках ("damage.melee.bonus"), затем как есть — так номер указывает
 * на нужное место, а не на случайное вхождение подстроки.
 *
 * @param {string} text — исходный текст редактора
 * @param {string|null} needle — что искать
 * @returns {number|null} — номер строки (с 1) или null
 */
export function findLine(text, needle) {
  if (!text || !needle) return null;
  const idx = text.indexOf(`"${needle}"`) >= 0
    ? text.indexOf(`"${needle}"`)
    : text.indexOf(String(needle));
  if (idx < 0) return null;
  return text.slice(0, idx).split("\n").length;
}

/** Собрать документы из входа: одиночный объект или пакетный массив. */
function documents(parsed) {
  if (Array.isArray(parsed)) {
    // Первым элементом может идти общий заголовок _defs/_vars — он не документ.
    return parsed.filter(d => d && typeof d === "object" && (d.name || d.type));
  }
  return parsed && typeof parsed === "object" ? [parsed] : [];
}

/** Известные системе id состояний (для проверки effects[].statuses). */
function knownStatuses() {
  return new Set((CONFIG.statusEffects ?? []).map(s => s.id));
}

/** Проверить один эффект документа. */
function lintEffect(fx, doc, out) {
  const fxName = fx?.name ?? fx?.label ?? "?";
  const where = `${doc.name ?? "?"} → ${fxName}`;

  for (const ch of fx?.changes ?? []) {
    if (ch?.mechanic) {
      try {
        const defs = resolveMechanic(ch.mechanic);
        validateChangeValue(ch.mechanic, defs, ch);
      } catch (err) {
        out.push({ level: "error", message: `${where}: ${err.message}`, needle: ch.mechanic });
      }
    } else if (!(ch?.key && ch?.mode !== undefined)) {
      out.push({
        level: "error",
        message: game.i18n.format("OKASSEN.errors.badChange", { effect: fxName }),
        needle: fxName
      });
    }
    if (ch && ch.value === undefined) {
      out.push({
        level: "error",
        message: game.i18n.format("OKASSEN.errors.noValue", { effect: fxName }),
        needle: ch.mechanic ?? ch.key ?? fxName
      });
    }
  }

  // applyTo: активность с таким id должна существовать в этом же документе.
  const activities = doc.system?.activities ?? {};
  for (const ref of Array.isArray(fx?.applyTo) ? fx.applyTo : []) {
    const id = typeof ref === "string" ? ref : ref?.activity;
    if (!id) continue;
    if (!activities[id]) {
      out.push({
        level: "warn",
        message: game.i18n.format("OKASSEN.lint.applyToMissing", { effect: fxName, activity: id }),
        needle: id
      });
    }
  }

  // statuses: опечатка в id состояния = иконка, которой не будет.
  const statuses = knownStatuses();
  for (const st of Array.isArray(fx?.statuses) ? fx.statuses : []) {
    if (statuses.size && !statuses.has(st)) {
      out.push({
        level: "warn",
        message: game.i18n.format("OKASSEN.lint.unknownStatus", { effect: fxName, status: st }),
        needle: st
      });
    }
  }
}

/** Проверить обработчики документа (onUse и хуки жизненного цикла). */
function lintHandlers(doc, out) {
  const forge = doc._forge ?? {};
  const allowed = isActorType(doc.type) ? ACTOR_HOOKS : ITEM_HOOKS;
  const refs = [["onUse", forge.onUse], ...Object.keys(allowed).map(k => [k, forge[k]])];

  for (const [key, id] of refs) {
    if (typeof id !== "string" || !id) continue;
    if (hasHandler(id)) continue;
    out.push({
      level: "warn",
      message: game.i18n.format("OKASSEN.lint.unknownHandler", { hook: key, handler: id, name: doc.name ?? "?" }),
      needle: id
    });
  }
}

/**
 * Прогнать весь вход через проверки и собрать список замечаний.
 *
 * @param {object|Array} parsed — уже распарсенный (и препроцессированный) JSON
 * @returns {Array<{level: "error"|"warn", message: string, needle: string|null}>}
 */
export function lintForge(parsed) {
  const out = [];
  const docs = documents(parsed);
  if (!docs.length) return out;

  for (const doc of docs) {
    // 1. Штатная валидация: ловим ПЕРВУЮ ошибку документа (дальше она всё
    //    равно прервала бы импорт) — но не мешаем проверить остальные.
    try {
      validate(doc);
    } catch (err) {
      out.push({ level: "error", message: err.message, needle: doc.name ?? null });
    }

    // 2. Механики, applyTo, statuses — по всем эффектам, без остановки.
    for (const fx of doc._forge?.effects ?? []) lintEffect(fx, doc, out);

    // 3. Обработчики onUse/хуков.
    lintHandlers(doc, out);

    // 4. Вложенные предметы — тем же набором проверок.
    for (const child of doc._forge?.nested ?? []) {
      for (const fx of child?._forge?.effects ?? []) lintEffect(fx, child, out);
      lintHandlers(child, out);
    }
    // 5. Предметы актёра.
    for (const child of Array.isArray(doc.items) ? doc.items : []) {
      for (const fx of child?._forge?.effects ?? []) lintEffect(fx, child, out);
      lintHandlers(child, out);
    }
  }

  // 6. Зависимости (midi-qol/DAE) и неизвестные поля system — как и при
  //    импорте, но заранее и без создания документов.
  for (const message of analyzeDependencies(parsed)) out.push({ level: "warn", message, needle: null });
  if (getSetting("schemaWarnings")) {
    for (const message of analyzeSchema(parsed)) out.push({ level: "warn", message, needle: null });
  }

  return out;
}
