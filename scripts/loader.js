/**
 * loader.js — ядро модуля: расширенный JSON → готовый предмет.
 *
 * Пайплайн:
 *  1. validate() — понятные ошибки до любых изменений в мире;
 *  2. глубокая копия, извлечение _forge (в системные данные он НЕ попадает);
 *  3. сборка flags: extraFlags + оригинал входа в flags.okassen.source;
 *  4. сборка эмбеддед-эффектов (в v13 их можно передать прямо в Item.create);
 *  5. создание предмета: на актёре (target) или в мире (сайдбар);
 *  6. вложенные предметы (nested.js);
 *  7. привязка onUse (флаг ставится при создании; здесь только предупреждаем,
 *     если обработчик ещё не зарегистрирован);
 *  8. уведомление об успехе, возврат документа.
 */

import { validate } from "./validate.js";
import { buildEffects, linkActivityEffects } from "./effects.js";
import { attachNested } from "./nested.js";
import { hasHandler } from "./onuse.js";
import { stampFormatVersion } from "./migrations.js";
import { applyForgeHookFlags, warnUnregisteredHooks, ACTOR_HOOKS } from "./lifecycle.js";
import { recordCreated, recordReplaced } from "./history.js";
import { escapeHtml, isActorType } from "./util.js";
import { getSetting } from "./settings.js";
import { sourceIdOf, stampSourceId, findExisting, updateForgeDocument } from "./sync.js";

const MODULE_ID = "okassen";

/**
 * Чем закончился ПОСЛЕДНИЙ импорт: "created" | "updated" | "replaced".
 * Нужно окну импорта, чтобы сообщение в окне совпадало с тем, что реально
 * произошло («создан» против «обновлён»); возвращать вместо документа объект
 * с результатом — значило бы сломать публичное API.
 */
let lastOutcome = "created";

/** Чем закончился последний вызов createForgeItem/createForgeActor. */
export function lastImportOutcome() {
  return lastOutcome;
}

/**
 * Создать предмет из расширенного JSON.
 *
 * @param {object} rawJson — распарсенный JSON (предмет dnd5e + необязательный _forge)
 * @param {object} [options]
 * @param {Actor|null} [options.target=null] — актёр-цель; null = создать в мире
 * @param {boolean} [options.silent=false] — не показывать уведомление об успехе
 *   (используется пакетными операциями, чтобы не заспамить экран)
 * @param {string|null} [options.folder=null] — id папки для мирового предмета
 *   (выбирается в окне импорта; применяется только к папкам типа Item)
 * @param {string|null} [options.pack=null] — id компендиума-цели
 *   (например "world.my-items"); игнорируется при указанном target
 * @param {"keep"|"ask"|"auto"|"update"|"replace"} [options.onDuplicate="keep"] —
 *   что делать, если такой документ уже есть (совпал _forge.sourceId либо
 *   имя + тип): "keep" — молча создать копию; "update" — обновить найденный
 *   на месте (uuid, папка и права сохраняются); "replace" — удалить старый и
 *   создать новый; "ask" — спросить пользователя, если настройка мира не
 *   задаёт ответ заранее; "auto" — взять ответ из настройки, не спрашивая
 *   (пакетный импорт)
 * @returns {Promise<Item|null>} — созданный предмет; null, если пользователь отменил
 * @throws {Error} — прокидывает ошибку дальше (окно импорта покажет её в себе),
 *   предварительно залогировав и показав ui.notifications.error
 */
