/**
 * sources.js — что в мире разошлось с исходным JSON.
 *
 * Модуль и раньше складывал весь входной JSON в flags.okassen.source, но
 * никто его не читал. А это ровно то, что нужно знать автору кампании:
 * какие документы правили руками в листе — потому что при следующем
 * импорте (или «Пересобрать») эти правки исчезнут.
 *
 * Здесь:
 *  - обход документов модуля (мир, актёры, их предметы);
 *  - сравнение документа с его исходником через diff.js;
 *  - пересборка одного документа или всех сразу — обычным импортом в режиме
 *    «Обновить на месте», поэтому пересборка попадает в историю и
 *    откатывается одной кнопкой.
 */

import { buildEffects } from "./effects.js";
import { preprocess } from "./preprocess.js";
import { diffRows, buildDiffHtml } from "./diff.js";
import { createForgeItem, createForgeActor } from "./loader.js";
import { beginRecord, commitRecord } from "./history.js";
import { escapeHtml } from "./util.js";

const MODULE_ID = "okassen";

/** Сохранённый исходник документа (или null — документ создан не модулем). */
export function sourceOf(doc) {
  const raw = doc?.getFlag?.(MODULE_ID, "source");
  return raw && typeof raw === "object" ? raw : null;
}

/**
 * Данные, которые дал бы исходник при импорте: name/img/system + эффекты.
 * Флаги и вложения в сравнение не берём — сравниваем то, что автор видит
 * в листе документа.
 *
 * @param {object} raw — сохранённый исходный JSON
 * @returns {object|null} — данные для diff или null, если исходник не читается
 */
function dataFromSource(raw) {
  try {
    const parsed = preprocess(foundry.utils.deepClone(raw));
    const data = Array.isArray(parsed) ? parsed[0] : parsed;
    const forge = data._forge ?? {};
    delete data._forge;
    data.effects = buildEffects(forge.effects ?? []);
    return data;
  } catch (err) {
    console.warn("[okassen] Не удалось развернуть исходник документа:", err);
    return null;
  }
}

/** Все документы модуля: мировые предметы и актёры + предметы актёров. */
export function forgeDocuments() {
  const out = [];
  for (const item of game.items) if (sourceOf(item)) out.push(item);
  for (const actor of game.actors) {
    if (sourceOf(actor)) out.push(actor);
    for (const item of actor.items) if (sourceOf(item)) out.push(item);
  }
  return out;
}

/**
 * Сравнить документ с его исходником.
 *
 * @param {Item|Actor} doc
 * @returns {{rows: Array, data: object}|null} — null, если исходника нет
 */
export function compareWithSource(doc) {
  const raw = sourceOf(doc);
  if (!raw) return null;
  const data = dataFromSource(raw);
  if (!data) return null;
  try {
    return { rows: diffRows(doc, data), data };
  } catch (err) {
    console.warn(`[okassen] Не удалось сравнить "${doc.name}" с исходником:`, err);
    return null;
  }
}

/** Диалог «Сравнить с исходником» для одного документа. */
export async function openSourceDiff(doc) {
  const raw = sourceOf(doc);
  if (!raw) {
    ui.notifications.warn(game.i18n.format("OKASSEN.sources.noSource", { name: doc.name }));
    return;
  }
  const data = dataFromSource(raw);
  const content = data
    ? `<p>${game.i18n.format("OKASSEN.sources.diffIntro", { name: escapeHtml(doc.name) })}</p>`
      + buildDiffHtml(doc, data, { summaryKey: "OKASSEN.sources.diffSummary" })
    : `<p>${game.i18n.localize("OKASSEN.sources.broken")}</p>`;

  await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize("OKASSEN.sources.diffTitle"), icon: "fa-solid fa-code-compare" },
    position: { width: 560 },
    content,
    buttons: [{ action: "close", label: "OKASSEN.history.close", icon: "fa-solid fa-xmark", default: true }],
    rejectClose: false
  });
}

