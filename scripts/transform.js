/**
 * transform.js — встроенные обработчики "transform" и "revert":
 * превращение носителя предмета в другого актёра БЕЗ создания клона
 * в сайдбаре и без единой строчки макроса.
 *
 * Почему без модуля так не получается. Штатное превращение dnd5e
 * (Actor5e#transformInto, активность "transform") для СВЯЗАННОГО токена
 * создаёт в сайдбаре нового актёра «Имя (Форма)» — это и есть «клон».
 * Клона нет ровно в одной ветке: когда превращается актёр НЕСВЯЗАННОГО
 * токена — тогда новая форма пишется в ActorDelta самого токена.
 * // verified against dnd5e 5.3.3 (ветка `if (this.isToken)` в transformInto)
 *
 * Поэтому обработчик:
 *  1. находит токен носителя на сцене;
 *  2. если токен связан — временно отвязывает его (actorLink: false),
 *     запомнив это во флаге flags.okassen.relink;
 *  3. вызывает transformInto у ТОКЕНОВОГО актёра — форма уходит в дельту
 *     токена, сайдбар и лист персонажа остаются нетронутыми;
 *  4. возврат (повторное использование или обработчик "revert") просто
 *     возвращает связь: базовый актёр всё это время был цел, токен НЕ
 *     пересоздаётся — значит возврат доступен игроку и не ломает
 *     инициативу и цели (штатный dnd5e-возврат пересоздаёт токен и
 *     требует права на создание токенов, которых у игрока обычно нет).
 *
 * Конфиг берётся из флагов предмета (или актёра — для ходовых хуков):
 *   flags.okassen.transform = "Actor.<id>"        // краткая запись
 *   flags.okassen.transform = {
 *     target: "Actor.<id>",       // кем становимся (uuid актёра/компендиума)
 *     preset: "polymorph",        // пресет dnd5e: polymorph | wildshape | polymorphSelf
 *     settings: { keep: ["hp"] }, // точечные переопределения TransformationSetting
 *     toggle: true,               // повторное использование = возврат (по умолчанию да)
 *     unlink: true,               // можно ли отвязывать связанный токен (по умолчанию да)
 *     returnItem: true,           // положить в новую форму предмет «Вернуть облик» (по умолчанию да)
 *     renderSheet: false,         // открывать лист новой формы
 *     only: "Actor.<id>"          // работает только у этого носителя (uuid/id или массив)
 *   }
 * В JSON это пишется через _forge.extraFlags (см. README).
 */

import { registerHandler } from "./onuse.js";

const MODULE_ID = "okassen";

/** Класс настроек превращения dnd5e 5.x или null (другая/старая система). */
function transformationSettingClass() {
  const api = game.dnd5e ?? globalThis.dnd5e;
  return api?.dataModels?.settings?.TransformationSetting ?? null;
}

/**
 * Конфиг превращения из флагов документа.
 * Строка = uuid цели (краткая запись), объект = полный конфиг.
 * @param {Item|Actor|null} doc
 * @returns {object|null}
 */
export function readTransformConfig(doc) {
  const raw = doc?.getFlag?.(MODULE_ID, "transform");
  if (typeof raw === "string") return { target: raw };
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  return null;
}

/** UUID базового (мирового) актёра — в том числе для токенового актёра. */
function baseActorUuid(actor) {
  if (!actor) return null;
  return actor.isToken ? `Actor.${actor.token.actorId}` : actor.uuid;
}

/** Ограничение «только этот носитель» (cfg.only): uuid, id или их массив. */
function matchesOnly(actor, only) {
  const refs = Array.isArray(only) ? only : [only];
  const uuid = baseActorUuid(actor);
  const id = uuid?.split(".").pop();
  return refs.some(ref => ref === uuid || ref === id);
}

/**
 * Токен носителя на сцене. Превращение живёт в дельте токена — без токена
 * его просто некуда записать (кроме создания клона, чего мы и избегаем).
 * Приоритет: выделенный токен → единственный активный → первый активный.
 */
function pickToken(actor) {
  if (!actor) return null;
  if (actor.isToken) return actor.token;
  const controlled = (canvas?.tokens?.controlled ?? [])
    .map(t => t.document)
    .filter(t => t.actorId === actor.id);
  if (controlled.length) return controlled[0];
  const active = actor.getActiveTokens(false, true) ?? [];
  if (active.length > 1) {
    console.warn(`[okassen] transform: у "${actor.name}" несколько токенов на сцене — берём первый; выделите нужный, чтобы выбрать явно`);
  }
  return active[0] ?? null;
}

