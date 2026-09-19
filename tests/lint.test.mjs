/**
 * lint.test.mjs — живая проверка _forge и словарь механик.
 *
 * Главное свойство линтера: он НЕ останавливается на первой проблеме.
 * Валидатор бросает исключение на первой же ошибке — это правильно для
 * импорта, но бесполезно для редактора, где автор хочет видеть весь список.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryStubs, loadModule } from "./foundry-stub.mjs";

installFoundryStubs();

const { lintForge, findLine } = await loadModule("lint.js");
const { resolveMechanic, validateChangeValue } = await loadModule("mechanics.js");
const { registerSettings } = await loadModule("settings.js");
registerSettings();

/** Документ со всеми типичными проблемами сразу. */
const dirty = {
  name: "Посох",
  type: "weapon",
  system: { activities: { act1: {} } },
  _forge: {
    onUse: "нет-такого-обработчика",
    effects: [{
      label: "Эффект",
      statuses: ["prone", "нет-такого-состояния"],
      applyTo: ["act1", "act404"],
      changes: [
        { mechanic: "damage.melee.bonus", value: 1 },
        { mechanic: "такой-механики-нет", value: 1 },
        { mechanic: "ac.bonus" }
      ]
    }]
  }
};

test("линтер собирает все замечания за один проход", () => {
  const issues = lintForge(dirty);
  const text = issues.map(i => i.message).join("\n");

  assert.ok(issues.some(i => i.level === "error" && i.message.includes("такой-механики-нет")), text);
  assert.ok(issues.some(i => i.message.includes("applyToMissing")), text);
  assert.ok(issues.some(i => i.message.includes("unknownStatus")), text);
  assert.ok(issues.some(i => i.message.includes("unknownHandler")), text);
  assert.ok(issues.some(i => i.message.includes("noValue")), text);
});

test("у каждого замечания есть уровень", () => {
  for (const issue of lintForge(dirty)) {
    assert.ok(["error", "warn"].includes(issue.level), issue.level);
  }
});

test("чистый документ не даёт замечаний", () => {
  assert.deepEqual(lintForge({
    name: "Кольцо",
    type: "feat",
    system: {},
    _forge: { effects: [{ label: "Бонус", changes: [{ mechanic: "ac.bonus", value: 1 }] }] }
  }), []);
});

test("заголовок пакета (_defs/_vars) не считается документом", () => {
  const clean = { name: "Кольцо", type: "feat", system: {}, _forge: {} };
  assert.deepEqual(lintForge([{ _defs: {}, _vars: {} }, clean]), []);
});

test("findLine показывает строку с проблемным местом", () => {
  const raw = JSON.stringify(dirty, null, 2);
  const line = findLine(raw, "такой-механики-нет");
  assert.ok(line > 1);
  assert.ok(raw.split("\n")[line - 1].includes("такой-механики-нет"));
  assert.equal(findLine(raw, null), null);
  assert.equal(findLine(raw, "чего-тут-нет"), null);
});

test("resolveMechanic разворачивает известную механику", () => {
  const defs = resolveMechanic("ac.bonus");
  assert.equal(defs.length, 1);
  assert.equal(defs[0].key, "system.attributes.ac.bonus");
});

test("неизвестная механика и advantage.* без midi-qol отказывают явно", () => {
  assert.throws(() => resolveMechanic("нет-такой"), /unknownMechanic/);
  assert.throws(() => resolveMechanic("advantage.attack.all"), /advantageNeedsMidi/);
  assert.throws(() => resolveMechanic("dr.all"), /mechanicNeedsMidi/);
});

test("механики-множества проверяют значение по словарю системы", () => {
  const defs = resolveMechanic("resistance.add");
  validateChangeValue("resistance.add", defs, { value: "fire" }); // не бросает
  assert.throws(() => validateChangeValue("resistance.add", defs, { value: "плазма" }), /badSetValue/);
});
