/**
 * main.js — точка входа модуля Okassen: Better JSON Integration (BJI).
 *
 * Здесь: регистрация хуков, кнопка «Импорт Окассен» в сайдбаре предметов,
 * окно импорта (ApplicationV2 + Handlebars) и публичное API модуля.
 */

import { createForgeItem, createForgeActor, importAny } from "./loader.js";
import { initOnUse, registerHandler, HANDLERS } from "./onuse.js";
import { initNestedHooks } from "./nested.js";
import { MECHANICS, resolveMechanic } from "./mechanics.js";
import { EXAMPLE_ITEM, openGuide, ensureGuideJournal, GUIDE_HTML } from "./guide.js";
import { initJsonEditor } from "./editor.js";
import { buildForgeJson, buildFolderForgeJson, buildPackForgeJson } from "./export.js";
import { migrateWorld, FORMAT_VERSION } from "./migrations.js";
import { initOverTime } from "./overtime.js";
import { initLifecycleHooks } from "./lifecycle.js";
import { analyzeDependencies, midiActive } from "./deps.js";
import { analyzeSchema } from "./schema.js";
import { preprocess } from "./preprocess.js";
import { registerHistorySetting, beginRecord, commitRecord, rollbackImport, buildHistoryHtml } from "./history.js";
import { buildPreviewHtml } from "./preview.js";
import { escapeHtml, itemTypes, actorTypes } from "./util.js";

