/**
 * handlers.js — встроенные обработчики общего назначения.
 *
 * Раньше в комплекте были только демонстрационные "log"/"seals" и
 * превращение "transform"/"revert": всё остальное автор кампании писал
 * макросом. Здесь — то, ради чего эти макросы обычно и пишут:
 *
 *   "chatCard"     — сообщение в чат (с подстановками {item}/{actor}/{target});
 *   "applyEffect"  — наложить эффект предмета на выбранные цели или на носителя;
 *   "toggleEffect" — включить/выключить эффект носителя или состояние (condition);
 *   "rollTable"    — бросок по таблице случайных результатов;
 *   "summon"       — призвать актёра токеном рядом с носителем;
 *   "macro"        — вызвать макрос по имени/uuid с собственными аргументами.
 *
 * Конфиг живёт во флагах документа — как у "transform":
 *   "_forge": { "onUse": "chatCard",
 *               "extraFlags": { "okassen": { "chatCard": "Текст" } } }
 * Строка вместо объекта — краткая запись главного поля (см. SHORTHAND).
 *
 * Обработчики вызываются и из onUse, и из любого хука жизненного цикла
 * (onEquip, onTurnStart…): контекст один и тот же.
 *
 * Действия, на которые у игрока нет прав (эффект на чужого актёра, токен на
 * сцене), уходят активному ведущему через relay.js — он перечитывает конфиг
 * из самого предмета и исполняет сам.
 */

import { registerHandler } from "./onuse.js";
import { requestGM, registerRelayAction } from "./relay.js";

const MODULE_ID = "okassen";

/** Какое поле заполняет краткая строковая запись конфига. */
const SHORTHAND = {
  chatCard: "content",
  applyEffect: "effect",
  toggleEffect: "effect",
  rollTable: "table",
  summon: "actor",
  macro: "macro"
};

/**
 * Конфиг обработчика из флагов документа (предмета или актёра).
 * Строка → { <главное поле>: строка }, объект → он сам, иначе {}.
 *
 * @param {Item|Actor|null} doc — документ-носитель
 * @param {string} key — id обработчика (он же имя флага)
 * @returns {object}
 */
function readConfig(doc, key) {
  const raw = doc?.getFlag?.(MODULE_ID, key);
  if (typeof raw === "string") return { [SHORTHAND[key] ?? "value"]: raw };
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  return {};
}

/** Предупредить в чат-уведомлениях и в консоли: конфиг неполон. */
function misconfigured(key, doc, messageKey, data = {}) {
  console.warn(`[okassen] "${key}": ${game.i18n.format(messageKey, data)} (документ "${doc?.name ?? "?"}")`);
  ui.notifications.warn(game.i18n.format(messageKey, data));
}

/** Подстановки {item} / {actor} / {target} в тексте конфига. */
function fillPlaceholders(text, { item, actor }) {
  const target = [...(game.user?.targets ?? [])][0]?.actor?.name ?? "";
  return String(text)
    .replaceAll("{item}", item?.name ?? "")
    .replaceAll("{actor}", actor?.name ?? "")
    .replaceAll("{target}", target);
}

/** Актёры выбранных целей (без дублей); пусто — если целей нет. */
function targetActors() {
  const actors = new Map();
  for (const token of game.user?.targets ?? []) {
    if (token.actor) actors.set(token.actor.uuid, token.actor);
  }
  return [...actors.values()];
}

/**
 * Куда применять: "targets" (выбранные цели), "self" (носитель) или
 * "both". Умолчание — цели, если они выбраны, иначе носитель: так обработчик
 * полезен и без ручного наведения.
 */
function resolveRecipients(cfg, actor) {
  const targets = targetActors();
  const mode = cfg.to ?? (targets.length ? "targets" : "self");
  if (mode === "self") return actor ? [actor] : [];
  if (mode === "both") return [...new Set([actor, ...targets].filter(Boolean))];
  return targets;
}

