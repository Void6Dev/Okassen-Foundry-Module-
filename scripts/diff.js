/**
 * diff.js — сравнение документа с тем, во что его превратит JSON.
 *
 * Раньше это жило внутри loader.js и обслуживало только диалог дублей.
 * Теперь тем же кодом пользуются: диалог дублей, отчёт о расхождениях
 * с сохранённым исходником (sources.js) и предпросмотр.
 *
 * Сравниваем ПОЛНЫЕ данные с полными: входной JSON прогоняется через модель
 * документа, иначе разреженный JSON дал бы ложные «удаления» на каждом
 * незаполненном поле схемы.
 */

import { escapeHtml } from "./util.js";

/** Сколько строк отличий показывать в свёрнутом блоке. */
const MAX_ROWS = 24;

/** Короткое строковое представление значения для diff-списка. */
export function shortValue(v) {
  let s;
  try {
    s = typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    s = String(v);
  }
  if (s === undefined) s = "—";
  if (s.length > 48) s = s.slice(0, 45) + "…";
  return escapeHtml(s);
}

/**
 * Список отличий между существующим документом и данными нового.
 *
 * @param {Item|Actor} existing — документ в мире
 * @param {object} data — данные документа (без _forge; effects — массив данных)
 * @returns {Array<{path: string, from: *, to: *}>} — пустой массив = совпадают
 */
export function diffRows(existing, data) {
  const pick = src => foundry.utils.flattenObject({
    name: src.name, img: src.img, system: src.system ?? {}
  });
  const oldFlat = pick(existing.toObject());

  // Полные данные нового: модель заполнит умолчания и вычистит мусор.
  const cls = existing.documentName === "Actor" ? Actor : Item;
  const newDoc = new cls.implementation(foundry.utils.deepClone(data));
  const newFlat = pick(newDoc.toObject());

  const rows = [];
  for (const k of [...new Set([...Object.keys(oldFlat), ...Object.keys(newFlat)])].sort()) {
    const a = JSON.stringify(oldFlat[k]);
    const b = JSON.stringify(newFlat[k]);
    if (a === b) continue;
    rows.push({ path: k, from: oldFlat[k], to: newFlat[k] });
  }

  // Эффекты сравниваем по именам (детально их покажет предпросмотр).
  const oldFx = existing.effects.map(e => e.name).sort().join(", ");
  const newFx = (data.effects ?? []).map(e => e.name).sort().join(", ");
  if (oldFx !== newFx) rows.push({ path: "effects", from: `[${oldFx}]`, to: `[${newFx}]` });

  return rows;
}

/**
 * HTML-блок отличий (<details> со списком) или сообщение «отличий нет».
 * Ошибка построения не должна ронять вызывающий диалог — возвращаем "".
 *
 * @param {Item|Actor} existing
 * @param {object} data
 * @param {object} [opts]
 * @param {string} [opts.summaryKey] — ключ локализации заголовка (принимает {count})
 * @returns {string}
 */
export function buildDiffHtml(existing, data, { summaryKey = "OKASSEN.dup.diffSummary" } = {}) {
  try {
    const rows = diffRows(existing, data);
    if (!rows.length) {
      return `<p class="okassen-diff-none">${game.i18n.localize("OKASSEN.dup.noDiff")}</p>`;
    }

    const items = rows.slice(0, MAX_ROWS)
      .map(r => `<li><code>${escapeHtml(r.path)}</code>: ${shortValue(r.from)} → ${shortValue(r.to)}</li>`)
      .join("");
    const more = rows.length > MAX_ROWS
      ? `<li>… ${game.i18n.format("OKASSEN.dup.moreDiff", { count: rows.length - MAX_ROWS })}</li>`
      : "";

    return `<details class="okassen-diff" open>
      <summary>${game.i18n.format(summaryKey, { count: rows.length })}</summary>
      <ul>${items}${more}</ul>
    </details>`;
  } catch (err) {
    console.warn("[okassen] Не удалось построить diff:", err);
    return "";
  }
}
