/**
 * history.js — история импорта и откат одной кнопкой.
 *
 * Каждый импорт из окна (одиночный или пакетный) пишется в мировую настройку:
 *  - uuid всех созданных документов (включая вложенные и предметы актёров);
 *  - полные снапшоты документов, УДАЛЁННЫХ по «Заменить» в диалоге дублей;
 *  - полные снапшоты документов, ИЗМЕНЁННЫХ режимом «Обновить на месте»
 *    (sync.js) — откат возвращает документ к состоянию до импорта.
 *
 * «Отменить» удаляет созданное, восстанавливает заменённое и откатывает
 * обновлённое.
 * Итеративная генерация (поправил JSON → импортировал заново) перестаёт быть
 * прогулкой без страховки.
 *
 * Запись ведётся только у ведущего (мировые настройки пишет GM); сколько
 * импортов хранить, задаёт настройка «Записей в истории импорта».
 */

import { escapeHtml } from "./util.js";
import { getSetting } from "./settings.js";

const MODULE_ID = "okassen";
const SETTING = "importHistory";

/** Текущая (открытая) запись импорта; null вне импорта. */
let current = null;

/**
 * Прочитать журнал импортов. Если настройка не зарегистрирована (сорвался
 * шаг инициализации, модуль только что включили), возвращаем пустой список:
 * вкладка «История» должна показать «пусто», а не уронить окно.
 *
 * @returns {Array<object>}
 */
function readHistory() {
  try {
    const value = game.settings.get(MODULE_ID, SETTING);
    return Array.isArray(value) ? value : [];
  } catch (err) {
    console.warn("[okassen] История импорта недоступна:", err);
    return [];
  }
}

/** Сколько записей в журнале импортов (0, если журнал недоступен). */
export function historyCount() {
  return readHistory().length;
}

/** Регистрация настройки. Вызывается из main.js на init. */
export function registerHistorySetting() {
  game.settings.register(MODULE_ID, SETTING, {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });
}

/** Начать запись импорта. Не-ведущий не пишет (нет прав на мировые настройки). */
export function beginRecord(label) {
  if (!game.user.isGM) return;
  current = {
    id: foundry.utils.randomID(),
    ts: Date.now(),
    label: String(label ?? "").slice(0, 120),
    created: [],
    replaced: [],
    updated: []
  };
}

/** Зафиксировать созданный документ (вызывается загрузчиком и nested.js). */
export function recordCreated(doc) {
  if (current && doc?.uuid) current.created.push(doc.uuid);
}

/**
 * Зафиксировать документ, удаляемый по «Заменить» (снапшот ДО удаления).
 * Для эмбеддед-документов (предмет на актёре, вложение) запоминаем и
 * родителя — иначе откат восстановил бы предмет в мир, а не туда, где он был.
 * @param {Item|Actor} doc
 */
export function recordReplaced(doc) {
  if (!current || !doc) return;
  current.replaced.push({
    documentName: doc.documentName,
    folder: doc.folder?.id ?? null,
    parentUuid: doc.parent?.uuid ?? null,
    pack: doc.pack ?? null,
    data: doc.toObject()
  });
}

/**
 * Зафиксировать документ ПЕРЕД обновлением на месте («Обновить», sync.js).
 * Храним полный снапшот: откат вернёт документ к состоянию до импорта,
 * не трогая ни uuid, ни его место в мире.
 * @param {Item|Actor} doc
 */
export function recordUpdated(doc) {
  if (!current || !doc?.uuid) return;
  // Документ мог обновляться в этом же импорте дважды — первый снапшот
  // и есть «как было до импорта», повторные не нужны.
  if (current.updated.some(u => u.uuid === doc.uuid)) return;
  current.updated.push({ uuid: doc.uuid, data: doc.toObject() });
}

/** Закрыть запись: если в ней что-то есть — положить в историю. */
export async function commitRecord() {
  const rec = current;
  current = null;
  if (!rec || (!rec.created.length && !rec.replaced.length && !rec.updated.length)) return;
  try {
    const limit = Math.max(1, Number(getSetting("historyLimit")) || 30);
    const history = [rec, ...readHistory()].slice(0, limit);
    await game.settings.set(MODULE_ID, SETTING, history);
  } catch (err) {
    console.error("[okassen] Не удалось сохранить запись истории импорта:", err);
  }
}

/**
 * Откатить импорт: удалить созданное, восстановить заменённое, вернуть
 * обновлённое к состоянию до импорта.
 * @param {string} id — id записи истории
 * @returns {Promise<{deleted: number, restored: number, reverted: number}>}
 */
