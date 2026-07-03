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
import { buildEffects } from "./effects.js";
import { attachNested } from "./nested.js";
import { HANDLERS } from "./onuse.js";

const MODULE_ID = "okassen";

/**
 * Создать предмет из расширенного JSON.
 *
 * @param {object} rawJson — распарсенный JSON (предмет dnd5e + необязательный _forge)
 * @param {object} [options]
 * @param {Actor|null} [options.target=null] — актёр-цель; null = создать в мире
 * @returns {Promise<Item>} — созданный предмет
 * @throws {Error} — прокидывает ошибку дальше (окно импорта покажет её в себе),
 *   предварительно залогировав и показав ui.notifications.error
 */
export async function createForgeItem(rawJson, { target = null } = {}) {
  try {
    // 1. Валидация — до любых изменений.
    validate(rawJson);

    // 2. Работаем с копией; оригинал сохраним целиком (включая _forge) во флаг.
    const source = foundry.utils.deepClone(rawJson);
    const data = foundry.utils.deepClone(rawJson);
    const forge = data._forge ?? {};
    delete data._forge; // _forge НЕ должен протечь в системные данные предмета

    // 3. Флаги: extraFlags автора + служебные флаги модуля.
    data.flags = foundry.utils.mergeObject(data.flags ?? {}, forge.extraFlags ?? {});
    foundry.utils.setProperty(data.flags, `${MODULE_ID}.source`, source);
    if (forge.onUse) foundry.utils.setProperty(data.flags, `${MODULE_ID}.onUse`, forge.onUse);

    // 4. Active Effects — сразу эмбеддед в данные создания.
    data.effects = buildEffects(forge.effects ?? []);

    // 5. Создание документа.
    let item;
    if (target) {
      if (!(target instanceof Actor)) {
        throw new Error(game.i18n.localize("OKASSEN.errors.targetNotActor"));
      }
      [item] = await target.createEmbeddedDocuments("Item", [data]);
    } else {
      item = await Item.implementation.create(data);
    }

    // 6. Вложенные предметы. Ошибки внутри не роняют импорт (см. nested.js).
    await attachNested(item, forge.nested ?? []);

    // 7. onUse: флаг уже стоит; честно предупреждаем, если обработчика (пока) нет.
    if (forge.onUse && !HANDLERS.has(forge.onUse)) {
      console.warn(`[okassen] onUse-обработчик "${forge.onUse}" не зарегистрирован — предмет создан, но логика при использовании не сработает, пока обработчик не появится`);
      ui.notifications.warn(game.i18n.format("OKASSEN.notify.onUseUnregistered", {
        handler: forge.onUse,
        item: item.name
      }));
    }

    // 8. Успех.
    ui.notifications.info(game.i18n.format("OKASSEN.notify.created", {
      name: item.name,
      place: target ? target.name : game.i18n.localize("OKASSEN.notify.world")
    }));
    return item;

  } catch (err) {
    // 9. Любая ошибка: консоль с префиксом + уведомление; окно импорта поймает
    //    проброшенную ошибку и покажет текст у себя.
    console.error("[okassen] Ошибка импорта:", err);
    ui.notifications.error(game.i18n.format("OKASSEN.notify.error", { message: err.message }));
    throw err;
  }
}
