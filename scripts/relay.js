/**
 * relay.js — выполнение действий от имени активного ведущего.
 *
 * Зачем. Foundry не даст игроку изменить документ, которым он не владеет:
 * наложить эффект на чужого НИПа, создать токен на сцене. Обработчики
 * applyEffect и summon из-за этого работали только у ведущего, а игроку
 * оставалось просить его вручную.
 *
 * Здесь — узкий сокет-канал: игрок отправляет ЗАПРОС, активный ведущий его
 * исполняет. Запрос не содержит данных для записи — только ссылки:
 *   { action, itemUuid, targetUuid | sceneId }.
 * Ведущий сам перечитывает предмет и его конфиг из флагов и сам решает, что
 * делать. Это принципиально: иначе подделанное сообщение давало бы игроку
 * право писать в мир что угодно руками ведущего.
 *
 * Проверки на стороне ведущего:
 *  1. отправитель — существующий активный пользователь;
 *  2. он ВЛАДЕЕТ носителем (актёром предмета) — то есть имел право
 *     использовать предмет;
 *  3. предмет реально ссылается на этот обработчик (флаг onUse или хук),
 *     то есть действие описано автором контента, а не придумано клиентом.
 *
 * Канал выключается настройкой «Выполнять действия игроков от имени ведущего».
 */

import { getSetting } from "./settings.js";

const MODULE_ID = "okassen";
const CHANNEL = `module.${MODULE_ID}`;

/** Обработчики действий у ведущего: action → async (payload, user) => void */
const ACTIONS = new Map();

/**
 * Зарегистрировать действие, исполняемое ведущим.
 * @param {string} action — имя действия в сообщении
 * @param {(payload: object, user: User, item: Item) => Promise<void>} fn
 */
export function registerRelayAction(action, fn) {
  ACTIONS.set(action, fn);
}

/** Этот клиент — тот самый ведущий, который исполняет запросы? */
function isRelayGM() {
  return game.users.activeGM?.isSelf === true;
}

/**
 * Проверить запрос перед исполнением. Возвращает предмет-носитель или null
 * (причина пишется в консоль ведущего — игроку она бесполезна).
 */
async function authorize(payload, user) {
  if (!user?.active) {
    console.warn("[okassen] Релей: запрос от неактивного пользователя отклонён");
    return null;
  }
  const item = await fromUuid(payload?.itemUuid).catch(() => null);
  if (!(item instanceof Item)) {
    console.warn(`[okassen] Релей: предмет ${payload?.itemUuid} не найден`);
    return null;
  }
  // Носителем должен владеть отправитель: право использовать предмет = право
  // запускать его логику. Мировой предмет без актёра игроку не принадлежит.
  const carrier = item.actor;
  if (!carrier?.testUserPermission(user, "OWNER")) {
    console.warn(`[okassen] Релей: ${user.name} не владеет носителем предмета "${item.name}" — запрос отклонён`);
    return null;
  }
  // Действие должно быть прописано в самом предмете (onUse или любой хук).
  const flags = item.flags?.[MODULE_ID] ?? {};
  const declared = [flags.onUse, ...Object.values(flags.hooks ?? {})];
  if (!declared.includes(payload.action)) {
    console.warn(`[okassen] Релей: предмет "${item.name}" не объявляет обработчик "${payload.action}" — запрос отклонён`);
    return null;
  }
  return item;
}

/**
 * Попросить ведущего выполнить действие. Возвращает true, если запрос
 * отправлен (это НЕ значит, что ведущий его выполнил — ответа мы не ждём).
 *
 * @param {string} action — имя зарегистрированного действия
 * @param {object} payload — ссылки: itemUuid и что нужно действию
 * @returns {boolean}
 */
export function requestGM(action, payload) {
  if (!getSetting("gmRelay")) return false;
  if (!game.users.activeGM) {
    ui.notifications.warn(game.i18n.localize("OKASSEN.relay.noGM"));
    return false;
  }
  game.socket.emit(CHANNEL, { ...payload, action, from: game.user.id });
  return true;
}

/** Подписка на канал. Вызывается один раз из main.js (ready). */
export function initRelay() {
  game.socket.on(CHANNEL, async payload => {
    try {
      if (!isRelayGM()) return;            // исполняет ровно один клиент
      if (!getSetting("gmRelay")) return;  // канал выключен настройкой мира

      const fn = ACTIONS.get(payload?.action);
      if (!fn) return;

      const user = game.users.get(payload.from);
      const item = await authorize(payload, user);
      if (!item) return;

      await fn(payload, user, item);
    } catch (err) {
      console.error("[okassen] Ошибка исполнения запроса релея:", err);
    }
  });
}
