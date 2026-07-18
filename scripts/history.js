/**
 * history.js — история импорта и откат одной кнопкой.
 *
 * Каждый импорт из окна (одиночный или пакетный) пишется в мировую настройку:
 *  - uuid всех созданных документов (включая вложенные и предметы актёров);
 *  - полные снапшоты документов, УДАЛЁННЫХ по «Заменить» в диалоге дублей.
 *
 * «Отменить» удаляет всё созданное этим импортом и восстанавливает заменённое.
 * Итеративная генерация (поправил JSON → импортировал заново) перестаёт быть
 * прогулкой без страховки.
 *
 * Запись ведётся только у ведущего (мировые настройки пишет GM); максимум
 * MAX_ENTRIES последних импортов, старые вытесняются.
 */

import { escapeHtml } from "./util.js";

const MODULE_ID = "okassen";
const SETTING = "importHistory";
const MAX_ENTRIES = 30;

/** Текущая (открытая) запись импорта; null вне импорта. */
let current = null;

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
    replaced: []
  };
}

/** Зафиксировать созданный документ (вызывается загрузчиком и nested.js). */
export function recordCreated(doc) {
  if (current && doc?.uuid) current.created.push(doc.uuid);
}

/**
 * Зафиксировать документ, удаляемый по «Заменить» (снапшот ДО удаления).
 * @param {Item|Actor} doc
 */
export function recordReplaced(doc) {
  if (!current || !doc) return;
  current.replaced.push({
    documentName: doc.documentName,
    folder: doc.folder?.id ?? null,
    data: doc.toObject()
  });
}

/** Закрыть запись: если в ней что-то есть — положить в историю. */
export async function commitRecord() {
  const rec = current;
  current = null;
  if (!rec || (!rec.created.length && !rec.replaced.length)) return;
  try {
    const history = [rec, ...game.settings.get(MODULE_ID, SETTING)].slice(0, MAX_ENTRIES);
    await game.settings.set(MODULE_ID, SETTING, history);
  } catch (err) {
    console.error("[okassen] Не удалось сохранить запись истории импорта:", err);
  }
}

/**
 * Откатить импорт: удалить созданное, восстановить заменённое.
 * @param {string} id — id записи истории
 * @returns {Promise<{deleted: number, restored: number}>}
 */
export async function rollbackImport(id) {
  const history = game.settings.get(MODULE_ID, SETTING);
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

  // 2. Восстанавливаем заменённые (мировые документы).
  let restored = 0;
  for (const snap of rec.replaced) {
    try {
      const cls = snap.documentName === "Actor" ? Actor : Item;
      const data = foundry.utils.deepClone(snap.data);
      if (snap.folder && game.folders.has(snap.folder)) data.folder = snap.folder;
      await cls.implementation.create(data, { keepId: true });
      restored++;
    } catch (err) {
      console.warn("[okassen] Откат: не удалось восстановить заменённый документ:", err);
    }
  }

  // 3. Убираем запись из истории.
  await game.settings.set(MODULE_ID, SETTING, history.filter(r => r.id !== id));

  ui.notifications.info(game.i18n.format("OKASSEN.history.rolledBack", { deleted, restored }));
  return { deleted, restored };
}

/**
 * Собрать HTML списка истории импорта (записи + кнопки «Отменить»).
 * Используется и диалогом, и вкладкой «История» окна импорта. Кнопки
 * помечены data-undo="<id>" — обработчик клика навешивает вызывающая сторона.
 * @returns {string}
 */
export function buildHistoryHtml() {
  const history = game.settings.get(MODULE_ID, SETTING);

  const rows = history.map(rec => {
    const when = new Date(rec.ts).toLocaleString(game.i18n.lang);
    const counts = game.i18n.format("OKASSEN.history.counts", {
      created: rec.created.length,
      replaced: rec.replaced.length
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
