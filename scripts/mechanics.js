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
 */

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
  "damage.melee.bonus":  { key: "system.bonuses.mwak.damage", mode: MODES.ADD }, // verified against dnd5e 4.4.4
  "damage.ranged.bonus": { key: "system.bonuses.rwak.damage", mode: MODES.ADD }, // verified against dnd5e 4.4.4
  "attack.melee.bonus":  { key: "system.bonuses.mwak.attack", mode: MODES.ADD }, // verified against dnd5e 4.4.4
  "attack.ranged.bonus": { key: "system.bonuses.rwak.attack", mode: MODES.ADD }, // verified against dnd5e 4.4.4

  // В dnd5e НЕТ ключа system.bonuses.spell.damage (есть только spell.dc)!
  // Заклинания делятся на msak (ближние) и rsak (дальние), поэтому одна механика
  // разворачивается в два change. // verified against dnd5e 4.4.4
  "damage.spell.bonus": [
    { key: "system.bonuses.msak.damage", mode: MODES.ADD },
    { key: "system.bonuses.rsak.damage", mode: MODES.ADD }
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
  "vulnerability.add": { key: "system.traits.dv.value", mode: MODES.ADD, set: "damageTypes" }  // verified against dnd5e 4.4.4
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
 * Разрешить механику в массив шаблонов change.
 *
 * @param {string} mechanic — короткая запись механики
 * @returns {Array<{key: string, mode: number, priority?: number, set?: string}>}
 * @throws {Error} — с человекочитаемым текстом, если механика неизвестна.
 *   Для advantage.*/disadvantage.* (кроме advantage.init) — отдельное пояснение
 *   про midi-qol: в чистой dnd5e 4.4.4 таких AE-флагов просто нет, и мы честно
 *   отказываемся, а не делаем вид, что работает.
 */
export function resolveMechanic(mechanic) {
  const def = MECHANICS[mechanic];
  if (def) return Array.isArray(def) ? def : [def];

  // Особый случай: преимущество/помеха. База dnd5e 4.4.4 не умеет это через
  // Active Effects (кроме инициативы) — нужен модуль midi-qol.
  if (/^(advantage|disadvantage)\./.test(mechanic)) {
    throw new Error(game.i18n.format("OKASSEN.errors.advantageNeedsMidi", { mechanic }));
  }

  const available = Object.keys(MECHANICS).sort().join(", ");
  throw new Error(game.i18n.format("OKASSEN.errors.unknownMechanic", { mechanic, available }));
}

/**
 * Проверить значение change для механики. Сейчас проверяет только механики-множества:
 * значение должно быть валидным ключом CONFIG.DND5E[set] (например, типом урона).
 *
 * @param {string} mechanic — имя механики (для текста ошибки)
 * @param {Array} defs — результат resolveMechanic
 * @param {*} value — значение из JSON
 * @throws {Error} — если значение не подходит
 */
export function validateChangeValue(mechanic, defs, value) {
  for (const def of defs) {
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
