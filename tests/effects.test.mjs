/**
 * effects.test.mjs — сборка Active Effects из _forge.effects.
 *
 * Ключевое здесь — стабильность _id: на ней держатся и привязки эффектов
 * к активностям (applyTo), и повторный импорт «Обновить на месте».
 * И штамп managed: по нему обновление понимает, какие эффекты его,
 * а какие ведущий добавил руками.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryStubs, loadModule } from "./foundry-stub.mjs";

installFoundryStubs();

const { buildEffects, linkActivityEffects } = await loadModule("effects.js");

test("механика разворачивается в change с ключом и режимом", () => {
  const [fx] = buildEffects([
    { label: "Огонь", changes: [{ mechanic: "ac.bonus", value: 2 }] }
  ]);
  assert.equal(fx.name, "Огонь");
  assert.equal(fx.changes.length, 1);
  assert.equal(fx.changes[0].key, "system.attributes.ac.bonus");
  assert.equal(fx.changes[0].mode, CONST.ACTIVE_EFFECT_MODES.ADD);
  // Значения Active Effect в Foundry — строки, модуль приводит их сам.
  assert.equal(fx.changes[0].value, "2");
});

test("тип урона дописывается к формуле бонуса", () => {
  const [fx] = buildEffects([
    { label: "Клинок", changes: [{ mechanic: "damage.melee.bonus", value: "1d4", type: "fire" }] }
  ]);
  assert.equal(fx.changes[0].value, "1d4[fire]");
});

test("эффекты помечаются штампом managed", () => {
  const [fx] = buildEffects([{ label: "Любой", changes: [] }]);
  assert.equal(fx.flags.okassen.managed, true);
});

test("одинаковое семя id даёт одинаковый _id (повторный импорт не рвёт ссылки)", () => {
  const a = buildEffects([{ id: "seal-1", label: "Первая печать", changes: [] }]);
  const b = buildEffects([{ id: "seal-1", label: "Переименованная печать", changes: [] }]);
  assert.equal(a[0]._id, b[0]._id);
  assert.match(a[0]._id, /^[A-Za-z0-9]{16}$/);

  const c = buildEffects([{ id: "seal-2", label: "Вторая печать", changes: [] }]);
  assert.notEqual(a[0]._id, c[0]._id);
});

test("готовый 16-символьный _id сохраняется как есть", () => {
  const [fx] = buildEffects([{ _id: "abcdefgh12345678", label: "Эффект", changes: [] }]);
  assert.equal(fx._id, "abcdefgh12345678");
});

test("умолчания: transfer включён, disabled выключен, иконка подставлена", () => {
  const [fx] = buildEffects([{ label: "Эффект", changes: [] }]);
  assert.equal(fx.transfer, true);
  assert.equal(fx.disabled, false);
  assert.ok(fx.img);
});

test("overTime без midi-qol уезжает во флаг модуля, а не в change", () => {
  const [fx] = buildEffects([
    { label: "Регенерация", changes: [{ mechanic: "heal.overTime", value: "1d4", turn: "start" }] }
  ]);
  assert.equal(fx.changes.length, 0, "в changes ничего не попадает");
  const specs = fx.flags.okassen.overTime;
  assert.equal(specs.length, 1);
  assert.equal(specs[0].kind, "heal");
  assert.equal(specs[0].formula, "1d4");
});

test("applyTo вписывает id эффекта в активность предмета", () => {
  const forge = [{ id: "web", label: "Паутина", applyTo: ["act1"], changes: [] }];
  const data = { name: "Сеть", type: "weapon", system: { activities: { act1: {} } } };
  data.effects = buildEffects(forge);
  linkActivityEffects(data, forge);

  assert.deepEqual(data.system.activities.act1.effects, [{ _id: data.effects[0]._id }]);
});

test("applyTo на несуществующую активность ничего не ломает", () => {
  const forge = [{ id: "web", label: "Паутина", applyTo: ["нет-такой"], changes: [] }];
  const data = { name: "Сеть", type: "weapon", system: { activities: { act1: {} } } };
  data.effects = buildEffects(forge);
  linkActivityEffects(data, forge);

  assert.equal(data.system.activities.act1.effects, undefined);
});
