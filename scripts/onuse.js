/**
 * onuse.js — реестр onUse-обработчиков и хук на использование предмета.
 *
 * Предмет, импортированный с _forge.onUse: "<id>", получает флаг
 * flags.okassen.onUse. Когда игрок использует предмет, модуль находит
 * зарегистрированный обработчик по этому id и вызывает его.
 *
 * ВАЖНО: это ЕДИНСТВЕННАЯ часть модуля, которая требует, чтобы модуль был
 * включён после создания предмета. Всё остальное (эффекты, вложения) —
 * обычные документы Foundry и работает без модуля.
 */

const MODULE_ID = "okassen";

/** Реестр обработчиков: id → функция */
export const HANDLERS = new Map();

/**
 * Зарегистрировать onUse-обработчик. Доступно и внешнему коду через
 * game.modules.get("okassen").api.registerHandler — автор кампании добавляет
 * свою логику (посох и т.п.) в собственном мире/модуле.
 *
 * @param {string} id — идентификатор, который пишется в _forge.onUse
 * @param {Function} fn — обработчик; получает контекст { item, actor, activity, usageConfig, results }
 */
export function registerHandler(id, fn) {
  if (typeof id !== "string" || typeof fn !== "function") {
    throw new Error(`[okassen] registerHandler: ожидается (string, function), получено (${typeof id}, ${typeof fn})`);
  }
  if (HANDLERS.has(id)) console.warn(`[okassen] onUse-обработчик "${id}" перезаписан`);
  HANDLERS.set(id, fn);
}

/**
 * Регистрация хука использования. Вызывается один раз из main.js на init.
 *
 * Про имя хука: в dnd5e 4.x предметы используются через систему АКТИВНОСТЕЙ
 * (activities), и корректный хук — "dnd5e.postUseActivity"
 * (activity, usageConfig, results). Старый "dnd5e.useItem" из 2.x/3.x в 4.4.4
 * для активностей не является основным путём, поэтому используем postUseActivity.
 * // verified against dnd5e 4.4.4
 */
export function initOnUse() {
  Hooks.on("dnd5e.postUseActivity", (activity, usageConfig, results) => {
    const item = activity?.item;
    if (!item) return;

    const handlerId = item.getFlag?.(MODULE_ID, "onUse");
    if (!handlerId) return;

    const fn = HANDLERS.get(handlerId);
    if (!fn) {
      console.warn(`[okassen] Предмет "${item.name}" ссылается на незарегистрированный onUse-обработчик "${handlerId}"`);
      ui.notifications.warn(game.i18n.format("OKASSEN.notify.onUseUnregistered", { handler: handlerId, item: item.name }));
      return;
    }

    try {
      fn({ item, actor: item.actor, activity, usageConfig, results });
    } catch (err) {
      console.error(`[okassen] Ошибка в onUse-обработчике "${handlerId}":`, err);
    }
  });

  // ------------------------------------------------------------------
  // Демонстрационный обработчик "log": пишет сообщение в чат.
  // Доказывает, что пайплайн onUse работает end-to-end; реальную логику
  // (посох адаптации и т.п.) автор зарегистрирует позже через api.
  // ------------------------------------------------------------------
  registerHandler("log", ({ item, actor }) => {
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: game.i18n.format("OKASSEN.onuse.logMessage", {
        item: item.name,
        actor: actor?.name ?? "—"
      })
    });
  });
}