export async function createForgeItem(rawJson, { target = null, silent = false, folder = null, pack = null, onDuplicate = "keep" } = {}) {
  try {
    // 1. Валидация — до любых изменений.
    validate(rawJson);
    if (target) pack = null; // цель-актёр главнее компендиума
    pack = resolvePack(pack, "Item");

    // 2. Работаем с копией; оригинал сохраним целиком (включая _forge) во флаг.
    const source = foundry.utils.deepClone(rawJson);
    const data = foundry.utils.deepClone(rawJson);
    const forge = data._forge ?? {};
    delete data._forge; // _forge НЕ должен протечь в системные данные предмета

    // 3. Флаги: extraFlags автора + служебные флаги модуля.
    const sourceId = sourceIdOf(rawJson);
    data.flags = foundry.utils.mergeObject(data.flags ?? {}, forge.extraFlags ?? {});
    foundry.utils.setProperty(data.flags, `${MODULE_ID}.source`, source);
    stampFormatVersion(data.flags);
    stampSourceId(data.flags, sourceId); // якорь для повторного импорта
    if (forge.onUse) foundry.utils.setProperty(data.flags, `${MODULE_ID}.onUse`, forge.onUse);
    applyForgeHookFlags(data.flags, forge); // onEquip/onCreate/onTurnStart и др.

    // 4. Active Effects — сразу эмбеддед в данные создания.
    data.effects = buildEffects(forge.effects ?? []);
    // 4b. Привязка эффектов к активностям (applyTo): dnd5e/MidiQOL наложит
    //     эффект на цель активности при использовании / провале спасброска.
    linkActivityEffects(data, forge.effects ?? []);

    // 5. Дубликаты. Ищем по _forge.sourceId (переживает переименование), иначе
    //    по имени + типу. В компендиуме — только по sourceId: совпадение имён
    //    в библиотеке это норма.
    const mode = resolveDuplicateMode(onDuplicate);
    const existing = mode === "keep"
      ? null
      : await findExisting(data, { sourceId, target, pack, documentName: "Item" });

    let choice = mode;
    if (existing && mode === "ask") {
      choice = await askDuplicate(existing, data);
      if (!choice || choice === "cancel") return null; // отмена — ничего не создаём
    }

    // 5а. «Обновить на месте»: документ остаётся тем же (uuid, папка, права,
    //     позиция в инвентаре), меняется только содержимое — см. sync.js.
    if (existing && choice === "update") {
      const updated = await updateForgeDocument(existing, data, forge);
      lastOutcome = "updated";
      warnHandlers(updated, forge);
      if (!silent) {
        ui.notifications.info(game.i18n.format("OKASSEN.notify.updated", {
          name: updated.name,
          place: target ? target.name : game.i18n.localize("OKASSEN.notify.world")
        }));
      }
      return updated;
    }

    if (existing && choice === "replace") {
      // Новый предмет займёт место старого (и его папку, если своя не выбрана).
      if (!target && !folder && existing.folder) folder = existing.folder.id;
      recordReplaced(existing); // снапшот в историю — откат восстановит
      await existing.delete();
    }
    // "keep" — просто создаём копию рядом.
    lastOutcome = existing && choice === "replace" ? "replaced" : "created";

    // 6. Папка (только для мировых предметов): выбранная в окне — приоритетнее
    //    той, что могла приехать в JSON; битые id папок из чужих миров чистим.
    //    В компендиуме мировые папки не действуют.
    if (!target) {
      if (pack) delete data.folder;
      else {
        const f = folder ? game.folders.get(folder) : null;
        if (f?.type === "Item") data.folder = f.id;
        else if (data.folder && !game.folders.has(data.folder)) delete data.folder;
      }
    }

    // 7. Создание документа: на актёре, в компендиуме или в мире.
    let item;
    if (target) {
      if (!(target instanceof Actor)) {
        throw new Error(game.i18n.localize("OKASSEN.errors.targetNotActor"));
      }
      [item] = await target.createEmbeddedDocuments("Item", [data]);
    } else {
      item = await Item.implementation.create(data, pack ? { pack } : {});
    }
    recordCreated(item);

    // 8. Вложенные предметы. Ошибки внутри не роняют импорт (см. nested.js).
    await attachNested(item, forge.nested ?? []);

    // 9. onUse и хуки: флаги уже стоят; честно предупреждаем, если
    //    обработчика (пока) нет.
    warnHandlers(item, forge);

    // 10. Успех.
    if (!silent) {
      ui.notifications.info(game.i18n.format("OKASSEN.notify.created", {
        name: item.name,
        place: target ? target.name : game.i18n.localize("OKASSEN.notify.world")
      }));
    }
    return item;

  } catch (err) {
    // Любая ошибка: консоль с префиксом + уведомление; окно импорта поймает
    // проброшенную ошибку и покажет текст у себя.
    console.error("[okassen] Ошибка импорта:", err);
    ui.notifications.error(game.i18n.format("OKASSEN.notify.error", { message: err.message }));
    throw err;
  }
}

