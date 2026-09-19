/**
 * lifecycle.js — хуки жизненного цикла помимо onUse.
 *
 * Формат (_forge предмета):
 *   "onEquip":     "id"  — предмет экипирован (system.equipped → true);
 *   "onUnequip":   "id"  — предмет снят;
 *   "onCreate":    "id"  — предмет создан (в мире или на актёре);
 *   "onDelete":    "id"  — предмет удалён;
 *   "onTurnStart": "id"  — начало хода носителя в бою;
 *   "onTurnEnd":   "id"  — конец хода носителя в бою;
 *   "onRest":      "id"  — носитель завершил отдых (контекст: restType, rest);
 *   "onDamaged":   "id"  — носителю уменьшили хиты (контекст: delta, hp);
 *   "onHealed":    "id"  — носителю восстановили хиты (контекст: delta, hp);
 *   "onCombatStart": "id" — начался бой с участием носителя;
 *   "onCombatEnd":   "id" — бой с участием носителя завершён.
 *
 * У актёров поддерживается всё, кроме предметных хуков (equip/create/delete):
 * ходовые, отдых, изменение хитов и бой — см. ACTOR_HOOKS.
 *
 * id — тот же реестр, что у onUse: api.registerHandler("id", fn) или
 * скрипт-макрос с именем "okassen:<id>". Контекст обработчика:
 *   { item, actor, trigger, combat? } — item = null для хуков актёра.
 *
 * ВАЖНО: как и onUse, эти хуки требуют ВКЛЮЧЁННЫЙ модуль во время игры
 * (в отличие от эффектов и вложений, которые после создания живут сами).
 */

import { runHandler, hasHandler } from "./onuse.js";

const MODULE_ID = "okassen";

/** _forge-ключ → ключ во flags.okassen.hooks (предметы). */
export const ITEM_HOOKS = {
  onEquip: "equip",
  onUnequip: "unequip",
  onCreate: "create",
  onDelete: "delete",
  onTurnStart: "turnStart",
  onTurnEnd: "turnEnd",
  onRest: "rest",
  onDamaged: "damaged",
  onHealed: "healed",
  onCombatStart: "combatStart",
  onCombatEnd: "combatEnd"
};

/** То же для актёров: всё, кроме хуков самого предмета (equip/create/delete). */
export const ACTOR_HOOKS = {
  onTurnStart: "turnStart",
  onTurnEnd: "turnEnd",
  onRest: "rest",
  onDamaged: "damaged",
  onHealed: "healed",
  onCombatStart: "combatStart",
  onCombatEnd: "combatEnd"
};

/**
 * Перенести хуки из _forge в flags.okassen.hooks создаваемого документа.
 * Вызывается загрузчиком (предметы, актёры) и nested.js (вложенные).
 *
 * @param {object} flags — объект flags будущего документа (мутируется)
 * @param {object} forge — блок _forge
 * @param {object} [allowed=ITEM_HOOKS] — какие хуки разрешены (ACTOR_HOOKS для актёров)
 */
export function applyForgeHookFlags(flags, forge, allowed = ITEM_HOOKS) {
  for (const [forgeKey, hookKey] of Object.entries(allowed)) {
    const id = forge[forgeKey];
    if (typeof id === "string" && id) {
      foundry.utils.setProperty(flags, `${MODULE_ID}.hooks.${hookKey}`, id);
    }
  }
}

/**
 * Предупредить при импорте о хуках, ссылающихся на незарегистрированные
 * обработчики (документ создан, но логика не сработает, пока обработчик
 * не появится). Аналог предупреждения onUse в loader.js.
 * @param {Item|Actor} doc — созданный документ
 */
export function warnUnregisteredHooks(doc) {
  const hooks = doc.getFlag(MODULE_ID, "hooks") ?? {};
  for (const [hookKey, id] of Object.entries(hooks)) {
    if (typeof id !== "string" || hasHandler(id)) continue;
    console.warn(`[okassen] Хук ${hookKey} документа "${doc.name}" ссылается на незарегистрированный обработчик "${id}"`);
    ui.notifications.warn(game.i18n.format("OKASSEN.notify.hookUnregistered", {
      handler: id, hook: hookKey, name: doc.name
    }));
  }
}

/** Запустить хук документа, если он задан; предупредить, если обработчика нет. */
function fire(doc, hookKey, context) {
  const id = doc.getFlag?.(MODULE_ID, `hooks.${hookKey}`);
  if (typeof id !== "string" || !id) return;
  if (!runHandler(id, { ...context, trigger: hookKey }, `${hookKey} @ ${doc.name}`)) {
    console.warn(`[okassen] Обработчик "${id}" (хук ${hookKey}, "${doc.name}") не зарегистрирован`);
    ui.notifications.warn(game.i18n.format("OKASSEN.notify.hookUnregistered", {
      handler: id, hook: hookKey, name: doc.name
    }));
  }
}

/**
 * Запустить хук у самого актёра и у КАЖДОГО его предмета.
 * Так «носитель» — это и актёр (его _forge), и любой предмет в инвентаре.
 *
 * @param {Actor|null} actor
 * @param {string} hookKey — ключ во flags.okassen.hooks
 * @param {object} [extra] — дополнительные поля контекста (combat, rest, delta…)
 */
