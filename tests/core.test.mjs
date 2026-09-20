/**
 * core.test.mjs — настройки, sourceId и поиск существующего документа.
 *
 * Это те части, на которых стоит повторный импорт: если getSetting перестанет
 * отдавать умолчание до регистрации, модуль упадёт на первом же хуке, а если
 * findExistingLocal перестанет находить документ по sourceId — «Обновить на
 * месте» молча превратится в «создать копию».
 */

import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryStubs, loadModule, StubDocument } from "./foundry-stub.mjs";

installFoundryStubs({
  items: [
    new StubDocument({ _id: "i1", name: "Медный посох", type: "weapon", flags: { okassen: { sourceId: "staff" } } }),
    new StubDocument({ _id: "i2", name: "Кольцо", type: "equipment" })
  ]
});

const { getSetting, registerSettings, DEFAULTS } = await loadModule("settings.js");
const { sourceIdOf, stampSourceId, findExistingLocal } = await loadModule("sync.js");

test("getSetting отдаёт умолчание, пока настройки не зарегистрированы", () => {
  assert.equal(getSetting("defaultDuplicate"), DEFAULTS.defaultDuplicate);
  assert.equal(getSetting("nestedDepth"), DEFAULTS.nestedDepth);
});

test("после регистрации читается реальное значение", () => {
  registerSettings();
  game.settings.set("okassen", "defaultDuplicate", "update");
  assert.equal(getSetting("defaultDuplicate"), "update");
});

test("неизвестная настройка не роняет вызов", () => {
  assert.equal(getSetting("такой-настройки-нет"), undefined);
});

test("sourceIdOf берёт только непустую строку", () => {
  assert.equal(sourceIdOf({ _forge: { sourceId: " staff " } }), "staff");
  assert.equal(sourceIdOf({ _forge: { sourceId: "   " } }), null);
  assert.equal(sourceIdOf({ _forge: { sourceId: 42 } }), null);
  assert.equal(sourceIdOf({}), null);
  assert.equal(sourceIdOf(null), null);
});

test("stampSourceId пишет флаг только при непустом id", () => {
  const flags = {};
  stampSourceId(flags, "staff");
  assert.equal(flags.okassen.sourceId, "staff");

  const empty = {};
  stampSourceId(empty, null);
  assert.deepEqual(empty, {});
});

test("документ находится по sourceId, даже если его переименовали", () => {
  const found = findExistingLocal(
    { name: "Совсем другое имя", type: "weapon" },
    { sourceId: "staff" }
  );
  assert.equal(found?.name, "Медный посох");
});

test("без sourceId документ ищется по имени и типу", () => {
  assert.equal(findExistingLocal({ name: "Кольцо", type: "equipment" })?.name, "Кольцо");
  // Тип не совпал — это другой документ.
  assert.equal(findExistingLocal({ name: "Кольцо", type: "weapon" }), null);
  assert.equal(findExistingLocal({ name: "Нет такого", type: "weapon" }), null);
});