/**
 * Во что превращается запрошенный режим дублей.
 *  - "ask"  — спросить, если настройка мира не решает за пользователя;
 *  - "auto" — молча взять ответ из настройки (пакетный импорт ничего не
 *             спрашивает: 50 диалогов подряд — не помощь);
 *  - остальное передаётся как есть (вызов из API главнее настройки).
 */
function resolveDuplicateMode(onDuplicate) {
  const configured = getSetting("defaultDuplicate");
  if (onDuplicate === "ask") return configured;
  if (onDuplicate === "auto") return configured === "ask" ? "keep" : configured;
  return onDuplicate ?? "keep";
}

/**
 * Предупредить о незарегистрированных обработчиках (onUse и хуки).
 * Документ уже создан/обновлён — логика просто не сработает, пока
 * обработчик не появится (api.registerHandler или макрос okassen:<id>).
 */
function warnHandlers(doc, forge) {
  if (forge.onUse && !hasHandler(forge.onUse)) {
    console.warn(`[okassen] onUse-обработчик "${forge.onUse}" не зарегистрирован — документ создан, но логика при использовании не сработает, пока обработчик не появится`);
    ui.notifications.warn(game.i18n.format("OKASSEN.notify.onUseUnregistered", {
      handler: forge.onUse,
      item: doc.name
    }));
  }
  warnUnregisteredHooks(doc);
}

/**
 * Проверить компендиум-цель. Несуществующий или запертый пак — ошибка;
 * пак с ДРУГИМ типом документов игнорируется (null), как и папки
 * неподходящего типа: в пакетном импорте смесь предметов и актёров — норма.
 *
 * @param {string|null} pack — id компендиума ("world.my-items") или null
 * @param {"Item"|"Actor"} documentName — ожидаемый тип документов
 * @returns {string|null} — тот же id или null (пак не подходит по типу)
 */
function resolvePack(pack, documentName) {
  if (!pack) return null;
  const p = game.packs.get(pack);
  if (!p) throw new Error(game.i18n.format("OKASSEN.errors.packNotFound", { pack }));
  if (p.documentName !== documentName) return null;
  if (p.locked) throw new Error(game.i18n.format("OKASSEN.errors.packLocked", { pack }));
  return pack;
}

/** Короткое строковое представление значения для diff-списка. */
function shortValue(v) {
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
 * HTML-diff между существующим предметом и тем, во что превратится новый JSON.
 * Новый предмет прогоняется через модель данных (new Item(data)), чтобы
 * сравнивать ПОЛНЫЕ данные с полными — иначе разреженный входной JSON дал бы
 * ложные «удаления» на каждом незаполненном поле схемы.
 *
 * @param {Item|Actor} existing — существующий документ
 * @param {object} data — данные создаваемого документа (уже без _forge)
 * @returns {string} — HTML (<details> со списком отличий) или ""
 */
function buildDiffHtml(existing, data) {
  const MAX_ROWS = 24;
  try {
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
      rows.push(`<li><code>${escapeHtml(k)}</code>: ${shortValue(oldFlat[k])} → ${shortValue(newFlat[k])}</li>`);
    }

    // Эффекты сравниваем по именам (детально их покажет предпросмотр).
    const oldFx = existing.effects.map(e => e.name).sort().join(", ");
    const newFx = (data.effects ?? []).map(e => e.name).sort().join(", ");
    if (oldFx !== newFx) {
      rows.push(`<li><code>effects</code>: [${shortValue(oldFx)}] → [${shortValue(newFx)}]</li>`);
    }

    if (!rows.length) {
      return `<p class="okassen-diff-none">${game.i18n.localize("OKASSEN.dup.noDiff")}</p>`;
    }
    const shown = rows.slice(0, MAX_ROWS).join("");
    const more = rows.length > MAX_ROWS
      ? `<li>… ${game.i18n.format("OKASSEN.dup.moreDiff", { count: rows.length - MAX_ROWS })}</li>`
      : "";
    return `<details class="okassen-diff" open>
      <summary>${game.i18n.format("OKASSEN.dup.diffSummary", { count: rows.length })}</summary>
      <ul>${shown}${more}</ul>
    </details>`;
  } catch (err) {
    console.warn("[okassen] Не удалось построить diff для диалога дублей:", err);
    return "";
  }
}

