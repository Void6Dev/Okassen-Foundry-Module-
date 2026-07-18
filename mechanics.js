/**
 * mechanics.js — словарь механик.
 *
 * Короткая человеко-читаемая запись (то, что пишет автор кампании в _forge.effects[].changes[].mechanic)
 * превращается здесь в настоящие ключи Active Effect системы dnd5e.
 *
 * Ключи сверены со схемой актёра dnd5e 4.4.4 (module/data/actor/*.mjs в исходниках системы):
 *  - бонусы атак/урона:  system.bonuses.{mwak,rwak,msak,rsak}.{attack,damage}
 *  - глобальные бонусы:  system.bonuses.abilities.{check,save,skill}, system.bonuses.spell.dc
 *  - характеристики:     system.abilities.<abbr>.value / .bonuses.{check,save}
 *  - навыки:             system.skills.<abbr>.bonuses.{check,passive}
 *  - AC:                 system.attributes.ac.{bonus,flat,calc}
 *  - HP (только персонажи): system.attributes.hp.bonuses.{overall,level}
 *  - скорость:           system.attributes.movement.{walk,fly,swim,climb,burrow}
 *  - инициатива:         system.attributes.init.bonus
 *  - сопротивления и пр. system.traits.{dr,di,dv}.value — это МНОЖЕСТВА (Set)
 *
 * ВАЖНО: одна механика может разворачиваться в НЕСКОЛЬКО changes (например,
 * «бонус к урону заклинаний» — в dnd5e нет единого ключа, есть msak и rsak отдельно).
 * Поэтому значением карты может быть как объект, так и массив объектов.
 *
 * Ключи проверялись против dnd5e 4.4.4 и перепроверены на dnd5e 5.3.3
 * (совпадают: system.bonuses.*, system.abilities.*, system.attributes.*,
 * system.traits.*, system.skills.*, system.tools.*). Метки «verified against
 * dnd5e 4.4.4» ниже относятся к этим же путям.
 */

import { validateOverTime } from "./overtime.js";
import { midiActive } from "./deps.js";

// Режимы Active Effect. CONST доступен глобально к моменту загрузки esmodules.
// CUSTOM 0, MULTIPLY 1, ADD 2, DOWNGRADE 3, UPGRADE 4, OVERRIDE 5
const MODES = CONST.ACTIVE_EFFECT_MODES;

/**
 * Карта механик. Значение — { key, mode, priority?, set? } или массив таких объектов.
 * Поле `set` помечает механики, работающие с множествами (Set): значение change
 * должно быть валидным ключом из CONFIG.DND5E[set] (проверяется в validateChangeValue).
 */