/** Настройки превращения: пресет dnd5e + точечные переопределения из JSON. */
function buildSettings(Setting, cfg) {
  const presets = CONFIG.DND5E?.transformation?.presets ?? {};
  const preset = cfg.preset ?? null;
  if (preset && !presets[preset]) {
    ui.notifications.warn(game.i18n.format("OKASSEN.transform.badPreset", {
      preset,
      presets: Object.keys(presets).join(", ")
    }));
  }
  return new Setting({
    ...(presets[preset]?.settings ?? {}),
    preset,
    ...(cfg.settings ?? {})
  });
}

/**
 * Вернуть исходную форму токену, который отвязали МЫ.
 * Базовый актёр не менялся, поэтому достаточно вернуть связь: дельта с
 * формой перестаёт применяться (TokenDocument#actor у связанного токена —
 * это базовый актёр).
 *
 * @param {TokenDocument} token — токен в превращённой форме
 * @returns {Promise<TokenDocument>}
 */
async function relinkToken(token) {
  const shaped = token.actor;
  const opts = shaped?.getFlag("dnd5e", "transformOptions") ?? {};
  const prevToken = token.getFlag("dnd5e", "previousTokenData") ?? {};
  const base = game.actors.get(token.actorId);

  // Перенос значений, которые превращение «сохраняло» — как в dnd5e#revertOriginalForm.
  const carry = {};
  if (base && shaped) {
    if (opts.keep?.includes("hp")) carry["system.attributes.hp.value"] = shaped.system.attributes.hp.value;
    if (opts.keep?.includes("tempHP")) carry["system.attributes.hp.temp"] = shaped.system.attributes.hp.temp;
    if (opts.keep?.includes("spells") || opts.spellLists?.length) {
      for (const [k, v] of Object.entries(shaped.system.spells ?? {})) {
        if (v.max) carry[`system.spells.${k}.value`] = v.value;
      }
    }
  }

  // Дельта больше не будет применяться, но её стоит обезвредить: без этого
  // следующее превращение увидит в ней флаг isPolymorphed и решит, что мы
  // уже в форме. Полная очистка — ActorDelta#restore (если ядро её даёт).
  try {
    if (typeof token.delta?.restore === "function") await token.delta.restore();
    else if (shaped) await shaped.update({ "flags.dnd5e.-=isPolymorphed": null });
  } catch (err) {
    console.warn("[okassen] transform: не удалось очистить дельту токена:", err);
  }

  const update = {
    ...prevToken,
    actorLink: true,
    flags: {
      dnd5e: { "-=previousActorData": null, "-=previousTokenData": null },
      [MODULE_ID]: { "-=relink": null }
    }
  };
  const result = await token.update(update);
  if (base && !foundry.utils.isEmpty(carry)) {
    await base.update(carry, { dnd5e: { concentrationCheck: false } });
  }
  ui.notifications.info(game.i18n.format("OKASSEN.transform.reverted", {
    name: base?.name ?? token.name
  }));
  return result;
}

/**
 * Положить в новую форму предмет «Вернуть облик» — одна кнопка на листе
 * зверя, чтобы вернуться обратно. Иначе возврат неудобен: предмет-источник
 * (заклинание, черта) остаётся у ИСХОДНОГО актёра и в новой форме его нет,
 * а штатная кнопка dnd5e пересоздаёт токен и требует прав ГМ.
 *
 * Предмет живёт в дельте токена, поэтому при возврате (восстановлении связи)
 * исчезает сам — чистить его не нужно.
 *
 * @param {Actor} shaped — актёр токена уже в новой форме
 * @param {object} cfg — конфиг превращения (кладётся во флаги предмета)
 * @param {string} img — иконка исходного облика
 */
async function addReturnItem(shaped, cfg, img) {
  const name = game.i18n.localize("OKASSEN.transform.returnItem");
  if (shaped.items.some(i => i.getFlag(MODULE_ID, "returnItem"))) return;
  const activityId = foundry.utils.randomID();
  try {
    await shaped.createEmbeddedDocuments("Item", [{
      name,
      type: "feat",
      img: img || "icons/magic/nature/wolf-paw-glow-large-green.webp",
      system: {
        description: { value: `<p>${game.i18n.localize("OKASSEN.transform.returnItemHint")}</p>` },
        activities: {
          [activityId]: {
            _id: activityId,
            type: "utility",
            name,
            activation: { type: "action" }
          }
        }
      },
      flags: {
        [MODULE_ID]: {
          onUse: "revert",
          returnItem: true,
          // Конфиг нужен обработчику "revert" (renderSheet и т.п.).
          transform: cfg
        }
      }
    }]);
  } catch (err) {
    // Не смогли положить предмет — превращение уже состоялось, не роняем его.
    console.warn("[okassen] transform: не удалось добавить предмет возврата:", err);
  }
}

