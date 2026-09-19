/**
 * settings.js — пользовательские настройки модуля (Настройка → Модули → Окассен).
 *
 * До этой версии у модуля не было ни одной настройки с `config: true`:
 * политика дублей, лимит истории и глубина вложений были зашиты в код.
 * Теперь их задаёт ведущий, а код спрашивает значение через getSetting().
 *
 * ВАЖНО: getSetting() безопасен до регистрации (init) — вернёт умолчание,
 * а не бросит исключение. Модули читают настройки и из хуков, которые
 * теоретически могут сработать раньше.
 */

const MODULE_ID = "okassen";

/** Ключ настройки → умолчание. Один источник правды для getSetting(). */
export const DEFAULTS = {
  defaultDuplicate: "ask",   // что делать с дубликатом: ask|update|replace|keep
  historyLimit: 30,          // сколько записей импорта хранить
  nestedDepth: 2,            // максимальная глубина _forge.nested
  schemaWarnings: true,      // предупреждать о неизвестных полях system
  liveLint: true,            // живая проверка _forge в редакторе
  autoGuide: true,           // создавать журнал-руководство при первом запуске
  gmRelay: true              // выполнять действия игроков от имени ведущего
};

/**
 * Прочитать настройку. Если регистрация ещё не прошла (или настройка
 * почему-то отсутствует) — вернуть умолчание из DEFAULTS.
 * @param {keyof DEFAULTS} key
 */
export function getSetting(key) {
  try {
    const value = game.settings.get(MODULE_ID, key);
    return value === undefined ? DEFAULTS[key] : value;
  } catch {
    return DEFAULTS[key];
  }
}

/** Регистрация настроек. Вызывается из main.js на init. */
export function registerSettings() {
  game.settings.register(MODULE_ID, "defaultDuplicate", {
    name: "OKASSEN.cfg.defaultDuplicate.name",
    hint: "OKASSEN.cfg.defaultDuplicate.hint",
    scope: "world",
    config: true,
    type: String,
    default: DEFAULTS.defaultDuplicate,
    choices: {
      ask: "OKASSEN.cfg.defaultDuplicate.ask",
      update: "OKASSEN.cfg.defaultDuplicate.update",
      replace: "OKASSEN.cfg.defaultDuplicate.replace",
      keep: "OKASSEN.cfg.defaultDuplicate.keep"
    }
  });

  game.settings.register(MODULE_ID, "historyLimit", {
    name: "OKASSEN.cfg.historyLimit.name",
    hint: "OKASSEN.cfg.historyLimit.hint",
    scope: "world",
    config: true,
    type: Number,
    default: DEFAULTS.historyLimit,
    range: { min: 5, max: 100, step: 5 }
  });

  game.settings.register(MODULE_ID, "nestedDepth", {
    name: "OKASSEN.cfg.nestedDepth.name",
    hint: "OKASSEN.cfg.nestedDepth.hint",
    scope: "world",
    config: true,
    type: Number,
    default: DEFAULTS.nestedDepth,
    range: { min: 1, max: 3, step: 1 }
  });

  game.settings.register(MODULE_ID, "schemaWarnings", {
    name: "OKASSEN.cfg.schemaWarnings.name",
    hint: "OKASSEN.cfg.schemaWarnings.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: DEFAULTS.schemaWarnings
  });

  game.settings.register(MODULE_ID, "liveLint", {
    name: "OKASSEN.cfg.liveLint.name",
    hint: "OKASSEN.cfg.liveLint.hint",
    scope: "client", // проверка рисуется в окне — это дело клиента, не мира
    config: true,
    type: Boolean,
    default: DEFAULTS.liveLint
  });

  game.settings.register(MODULE_ID, "gmRelay", {
    name: "OKASSEN.cfg.gmRelay.name",
    hint: "OKASSEN.cfg.gmRelay.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: DEFAULTS.gmRelay
  });

  game.settings.register(MODULE_ID, "autoGuide", {
    name: "OKASSEN.cfg.autoGuide.name",
    hint: "OKASSEN.cfg.autoGuide.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: DEFAULTS.autoGuide
  });
}