export const MECHANICS = {
  // ------------------------------------------------------------------
  // Урон и атака (глобальные бонусы актёра по типу действия)
  // ------------------------------------------------------------------
  // damageTyped: у записи change можно указать поле type ("fire") —
  // значение станет "1d4[fire]", и dnd5e прочитает тип урона из формулы.
  "damage.melee.bonus":  { key: "system.bonuses.mwak.damage", mode: MODES.ADD, damageTyped: true }, // verified against dnd5e 4.4.4
  "damage.ranged.bonus": { key: "system.bonuses.rwak.damage", mode: MODES.ADD, damageTyped: true }, // verified against dnd5e 4.4.4
  "attack.melee.bonus":  { key: "system.bonuses.mwak.attack", mode: MODES.ADD }, // verified against dnd5e 4.4.4
  "attack.ranged.bonus": { key: "system.bonuses.rwak.attack", mode: MODES.ADD }, // verified against dnd5e 4.4.4

  // В dnd5e НЕТ ключа system.bonuses.spell.damage (есть только spell.dc)!
  // Заклинания делятся на msak (ближние) и rsak (дальние), поэтому одна механика
  // разворачивается в два change. // verified against dnd5e 4.4.4
  "damage.spell.bonus": [
    { key: "system.bonuses.msak.damage", mode: MODES.ADD, damageTyped: true },
    { key: "system.bonuses.rsak.damage", mode: MODES.ADD, damageTyped: true }
  ],
  "attack.spell.bonus": [
    { key: "system.bonuses.msak.attack", mode: MODES.ADD },
    { key: "system.bonuses.rsak.attack", mode: MODES.ADD }
  ],

  // ------------------------------------------------------------------
  // Класс доспеха
  // ------------------------------------------------------------------
  "ac.bonus": { key: "system.attributes.ac.bonus", mode: MODES.ADD },      // verified against dnd5e 4.4.4
  // ВНИМАНИЕ: ac.flat применяется системой только когда у актёра
  // system.attributes.ac.calc === "flat". Для обычного персонажа с расчётом
  // по броне этот override не даст эффекта — это ограничение самой dnd5e.
  "ac.flat":  { key: "system.attributes.ac.flat", mode: MODES.OVERRIDE },  // verified against dnd5e 4.4.4

  // ------------------------------------------------------------------
  // Здоровье (бонусы HP есть только у персонажей; у NPC поле отсутствует)
  // ------------------------------------------------------------------
  "hp.max.bonus": { key: "system.attributes.hp.bonuses.overall", mode: MODES.ADD }, // verified against dnd5e 4.4.4

  // Временные хиты: UPGRADE — «пока эффект активен, temp HP не ниже N».
  // Тот же паттерн, что у эффекта Героизма в самой dnd5e: потраченные
  // temp HP вернутся при пересчёте, снятие эффекта их убирает.
  // Для РАЗОВОЙ выдачи temp HP используйте onUse-обработчик, не эффект.
  "hp.temp": { key: "system.attributes.hp.temp", mode: MODES.UPGRADE }, // verified against dnd5e 4.4.4

  // ------------------------------------------------------------------
  // Скорость
  // ------------------------------------------------------------------
  "speed.walk":     { key: "system.attributes.movement.walk", mode: MODES.ADD },      // verified against dnd5e 4.4.4
  "speed.walk.set": { key: "system.attributes.movement.walk", mode: MODES.OVERRIDE }, // verified against dnd5e 4.4.4
  "speed.fly":      { key: "system.attributes.movement.fly",  mode: MODES.UPGRADE },  // verified against dnd5e 4.4.4
  "speed.swim":     { key: "system.attributes.movement.swim", mode: MODES.UPGRADE },  // verified against dnd5e 4.4.4

  // ------------------------------------------------------------------
  // Инициатива
  // ------------------------------------------------------------------
  "init.bonus": { key: "system.attributes.init.bonus", mode: MODES.ADD }, // verified against dnd5e 4.4.4

  // Единственное «преимущество», которое умеет чистая dnd5e 4.4.4 через AE-флаг:
  // преимущество на инициативу. // verified against dnd5e 4.4.4 (flags.dnd5e.initiativeAdv)
  "advantage.init": { key: "flags.dnd5e.initiativeAdv", mode: MODES.OVERRIDE },

  // ------------------------------------------------------------------
  // Глобальные бонусы ко всем спасброскам / проверкам / навыкам
  // ------------------------------------------------------------------
  "save.all.bonus":  { key: "system.bonuses.abilities.save",  mode: MODES.ADD }, // verified against dnd5e 4.4.4
  "check.all.bonus": { key: "system.bonuses.abilities.check", mode: MODES.ADD }, // verified against dnd5e 4.4.4
  "skill.all.bonus": { key: "system.bonuses.abilities.skill", mode: MODES.ADD }, // verified against dnd5e 4.4.4

  // ------------------------------------------------------------------
  // Сопротивления / иммунитеты / уязвимости — МНОЖЕСТВА (Set).
  // Режим ADD в dnd5e добавляет значение в набор. Значение обязано быть
  // валидным типом урона из CONFIG.DND5E.damageTypes (проверяется отдельно).
  // ------------------------------------------------------------------
  "resistance.add":    { key: "system.traits.dr.value", mode: MODES.ADD, set: "damageTypes" }, // verified against dnd5e 4.4.4
  "immunity.add":      { key: "system.traits.di.value", mode: MODES.ADD, set: "damageTypes" }, // verified against dnd5e 4.4.4
  "vulnerability.add": { key: "system.traits.dv.value", mode: MODES.ADD, set: "damageTypes" }, // verified against dnd5e 4.4.4

  // Иммунитет к состоянию (ошеломление, испуг и т.д.) — тоже множество.
  // Значение — ключ из CONFIG.DND5E.conditionTypes (например "frightened").
  "conditionImmunity.add": { key: "system.traits.ci.value", mode: MODES.ADD, set: "conditionTypes" }, // verified against dnd5e 4.4.4

  // Язык — множество system.traits.languages.value. Без строгой проверки
  // значения: в 4.4.4 конфиг языков вложенный (standard/exotic с children),
  // плюс миры часто добавляют свои языки.
  "language.add": { key: "system.traits.languages.value", mode: MODES.ADD }, // verified against dnd5e 4.4.4

  // ------------------------------------------------------------------
  // Владения. Оружие/доспехи — множества traits (значения: категории
  // "sim"/"mar"/"lgt"... или конкретные baseItem-идентификаторы; конфиг
  // вложенный, поэтому строгой проверки нет — как у языков).
  // Инструменты в dnd5e 4.x живут НЕ в traits, а в system.tools.<id>.value —
  // ключ динамический: значение записи подставляется в «*»
  // (value: "thief" → system.tools.thief.value = 1).
  // ------------------------------------------------------------------
  "proficiency.weapon.add": { key: "system.traits.weaponProf.value", mode: MODES.ADD }, // verified against dnd5e 4.4.4
  "proficiency.armor.add":  { key: "system.traits.armorProf.value",  mode: MODES.ADD }, // verified against dnd5e 4.4.4
  "proficiency.tool.add": { key: "system.tools.*.value", mode: MODES.UPGRADE, dynamicKey: true, fixedValue: 1, set: "tools" }, // verified against dnd5e 4.4.4

  // ------------------------------------------------------------------
  // Чувства (в футах). UPGRADE — повышение до значения: тёмное зрение 60
  // не ухудшит расовое 120.
  // ------------------------------------------------------------------
  "senses.darkvision":  { key: "system.attributes.senses.darkvision",  mode: MODES.UPGRADE }, // verified against dnd5e 4.4.4
  "senses.blindsight":  { key: "system.attributes.senses.blindsight",  mode: MODES.UPGRADE }, // verified against dnd5e 4.4.4
  "senses.tremorsense": { key: "system.attributes.senses.tremorsense", mode: MODES.UPGRADE }, // verified against dnd5e 4.4.4
  "senses.truesight":   { key: "system.attributes.senses.truesight",   mode: MODES.UPGRADE }, // verified against dnd5e 4.4.4

  // ------------------------------------------------------------------
  // Заклинания и концентрация
  // ------------------------------------------------------------------
  "spell.dc.bonus": { key: "system.bonuses.spell.dc", mode: MODES.ADD }, // verified against dnd5e 4.4.4
  "save.concentration.bonus": { key: "system.attributes.concentration.bonuses.save", mode: MODES.ADD }, // verified against dnd5e 4.4.4

  // ------------------------------------------------------------------
  // Урон/лечение «во времени» — по ходам боя. Это НЕ обычные AE-changes:
  // effects.js разворачивает их либо в flags.midi-qol.OverTime (midi активен),
  // либо в flags.okassen.overTime эффекта (встроенный обработчик хода).
  // Дополнительные поля записи: type (тип урона, обязателен для damage),
  // turn ("start"|"end", по умолчанию "start"), save + dc (только с midi).
  // ------------------------------------------------------------------
  "damage.overTime": { special: "overTime", kind: "damage" },
  "heal.overTime":   { special: "overTime", kind: "heal" },

  // ------------------------------------------------------------------
  // Порог критического попадания (например 19 = крит на 19-20).
  // DOWNGRADE — берётся МЕНЬШЕЕ значение (меньший порог лучше).
  // Эти флаги dnd5e читает сама — midi-qol не нужен.
  // ------------------------------------------------------------------
  "crit.weapon.threshold": { key: "flags.dnd5e.weaponCriticalThreshold", mode: MODES.DOWNGRADE }, // verified against dnd5e 4.4.4
  "crit.spell.threshold":  { key: "flags.dnd5e.spellCriticalThreshold",  mode: MODES.DOWNGRADE }  // verified against dnd5e 4.4.4
};

