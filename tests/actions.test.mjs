/**
 * actions.test.mjs — связка шаблона и карты действий окна импорта.
 *
 * Тест родился из живого бага: кнопки вкладок использовали
 * data-action="tab", а Foundry v14 обрабатывает это имя САМ —
 * ApplicationV2#onClickAction ловит "tab" в своём switch раньше, чем
 * заглядывает в options.actions. Обработчик модуля не вызывался, и в окне
 * работала только вкладка, открытая по умолчанию.
 *
 * Отсюда две проверки: не использовать зарезервированные ядром имена и не
 * ссылаться на действие, которого нет в карте (такая кнопка молча мертва).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/** Имена, которые ApplicationV2 обрабатывает сам (client/applications/api/application.mjs). */
const RESERVED = new Set(["close", "tab", "toggleControls"]);

const template = fs.readFileSync("templates/import-dialog.hbs", "utf8");
const main = fs.readFileSync("scripts/main.js", "utf8");

/** Все data-action из шаблона. */
const used = [...template.matchAll(/data-action="([^"]+)"/g)].map(m => m[1]);

/** Имена из блока actions в DEFAULT_OPTIONS. */
const declared = new Set(
  [...main.matchAll(/^\s{6}(\w+):\s*OkassenImportDialog\.#/gm)].map(m => m[1])
);

test("шаблон вообще использует действия", () => {
  assert.ok(used.length > 5, `нашлось действий: ${used.length}`);
  assert.ok(declared.size > 5, `объявлено обработчиков: ${declared.size}`);
});

test("ни одно действие не конфликтует с зарезервированными именами ядра", () => {
  const clashes = [...new Set(used)].filter(a => RESERVED.has(a));
  assert.deepEqual(clashes, [], "ядро Foundry обработает такие действия само");
});

test("у каждого действия шаблона есть обработчик", () => {
  const orphans = [...new Set(used)].filter(a => !declared.has(a));
  assert.deepEqual(orphans, [], "кнопка есть, обработчика нет");
});

test("каждая вкладка шаблона имеет и кнопку, и секцию", () => {
  const buttons = new Set(
    [...template.matchAll(/data-action="okassenTab"\s+data-tab="([^"]+)"/g)].map(m => m[1])
  );
  const sections = new Set(
    [...template.matchAll(/<section class="okassen-tab[^"]*"\s+data-tab="([^"]+)"/g)].map(m => m[1])
  );
  assert.deepEqual([...buttons].sort(), [...sections].sort());
});
