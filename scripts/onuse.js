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
 * Найти скрипт-макрос-обработчик по конвенции имени: "okassen:<id>".
 * Позволяет автору писать логику предметов прямо в макросах Foundry,
 * без файлов и перезагрузок: создайте скрипт-макрос с именем
 * "okassen:heart-of-void" — и предмет с onUse: "heart-of-void" будет
 * вызывать его. Внутри макроса доступны переменные item, actor, activity,
 * usageConfig, results.
 */
function findMacroHandler(id) {
  const macro = game.macros.getName(`okassen:${id}`);
  return macro?.type === "script" ? macro : null;
}

/**
 * Есть ли обработчик с таким id (в реестре или среди макросов).
 * Используется загрузчиком для честного предупреждения при импорте.
 */
export function hasHandler(id) {
  return HANDLERS.has(id) || !!findMacroHandler(id);
}

/**
 * Выполнить обработчик по id: сначала реестр, затем скрипт-макрос "okassen:<id>".
 * Общий исполнитель для onUse И хуков жизненного цикла (lifecycle.js).
 * Ошибки внутри обработчика логируются и не пробрасываются.
 *
 * @param {string} id — идентификатор обработчика
 * @param {object} context — передаётся обработчику ({ item, actor, ... })
 * @param {string} label — откуда вызван (для текста ошибки в консоли)
 * @returns {boolean} — false, если обработчик не найден (предупреждает вызывающий)
 */
export function runHandler(id, context, label = "") {
  const fn = HANDLERS.get(id);
  if (fn) {
    try {
      fn(context);
    } catch (err) {
      console.error(`[okassen] Ошибка в обработчике "${id}"${label ? ` (${label})` : ""}:`, err);
    }
    return true;
  }

  const macro = findMacroHandler(id);
  if (macro) {
    // macro.execute передаёт scope как переменные внутри макроса.
    Promise.resolve(macro.execute(context)).catch(err =>
      console.error(`[okassen] Ошибка в макросе-обработчике "okassen:${id}"${label ? ` (${label})` : ""}:`, err)
    );
    return true;
  }

  return false;
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

    const context = { item, actor: item.actor, activity, usageConfig, results, trigger: "use" };

    // Приоритет: обработчик из реестра → скрипт-макрос "okassen:<id>".
    if (!runHandler(handlerId, context, `onUse @ ${item.name}`)) {
      console.warn(`[okassen] Предмет "${item.name}" ссылается на незарегистрированный onUse-обработчик "${handlerId}" (нет ни в реестре, ни макроса "okassen:${handlerId}")`);
      ui.notifications.warn(game.i18n.format("OKASSEN.notify.onUseUnregistered", { handler: handlerId, item: item.name }));
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

  // ------------------------------------------------------------------
  // Встроенный обработчик "seals" — печати артефакта.
  //
  // Предмет должен иметь во флагах flags.okassen.sealsTotal (задаётся через
  // _forge.extraFlags, см. пример). Каждое использование:
  //  - тратит одну печать (счётчик flags.okassen.sealsUsed);
  //  - ВКЛЮЧАЕТ первый выключенный эффект предмета — печати открываются
  //    по мере использования, как у Медного Посоха Адаптации;
  //  - пишет итог в чат. Когда печати кончились — просто сообщает об этом.
  // ------------------------------------------------------------------
  registerHandler("seals", async ({ item, actor }) => {
    const total = Number(item.getFlag(MODULE_ID, "sealsTotal") ?? 0);
    if (!total) {
      console.warn(`[okassen] "seals": у предмета "${item.name}" нет flags.okassen.sealsTotal`);
      return;
    }
    const used = Number(item.getFlag(MODULE_ID, "sealsUsed") ?? 0);
    const speaker = ChatMessage.getSpeaker({ actor });

    if (used >= total) {
      ChatMessage.create({
        speaker,
        content: game.i18n.format("OKASSEN.onuse.sealsExhausted", { item: item.name, total })
      });
      return;
    }

    await item.setFlag(MODULE_ID, "sealsUsed", used + 1);

    // Открываем следующую «печать» — первый выключенный эффект предмета.
    const fx = item.effects.find(e => e.disabled);
    if (fx) await fx.update({ disabled: false });

    ChatMessage.create({
      speaker,
      content: game.i18n.format("OKASSEN.onuse.sealsMessage", {
        item: item.name,
        used: used + 1,
        total,
        effect: fx ? game.i18n.format("OKASSEN.onuse.sealsEffectOn", { effect: fx.name }) : ""
      })
    });
  });
}