// ------------------------------------------------------------------
// Характеристики: значение, бонус спасброска, бонус проверки — для всех шести.
// Аббревиатуры стабильны в dnd5e 4.4.4 (CONFIG.DND5E.abilities).
// ------------------------------------------------------------------
for (const abl of ["str", "dex", "con", "int", "wis", "cha"]) {
  MECHANICS[`ability.${abl}`]     = { key: `system.abilities.${abl}.value`,         mode: MODES.ADD }; // verified against dnd5e 4.4.4
  MECHANICS[`save.${abl}.bonus`]  = { key: `system.abilities.${abl}.bonuses.save`,  mode: MODES.ADD }; // verified against dnd5e 4.4.4
  MECHANICS[`check.${abl}.bonus`] = { key: `system.abilities.${abl}.bonuses.check`, mode: MODES.ADD }; // verified against dnd5e 4.4.4
}

// ------------------------------------------------------------------
// Навыки: бонус к проверке для всех 18 стандартных навыков.
// Аббревиатуры стабильны в dnd5e 4.4.4 (CONFIG.DND5E.skills).
// ------------------------------------------------------------------
const SKILLS = [
  "acr", "ani", "arc", "ath", "dec", "his", "ins", "itm", "inv",
  "med", "nat", "prc", "prf", "per", "rel", "slt", "ste", "sur"
];
for (const skl of SKILLS) {
  MECHANICS[`skill.${skl}.bonus`] = { key: `system.skills.${skl}.bonuses.check`, mode: MODES.ADD }; // verified against dnd5e 4.4.4
}

