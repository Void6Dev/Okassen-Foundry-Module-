/**
 * nested.js — создание и линковка вложенных предметов (_forge.nested).
 *
 * Два сценария:
 *  1) Родитель создан НА АКТЁРЕ (импорт с указанием цели): вложенные предметы
 *     сразу создаются на том же актёре и связываются uuid'ами в обе стороны
 *     (flags.okassen.parent у ребёнка / flags.okassen.nested у родителя).
 *  2) Родитель создан В МИРЕ (сайдбар): вложенные тоже создаются мировыми
 *     предметами и линкуются. Дополнительно зарегистрирован хук createItem:
 *     когда мировой предмет с flags.okassen.nested попадает на актёра
 *     (перетаскиванием), его вложенные предметы автоматически копируются
 *     на того же актёра.
 *
 * Глубина рекурсии ограничена MAX_DEPTH = 2: вложенные могут иметь свои
 * _forge.effects и даже свои _forge.nested, но третий уровень вложенности
 * игнорируется с предупреждением.
 *
 * Ошибка в одном вложении НЕ роняет весь импорт — каждый ребёнок обёрнут в try/catch.
 */

import { buildEffects, linkActivityEffects } from "./effects.js";
import { stampFormatVersion } from "./migrations.js";
import { applyForgeHookFlags } from "./lifecycle.js";
import { recordCreated } from "./history.js";

const MODULE_ID = "okassen";
const MAX_DEPTH = 2;

/**
 * Создать вложенные предметы для родителя и связать их uuid'ами.
 *
 * @param {Item} parentItem — уже созданный родительский предмет
 * @param {Array<object>} nestedDefs — определения из _forge.nested
 * @param {number} [depth=1] — текущий уровень вложенности (1 = прямые дети)
 * @returns {Promise<Item[]>} — успешно созданные вложенные предметы
 */
export async function attachNested(parentItem, nestedDefs = [], depth = 1) {
  if (!Array.isArray(nestedDefs) || !nestedDefs.length) return [];

  // Ограничение глубины: третий уровень и глубже — игнорируем с предупреждением.
  if (depth > MAX_DEPTH) {
    console.warn(`[okassen] _forge.nested глубже ${MAX_DEPTH} уровней игнорируется (предмет "${parentItem.name}")`);
    ui.notifications.warn(game.i18n.format("OKASSEN.notify.nestedTooDeep", { name: parentItem.name }));
    return [];
  }

  const created = [];
  for (const def of nestedDefs) {
    try {
      // Готовим данные ребёнка так же, как loader готовит родителя:
      // вынимаем _forge, собираем эффекты, мержим extraFlags.
      const data = foundry.utils.deepClone(def);
      const forge = data._forge ?? {};
      delete data._forge;

      data.flags = foundry.utils.mergeObject(data.flags ?? {}, forge.extraFlags ?? {});
      foundry.utils.setProperty(data.flags, `${MODULE_ID}.parent`, parentItem.uuid);
      stampFormatVersion(data.flags);
      if (forge.onUse) foundry.utils.setProperty(data.flags, `${MODULE_ID}.onUse`, forge.onUse);
      applyForgeHookFlags(data.flags, forge);
      data.effects = buildEffects(forge.effects ?? []);
      linkActivityEffects(data, forge.effects ?? []);

      // Где создавать: рядом с родителем.
      let child;
      if (parentItem.isEmbedded) {
        // Родитель на актёре — ребёнок сразу на том же актёре.
        [child] = await parentItem.actor.createEmbeddedDocuments("Item", [data]);
      } else if (parentItem.pack) {
        // Родитель в компендиуме — ребёнок в том же паке (uuid-связка
        // остаётся валидной: Compendium-uuid'ы разрешаются fromUuid).
        child = await Item.implementation.create(data, { pack: parentItem.pack });
      } else {
        // Родитель мировой — ребёнок тоже мировой, в той же папке.
        if (parentItem.folder) data.folder = parentItem.folder.id;
        child = await Item.implementation.create(data);
      }
      created.push(child);
      recordCreated(child);

      // Рекурсия: вложенные вложенных (второй уровень).
      if (Array.isArray(forge.nested) && forge.nested.length) {
        await attachNested(child, forge.nested, depth + 1);
      }
    } catch (err) {
      // Частичный успех: логируем и продолжаем со следующим вложением.
      console.error(`[okassen] Не удалось создать вложенный предмет "${def?.name ?? "?"}":`, err);
      ui.notifications.warn(game.i18n.format("OKASSEN.notify.nestedFailed", { name: def?.name ?? "?" }));
    }
  }

  // Обратная связь: у родителя сохраняем uuid'ы всех успешно созданных детей.
  if (created.length) {
    await parentItem.setFlag(MODULE_ID, "nested", created.map(i => i.uuid));
  }
  return created;
}

/**
 * Регистрация хука «выдача родителя актёру подкладывает вложенные».
 * Вызывается один раз из main.js на init.
 *
 * Логика: когда на актёре создаётся предмет, у которого во flags.okassen.nested
 * лежат uuid'ы МИРОВЫХ предметов, — копируем эти предметы на того же актёра
 * и перелинковываем флаг на новые (эмбеддед) uuid'ы.
 */
export function initNestedHooks() {
  Hooks.on("createItem", async (item, options, userId) => {
    try {
      // Срабатываем только у того клиента, который создал предмет,
      // иначе каждый подключённый игрок создаст свой дубль.
      if (userId !== game.user.id) return;
      if (!(item.parent instanceof Actor)) return;

      const uuids = item.getFlag(MODULE_ID, "nested");
      if (!Array.isArray(uuids) || !uuids.length) return;

      const actor = item.parent;
      const toCreate = [];
      for (const uuid of uuids) {
        try {
          const src = await fromUuid(uuid);
          if (!src) {
            console.warn(`[okassen] Вложенный предмет ${uuid} не найден (родитель "${item.name}")`);
            continue;
          }
          // Если вложенный уже лежит на этом актёре (импорт шёл сразу на актёра) —
          // копировать нечего.
          if (src.parent === actor) continue;

          const data = src.toObject();
          // Ребёнок-копия ссылается на копию родителя на актёре.
          foundry.utils.setProperty(data, `flags.${MODULE_ID}.parent`, item.uuid);
          toCreate.push(data);
        } catch (err) {
          console.warn(`[okassen] Ошибка при копировании вложенного ${uuid}:`, err);
        }
      }

      if (toCreate.length) {
        const createdDocs = await actor.createEmbeddedDocuments("Item", toCreate);
        // Перелинковка: копия родителя теперь указывает на эмбеддед-копии детей.
        await item.setFlag(MODULE_ID, "nested", createdDocs.map(i => i.uuid));
      }
    } catch (err) {
      // Хук не должен ломать чужое создание предметов ни при каких условиях.
      console.error("[okassen] Ошибка в хуке подкладывания вложенных предметов:", err);
    }
  });
}
