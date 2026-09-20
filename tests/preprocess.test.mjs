/**
 * preprocess.test.mjs — сниппеты (_defs / $ref) и переменные (_vars / {{…}}).
 *
 * Препроцессор работает до валидации и создания документов, поэтому его
 * ошибки видны автору сразу. Проверяем и удачные развороты, и отказы:
 * молчаливый неверный разворот хуже понятной ошибки.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryStubs, loadModule } from "./foundry-stub.mjs";

installFoundryStubs();

const { preprocess, evalExpression } = await loadModule("preprocess.js");

test("$ref подставляет сниппет и принимает переопределения", () => {
  const out = preprocess({
    name: "Плащ",
    type: "equipment",
    _defs: { resist: { label: "Стойкость", changes: [{ mechanic: "ac.bonus", value: 1 }] } },
    _forge: { effects: [{ $ref: "resist" }, { $ref: "resist", label: "Вторая" }] }
  });

  assert.equal(out._forge.effects[0].label, "Стойкость");
  assert.equal(out._forge.effects[1].label, "Вторая");
  assert.equal(out._forge.effects[1].changes[0].mechanic, "ac.bonus");
  assert.equal(out._defs, undefined, "_defs вычищается из результата");
});

test("копии сниппета независимы", () => {
  const out = preprocess({
    name: "Плащ",
    type: "equipment",
    _defs: { base: { changes: [{ mechanic: "ac.bonus", value: 1 }] } },
    _forge: { effects: [{ $ref: "base" }, { $ref: "base" }] }
  });

  out._forge.effects[0].changes[0].value = 99;
  assert.equal(out._forge.effects[1].changes[0].value, 1);
});

test("цикл в _defs — понятная ошибка, а не переполнение стека", () => {
  assert.throws(() => preprocess({
    name: "Плащ",
    type: "equipment",
    _defs: { a: { $ref: "b" }, b: { $ref: "a" } },
    _forge: { effects: [{ $ref: "a" }] }
  }));
});

test("ссылка на несуществующий сниппет — ошибка", () => {
  assert.throws(() => preprocess({
    name: "Плащ",
    type: "equipment",
    _defs: {},
    _forge: { effects: [{ $ref: "нет-такого" }] }
  }));
});

test("{{выражение}} считается и сохраняет числовой тип", () => {
  const out = preprocess({
    name: "Посох",
    type: "weapon",
    _vars: { level: 5 },
    _forge: { effects: [{ label: "Бонус", changes: [{ mechanic: "ac.bonus", value: "{{floor(level / 2)}}" }] }] }
  });

  assert.equal(out._forge.effects[0].changes[0].value, 2);
  assert.equal(typeof out._forge.effects[0].changes[0].value, "number");
});

test("плейсхолдер внутри строки остаётся строкой", () => {
  const out = preprocess({
    name: "Посох",
    type: "weapon",
    _vars: { level: 3 },
    _forge: { effects: [{ label: "Урон", changes: [{ mechanic: "damage.melee.bonus", value: "{{level}}d6" }] }] }
  });

  assert.equal(out._forge.effects[0].changes[0].value, "3d6");
});

test("без _vars фигурные скобки в тексте не трогаются", () => {
  const out = preprocess({
    name: "Свиток",
    type: "consumable",
    system: { description: { value: "Текст с {{шаблоном}} внутри" } }
  });

  assert.equal(out.system.description.value, "Текст с {{шаблоном}} внутри");
});

test("общий заголовок пакета делится сниппетами со всеми документами", () => {
  const out = preprocess([
    { _defs: { bonus: { label: "Общий", changes: [] } }, _vars: { n: 2 } },
    { name: "Первый", type: "weapon", _forge: { effects: [{ $ref: "bonus" }] } },
    { name: "Второй", type: "weapon", _forge: { effects: [{ $ref: "bonus", label: "{{n}}" }] } }
  ]);

  assert.equal(out.length, 2, "заголовок не остаётся документом");
  assert.equal(out[0]._forge.effects[0].label, "Общий");
  assert.equal(out[1]._forge.effects[0].label, 2);
});

test("evalExpression: арифметика, функции и приоритеты", () => {
  assert.equal(evalExpression("2 + 3 * 4", {}), 14);
  assert.equal(evalExpression("(2 + 3) * 4", {}), 20);
  assert.equal(evalExpression("max(1, level)", { level: 7 }), 7);
  assert.equal(evalExpression("-level + 1", { level: 3 }), -2);
});

test("evalExpression: неизвестное имя и мусор — ошибка", () => {
  assert.throws(() => evalExpression("нетТакойПеременной + 1", {}));
  assert.throws(() => evalExpression("2 +", {}));
});