/** Найти документ по uuid или (для мировых коллекций) по имени. */
async function resolveDocument(ref, collection) {
  if (typeof ref !== "string" || !ref) return null;
  const byUuid = await fromUuid(ref).catch(() => null);
  if (byUuid) return byUuid;
  return collection?.getName?.(ref) ?? collection?.get?.(ref) ?? null;
}

/**
 * Выбрать эффекты предмета по ссылке из конфига: id, имя или массив того и
 * другого. Без ссылки — все эффекты предмета, которые не переносятся на
 * носителя сами (transfer: false): именно они обычно и предназначены целям.
 */
function pickEffects(item, ref) {
  const all = [...(item?.effects ?? [])];
  if (!ref) return all.filter(fx => !fx.transfer);
  const refs = (Array.isArray(ref) ? ref : [ref]).map(String);
  return all.filter(fx => refs.includes(fx.id) || refs.includes(fx.name));
}

/**
 * Наложить эффекты предмета на список актёров (у вызывающего есть права).
 *
 * @param {Actor[]} recipients — кому накладываем
 * @param {Item|null} item — предмет-источник
 * @param {ActiveEffect[]} effects — какие эффекты предмета переносим
 * @param {object} cfg — конфиг обработчика (duration, stack)
 */
async function applyEffectsTo(recipients, item, effects, cfg = {}) {
  for (const recipient of recipients) {
    const payload = effects.map(fx => {
      const data = fx.toObject();
      delete data._id;                  // на цели это НОВЫЙ эффект
      data.origin = item?.uuid ?? null; // «откуда» — для отмены и подсказок
      data.transfer = false;
      data.disabled = false;
      if (cfg.duration) data.duration = foundry.utils.mergeObject(data.duration ?? {}, cfg.duration);
      foundry.utils.setProperty(data, `flags.${MODULE_ID}.appliedBy`, item?.uuid ?? null);
      return data;
    });

    // Повторное использование не копит дубли: прежние эффекты от того же
    // предмета сначала снимаем (если не сказано иное).
    if (cfg.stack !== true) {
      const stale = recipient.effects
        .filter(fx => fx.getFlag(MODULE_ID, "appliedBy") === item?.uuid)
        .map(fx => fx.id);
      if (stale.length) await recipient.deleteEmbeddedDocuments("ActiveEffect", stale);
    }
    if (payload.length) await recipient.createEmbeddedDocuments("ActiveEffect", payload);
  }
}

/**
 * Поставить токены призванного актёра вокруг носителя. Выполняется только
 * там, где есть права на создание токенов (у ведущего — напрямую или по
 * запросу игрока через relay.js).
 *
 * @param {Item|null} item — предмет-источник (в его флагах конфиг)
 * @param {Actor|null} actor — носитель (вокруг его токена ставим)
 * @param {object} [ctx] — контекст для подстановок в имени
 */
