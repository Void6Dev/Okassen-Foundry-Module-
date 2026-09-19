/**
 * sync.js — повторный импорт «Обновить на месте».
 *
 * Зачем. До этой версии при совпадении документа было два исхода: создать
 * копию рядом или УДАЛИТЬ старый и создать новый. Второе рвёт всё, что
 * ссылалось на документ: предмет в инвентаре актёра, позицию в папке,
 * права доступа, ссылки макросов на uuid. Итеративная работа («поправил
 * JSON → импортировал заново») из-за этого была неудобной.
 *
 * Теперь есть третий путь: найти существующий документ и ОБНОВИТЬ его —
 * uuid, _id, папка, сортировка и права остаются прежними, меняется только
 * содержимое: name/img/system, эффекты и вложения.
 *
 * Как документ находится:
 *  1. по `_forge.sourceId` (стабильный идентификатор автора, штампуется в
 *     flags.okassen.sourceId) — переживает переименование документа;
 *  2. если sourceId нет — по совпадению name + type, как и раньше.
 *
 * Что считается «нашим» и потому пересобирается:
 *  - эффекты со штампом flags.okassen.managed (его ставит buildEffects) —
 *    удаляются и создаются заново с теми же _id, чтобы не рвать привязки
 *    активностей (system.activities.<id>.effects);
 *  - вложенные предметы (flags.okassen.nested) — пересоздаются, если в JSON
 *    есть блок _forge.nested.
 * Всё, что ведущий добавил руками (чужие эффекты, чужие флаги), остаётся.
 */

import { attachNested } from "./nested.js";
import { recordUpdated, recordReplaced } from "./history.js";

const MODULE_ID = "okassen";

/**
 * Стабильный идентификатор из блока _forge (если автор его задал).
 * @param {object} raw — входной JSON документа
 * @returns {string|null}
 */
