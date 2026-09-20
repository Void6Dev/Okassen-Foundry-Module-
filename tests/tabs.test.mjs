/**
 * tabs.test.mjs — построители содержимого вкладок окна импорта.
 *
 * Отдельная защита от каскада: если регистрация настройки почему-то не
 * прошла (сбой в соседнем шаге инициализации, чужой модуль сломал init),
 * вкладка должна показать пустой список, а не уронить окно целиком.
 * Именно так выглядел баг «работает только вкладка импорта».
 */

import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryStubs, loadModule, StubDocument } from "./foundry-stub.mjs";

installFoundryStubs({
  items: [
    new StubDocument({
      _id: "i1",
      name: "Медный посох",
      type: "weapon",
      img: "icons/staff.webp",
      system: { description: { value: "<p>Текст</p>" } },
      flags: {
        okassen: {
          sourceId: "staff",
          source: {
            name: "Медный посох",
            type: "weapon",
            img: "icons/staff.webp",
            system: { description: { value: "<p>Текст</p>" } }
          }
        }
      }
    })
  ]
});

const { buildHistoryHtml } = await loadModule("history.js");
const { buildSourcesHtml, compareWithSource, sourceOf } = await loadModule("sources.js");
const { buildPreviewHtml } = await loadModule("preview.js");
const { registerSettings } = await loadModule("settings.js");

test("история не падает, когда её настройка ещё не зарегистрирована", () => {
  // Настройки намеренно НЕ регистрируем: воспроизводим сорванный init.
  const html = buildHistoryHtml();
  assert.match(html, /OKASSEN\.history\.empty/);
});

test("исходники читаются и совпадение с JSON видно", () => {
  const html = buildSourcesHtml();
  assert.match(html, /OKASSEN\.sources\.(summary|allClean)/);
});

test("документ без правок не числится разошедшимся", () => {
  const doc = game.items[0];
  assert.ok(sourceOf(doc), "исходник на месте");
  assert.deepEqual(compareWithSource(doc).rows, []);
});

test("правка в листе видна как расхождение", () => {
  const doc = game.items[0];
  doc._source.name = "Медный посох +1";
  const { rows } = compareWithSource(doc);
  assert.ok(rows.some(r => r.path === "name"), JSON.stringify(rows));
  doc._source.name = "Медный посох";
});

test("предпросмотр строится и называет судьбу документа", () => {
  registerSettings();
  const html = buildPreviewHtml({
    name: "Медный посох",
    type: "weapon",
    system: {},
    _forge: { effects: [{ label: "Бонус", changes: [{ mechanic: "ac.bonus", value: 1 }] }] }
  });
  assert.match(html, /okassen-preview-fate/);
  assert.match(html, /OKASSEN\.preview\.willMatch/, "существующий документ найден");
});
