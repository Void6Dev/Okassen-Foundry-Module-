/**
 * manifest.test.mjs — целостность того, что Foundry читает без нас:
 * манифест модуля и файлы локализации.
 *
 * Проверки дешёвые, а ловят самое обидное: ключ, который забыли перевести
 * (в интерфейсе видно «OKASSEN.что.то» вместо текста), и расхождение
 * версии в module.json со ссылкой на архив релиза.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = file => fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
const readJson = file => JSON.parse(read(file));

const ru = readJson("lang/ru.json");
const en = readJson("lang/en.json");

test("манифест модуля валиден и согласован", () => {
  const manifest = readJson("module.json");
  assert.equal(manifest.id, "okassen");
  assert.ok(manifest.version, "есть версия");
  assert.ok(manifest.esmodules?.includes("scripts/main.js"));
  assert.ok(
    manifest.download.includes(`v${manifest.version}/`),
    `ссылка на архив (${manifest.download}) должна указывать на версию ${manifest.version}`
  );
  for (const lang of manifest.languages ?? []) {
    assert.ok(fs.existsSync(path.resolve(process.cwd(), lang.path)), `есть файл ${lang.path}`);
  }
});

test("наборы ключей ru и en совпадают", () => {
  const onlyRu = Object.keys(ru).filter(k => !(k in en));
  const onlyEn = Object.keys(en).filter(k => !(k in ru));
  assert.deepEqual(onlyRu, [], "ключи без английского перевода");
  assert.deepEqual(onlyEn, [], "ключи без русского перевода");
});

test("пустых строк перевода нет", () => {
  for (const [file, data] of [["ru", ru], ["en", en]]) {
    for (const [key, value] of Object.entries(data)) {
      assert.ok(typeof value === "string" && value.trim(), `${file}: пустое значение у ${key}`);
    }
  }
});

test("каждый ключ, который спрашивает код, существует в переводе", () => {
  const sources = [
    ...fs.readdirSync("scripts").filter(f => f.endsWith(".js")).map(f => `scripts/${f}`),
    ...fs.readdirSync("templates").filter(f => f.endsWith(".hbs")).map(f => `templates/${f}`)
  ];

  const used = new Set();
  for (const file of sources) {
    // Только ключи-литералы: собранные из шаблонных строк (`OKASSEN.mech.${x}`)
    // проверить статически нельзя — у них есть свои запасные ветки в коде.
    for (const m of read(file).matchAll(/["'](OKASSEN\.[A-Za-z0-9_.-]+)["']/g)) used.add(m[1]);
  }

  const missing = [...used].filter(key => !(key in ru)).sort();
  assert.deepEqual(missing, [], "ключи используются в коде, но не переведены");
});