function fireForActor(actor, hookKey, extra = {}) {
  if (!actor) return;
  fire(actor, hookKey, { item: null, actor, ...extra });
  for (const item of actor.items) {
    fire(item, hookKey, { item, actor, ...extra });
  }
}

/**
 * Регистрация хуков жизненного цикла. Вызывается один раз из main.js (init).
 *
 * Гварды от дублей:
 *  - create/delete/equip: срабатывают только у клиента, который сделал
 *    изменение (userId === game.user.id) — как в nested.js;
 *  - ходовые: только у активного ведущего — смена хода приходит всем клиентам.
 */
export function initLifecycleHooks() {
  Hooks.on("createItem", (item, _options, userId) => {
    try {
      if (userId !== game.user.id) return;
      fire(item, "create", { item, actor: item.actor ?? null });
    } catch (err) {
      console.error("[okassen] Ошибка хука onCreate:", err);
    }
  });

  Hooks.on("deleteItem", (item, _options, userId) => {
    try {
      if (userId !== game.user.id) return;
      fire(item, "delete", { item, actor: item.actor ?? null });
    } catch (err) {
      console.error("[okassen] Ошибка хука onDelete:", err);
    }
  });

  Hooks.on("updateItem", (item, changed, _options, userId) => {
    try {
      if (userId !== game.user.id) return;
      // Экипировка имеет смысл только на актёре.
      if (!(item.parent instanceof Actor)) return;
      const equipped = foundry.utils.getProperty(changed, "system.equipped");
      if (equipped === true) fire(item, "equip", { item, actor: item.parent, equipped: true });
      else if (equipped === false) fire(item, "unequip", { item, actor: item.parent, equipped: false });
    } catch (err) {
      console.error("[okassen] Ошибка хука onEquip/onUnequip:", err);
    }
  });

  Hooks.on("combatTurnChange", (combat, prior, current) => {
    try {
      if (!game.users.activeGM?.isSelf) return;
      const priorActor = combat.combatants.get(prior?.combatantId)?.actor ?? null;
      const currentActor = combat.combatants.get(current?.combatantId)?.actor ?? null;
      if (priorActor && prior?.combatantId !== current?.combatantId) {
        fireForActor(priorActor, "turnEnd", { combat });
      }
      fireForActor(currentActor, "turnStart", { combat });
    } catch (err) {
      console.error("[okassen] Ошибка ходовых хуков:", err);
    }
  });

  // --- Отдых (dnd5e): короткий и длинный ------------------------------
  // Хук системы: dnd5e.restCompleted(actor, result). Тип отдыха в 4.x/5.x
  // лежит в result.type ("short"/"long"); у старых сборок — result.longRest.
  // // verified against dnd5e 5.3.3
  Hooks.on("dnd5e.restCompleted", (actor, result) => {
    try {
      if (!game.users.activeGM?.isSelf) return;
      const restType = result?.type ?? (result?.longRest ? "long" : "short");
      fireForActor(actor, "rest", { rest: result, restType });
    } catch (err) {
      console.error("[okassen] Ошибка хука onRest:", err);
    }
  });

  // --- Изменение хитов: onDamaged / onHealed --------------------------
  // Прежнее значение забираем в preUpdateActor: в updateActor актёр уже
  // обновлён, и дельту по нему не вычислить.
  Hooks.on("preUpdateActor", (actor, changed, options) => {
    try {
      const next = foundry.utils.getProperty(changed, "system.attributes.hp.value");
      if (next === undefined) return;
      options[MODULE_ID] = { ...(options[MODULE_ID] ?? {}), prevHp: actor.system?.attributes?.hp?.value ?? null };
    } catch (err) {
      console.error("[okassen] Ошибка подготовки хуков onDamaged/onHealed:", err);
    }
  });

  Hooks.on("updateActor", (actor, changed, options) => {
    try {
      // Событие приходит всем клиентам — реагирует только активный ведущий.
      if (!game.users.activeGM?.isSelf) return;
      const prev = options?.[MODULE_ID]?.prevHp;
      const next = foundry.utils.getProperty(changed, "system.attributes.hp.value");
      if (prev == null || next === undefined) return;
      const delta = next - prev;
      if (!delta) return;
      const hookKey = delta < 0 ? "damaged" : "healed";
      fireForActor(actor, hookKey, { delta: Math.abs(delta), hp: next, previousHp: prev });
    } catch (err) {
      console.error("[okassen] Ошибка хуков onDamaged/onHealed:", err);
    }
  });

  // --- Бой: начало и конец -------------------------------------------
  Hooks.on("combatStart", combat => {
    try {
      if (!game.users.activeGM?.isSelf) return;
      for (const combatant of combat.combatants) fireForActor(combatant.actor, "combatStart", { combat });
    } catch (err) {
      console.error("[okassen] Ошибка хука onCombatStart:", err);
    }
  });

  Hooks.on("deleteCombat", combat => {
    try {
      if (!game.users.activeGM?.isSelf) return;
      for (const combatant of combat.combatants) fireForActor(combatant.actor, "combatEnd", { combat });
    } catch (err) {
      console.error("[okassen] Ошибка хука onCombatEnd:", err);
    }
  });
}