/**
 * Спросить пользователя, что делать с дубликатом. Показывает diff:
 * что именно изменится в документе.
 *
 * «Обновить» идёт первым и выбран по умолчанию: при итеративной работе это
 * нужный ответ в подавляющем большинстве случаев — документ остаётся тем же
 * (uuid, папка, права, место в инвентаре), меняется только содержимое.
 *
 * @param {Item|Actor} existing — уже существующий документ
 * @param {object} data — данные нового документа
 * @returns {Promise<"update"|"replace"|"keep"|"cancel"|null>}
 */
async function askDuplicate(existing, data) {
  return foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize("OKASSEN.dup.title"), icon: "fa-solid fa-clone" },
    position: { width: 520 },
    content: `<p>${game.i18n.format("OKASSEN.dup.content", { name: existing.name, type: existing.type })}</p>`
      + buildDiffHtml(existing, data)
      + `<p class="okassen-hint okassen-hint-small">${game.i18n.localize("OKASSEN.dup.updateHint")}</p>`,
    buttons: [
      { action: "update", label: "OKASSEN.dup.update", icon: "fa-solid fa-arrows-rotate", default: true },
      { action: "replace", label: "OKASSEN.dup.replace", icon: "fa-solid fa-rotate" },
      { action: "keep", label: "OKASSEN.dup.keep", icon: "fa-solid fa-copy" },
      { action: "cancel", label: "OKASSEN.dup.cancel", icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false // закрытие окна = отмена, а не исключение
  }).catch(() => "cancel");
}

/**
 * Это JSON актёра (НИП, персонаж), а не предмета?
 * Определяем по type против зарегистрированных типов актёров системы.
 */
export function isActorJson(raw) {
  return !!raw && typeof raw === "object" && isActorType(raw.type);
}

/**
 * Создать АКТЁРА из расширенного JSON.
 *
 * Формат: обычный актёр dnd5e (name, type: "npc"/"character", system,
 * prototypeToken...) + необязательные:
 *  - _forge.effects — Active Effects на самом актёре (формат тот же, что у предметов);
 *  - _forge.extraFlags — мержится во flags актёра;
 *  - items[] — массив предметов, каждый может иметь СВОЙ _forge
 *    (эффекты, вложения, onUse) — они создаются через createForgeItem.
 *
 * @param {object} rawJson — распарсенный JSON актёра
 * @param {object} [options]
 * @param {string|null} [options.folder=null] — id папки для актёра
 *   (применяется только к папкам типа Actor)
 * @param {string|null} [options.pack=null] — id компендиума актёров-цели
 * @param {"keep"|"ask"|"auto"|"update"|"replace"} [options.onDuplicate="keep"] —
 *   как поступить с уже существующим актёром (см. createForgeItem)
 * @returns {Promise<Actor|null>} — созданный (или обновлённый) актёр;
 *   null, если пользователь отменил импорт в диалоге дублей
 */