/**
 * Пересобрать документ из его исходника — обычный импорт в режиме
 * «Обновить на месте»: uuid сохраняется, правки в листе заменяются тем,
 * что описано в JSON.
 *
 * @param {Item|Actor} doc
 * @returns {Promise<Item|Actor|null>}
 */
export async function rebuildDocument(doc) {
  const raw = sourceOf(doc);
  if (!raw) return null;

  if (doc.documentName === "Actor") {
    return createForgeActor(raw, { onDuplicate: "update", pack: doc.pack ?? null });
  }
  return createForgeItem(raw, {
    target: doc.parent instanceof Actor ? doc.parent : null,
    pack: doc.pack ?? null,
    silent: true,
    onDuplicate: "update"
  });
}

/**
 * Пересобрать все документы модуля одним заходом. Всё пишется в ОДНУ запись
 * истории — «Отменить» вернёт мир к состоянию до пересборки.
 *
 * @param {Item[]|Actor[]} [docs] — что пересобирать (по умолчанию все)
 * @returns {Promise<{ok: number, failed: string[]}>}
 */
export async function rebuildAll(docs = forgeDocuments()) {
  beginRecord(game.i18n.format("OKASSEN.sources.rebuildLabel", { count: docs.length }));
  const failed = [];
  let ok = 0;
  try {
    for (const doc of docs) {
      try {
        // Вложенные предметы пересоберёт их родитель — отдельно не трогаем,
        // иначе дети были бы созданы дважды.
        if (doc.getFlag(MODULE_ID, "parent")) continue;
        await rebuildDocument(doc);
        ok++;
      } catch (err) {
        failed.push(`${doc.name}: ${err.message}`);
        console.error(`[okassen] Пересборка "${doc.name}" не удалась:`, err);
      }
    }
  } finally {
    await commitRecord();
  }
  return { ok, failed };
}

/**
 * HTML вкладки «Исходники»: документы модуля, у которых содержимое разошлось
 * с сохранённым JSON. Кнопки помечены data-атрибутами — обработчики клика
 * вешает вызывающая сторона (окно импорта).
 *
 * @returns {string}
 */
export function buildSourcesHtml() {
  const docs = forgeDocuments();
  if (!docs.length) return `<p class="okassen-tab-empty">${game.i18n.localize("OKASSEN.sources.empty")}</p>`;

  const drifted = [];
  let clean = 0;
  for (const doc of docs) {
    const cmp = compareWithSource(doc);
    if (!cmp) continue;
    if (cmp.rows.length) drifted.push({ doc, count: cmp.rows.length });
    else clean++;
  }

  const summary = `<p class="okassen-preview-note">${game.i18n.format("OKASSEN.sources.summary", {
    total: docs.length, drifted: drifted.length, clean
  })}</p>`;

  if (!drifted.length) {
    return summary + `<p class="okassen-sources-clean">✔ ${game.i18n.localize("OKASSEN.sources.allClean")}</p>`;
  }

  const rows = drifted
    .sort((a, b) => b.count - a.count)
    .map(({ doc, count }) => {
      const place = doc.parent instanceof Actor ? `${escapeHtml(doc.parent.name)} → ` : "";
      return `<li class="okassen-sources-row">
        <div class="okassen-sources-info">
          <strong>${place}${escapeHtml(doc.name)}</strong>
          <span>${escapeHtml(doc.type)} · ${game.i18n.format("OKASSEN.sources.diffCount", { count })}</span>
        </div>
        <div class="okassen-sources-actions">
          <button type="button" data-source-diff="${doc.uuid}">
            <i class="fa-solid fa-code-compare"></i> ${game.i18n.localize("OKASSEN.sources.diff")}
          </button>
          <button type="button" data-source-rebuild="${doc.uuid}">
            <i class="fa-solid fa-arrows-rotate"></i> ${game.i18n.localize("OKASSEN.sources.rebuild")}
          </button>
        </div>
      </li>`;
    }).join("");

  return summary + `<ul class="okassen-sources-list">${rows}</ul>`;
}