async function performSummon(item, actor, ctx = {}) {
  const cfg = readConfig(item ?? actor, "summon");
  const summonActor = await resolveDocument(cfg.actor, game.actors);
  if (!(summonActor instanceof Actor)) {
    return misconfigured("summon", item ?? actor, "OKASSEN.handlers.summonNoActor", { actor: cfg.actor ?? "—" });
  }

  const origin = actor?.getActiveTokens?.(true)[0] ?? actor?.token?.object;
  const scene = origin?.scene ?? canvas.scene;
  if (!scene) return misconfigured("summon", item ?? actor, "OKASSEN.handlers.noScene");

  const grid = scene.grid.size;
  const count = Math.max(1, Math.min(Number(cfg.count) || 1, 12)); // 12 — потолок от опечаток
  const base = await summonActor.getTokenDocument({
    actorLink: false,
    disposition: cfg.disposition ?? CONST.TOKEN_DISPOSITIONS.FRIENDLY
  });

  const docs = [];
  for (let i = 0; i < count; i++) {
    const data = base.toObject();
    delete data._id;
    if (cfg.name) data.name = fillPlaceholders(cfg.name, { item, actor, ...ctx });
    // Раскладываем по кольцу вокруг носителя: по клетке на призванного.
    const angle = (i / count) * Math.PI * 2;
    data.x = Math.round((origin?.document?.x ?? scene.dimensions.sceneX) + Math.cos(angle) * grid * (cfg.distance ?? 1));
    data.y = Math.round((origin?.document?.y ?? scene.dimensions.sceneY) + Math.sin(angle) * grid * (cfg.distance ?? 1));
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.summonedBy`, item?.uuid ?? actor?.uuid ?? null);
    docs.push(data);
  }
  const created = await scene.createEmbeddedDocuments("Token", docs);
  ui.notifications.info(game.i18n.format("OKASSEN.handlers.summoned", {
    count: created.length, name: summonActor.name
  }));
}

/**
 * Действия, которые ведущий выполняет по просьбе игрока. Конфиг и эффекты
 * ведущий берёт ИЗ ПРЕДМЕТА, а не из сообщения: клиент передаёт только
 * ссылки (см. relay.js).
 */
function registerRelayActions() {
  registerRelayAction("applyEffect", async (payload, user, item) => {
    const cfg = readConfig(item, "applyEffect");
    const effects = pickEffects(item, cfg.effect ?? cfg.effects);
    if (!effects.length) return;

    const targets = [];
    for (const uuid of payload.targetUuids ?? []) {
      const doc = await fromUuid(uuid).catch(() => null);
      const target = doc instanceof Actor ? doc : doc?.actor;
      if (target) targets.push(target);
    }
    if (!targets.length) return;

    await applyEffectsTo(targets, item, effects, cfg);
    console.log(`[okassen] Релей: эффекты предмета "${item.name}" наложены по просьбе ${user.name} (целей: ${targets.length})`);
  });

  registerRelayAction("summon", async (payload, user, item) => {
    await performSummon(item, item.actor, {});
    console.log(`[okassen] Релей: призыв от предмета "${item.name}" выполнен по просьбе ${user.name}`);
  });
}

/** Регистрация всех встроенных обработчиков. Вызывается из main.js (init). */
export function initBuiltinHandlers() {
  registerRelayActions();

  /* ---------------------------------------------------------------- */
  /* chatCard — сообщение в чат                                        */
  /* ---------------------------------------------------------------- */
  registerHandler("chatCard", async ctx => {
    const { item, actor } = ctx;
    const cfg = readConfig(item ?? actor, "chatCard");
    if (!cfg.content) return misconfigured("chatCard", item ?? actor, "OKASSEN.handlers.chatCardNoContent");

    const data = {
      speaker: ChatMessage.getSpeaker({ actor }),
      content: fillPlaceholders(cfg.content, ctx)
    };
    if (cfg.flavor) data.flavor = fillPlaceholders(cfg.flavor, ctx);
    // "gm" — шёпот ведущим, true — самому себе.
    if (cfg.whisper === "gm") data.whisper = ChatMessage.getWhisperRecipients("GM").map(u => u.id);
    else if (cfg.whisper === true) data.whisper = [game.user.id];
    await ChatMessage.create(data);
  });

  /* ---------------------------------------------------------------- */
  /* applyEffect — наложить эффект предмета на цели/носителя           */
  /* ---------------------------------------------------------------- */
  registerHandler("applyEffect", async ctx => {
    const { item, actor } = ctx;
    const cfg = readConfig(item ?? actor, "applyEffect");
    const effects = pickEffects(item, cfg.effect ?? cfg.effects);
    if (!effects.length) return misconfigured("applyEffect", item ?? actor, "OKASSEN.handlers.applyEffectNone");

    const recipients = resolveRecipients(cfg, actor);
    if (!recipients.length) return misconfigured("applyEffect", item ?? actor, "OKASSEN.handlers.noTargets");

    // Чужие актёры — через ведущего одним запросом; свои — прямо здесь.
    const mine = recipients.filter(a => a.isOwner);
    const foreign = recipients.filter(a => !a.isOwner);

    await applyEffectsTo(mine, item, effects, cfg);

    if (foreign.length) {
      const sent = requestGM("applyEffect", {
        itemUuid: item?.uuid ?? null,
        targetUuids: foreign.map(a => a.uuid)
      });
      if (!sent) {
        ui.notifications.warn(game.i18n.format("OKASSEN.handlers.noPermission", {
          name: foreign.map(a => a.name).join(", ")
        }));
      }
    }
  });

  /* ---------------------------------------------------------------- */
  /* toggleEffect — переключить эффект носителя или состояние          */
  /* ---------------------------------------------------------------- */
  registerHandler("toggleEffect", async ctx => {
    const { item, actor } = ctx;
    const cfg = readConfig(item ?? actor, "toggleEffect");
    if (!actor) return misconfigured("toggleEffect", item, "OKASSEN.handlers.noActor");

    // Состояние (condition): у актёра dnd5e для этого есть toggleStatusEffect.
    if (cfg.status) {
      await actor.toggleStatusEffect(cfg.status);
      return;
    }
    const fx = pickEffects(item, cfg.effect)[0] ?? item?.effects?.find(e => e.name === cfg.effect);
    if (!fx) return misconfigured("toggleEffect", item ?? actor, "OKASSEN.handlers.effectNotFound", { effect: cfg.effect ?? "—" });
    await fx.update({ disabled: !fx.disabled });
  });

  /* ---------------------------------------------------------------- */
  /* rollTable — бросок по таблице                                     */
  /* ---------------------------------------------------------------- */
  registerHandler("rollTable", async ctx => {
    const { item, actor } = ctx;
    const cfg = readConfig(item ?? actor, "rollTable");
    const table = await resolveDocument(cfg.table, game.tables);
    if (!table) return misconfigured("rollTable", item ?? actor, "OKASSEN.handlers.tableNotFound", { table: cfg.table ?? "—" });

    const options = { rollMode: cfg.rollMode ?? game.settings.get("core", "rollMode") };
    if (cfg.roll) options.roll = new Roll(String(cfg.roll));
    await table.draw(options);
  });

  /* ---------------------------------------------------------------- */
  /* summon — призвать актёра токеном рядом с носителем                */
  /* ---------------------------------------------------------------- */
  registerHandler("summon", async ctx => {
    const { item, actor } = ctx;
    // Токены на сцене создаёт ведущий: у игрока таких прав нет, и Foundry
    // откажет молча. Просим ведущего — он перечитает конфиг сам.
    if (!game.user.isGM) {
      const sent = requestGM("summon", { itemUuid: item?.uuid ?? null });
      if (!sent) ui.notifications.warn(game.i18n.localize("OKASSEN.handlers.summonNeedsGM"));
      return;
    }
    await performSummon(item, actor, ctx);
  });

  /* ---------------------------------------------------------------- */
  /* macro — вызвать макрос с собственными аргументами                 */
  /* ---------------------------------------------------------------- */
  registerHandler("macro", async ctx => {
    const { item, actor } = ctx;
    const cfg = readConfig(item ?? actor, "macro");
    const macro = await resolveDocument(cfg.macro, game.macros);
    if (!(macro instanceof Macro)) {
      return misconfigured("macro", item ?? actor, "OKASSEN.handlers.macroNotFound", { macro: cfg.macro ?? "—" });
    }
    // Аргументы конфига доступны внутри макроса как обычные переменные,
    // рядом с item/actor/trigger из контекста.
    await macro.execute({ ...ctx, ...(cfg.args ?? {}) });
  });
}