export async function createForgeActor(rawJson, { folder = null, pack = null, onDuplicate = "keep" } = {}) {
  try {
    // 1. Валидация (validate сам распознаёт актёра по type).
    validate(rawJson);
    pack = resolvePack(pack, "Actor");

    // 2. Копия; предметы создаём ОТДЕЛЬНО после актёра, чтобы у каждого
    //    отработал его собственный _forge (эффекты, вложения, onUse).
    const source = foundry.utils.deepClone(rawJson);
    const data = foundry.utils.deepClone(rawJson);
    const forge = data._forge ?? {};
    delete data._forge;
    const itemDefs = Array.isArray(data.items) ? data.items : [];
    delete data.items;

    // 3. Флаги и эффекты самого актёра.
    const sourceId = sourceIdOf(rawJson);
    data.flags = foundry.utils.mergeObject(data.flags ?? {}, forge.extraFlags ?? {});
    foundry.utils.setProperty(data.flags, `${MODULE_ID}.source`, source);
    stampFormatVersion(data.flags);
    stampSourceId(data.flags, sourceId); // якорь для повторного импорта
    applyForgeHookFlags(data.flags, forge, ACTOR_HOOKS); // onTurnStart/onTurnEnd актёра
    data.effects = buildEffects(forge.effects ?? []);

    // 3а. Дубликаты актёра: тот же выбор, что и у предметов. «Обновить»
    //     сохраняет uuid актёра — токены на сценах не теряют связь.
    const mode = resolveDuplicateMode(onDuplicate);
    const existing = mode === "keep"
      ? null
      : await findExisting(data, { sourceId, pack, documentName: "Actor" });

    let choice = mode;
    if (existing && mode === "ask") {
      choice = await askDuplicate(existing, data);
      if (!choice || choice === "cancel") return null;
    }

    if (existing && choice === "update") {
      const updated = await updateForgeDocument(existing, data, forge, {
        importItem: createForgeItem,
        itemDefs
      });
      lastOutcome = "updated";
      warnUnregisteredHooks(updated);
      ui.notifications.info(game.i18n.format("OKASSEN.notify.actorUpdated", { name: updated.name }));
      return updated;
    }

    if (existing && choice === "replace") {
      if (!folder && existing.folder) folder = existing.folder.id;
      recordReplaced(existing);
      await existing.delete();
    }
    lastOutcome = existing && choice === "replace" ? "replaced" : "created";

    // 4. Папка: выбранная в окне приоритетнее приехавшей в JSON; битые id чистим.
    //    В компендиуме мировые папки не действуют.
    if (pack) delete data.folder;
    else {
      const f = folder ? game.folders.get(folder) : null;
      if (f?.type === "Actor") data.folder = f.id;
      else if (data.folder && !game.folders.has(data.folder)) delete data.folder;
    }

    // 5. Создание актёра.
    const actor = await Actor.implementation.create(data, pack ? { pack } : {});
    recordCreated(actor);

    // 6. Предметы: ошибка в одном не роняет остальные.
    const failed = [];
    for (const def of itemDefs) {
      try {
        await createForgeItem(def, { target: actor, silent: true });
      } catch (err) {
        failed.push(def?.name ?? "?");
        console.error(`[okassen] Не удалось создать предмет "${def?.name ?? "?"}" у актёра "${actor.name}":`, err);
      }
    }
    if (failed.length) {
      ui.notifications.warn(game.i18n.format("OKASSEN.notify.actorItemsFailed", {
        name: actor.name,
        items: failed.join(", ")
      }));
    }

    // 7. Успех.
    warnUnregisteredHooks(actor);
    ui.notifications.info(game.i18n.format("OKASSEN.notify.actorCreated", { name: actor.name }));
    return actor;

  } catch (err) {
    console.error("[okassen] Ошибка импорта актёра:", err);
    ui.notifications.error(game.i18n.format("OKASSEN.notify.error", { message: err.message }));
    throw err;
  }
}

/**
 * Универсальный вход: сам решает, предмет это или актёр.
 * Для актёра параметр target игнорируется (актёр всегда создаётся в мире
 * или в компендиуме актёров).
 *
 * @returns {Promise<Item|Actor|null>} — null, если пользователь отменил импорт
 */
export async function importAny(parsed, { target = null, folder = null, pack = null, onDuplicate = "keep" } = {}) {
  return isActorJson(parsed)
    ? createForgeActor(parsed, { folder, pack, onDuplicate })
    : createForgeItem(parsed, { target, folder, pack, onDuplicate });
}
