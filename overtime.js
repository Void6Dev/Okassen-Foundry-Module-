/**
 * overtime.js — урон/лечение «во времени» (_forge-механики damage.overTime и heal.overTime).
 *
 * Запись автора:
 *   { "mechanic": "damage.overTime", "value": "1d6", "type": "fire",
 *     "turn": "start"|"end", "save": "con", "dc": 14 }
 *   { "mechanic": "heal.overTime", "value": "1d4+1" }
 *
 * Два пути под капотом:
 *  1) midi-qol активен → change разворачивается в ключ flags.midi-qol.OverTime
 *     (строка "turn=start,damageRoll=1d6,damageType=fire,..."). Эффект живёт
 *     без окассена — midi сам всё сделает, включая спасброски.
 *  2) midi-qol нет → спецификация кладётся в flags.okassen.overTime эффекта,
 *     и ВСТРОЕННЫЙ обработчик (хук combatTurnChange, только активный ведущий)
 *     кидает формулу и применяет урон/лечение. Спасброски этот путь не умеет —
 *     о save/dc честно предупреждает deps.js при импорте.
 *
 * ВАЖНО: путь (2) требует включённого модуля во время игры — как и onUse.
 */

import { midiActive } from "./deps.js";

const MODULE_ID = "okassen";
const TURNS = ["start", "end"];

/**
 * Проверить запись overTime-механики. Бросает Error с пояснением.
 * @param {string} mechanic — "damage.overTime" | "heal.overTime"
 * @param {string} kind — "damage" | "heal"
 * @param {object} ch — полная запись change из JSON
 */
export function validateOverTime(mechanic, kind, ch) {
  const fail = (key, data = {}) => {
    throw new Error(game.i18n.format(key, { mechanic, ...data }));
  };

  if (typeof ch.value !== "string" && typeof ch.value !== "number") {
    fail("OKASSEN.errors.overTimeFormula");
  }
  if (kind === "damage") {
    const types = CONFIG.DND5E?.damageTypes ?? {};
    if (!ch.type || !(ch.type in types)) {
      fail("OKASSEN.errors.overTimeType", { allowed: Object.keys(types).sort().join(", ") });
    }
  }
  if (ch.turn !== undefined && !TURNS.includes(ch.turn)) {
    fail("OKASSEN.errors.overTimeTurn");
  }
  if (ch.save !== undefined && !(ch.save in (CONFIG.DND5E?.abilities ?? {}))) {
    fail("OKASSEN.errors.overTimeSaveAbility", {
      allowed: Object.keys(CONFIG.DND5E?.abilities ?? {}).sort().join(", ")
    });
  }
  if (ch.dc !== undefined && !Number.isFinite(Number(ch.dc))) {
    fail("OKASSEN.errors.overTimeDc");
  }
  if (ch.condition !== undefined && typeof ch.condition !== "string") {
    fail("OKASSEN.errors.overTimeCondition");
  }
}

/**
 * Развернуть overTime-запись в данные для эффекта.
 *
 * @param {string} kind — "damage" | "heal"
 * @param {object} ch — запись change
 * @param {string} effectName — имя эффекта (label для midi и чата)
 * @returns {{change: object|null, spec: object|null}} — ровно одно из двух:
 *   change — AE-change для midi-пути; spec — запись для flags.okassen.overTime.
 */
export function buildOverTime(kind, ch, effectName) {
  const formula = String(ch.value);
  const turn = ch.turn ?? "start";
  const damageType = kind === "heal" ? "healing" : ch.type;

  if (midiActive()) {
    const parts = [
      `turn=${turn}`,
      `label=${effectName}`,
      `damageRoll=${formula}`,
      `damageType=${damageType}`
    ];
    if (ch.save && ch.dc !== undefined) {
      parts.push(`saveAbility=${ch.save}`, `saveDC=${Number(ch.dc)}`, "saveDamage=nodamage", "rollType=save");
    }
    // Необязательное условие срабатывания (выражение midi-qol): напр.
    // "condition": "!@flags.okassen.regenBlocked" — регенерация пропустит ход,
    // пока стоит флаг (его ставит ГМ/макрос после урона магией).
    if (ch.condition) parts.push(`applyCondition=${ch.condition}`);
    return {
      change: {
        key: "flags.midi-qol.OverTime",
        mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE,
        value: parts.join(","),
        priority: ch.priority ?? null
      },
      spec: null
    };
  }

  // Встроенный путь: спасбросок не поддерживаем (deps.js уже предупредил).
  return {
    change: null,
    spec: { kind, formula, type: damageType, turn }
  };
}

/* ------------------------------------------------------------------ */
/* Встроенный обработчик: хук смены хода                               */
/* ------------------------------------------------------------------ */

/** Достать актёра комбатанта по записи {combatantId} из combatTurnChange. */
function combatantActor(combat, turnInfo) {
  const combatant = combat.combatants.get(turnInfo?.combatantId);
  return combatant?.actor ?? null;
}

/**
 * Применить все overTime-спецификации актёра для данного момента хода.
 * @param {Actor} actor
 * @param {"start"|"end"} turn
 */
async function applyOverTime(actor, turn) {
  // appliedEffects — только активные (не disabled и не подавленные) эффекты,
  // включая перенесённые с экипированных предметов.
  for (const effect of actor.appliedEffects) {
    const specs = effect.getFlag(MODULE_ID, "overTime");
    if (!Array.isArray(specs)) continue;
    for (const spec of specs) {
      if ((spec.turn ?? "start") !== turn) continue;
      try {
        const roll = new Roll(String(spec.formula), actor.getRollData());
        await roll.evaluate();
        await actor.applyDamage([{ value: roll.total, type: spec.type }]);
        await roll.toMessage({
          speaker: ChatMessage.getSpeaker({ actor }),
          flavor: game.i18n.format(
            spec.kind === "heal" ? "OKASSEN.overtime.healFlavor" : "OKASSEN.overtime.damageFlavor",
            { effect: effect.name, type: spec.type }
          )
        });
      } catch (err) {
        console.error(`[okassen] overTime «${effect.name}» у «${actor.name}» не применился:`, err);
      }
    }
  }
}

/**
 * Регистрация встроенного обработчика. Вызывается один раз из main.js (init).
 *
 * Срабатывает ТОЛЬКО у активного ведущего — хук приходит всем клиентам,
 * а урон должен примениться один раз.
 */
export function initOverTime() {
  Hooks.on("combatTurnChange", async (combat, prior, current) => {
    try {
      if (!game.users.activeGM?.isSelf) return;

      // Конец хода предыдущего комбатанта, затем начало хода текущего.
      const priorActor = combatantActor(combat, prior);
      const currentActor = combatantActor(combat, current);
      if (priorActor && prior?.combatantId !== current?.combatantId) {
        await applyOverTime(priorActor, "end");
      }
      if (currentActor) await applyOverTime(currentActor, "start");
    } catch (err) {
      console.error("[okassen] Ошибка обработчика overTime:", err);
    }
  });
}