const MODULE_ID = "okassen";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Локализованное описание механики (см. lang/*.json, ключи OKASSEN.mech.*
 * с дефисами вместо точек) или "" — для подсказок и тултипов.
 * Генерируемые семейства (ability.str, skill.acr.bonus...) описываются
 * шаблонами OKASSEN.mechPattern.* с локализованным названием из CONFIG.DND5E.
 */
function mechanicDescription(name) {
  const key = `OKASSEN.mech.${name.replaceAll(".", "-")}`;
  if (game.i18n.has(key)) return game.i18n.localize(key);

  const cfgLabel = (config, k) => {
    const entry = config?.[k];
    const label = typeof entry === "object" ? entry?.label : entry;
    return label ? game.i18n.localize(label) : null;
  };

  let m;
  if ((m = /^ability\.(\w+)$/.exec(name))) {
    const label = cfgLabel(CONFIG.DND5E?.abilities, m[1]);
    if (label) return game.i18n.format("OKASSEN.mechPattern.ability", { label });
  }
  if ((m = /^(save|check)\.(\w+)\.bonus$/.exec(name))) {
    const label = cfgLabel(CONFIG.DND5E?.abilities, m[2]);
    if (label) return game.i18n.format(`OKASSEN.mechPattern.${m[1]}`, { label });
  }
  if ((m = /^skill\.(\w+)\.bonus$/.exec(name))) {
    const label = cfgLabel(CONFIG.DND5E?.skills, m[1]);
    if (label) return game.i18n.format("OKASSEN.mechPattern.skill", { label });
  }
  return "";
}

/** Технический хвост механики: реальные ключи и режимы AE. */
function mechanicKeys(def) {
  const modeNames = Object.fromEntries(
    Object.entries(CONST.ACTIVE_EFFECT_MODES).map(([k, v]) => [v, k])
  );
  const defs = Array.isArray(def) ? def : [def];
  return defs
    .map(d => d.special ? d.special : `${d.key} (${modeNames[d.mode] ?? d.mode})`)
    .join(", ");
}

/**
 * Часто используемые midi-суффиксы преимущества/помехи — подсказываются,
 * только когда midi-qol активен (без него resolveMechanic честно откажет).
 * Это ПОДСКАЗКИ, не белый список: принимается любой суффикс flags.midi-qol.
 */
const MIDI_ADVANTAGE_SUFFIXES = [
  "all", "attack.all", "attack.mwak", "attack.rwak", "attack.msak", "attack.rsak",
  "ability.save.all", "ability.check.all", "skill.all", "deathSave", "concentration"
];

/** Подсказки для "mechanic": имя + локализованное описание (или ключи). */
function mechanicCompletions() {
  const items = Object.entries(MECHANICS)
    .map(([label, def]) => ({ label, detail: mechanicDescription(label) || mechanicKeys(def) }));

  if (midiActive()) {
    for (const kind of ["advantage", "disadvantage"]) {
      for (const suffix of MIDI_ADVANTAGE_SUFFIXES) {
        items.push({ label: `${kind}.${suffix}`, detail: `flags.midi-qol.${kind}.${suffix}` });
      }
    }
  }
  return items.sort((a, b) => a.label.localeCompare(b.label));
}

/** Подсказки из словаря CONFIG.DND5E.* ({ключ: {label} | строка}). */
function configCompletions(config) {
  const text = v => {
    if (typeof v === "string") return game.i18n.localize(v);
    if (v && typeof v === "object" && v.label) return game.i18n.localize(v.label);
    return "";
  };
  return Object.entries(config ?? {})
    .map(([label, v]) => ({ label, detail: text(v) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Подсказки-обработчики: реестр API + скрипт-макросы "okassen:<id>". */
function handlerCompletions() {
  const items = new Map();
  for (const id of HANDLERS.keys()) items.set(id, "API");
  for (const macro of game.macros) {
    if (macro.name.startsWith("okassen:") && macro.type === "script") {
      items.set(macro.name.slice(8), game.i18n.localize("DOCUMENT.Macro"));
    }
  }
  return [...items.entries()]
    .map(([label, detail]) => ({ label, detail }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** _forge-ключи, значение которых — id обработчика. */
const HANDLER_KEYS = new Set(
  ["onUse", "onEquip", "onUnequip", "onCreate", "onDelete", "onTurnStart", "onTurnEnd"]
);

/**
 * Резолвер автодополнения для редактора: по ключу, значение которого
 * редактируется, возвращает список подсказок (или null — подсказок нет).
 * @param {{key: string, prefix: string, before: string}} ctx
 */
function completionResolver(ctx) {
  if (HANDLER_KEYS.has(ctx.key)) return handlerCompletions();

  switch (ctx.key) {
    case "mechanic":
      return mechanicCompletions();

    // Поля overTime-записей.
    case "turn":
      return [
        { label: "start", detail: game.i18n.localize("OKASSEN.editor.turnStart") },
        { label: "end", detail: game.i18n.localize("OKASSEN.editor.turnEnd") }
      ];
    case "save":
      return configCompletions(CONFIG.DND5E?.abilities);

    // "type": внутри change-объекта (рядом виден "mechanic") — тип урона;
    // на верхнем уровне документа — тип предмета/актёра.
    case "type": {
      if (/"mechanic"\s*:[^{}]*$/.test(ctx.before)) {
        return configCompletions(CONFIG.DND5E?.damageTypes);
      }
      const types = [...new Set([...itemTypes(), ...actorTypes()])].sort();
      return types.map(label => ({ label, detail: "" }));
    }

    // "value": для механик-множеств подсказываем допустимые ключи словаря
    // (типы урона, состояния, инструменты...) по ближайшему "mechanic" выше.
    case "value": {
      const m = [...ctx.before.matchAll(/"mechanic"\s*:\s*"([^"]+)"/g)].pop();
      if (!m) return null;
      const def = MECHANICS[m[1]];
      const single = Array.isArray(def) ? null : def;
      if (single?.set) return configCompletions(CONFIG.DND5E?.[single.set]);
      return null;
    }
  }
  return null;
}

/**
 * Подсказка-тултип в статус-строке: описание механики, в значении которой
 * стоит каретка (когда имя набрано полностью и есть в словаре).
 */
function editorHint(ctx) {
  if (!ctx) return "";
  let name = null;
  if (ctx.key === "mechanic" && MECHANICS[ctx.prefix]) name = ctx.prefix;
  if (!name) return "";
  const desc = mechanicDescription(name);
  const keys = mechanicKeys(MECHANICS[name]);
  return desc ? `${name} — ${desc} [${keys}]` : `${name} → ${keys}`;
}

/**
 * Браузер обработчиков: все зарегистрированные onUse/хук-обработчики
 * (API + макросы "okassen:<id>") и документы мира, которые на них ссылаются.
 * Ссылки на НЕзарегистрированные id тоже видны — это и есть самое ценное:
 * сразу видно, у какого предмета логика молча не сработает.
 */
function buildHandlersHtml() {
  const esc = s => escapeHtml(s);
  const handlers = new Map(); // id → { sources: string[], refs: string[] }
  const entry = id => {
    if (!handlers.has(id)) handlers.set(id, { sources: [], refs: [] });
    return handlers.get(id);
  };

  for (const id of HANDLERS.keys()) entry(id).sources.push("API");
  for (const macro of game.macros) {
    if (macro.type === "script" && macro.name.startsWith("okassen:")) {
      entry(macro.name.slice(8)).sources.push(game.i18n.localize("OKASSEN.handlers.macro"));
    }
  }

  // Документы, ссылающиеся на обработчики (onUse + хуки жизненного цикла).
  const collect = (doc, place) => {
    const flags = doc.flags?.[MODULE_ID];
    if (!flags) return;
    const ids = [flags.onUse, ...Object.values(flags.hooks ?? {})]
      .filter(v => typeof v === "string" && v);
    for (const id of ids) entry(id).refs.push(place);
  };
  for (const item of game.items) collect(item, item.name);
  for (const actor of game.actors) {
    collect(actor, actor.name);
    for (const item of actor.items) collect(item, `${actor.name} → ${item.name}`);
  }

  const rows = [...handlers.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, info]) => {
      const source = info.sources.length
        ? `<span class="okassen-handler-src">${esc(info.sources.join(" + "))}</span>`
        : `<span class="okassen-handler-missing">${game.i18n.localize("OKASSEN.handlers.unregistered")}</span>`;
      const refs = info.refs.length
        ? esc(info.refs.slice(0, 6).join(", ")) + (info.refs.length > 6 ? ` (+${info.refs.length - 6})` : "")
        : `<em>${game.i18n.localize("OKASSEN.handlers.noRefs")}</em>`;
      return `<li class="okassen-handler-row">
        <div><code>${esc(id)}</code> ${source}</div>
        <div class="okassen-handler-refs">${refs}</div>
      </li>`;
    }).join("");

  return handlers.size
    ? `<p class="okassen-preview-note">${game.i18n.localize("OKASSEN.handlers.hint")}</p>
       <ul class="okassen-handler-list">${rows}</ul>`
    : `<p>${game.i18n.localize("OKASSEN.handlers.empty")}</p>`;
}

/**
 * Окно импорта: textarea для JSON, необязательный UUID актёра-цели,
 * кнопки «Создать» и «Очистить».
 *
 * Окно НЕ закрывается после успешного импорта — можно вставлять несколько
 * предметов подряд. Ошибки парсинга/валидации показываются прямо в окне.
 */
class OkassenImportDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "okassen-import",
    classes: ["okassen-import"],
    tag: "div",
    window: {
      title: "OKASSEN.import.title", // ApplicationV2 локализует сам
      icon: "fa-solid fa-file-import",
      resizable: true
    },
    position: { width: 780, height: "auto" },
    // Обработчики на data-action (клик по кнопке), НЕ submit формы —
    // так нет конфликтов с поведением <form>.
    actions: {
      tab: OkassenImportDialog.#onTab,
      create: OkassenImportDialog.#onCreate,
      clear: OkassenImportDialog.#onClear,
      example: OkassenImportDialog.#onExample,
      guide: OkassenImportDialog.#onGuide,
      format: OkassenImportDialog.#onFormat,
      export: OkassenImportDialog.#onExport,
      preview: OkassenImportDialog.#onPreview,
      fromUrl: OkassenImportDialog.#onFromUrl,
      historyRefresh: OkassenImportDialog.#onHistoryRefresh,
      handlersRefresh: OkassenImportDialog.#onHandlersRefresh
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/import-dialog.hbs` }
  };

  /** Данные для шаблона: списки папок предметов и актёров (с полным путём). */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    // «Родитель / Ребёнок» — чтобы вложенные папки были различимы в списке.
    const path = f => {
      const parts = [f.name];
      let p = f.folder;
      while (p) { parts.unshift(p.name); p = p.folder; }
      return parts.join(" / ");
    };
    const list = type => game.folders
      .filter(f => f.type === type)
      .map(f => ({ id: f.id, name: path(f) }))
      .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
    context.folders = { items: list("Item"), actors: list("Actor") };

    // Компендиумы предметов и актёров (запертые видны, но выключены).
    const packs = type => game.packs
      .filter(p => p.documentName === type)
      .map(p => ({
        id: p.collection,
        name: `${p.metadata.label} (${p.collection})`,
        locked: p.locked
      }))
      .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
    context.packs = { items: packs("Item"), actors: packs("Actor") };
    return context;
  }

  /** Активная вкладка окна (import/export/tools) — переживает ре-рендер. */
  #activeTab = "import";

  /** После рендера — оживляем редактор (номера строк, подсветка, Tab/Enter). */
  _onRender(context, options) {
    super._onRender(context, options);
    initJsonEditor(
      this.element.querySelector(".okassen-editor"),
      this.element.querySelector(".okassen-status-text"),
      {
        completions: completionResolver,
        hint: editorHint,
        hintEl: this.element.querySelector(".okassen-hint-line")
      }
    );
    // Восстанавливаем выбранную вкладку (после первого рендера — «import»).
    this.#activateTab(this.#activeTab);
  }

  /** Кнопка-вкладка: переключиться на неё. */
  static #onTab(_event, target) {
    this.#activateTab(target.dataset.tab);
  }

  /** Показать одну вкладку, спрятать остальные; подсветить её в nav. */
  #activateTab(name) {
    this.#activeTab = name;
    for (const el of this.element.querySelectorAll(".okassen-tabs .item")) {
      el.classList.toggle("active", el.dataset.tab === name);
    }
    for (const el of this.element.querySelectorAll(".okassen-tab")) {
      el.classList.toggle("active", el.dataset.tab === name);
    }
  }

  /** Программно заменить текст в редакторе (событие input обновляет подсветку). */
  #setJson(text) {
    const textarea = this.element.querySelector(".okassen-json");
    textarea.value = text;
    textarea.dispatchEvent(new Event("input"));
  }

  /**
   * Показать сообщение в самом окне (ошибка/успех/нейтральное), не в консоли.
   * По умолчанию — бокс вкладки «Импорт»; selector позволяет адресовать
   * другой бокс (например, `.okassen-export-msg` на вкладке «Экспорт»).
   */
  #showMessage(text, type = "error", selector = ".okassen-message:not(.okassen-export-msg)") {
    const box = this.element.querySelector(selector);
    if (!box) return;
    box.hidden = false;
    box.textContent = text;
    box.classList.toggle("error", type === "error");
    box.classList.toggle("success", type === "success");
  }

  #hideMessage(selector = ".okassen-message:not(.okassen-export-msg)") {
    const box = this.element.querySelector(selector);
    if (box) box.hidden = true;
  }

  /**
   * Приклеить к сообщению предупреждения о зависимостях/схеме (если есть).
   * Предупреждения не меняют тип сообщения: импорт состоялся, но автору
   * стоит знать, что часть механик молча не сработает.
   */
  static #withWarnings(msg, warnings) {
    if (!warnings?.length) return msg;
    return msg + "\n\n" + warnings.map(w => `⚠ ${w}`).join("\n");
  }

  /** Кнопка «Создать»: парсинг → цель → createForgeItem. */
  static async #onCreate(_event, _target) {
    // В actions ApplicationV2 `this` — экземпляр приложения.
    this.#hideMessage();
    const textarea = this.element.querySelector(".okassen-json");
    const targetInput = this.element.querySelector(".okassen-target");

    // 1. Парсинг JSON: ошибку показываем в окне, не в консоли.
    let parsed;
    try {
      parsed = JSON.parse(textarea.value);
    } catch (err) {
      this.#showMessage(game.i18n.format("OKASSEN.import.parseError", { message: err.message }));
      return;
    }

    // 1а. Препроцессор: сниппеты _defs/$ref и плейсхолдеры _vars/{{…}}.
    try {
      parsed = preprocess(parsed);
    } catch (err) {
      this.#showMessage(err.message);
      return;
    }

    // 2. Актёр-цель (пусто = создать в мире).
    let target = null;
    const uuidStr = targetInput.value.trim();
    if (uuidStr) {
      const doc = await fromUuid(uuidStr).catch(() => null);
      // Разрешаем и uuid токена — берём его актёра.
      target = doc instanceof Actor ? doc : (doc?.actor ?? null);
      if (!target) {
        this.#showMessage(game.i18n.format("OKASSEN.import.targetNotFound", { uuid: uuidStr }));
        return;
      }
    }

    // 3. Анализ зависимостей (midi-qol/DAE) и сверка system со схемой dnd5e.
    //    Предупреждения, не ошибки — импорт продолжается.
    const depWarnings = [...analyzeDependencies(parsed), ...analyzeSchema(parsed)];

    // 4. Создание. Массив = пакетный импорт: ошибка в одном предмете
    //    не прерывает остальные, в конце — сводка.
    // Папка и компендиум из выпадающих списков (пусто = корень/мир).
    const folder = this.element.querySelector(".okassen-folder")?.value || null;
    const pack = this.element.querySelector(".okassen-pack")?.value || null;

    // Весь импорт (включая вложенные и предметы актёров) пишется в историю —
    // кнопка «История» откатит его одной кнопкой.
    beginRecord(Array.isArray(parsed)
      ? game.i18n.format("OKASSEN.history.batchLabel", { count: parsed.length })
      : (parsed?.name ?? "?"));
    try {
      if (Array.isArray(parsed)) {
        const ok = [];
        const failed = [];
        for (const [i, entry] of parsed.entries()) {
          try {
            const doc = await importAny(entry, { target, folder, pack });
            ok.push(doc.name);
          } catch (err) {
            failed.push(`#${i + 1} (${entry?.name ?? "?"}): ${err.message}`);
          }
        }
        let msg = game.i18n.format("OKASSEN.import.batchResult", {
          ok: ok.length,
          total: parsed.length
        });
        if (failed.length) msg += "\n" + failed.join("\n");
        this.#showMessage(
          OkassenImportDialog.#withWarnings(msg, depWarnings),
          failed.length ? "error" : "success"
        );
        return;
      }

      // Одиночный документ (предмет или актёр — importAny разберётся).
      // Ядро само логирует и показывает уведомления; здесь дублируем текст
      // в окно, чтобы результат был виден на месте. При дубликате предмета
      // ядро спросит: заменить / копия / отмена (onDuplicate: "ask").
      try {
        const doc = await importAny(parsed, { target, folder, pack, onDuplicate: "ask" });
        if (doc === null) {
          // Пользователь отменил в диалоге дубликата.
          this.#showMessage(game.i18n.localize("OKASSEN.import.cancelled"), "info");
          return;
        }
        this.#showMessage(
          OkassenImportDialog.#withWarnings(
            game.i18n.format(
              doc instanceof Actor ? "OKASSEN.import.actorSuccess" : "OKASSEN.import.success",
              { name: doc.name }
            ),
            depWarnings
          ),
          "success"
        );
      } catch (err) {
        this.#showMessage(err.message);
      }
    } finally {
      // Частичный импорт тоже должен быть откатываемым.
      await commitRecord();
    }
  }

  /** Кнопка «Обновить» на вкладке «История»: перечитать журнал импортов. */
  static #onHistoryRefresh(_event, _target) {
    this.#renderHistory();
  }

  /** Кнопка «Обновить» на вкладке «Обработчики»: пересобрать список. */
  static #onHandlersRefresh(_event, _target) {
    this.#renderHandlers();
  }

  /**
   * Кнопка «Из URL»: скачать JSON по ссылке (gist raw и т.п.) и подставить
   * в редактор. НИЧЕГО не импортирует само — что приехало, видно в редакторе,
   * дальше обычные «Предпросмотр»/«Создать».
   */
  static async #onFromUrl(_event, _target) {
    this.#hideMessage();
    const url = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("OKASSEN.url.title"), icon: "fa-solid fa-link" },
      position: { width: 480 },
      content: `<p>${game.i18n.localize("OKASSEN.url.hint")}</p>
        <input type="text" name="url" placeholder="https://gist.githubusercontent.com/.../raw/items.json" autofocus>`,
      ok: {
        label: "OKASSEN.url.load",
        icon: "fa-solid fa-download",
        callback: (_ev, button) => button.form.elements.url.value.trim()
      },
      rejectClose: false
    });
    if (!url) return;

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const text = await response.text();
      JSON.parse(text); // проверка ДО подстановки: мусор в редактор не тащим
      this.#setJson(text);
      this.#activateTab("import"); // редактор — на вкладке «Импорт»
      this.#showMessage(game.i18n.format("OKASSEN.url.done", { url }), "success");
    } catch (err) {
      // Типичная причина — CORS: сервер не отдаёт файл браузеру напрямую.
      this.#showMessage(game.i18n.format("OKASSEN.url.error", { message: err.message }));
    }
  }

  /**
   * Кнопка «Прогнать» на вкладке «Предпросмотр»: сухой прогон JSON из
   * редактора — сводка рисуется прямо во вкладке, БЕЗ создания документов.
   */
  static #onPreview(_event, _target) {
    this.#renderPreview();
  }

  /** Кнопка «Очистить»: сброс полей и сообщения. */
  static #onClear(_event, _target) {
    this.#setJson("");
    this.element.querySelector(".okassen-target").value = "";
    this.#hideMessage();
  }

  /** Кнопка «Пример»: подставить демонстрационный JSON в поле ввода. */
  static #onExample(_event, _target) {
    this.#setJson(JSON.stringify(EXAMPLE_ITEM, null, 2));
    this.#hideMessage();
  }

  /** Кнопка «Руководство»: открыть журнал с гайдом (создать, если удалён). */
  static async #onGuide(_event, _target) {
    await openGuide();
  }

  /** Кнопка «Формат»: распарсить и переотформатировать JSON с отступами. */
  static #onFormat(_event, _target) {
    const textarea = this.element.querySelector(".okassen-json");
    if (!textarea.value.trim()) return;
    let parsed;
    try {
      parsed = JSON.parse(textarea.value);
    } catch (err) {
      this.#showMessage(game.i18n.format("OKASSEN.import.parseError", { message: err.message }));
      return;
    }
    this.#setJson(JSON.stringify(parsed, null, 2));
    this.#hideMessage();
  }

  /** Ошибка экспорта — в бокс вкладки «Экспорт» (остаёмся на ней). */
  #exportError(text) {
    this.#showMessage(text, "error", ".okassen-export-msg");
  }

  /**
   * Успех экспорта: положить JSON в редактор «Импорта», сообщить там же
   * и переключиться на вкладку «Импорт» — результат сразу перед глазами.
   */
  #exportDone(json, message) {
    this.#hideMessage(".okassen-export-msg");
    this.#setJson(JSON.stringify(json, null, 2));
    this.#showMessage(message, "success");
    this.#activateTab("import");
  }

  /**
   * Кнопка «Экспорт» (вкладка «Экспорт»). Поле UUID принимает:
   *  - UUID предмета/актёра (в т.ч. из компендиума: Compendium.xxx) — один JSON;
   *  - UUID папки сайдбара (Folder.xxx) — вся папка с подпапками, массивом;
   *  - id компендиума ("world.my-items") — весь пак, массивом.
   * Результат кладётся в редактор вкладки «Импорт».
   */
  static async #onExport(_event, _target) {
    // Экспорт берёт UUID из собственного поля на вкладке «Экспорт».
    const uuidStr = this.element.querySelector(".okassen-export-uuid").value.trim();
    if (!uuidStr) {
      this.#exportError(game.i18n.localize("OKASSEN.export.needUuid"));
      return;
    }

    // id компендиума — массовый экспорт пака.
    const pack = game.packs.get(uuidStr);
    if (pack) {
      if (!["Item", "Actor"].includes(pack.documentName)) {
        this.#exportError(game.i18n.format("OKASSEN.export.packBadType", { pack: uuidStr }));
        return;
      }
      const arr = await buildPackForgeJson(pack);
      this.#setJson(JSON.stringify(arr, null, 2));
      this.#activateTab("import");
      this.#showMessage(game.i18n.format("OKASSEN.export.bulkDone", { count: arr.length, name: pack.metadata.label }), "success");
      return;
    }

    let doc = await fromUuid(uuidStr).catch(() => null);
    // UUID токена → его актёр.
    if (doc instanceof TokenDocument) doc = doc.actor;

    // Папка сайдбара — массовый экспорт содержимого.
    if (doc instanceof Folder) {
      if (!["Item", "Actor"].includes(doc.type)) {
        this.#exportError(game.i18n.format("OKASSEN.export.folderBadType", { name: doc.name }));
        return;
      }
      const arr = await buildFolderForgeJson(doc);
      this.#setJson(JSON.stringify(arr, null, 2));
      this.#activateTab("import");
      this.#showMessage(game.i18n.format("OKASSEN.export.bulkDone", { count: arr.length, name: doc.name }), "success");
      return;
    }

    if (!(doc instanceof Item) && !(doc instanceof Actor)) {
      this.#exportError(game.i18n.format("OKASSEN.export.notItem", { uuid: uuidStr }));
      return;
    }
    const json = await buildForgeJson(doc);
    this.#setJson(JSON.stringify(json, null, 2));
    this.#activateTab("import");
    this.#showMessage(game.i18n.format("OKASSEN.export.done", { name: doc.name }), "success");
  }
}