export function sourceIdOf(raw) {
  const id = raw?._forge?.sourceId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/**
 * Записать sourceId во флаги создаваемого документа.
 * @param {object} flags — объект flags будущего документа (мутируется)
 * @param {string|null} sourceId
 */
export function stampSourceId(flags, sourceId) {
  if (sourceId) foundry.utils.setProperty(flags, MODULE_ID + ".sourceId", sourceId);
}

/**
 * Найти документ в компендиуме по sourceId (индекс с нужным полем).
 * В паке ищем ТОЛЬКО по sourceId: совпадение имён в библиотеке — норма.
 */
async function findInPack(pack, sourceId) {
  if (!sourceId) return null;
  const p = game.packs.get(pack);
  if (!p) return null;
  const field = "flags." + MODULE_ID + ".sourceId";
  const index = await p.getIndex({ fields: [field] });
  const hit = index.find(e => foundry.utils.getProperty(e, field) === sourceId);
  return hit ? p.getDocument(hit._id) : null;
}

/**
 * Найти существующий документ, который новый JSON должен заменить/обновить.
 *
 * @param {object} data — данные документа (уже без _forge)
 * @param {object} [opts]
 * @param {string|null} [opts.sourceId] — стабильный id из _forge
 * @param {Actor|null} [opts.target] — актёр-цель (ищем среди его предметов)
 * @param {string|null} [opts.pack] — компендиум-цель
 * @param {"Item"|"Actor"} [opts.documentName="Item"]
 * @returns {Promise<Item|Actor|null>}
 */
export async function findExisting(data, { sourceId = null, target = null, pack = null, documentName = "Item" } = {}) {
  if (pack) return findInPack(pack, sourceId);

  const collection = documentName === "Actor"
    ? game.actors
    : (target ? target.items : game.items);
  if (!collection) return null;

  if (sourceId) {
    const byId = collection.find(d => d.getFlag?.(MODULE_ID, "sourceId") === sourceId);
    if (byId) return byId;
  }
  return collection.find(d => d.name === data.name && d.type === data.type) ?? null;
}

/** Эффект создан модулем (а не добавлен ведущим руками)? */
function isManagedEffect(fx) {
  return fx.getFlag?.(MODULE_ID, "managed") === true;
}

/**
 * Пересобрать эффекты документа под новый JSON.
 *
 * Удаляем: все «наши» эффекты и любые, чей _id заявлен во входном JSON
 * (документ заявляет на них права). Создаём: весь желаемый набор с keepId —
 * так стабильные _id сохраняются и привязки активностей не рвутся.
 *
 * @param {Item|Actor} doc
 * @param {Array<object>} desired — данные эффектов (результат buildEffects)
 */
async function syncEffects(doc, desired) {
  const desiredIds = new Set(desired.map(e => e._id).filter(Boolean));
  const desiredNames = new Set(desired.map(e => e.name).filter(Boolean));
  // Совпадение по имени нужно ради документов, созданных ДО появления штампа
  // managed: их эффекты без стабильного _id иначе остались бы рядом с новыми
  // копиями. Чужие эффекты с другими именами по-прежнему не трогаем.
  const toDelete = doc.effects
    .filter(fx => isManagedEffect(fx) || desiredIds.has(fx.id) || desiredNames.has(fx.name))
    .map(fx => fx.id);

  if (toDelete.length) await doc.deleteEmbeddedDocuments("ActiveEffect", toDelete);
  if (desired.length) {
    await doc.createEmbeddedDocuments("ActiveEffect", foundry.utils.deepClone(desired), { keepId: true });
  }
}

/**
 * Пересоздать вложенные предметы: старых «детей» удаляем (со снапшотом
 * в историю — откат их вернёт), новых создаёт attachNested.
 *
 * @param {Item} item — родительский предмет (уже обновлённый)
 * @param {Array<object>} nestedDefs — _forge.nested из нового JSON
 */
async function syncNested(item, nestedDefs) {
  const uuids = item.getFlag(MODULE_ID, "nested") ?? [];
  for (const uuid of Array.isArray(uuids) ? uuids : []) {
    try {
      const child = await fromUuid(uuid);
      if (!child) continue;
      recordReplaced(child); // снапшот до удаления — откат восстановит
      await child.delete();
    } catch (err) {
      console.warn("[okassen] Обновление: не удалось удалить вложенный предмет " + uuid + ":", err);
    }
  }
  await item.unsetFlag(MODULE_ID, "nested").catch(() => {});
  await attachNested(item, nestedDefs);
}

/**
 * Обновить существующий документ данными нового JSON.
 *
 * Сохраняются: _id и uuid, папка, сортировка, права доступа, чужие флаги.
 * Заменяются: name, img, system (целиком — это «пересборка», а не мерж),
 * «наши» эффекты и вложения.
 *
 * @param {Item|Actor} existing — документ, который обновляем
 * @param {object} data — данные из JSON (без _forge, с собранными effects)
 * @param {object} forge — блок _forge (нужен ради nested)
 * @param {object} [opts]
 * @param {Function|null} [opts.importItem] — как импортировать предмет актёра
 *   (loader передаёт сюда createForgeItem, чтобы не было циклического импорта)
 * @param {Array<object>|null} [opts.itemDefs] — предметы актёра из JSON
 * @returns {Promise<Item|Actor>} — тот же документ, уже обновлённый
 */
export async function updateForgeDocument(existing, data, forge = {}, { importItem = null, itemDefs = null } = {}) {
  // Тип документа сменить нельзя — честно говорим об этом до любых изменений.
  if (data.type && data.type !== existing.type) {
    throw new Error(game.i18n.format("OKASSEN.errors.updateTypeMismatch", {
      name: existing.name, from: existing.type, to: data.type
    }));
  }

  recordUpdated(existing); // снапшот ДО изменений — откат вернёт как было

  // Флаги мержим (чужие модули не теряем), остальное заменяем целиком.
  const flags = foundry.utils.mergeObject(
    foundry.utils.deepClone(existing.toObject().flags ?? {}),
    foundry.utils.deepClone(data.flags ?? {}),
    { inplace: false }
  );

  const update = { flags };
  if (data.name !== undefined) update.name = data.name;
  if (data.img !== undefined) update.img = data.img;
  if (data.system !== undefined) update.system = foundry.utils.deepClone(data.system);
  if (data.prototypeToken !== undefined) update.prototypeToken = foundry.utils.deepClone(data.prototypeToken);

  // recursive: false — system заменяется целиком: поле, убранное из JSON,
  // должно исчезнуть и в документе, иначе «обновление» копило бы мусор.
  await existing.update(update, { diff: false, recursive: false });

  await syncEffects(existing, data.effects ?? []);

  // Вложения — только если автор описал блок nested (иначе не трогаем).
  if (existing.documentName === "Item" && Array.isArray(forge.nested)) {
    await syncNested(existing, forge.nested);
  }

  // Предметы актёра: каждый идёт тем же путём «обновить на месте».
  if (existing.documentName === "Actor" && Array.isArray(itemDefs) && importItem) {
    for (const def of itemDefs) {
      try {
        await importItem(def, { target: existing, silent: true, onDuplicate: "update" });
      } catch (err) {
        console.error(`[okassen] Обновление актёра "${existing.name}": предмет "${def?.name ?? "?"}" не удался:`, err);
      }
    }
  }

  return existing;
}