/**
 * Курированные механики, работающие ТОЛЬКО через midi-qol: их нет в чистой
 * dnd5e ни в каком виде. Значение записи — 1 (флаг-переключатель), кроме
 * dr.* — там число/формула снижаемого урона. Ключи — стабильные флаги midi-qol.
 *
 *  - grants.* — как атакующие бьют ПО носителю эффекта (помеха/преимущество им);
 *  - fail.*   — носитель автоматически проваливает все спасброски/проверки;
 *  - dr.all / dr.nonmagical — плоское снижение получаемого урона (midi DR).
 */
export const MIDI_MECHANICS = {
  "grants.advantage.attack.all":    "flags.midi-qol.grants.advantage.attack.all",
  "grants.disadvantage.attack.all": "flags.midi-qol.grants.disadvantage.attack.all",
  "fail.save.all":                  "flags.midi-qol.fail.ability.save.all",
  "fail.check.all":                 "flags.midi-qol.fail.ability.check.all",
  "dr.all":                         "flags.midi-qol.DR.all",
  "dr.nonmagical":                  "flags.midi-qol.DR.non-magical"
};

/** Механика требует активного midi-qol (advantage/disadvantage или из MIDI_MECHANICS)? */
export function mechanicNeedsMidi(mechanic) {
  if (typeof mechanic !== "string") return false;
  if (mechanic in MIDI_MECHANICS) return true;
  return /^(advantage|disadvantage)\./.test(mechanic) && mechanic !== "advantage.init";
}

/**
 * Разрешить механику в массив шаблонов change.
 *
 * @param {string} mechanic — короткая запись механики
 * @returns {Array<{key: string, mode: number, priority?: number, set?: string}>}
 * @throws {Error} — с человекочитаемым текстом, если механика неизвестна.
 *   Для механик advantage.* / disadvantage.* (кроме advantage.init) и для
 *   курированных midi-механик (grants.* / fail.* / dr.*) — отдельное пояснение
 *   про midi-qol: без него таких AE-флагов просто нет, и мы честно отказываемся,
 *   а не делаем вид, что работает.
 */
export function resolveMechanic(mechanic) {
  const def = MECHANICS[mechanic];
  if (def) return Array.isArray(def) ? def : [def];

  // Курированные midi-механики: с активным midi → его флаг, иначе честный отказ.
  if (mechanic in MIDI_MECHANICS) {
    if (midiActive()) return [{ key: MIDI_MECHANICS[mechanic], mode: MODES.OVERRIDE }];
    throw new Error(game.i18n.format("OKASSEN.errors.mechanicNeedsMidi", { mechanic }));
  }

  // Особый случай: преимущество/помеха. База dnd5e не умеет это через Active
  // Effects (кроме инициативы). Если midi-qol АКТИВЕН — дружелюбная обёртка:
  // advantage.attack.mwak → flags.midi-qol.advantage.attack.mwak
  // (value в записи ставьте 1). Без midi — честный отказ, как раньше.
  if (/^(advantage|disadvantage)\./.test(mechanic)) {
    if (midiActive()) {
      return [{ key: `flags.midi-qol.${mechanic}`, mode: MODES.OVERRIDE }];
    }
    throw new Error(game.i18n.format("OKASSEN.errors.advantageNeedsMidi", { mechanic }));
  }

  const available = [...Object.keys(MECHANICS), ...Object.keys(MIDI_MECHANICS)].sort().join(", ");
  throw new Error(game.i18n.format("OKASSEN.errors.unknownMechanic", { mechanic, available }));
}

/**
 * Проверить запись change для механики: значения-множества (валидный ключ
 * CONFIG.DND5E[set]) и спецификации overTime (формула/тип/ход/спасбросок).
 *
 * @param {string} mechanic — имя механики (для текста ошибки)
 * @param {Array} defs — результат resolveMechanic
 * @param {object} change — ПОЛНАЯ запись change из JSON (не только value)
 * @throws {Error} — если запись не подходит
 */
export function validateChangeValue(mechanic, defs, change) {
  const value = change.value;
  for (const def of defs) {
    if (def.special === "overTime") {
      validateOverTime(mechanic, def.kind, change);
      continue;
    }
    if (!def.set) continue;
    const config = CONFIG.DND5E?.[def.set] ?? {};
    if (!(value in config)) {
      throw new Error(game.i18n.format("OKASSEN.errors.badSetValue", {
        mechanic,
        value: String(value),
        allowed: Object.keys(config).sort().join(", ")
      }));
    }
  }
}