/** Открыть окно импорта с уже заполненным экспортом документа. */
async function openExportDialog(doc) {
  const dlg = new OkassenImportDialog();
  await dlg.render({ force: true });
  const json = await buildForgeJson(doc);
  const textarea = dlg.element.querySelector(".okassen-json");
  textarea.value = JSON.stringify(json, null, 2);
  textarea.dispatchEvent(new Event("input"));
}

/* ------------------------------------------------------------------ */
/* Хуки                                                                */
/* ------------------------------------------------------------------ */

Hooks.once("init", () => {
  // Регистрируем хуки использования предметов и подкладывания вложенных,
  // встроенный обработчик overTime (урон/лечение по ходам).
  initOnUse();
  initNestedHooks();
  initOverTime();
  initLifecycleHooks();

  // История импорта (мировая настройка для отката).
  registerHistorySetting();

  // Служебная настройка: журнал-руководство создаётся только один раз за мир,
  // чтобы не возвращать его тому, кто удалил журнал намеренно.
  game.settings.register(MODULE_ID, "guideCreated", {
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });
});

Hooks.once("ready", () => {
  // Публичное API: автор кампании регистрирует свои onUse-обработчики
  // и может импортировать предметы из макросов/консоли.
  const mod = game.modules.get(MODULE_ID);
  if (mod) {
    mod.api = {
      createForgeItem,
      createForgeActor,
      importAny,
      preprocess,
      analyzeDependencies,
      analyzeSchema,
      registerHandler,
      handlers: HANDLERS,
      MECHANICS,
      resolveMechanic,
      buildForgeJson,
      rollbackImport,
      FORMAT_VERSION,
      openImportDialog: () => new OkassenImportDialog().render({ force: true }),
      openGuide
    };
  }

  // Автосоздание журнала-руководства при первом запуске (только ведущий).
  ensureGuideJournal().catch(err => console.error("[okassen] Не удалось создать журнал-руководство:", err));

  // Миграция контента, созданного старыми версиями формата (только ведущий).
  migrateWorld().catch(err => console.error("[okassen] Ошибка миграции:", err));

  console.log(`[okassen] ready, ${game.system.id} v${game.system.version}`);
  if (game.system.id !== "dnd5e") {
    ui.notifications.warn(game.i18n.localize("OKASSEN.notify.wrongSystem"));
  }
});

