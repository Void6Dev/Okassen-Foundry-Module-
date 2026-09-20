/**
 * examples.test.mjs — примеры из папки examples/ должны быть импортируемыми.
 *
 * Пример, который не проходит собственный линтер модуля, — худшая из
 * документаций: человек копирует его, получает ошибку и решает, что сломан
 * модуль. Ошибки (level: "error") запрещены; предупреждения допустимы —
 * они бывают честными (например, механика требует неактивный midi-qol).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { installFoundryStubs, loadModule } from "./foundry-stub.mjs";

// midi-qol включён намеренно: часть примеров (пентаграмма Продитрикса)
// построена на механиках преимущества/помехи, которых в чистой dnd5e нет —
// без midi модуль честно откажет. Проверяем примеры в том мире, на который
// они рассчитаны; остальные примеры от включённого midi не меняются.
installFoundryStubs({ midi: true });

const { lintForge } = await loadModule("lint.js");
const { preprocess } = await loadModule("preprocess.js");
const { registerSettings } = await loadModule("settings.js");
const { initBuiltinHandlers } = await loadModule("handlers.js");
const { initTransform } = await loadModule("transform.js");

registerSettings();
// Обработчики должны быть зарегистрированы: иначе линтер справедливо скажет,
// что примеры ссылаются на несуществующие onUse-обработчики.
initBuiltinHandlers();
initTransform();

const files = fs.readdirSync("examples").filter(f => f.endsWith(".json"));

test("папка примеров не пуста", () => {
  assert.ok(files.length > 0);
});

for (const file of files) {
  test(`пример ${file} разбирается и проходит проверку`, () => {
    const raw = JSON.parse(fs.readFileSync(path.join("examples", file), "utf8"));
    const issues = lintForge(preprocess(raw));
    const errors = issues.filter(i => i.level === "error");
    assert.deepEqual(errors.map(e => e.message), [], `ошибки в ${file}`);
  });
}