export async function rollbackImport(id) {
  const history = readHistory();
  const rec = history.find(r => r.id === id);
  if (!rec) throw new Error(game.i18n.localize("OKASSEN.history.notFound"));

  // 1. Удаляем созданные документы. Порядок — обратный созданию: дети
  //    вложений удаляются раньше родителей. Уже отсутствующие (удалённые
  //    вручную или вместе с актёром) молча пропускаются.
  let deleted = 0;
  for (const uuid of [...rec.created].reverse()) {
    try {
      const doc = await fromUuid(uuid);
      if (doc) {
        await doc.delete();
        deleted++;
      }
    } catch (err) {
      console.warn(`[okassen] Откат: не удалось удалить ${uuid}:`, err);
    }
  }

  // 2. Восстанавливаем заменённые. Эмбеддед-документы (предмет на актёре,
  //    вложение) возвращаются В РОДИТЕЛЯ, мировые — в мир/компендиум.
  let restored = 0;
  for (const snap of rec.replaced) {
    try {
      const data = foundry.utils.deepClone(snap.data);
      const parent = snap.parentUuid ? await fromUuid(snap.parentUuid).catch(() => null) : null;
      if (snap.parentUuid && !parent) {
        console.warn("[okassen] Откат: родитель " + snap.parentUuid + " не найден, документ пропущен");
        continue;
      }
      if (parent) {
        await parent.createEmbeddedDocuments(snap.documentName, [data], { keepId: true });
      } else {
        const cls = snap.documentName === "Actor" ? Actor : Item;
        if (snap.folder && game.folders.has(snap.folder)) data.folder = snap.folder;
        await cls.implementation.create(data, snap.pack ? { keepId: true, pack: snap.pack } : { keepId: true });
      }
      restored++;
    } catch (err) {
      console.warn("[okassen] Откат: не удалось восстановить заменённый документ:", err);
    }
  }

  // 3. Возвращаем обновлённые на месте к снапшоту «как было до импорта».
  //    diff/recursive: false — снапшот записывается целиком, а не мержится
  //    с тем, что импорт успел дописать.
  let reverted = 0;
  for (const snap of rec.updated ?? []) {
    try {
      const doc = await fromUuid(snap.uuid).catch(() => null);
      if (!doc) continue;
      const data = foundry.utils.deepClone(snap.data);
      const effects = Array.isArray(data.effects) ? data.effects : [];
      delete data.effects;
      delete data.items; // предметы актёра откатываются своими записями created/updated
      await doc.update(data, { diff: false, recursive: false });
      // Эффекты — отдельной коллекцией: сносим текущие и восстанавливаем прежние.
      const ids = doc.effects.map(fx => fx.id);
      if (ids.length) await doc.deleteEmbeddedDocuments("ActiveEffect", ids);
      if (effects.length) await doc.createEmbeddedDocuments("ActiveEffect", effects, { keepId: true });
      reverted++;
    } catch (err) {
      console.warn("[okassen] Откат: не удалось вернуть обновлённый документ:", err);
    }
  }

  // 4. Убираем запись из истории.
  await game.settings.set(MODULE_ID, SETTING, history.filter(r => r.id !== id));

  ui.notifications.info(game.i18n.format("OKASSEN.history.rolledBack", { deleted, restored, reverted }));
  return { deleted, restored, reverted };
}

/**
 * Собрать HTML списка истории импорта (записи + кнопки «Отменить»).
 * Используется и диалогом, и вкладкой «История» окна импорта. Кнопки
 * помечены data-undo="<id>" — обработчик клика навешивает вызывающая сторона.
 * @returns {string}
 */
export function buildHistoryHtml() {
  const history = readHistory();

  const rows = history.map(rec => {
    const when = new Date(rec.ts).toLocaleString(game.i18n.lang);
    const counts = game.i18n.format("OKASSEN.history.counts", {
      created: rec.created.length,
      replaced: rec.replaced.length,
      updated: rec.updated?.length ?? 0
    });
    return `<li class="okassen-history-row">
      <div class="okassen-history-info">
        <strong>${escapeHtml(rec.label || "—")}</strong>
        <span>${when} · ${counts}</span>
      </div>
      <button type="button" data-undo="${rec.id}">
        <i class="fa-solid fa-rotate-left"></i> ${game.i18n.localize("OKASSEN.history.undo")}
      </button>
    </li>`;
  }).join("");

  return history.length
    ? `<ul class="okassen-history-list">${rows}</ul>`
    : `<p>${game.i18n.localize("OKASSEN.history.empty")}</p>`;
}

/** Открыть диалог истории импорта (список + «Отменить» на каждой записи). */
export async function openHistoryDialog() {
  const content = buildHistoryHtml();

  await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize("OKASSEN.history.title"), icon: "fa-solid fa-clock-rotate-left" },
    position: { width: 480 },
    content,
    buttons: [{ action: "close", label: "OKASSEN.history.close", icon: "fa-solid fa-xmark", default: true }],
    render: (_event, dialog) => {
      // v13 передаёт приложение, старые сборки — сам HTMLElement.
      const root = dialog instanceof HTMLElement ? dialog : dialog.element;
      root.querySelectorAll("[data-undo]").forEach(btn => {
        btn.addEventListener("click", async () => {
          const ok = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize("OKASSEN.history.undo") },
            content: `<p>${game.i18n.localize("OKASSEN.history.confirm")}</p>`
          });
          if (!ok) return;
          btn.disabled = true;
          try {
            await rollbackImport(btn.dataset.undo);
            btn.closest("li")?.remove();
          } catch (err) {
            btn.disabled = false;
            ui.notifications.error(err.message);
          }
        });
      });
    },
    rejectClose: false
  });
}