/**
 * Обработчик "transform": превратить носителя в актёра из конфига.
 * Контекст тот же, что у любого onUse/хук-обработчика ({ item, actor }).
 */
export async function transformHandler({ item, actor }) {
  const holder = actor ?? item?.actor ?? null;
  const cfg = readTransformConfig(item) ?? readTransformConfig(holder);
  const label = item?.name ?? holder?.name ?? "—";

  if (!cfg?.target) {
    ui.notifications.warn(game.i18n.format("OKASSEN.transform.noTarget", { item: label }));
    return;
  }
  if (cfg.only && !matchesOnly(holder, cfg.only)) return; // не тот носитель — молча мимо

  const Setting = transformationSettingClass();
  if (!Setting) {
    ui.notifications.error(game.i18n.localize("OKASSEN.transform.needsDnd5e"));
    return;
  }
  if (!game.user.isGM && !game.settings.get("dnd5e", "allowPolymorphing")) {
    ui.notifications.warn(game.i18n.localize("OKASSEN.transform.notAllowed"));
    return;
  }

  const source = await fromUuid(cfg.target);
  if (!(source instanceof Actor)) {
    ui.notifications.warn(game.i18n.format("OKASSEN.transform.targetNotFound", { target: cfg.target }));
    return;
  }

  const token = pickToken(holder);
  if (!token) {
    ui.notifications.warn(game.i18n.format("OKASSEN.transform.noToken", { name: holder?.name ?? label }));
    return;
  }

  // Уже в форме: повторное использование возвращает исходный облик.
  if (token.actor?.isPolymorphed) {
    if (cfg.toggle === false) {
      ui.notifications.warn(game.i18n.format("OKASSEN.transform.already", { name: token.name }));
      return;
    }
    return revertToken(token, cfg);
  }

  // Ключевой шаг: отвязываем токен, иначе dnd5e создаст актёра-клона.
  if (token.actorLink) {
    if (cfg.unlink === false) {
      ui.notifications.warn(game.i18n.format("OKASSEN.transform.linkedToken", { name: token.name }));
      return;
    }
    try {
      await token.update({ actorLink: false, [`flags.${MODULE_ID}.relink`]: true });
    } catch (err) {
      console.error("[okassen] transform: не удалось отвязать токен:", err);
      ui.notifications.error(game.i18n.format("OKASSEN.transform.unlinkFailed", { name: token.name }));
      return;
    }
  }

  const name = holder?.name ?? token.name;
  const img = holder?.img;
  await token.actor.transformInto(source, buildSettings(Setting, cfg), {
    renderSheet: cfg.renderSheet ?? false
  });
  // Кнопка возврата прямо на листе новой формы.
  if (cfg.returnItem !== false) await addReturnItem(token.actor, cfg, img);
  ui.notifications.info(game.i18n.format("OKASSEN.transform.done", { name, form: source.name }));
}

/** Возврат исходной формы: наш путь (relink) или штатный dnd5e. */
async function revertToken(token, cfg = {}) {
  if (token.getFlag(MODULE_ID, "relink")) return relinkToken(token);
  // Токен был несвязанным изначально (или превращение делали не мы) —
  // отдаём штатному возврату dnd5e: он пересоздаёт токен (нужны права ГМ).
  return token.actor?.revertOriginalForm({ renderSheet: cfg.renderSheet ?? false });
}

/** Обработчик "revert": вернуть носителю исходную форму. */
export async function revertHandler({ item, actor }) {
  const holder = actor ?? item?.actor ?? null;
  const cfg = readTransformConfig(item) ?? readTransformConfig(holder) ?? {};
  const token = holder?.isToken ? holder.token : pickToken(holder);
  const subject = token?.actor ?? holder;

  if (!subject?.isPolymorphed) {
    ui.notifications.warn(game.i18n.format("OKASSEN.transform.notTransformed", {
      name: holder?.name ?? "—"
    }));
    return;
  }
  if (!token) return subject.revertOriginalForm({ renderSheet: cfg.renderSheet ?? false });
  return revertToken(token, cfg);
}

/** Регистрация встроенных обработчиков. Вызывается один раз из main.js (init). */
export function initTransform() {
  registerHandler("transform", transformHandler);
  registerHandler("revert", revertHandler);
}
