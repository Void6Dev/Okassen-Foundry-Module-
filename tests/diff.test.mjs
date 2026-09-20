/**
 * diff.test.mjs — сравнение документа с данными нового JSON.
 *
 * На diffRows держатся три вещи: диалог дублей, отчёт о расхождениях с
 * исходником и подсчёт «отличий: N» во вкладке «Исходники». Ложное
 * срабатывание там хуже, чем отсутствие строки: автор начнёт искать
 * правки, которых не делал.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryStubs, loadModule, StubDocument } from "./foundry-stub.mjs";

installFoundryStubs();

const { diffRows, shortValue } = await loadModule("diff.js");

const existing = new StubDocument({
  _id: "i1",
  name: "Медный посох",
  img: "icons/staff.webp",
  type: "weapon",
  system: { description: { value: "<p>Старое описание</p>" }, equipped: true },
  effects: [{ _id: "fx1", name: "Первая печать" }]
});

test("совпадающие данные не дают отличий", () => {
  const rows = diffRows(existing, {
    name: "Медный посох",
    img: "icons/staff.webp",
    type: "weapon",
    system: { description: { value: "<p>Старое описание</p>" }, equipped: true },
    effects: [{ name: "Первая печать" }]
  });
  assert.deepEqual(rows, []);
});

test("изменение имени и поля system попадает в список", () => {
  const rows = diffRows(existing, {
    name: "Медный посох +1",
    img: "icons/staff.webp",
    type: "weapon",
    system: { description: { value: "<p>Новое описание</p>" }, equipped: true },
    effects: [{ name: "Первая печать" }]
  });

  const paths = rows.map(r => r.path);
  assert.ok(paths.includes("name"), paths.join(", "));
  assert.ok(paths.includes("system.description.value"), paths.join(", "));
  assert.equal(rows.find(r => r.path === "name").to, "Медный посох +1");
});

test("разный набор эффектов виден одной строкой", () => {
  const rows = diffRows(existing, {
    name: "Медный посох",
    img: "icons/staff.webp",
    type: "weapon",
    system: { description: { value: "<p>Старое описание</p>" }, equipped: true },
    effects: [{ name: "Первая печать" }, { name: "Вторая печать" }]
  });

  const fx = rows.find(r => r.path === "effects");
  assert.ok(fx, "строка effects есть");
  assert.ok(String(fx.to).includes("Вторая печать"));
});

test("shortValue обрезает длинные значения и экранирует HTML", () => {
  assert.equal(shortValue("коротко"), "коротко");
  assert.ok(shortValue("x".repeat(100)).endsWith("…"));
  assert.equal(shortValue("<b>&"), "&lt;b&gt;&amp;");
  assert.equal(shortValue(undefined), "—");
});