/**
 * Кнопка «Импорт Окассен» в шапке сайдбара предметов.
 * В v13 сайдбар — ApplicationV2, hook отдаёт HTMLElement; на всякий случай
 * поддерживаем и jQuery (если другой модуль обернул).
 */
Hooks.on("renderItemDirectory", (_app, html) => {
  const root = html instanceof HTMLElement ? html : html[0];
  if (root.querySelector(".okassen-import-button")) return; // не дублируем при ре-рендере

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "okassen-import-button";
  btn.innerHTML = `<i class="fa-solid fa-file-import"></i> ${game.i18n.localize("OKASSEN.import.button")}`;
  btn.addEventListener("click", () => new OkassenImportDialog().render({ force: true }));

  // В v13 у директории есть блок действий в шапке; fallback — сама шапка.
  const anchor = root.querySelector(".header-actions")
    ?? root.querySelector(".directory-header")
    ?? root;
  anchor.appendChild(btn);
});

/**
 * Пункт «Экспорт Окассен (JSON)» в контекстном меню сайдбара.
 *
 * В Foundry 14 / dnd5e 5.x хуки контекстного меню директорий переименованы:
 * getItem/ActorDirectoryEntryContext → getItem/ActorContextOptions,
 * сигнатура (application, entryOptions). Коллбэк пункта получает элемент
 * записи (HTMLElement) с data-entry-id. // verified against dnd5e 5.3.3
 */
function directoryEntryId(li) {
  const el = li instanceof HTMLElement ? li : li?.[0];
  return el?.dataset.entryId ?? el?.dataset.documentId;
}

Hooks.on("getItemContextOptions", (_app, options) => {
  options.push({
    name: "OKASSEN.export.menu",
    icon: '<i class="fa-solid fa-file-export"></i>',
    callback: async li => {
      const item = game.items.get(directoryEntryId(li));
      if (item) await openExportDialog(item);
    }
  });
});

/** То же для актёров: «Экспорт Окассен (JSON)» в контекстном меню НИПа. */
Hooks.on("getActorContextOptions", (_app, options) => {
  options.push({
    name: "OKASSEN.export.menu",
    icon: '<i class="fa-solid fa-file-export"></i>',
    callback: async li => {
      const actor = game.actors.get(directoryEntryId(li));
      if (actor) await openExportDialog(actor);
    }
  });
});
