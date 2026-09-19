/**
 * main.js — точка входа модуля Okassen: Better JSON Integration (BJI).
 *
 * Здесь: регистрация хуков, кнопка «Импорт Окассен» в сайдбаре предметов,
 * окно импорта (ApplicationV2 + Handlebars) и публичное API модуля.
 */

import { createForgeItem, createForgeActor, importAny, lastImportOutcome } from "./loader.js";
import { initOnUse, registerHandler, HANDLERS } from "./onuse.js";
import { initNestedHooks } from "./nested.js";
import { MECHANICS, resolveMechanic } from "./mechanics.js";
import { EXAMPLE_ITEM, openGuide, ensureGuideJournal, GUIDE_HTML } from "./guide.js";
import { initJsonEditor } from "./editor.js";
import { buildForgeJson, buildFolderForgeJson, buildPackForgeJson } from "./export.js";
import { migrateWorld, FORMAT_VERSION } from "./migrations.js";
import { initOverTime } from "./overtime.js";
import { initLifecycleHooks, ITEM_HOOKS } from "./lifecycle.js";
import { initTransform } from "./transform.js";
import { analyzeDependencies, midiActive } from "./deps.js";
import { analyzeSchema } from "./schema.js";
import { preprocess } from "./preprocess.js";
import { registerHistorySetting, beginRecord, commitRecord, rollbackImport, buildHistoryHtml } from "./history.js";
import { buildPreviewHtml } from "./preview.js";
import { escapeHtml, itemTypes, actorTypes } from "./util.js";
import { registerSettings, getSetting } from "./settings.js";
import { initBuiltinHandlers } from "./handlers.js";
import { lintForge, findLine } from "./lint.js";
import { initRelay } from "./relay.js";
import { buildSourcesHtml, openSourceDiff, rebuildDocument, rebuildAll, sourceOf } from "./sources.js";

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

/** _forge-ключи, значение которых — id обработчика (onUse + все хуки). */
const HANDLER_KEYS = new Set(["onUse", ...Object.keys(ITEM_HOOKS)]);

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
    position: { width: 860, height: "auto" },
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
      pickFile: OkassenImportDialog.#onPickFile,
      download: OkassenImportDialog.#onDownload,
      copy: OkassenImportDialog.#onCopy,
      historyRefresh: OkassenImportDialog.#onHistoryRefresh,
      handlersRefresh: OkassenImportDialog.#onHandlersRefresh,
      sourcesRefresh: OkassenImportDialog.#onSourcesRefresh,
      rebuildAll: OkassenImportDialog.#onRebuildAll,
      openConfig: OkassenImportDialog.#onOpenConfig
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

  /** Активная вкладка (data-tab). Сохраняется между ре-рендерами не нужно —
   *  окно живёт одним рендером, вкладки переключаются классами. */
  #activeTab = "import";

  /** Таймер отложенной проверки _forge (см. #renderLint). */
  #lintTimer = null;

  /** После рендера — оживляем редактор и наполняем статичные вкладки. */
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

    // Файл(ы) с диска: скрытый input, кнопка «Файл…» его открывает.
    this.element.querySelector(".okassen-file")?.addEventListener("change", async ev => {
      await this.#loadFiles([...ev.target.files]);
      ev.target.value = ""; // тот же файл можно выбрать повторно
    });

    // Перетаскивание: JSON-файл с диска или документ из сайдбара.
    this.#initDragAndDrop();

    // Живая проверка _forge: с задержкой, чтобы не считать на каждую букву.
    const textarea = this.element.querySelector(".okassen-json");
    textarea?.addEventListener("input", () => {
      clearTimeout(this.#lintTimer);
      this.#lintTimer = setTimeout(() => this.#renderLint(), 350);
    });
    this.element.querySelector(".okassen-lint")?.addEventListener("click", ev => {
      const el = ev.target.closest("[data-line]");
      if (el) this.#jumpToLine(Number(el.dataset.line));
    });

    // Кнопки строк «Исходников» создаются динамически — ловим делегатом.
    this.element.querySelector(".okassen-sources-content")?.addEventListener("click", async ev => {
      const diffBtn = ev.target.closest("[data-source-diff]");
      const rebuildBtn = ev.target.closest("[data-source-rebuild]");
      const uuid = diffBtn?.dataset.sourceDiff ?? rebuildBtn?.dataset.sourceRebuild;
      if (!uuid) return;

      const doc = await fromUuid(uuid).catch(() => null);
      if (!doc) {
        ui.notifications.warn(game.i18n.localize("OKASSEN.sources.gone"));
        this.#renderSources();
        return;
      }
      if (diffBtn) return openSourceDiff(doc);

      rebuildBtn.disabled = true;
      beginRecord(game.i18n.format("OKASSEN.sources.rebuildOne", { name: doc.name }));
      try {
        await rebuildDocument(doc);
      } catch (err) {
        ui.notifications.error(err.message);
      } finally {
        await commitRecord();
        this.#renderSources();
      }
    });

    // Руководство — статично, наполняем один раз при рендере.
    const guideBox = this.element.querySelector(".okassen-guide-content");
    if (guideBox) guideBox.innerHTML = GUIDE_HTML;

    // Откат записей истории — делегирование на контейнер (кнопки data-undo
    // создаются динамически в #renderHistory).
    const histBox = this.element.querySelector(".okassen-history-content");
    histBox?.addEventListener("click", async ev => {
      const btn = ev.target.closest("[data-undo]");
      if (!btn) return;
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("OKASSEN.history.undo") },
        content: `<p>${game.i18n.localize("OKASSEN.history.confirm")}</p>`
      });
      if (!ok) return;
      btn.disabled = true;
      try {
        await rollbackImport(btn.dataset.undo);
        this.#renderHistory();
      } catch (err) {
        btn.disabled = false;
        ui.notifications.error(err.message);
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* Вкладки                                                          */
  /* ---------------------------------------------------------------- */

  /** Клик по кнопке вкладки в шапке. */
  static #onTab(_event, target) {
    this.#activateTab(target.dataset.tab);
  }

  /**
   * Переключить активную вкладку: погасить старую секцию/кнопку, зажечь новую
   * и (для динамических вкладок) наполнить контент актуальными данными.
   */
  #activateTab(tab) {
    this.#activeTab = tab;
    for (const btn of this.element.querySelectorAll(".okassen-tab-btn")) {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    }
    for (const sec of this.element.querySelectorAll(".okassen-tab")) {
      sec.classList.toggle("active", sec.dataset.tab === tab);
    }
    if (tab === "preview") this.#renderPreview();
    else if (tab === "history") this.#renderHistory();
    else if (tab === "handlers") this.#renderHandlers();
    else if (tab === "sources") this.#renderSources();
    else if (tab === "settings") this.#renderSettings();
  }

  /**
   * Перетаскивание в окно: JSON-файл с диска или документ из сайдбара
   * (предмет, актёр, папка). Документ сразу экспортируется в редактор —
   * копировать UUID руками больше не нужно.
   *
   * Слушатели вешаются на корень окна с preventDefault: иначе textarea
   * обработает drop сам (вставит путь к файлу), а браузер откроет файл
   * вместо импорта.
   */
  #initDragAndDrop() {
    const root = this.element;
    // Текст подсказки поверх окна рисует CSS (::after), но локализацию он не
    // умеет — отдаём строку переменной. JSON.stringify даёт корректный
    // CSS-литерал строки вместе с кавычками.
    root.style.setProperty("--ok-drop-hint", JSON.stringify(game.i18n.localize("OKASSEN.file.dropHint")));

    const over = ev => {
      if (!ev.dataTransfer) return;
      ev.preventDefault();
      root.classList.add("okassen-dropping");
    };
    root.addEventListener("dragenter", over);
    root.addEventListener("dragover", over);
    root.addEventListener("dragleave", ev => {
      // Уход за пределы окна, а не переход между его элементами.
      if (!root.contains(ev.relatedTarget)) root.classList.remove("okassen-dropping");
    });
    root.addEventListener("drop", async ev => {
      ev.preventDefault();
      root.classList.remove("okassen-dropping");
      await this.#handleDrop(ev);
    });
  }

  /** Разобрать, что именно бросили в окно, и положить это в редактор. */
  async #handleDrop(event) {
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length) return this.#loadFiles(files);

    // Документ из сайдбара: Foundry кладёт в text/plain JSON со ссылкой.
    const raw = event.dataTransfer?.getData("text/plain");
    if (!raw) return;
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return; // обычный текст — пусть его обработает textarea
    }
    const uuid = data?.uuid ?? (data?.type && data?.id ? `${data.type}.${data.id}` : null);
    if (!uuid) return;

    // Бросок на поле «UUID актёра-цели» заполняет именно его: перетащить
    // актёра в цель — самое очевидное действие, и экспорт тут был бы сюрпризом.
    const targetInput = event.target?.closest?.(".okassen-target");
    if (targetInput) {
      targetInput.value = uuid;
      this.#showMessage(game.i18n.format("OKASSEN.import.targetSet", { uuid }), "success");
      return;
    }

    let doc = await fromUuid(uuid).catch(() => null);
    if (doc instanceof TokenDocument) doc = doc.actor;
    try {
      if (doc instanceof Folder) {
        const arr = await buildFolderForgeJson(doc);
        this.#exportDone(arr, game.i18n.format("OKASSEN.export.bulkDone", { count: arr.length, name: doc.name }));
      } else if (doc instanceof Item || doc instanceof Actor) {
        const json = await buildForgeJson(doc);
        this.#exportDone(json, game.i18n.format("OKASSEN.export.done", { name: doc.name }));
      }
    } catch (err) {
      this.#showMessage(err.message);
    }
  }

  /**
   * Прочитать JSON-файлы и положить их в редактор. Несколько файлов
   * сливаются в один массив — это готовый пакетный импорт.
   *
   * @param {File[]} files
   */
  async #loadFiles(files) {
    const json = files.filter(f => /\.json$/i.test(f.name) || (f.type ?? "").includes("json"));
    if (!json.length) {
      if (files.length) this.#showMessage(game.i18n.localize("OKASSEN.file.notJson"));
      return;
    }

    const docs = [];
    for (const file of json) {
      let parsed;
      try {
        parsed = JSON.parse(await file.text());
      } catch (err) {
        this.#showMessage(game.i18n.format("OKASSEN.file.parseError", { file: file.name, message: err.message }));
        return;
      }
      if (Array.isArray(parsed)) docs.push(...parsed);
      else docs.push(parsed);
    }

    this.#setJson(JSON.stringify(docs.length === 1 ? docs[0] : docs, null, 2));
    this.#showMessage(game.i18n.format("OKASSEN.file.loaded", {
      files: json.length,
      docs: docs.length
    }), "success");
    this.#activateTab("import");
  }

  /**
   * Живая проверка _forge под редактором: механики, обработчики, applyTo,
   * состояния, зависимости и неизвестные поля system — списком, с прыжком
   * к нужной строке по клику. Синтаксис JSON остаётся за статус-строкой.
   */
  #renderLint() {
    const box = this.element.querySelector(".okassen-lint");
    if (!box) return;
    const raw = this.element.querySelector(".okassen-json")?.value ?? "";

    if (!getSetting("liveLint") || !raw.trim()) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }

    let parsed;
    try {
      parsed = preprocess(JSON.parse(raw));
    } catch {
      box.hidden = true; // битый JSON — про него уже сказала статус-строка
      return;
    }

    let issues;
    try {
      issues = lintForge(parsed);
    } catch (err) {
      console.error("[okassen] Ошибка проверки _forge:", err);
      box.hidden = true;
      return;
    }

    box.hidden = false;
    if (!issues.length) {
      box.innerHTML = `<p class="okassen-lint-ok">✔ ${game.i18n.localize("OKASSEN.lint.clean")}</p>`;
      return;
    }

    const errors = issues.filter(i => i.level === "error").length;
    const rows = issues.map(issue => {
      const line = findLine(raw, issue.needle);
      const where = line ? `<span class="okassen-lint-line" data-line="${line}">${game.i18n.format("OKASSEN.lint.line", { line })}</span>` : "";
      const icon = issue.level === "error" ? "✖" : "⚠";
      return `<li class="okassen-lint-${issue.level}">${icon} ${escapeHtml(issue.message)} ${where}</li>`;
    }).join("");

    box.innerHTML = `<details class="okassen-lint-details" open>
      <summary>${game.i18n.format("OKASSEN.lint.summary", { errors, warnings: issues.length - errors })}</summary>
      <ul>${rows}</ul>
    </details>`;
  }

  /** Поставить каретку на строку редактора и прокрутить к ней. */
  #jumpToLine(line) {
    const textarea = this.element.querySelector(".okassen-json");
    if (!textarea) return;
    const lines = textarea.value.split("\n");
    if (line < 1 || line > lines.length) return;
    const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
    textarea.focus();
    textarea.setSelectionRange(start, start + lines[line - 1].length);
    // Прокрутка: строка примерно посередине окна редактора.
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 16;
    textarea.scrollTop = Math.max(0, (line - 4) * lineHeight);
  }

  /** Предпросмотр: сухой прогон JSON из редактора → HTML-сводка во вкладке. */
  #renderPreview() {
    const box = this.element.querySelector(".okassen-preview-content");
    if (!box) return;
    const raw = this.element.querySelector(".okassen-json").value;
    if (!raw.trim()) {
      box.innerHTML = `<p class="okassen-tab-empty">${game.i18n.localize("OKASSEN.preview.tabEmpty")}</p>`;
      return;
    }
    let parsed;
    try {
      parsed = preprocess(JSON.parse(raw));
    } catch (err) {
      box.innerHTML = `<p class="okassen-preview-error">✖ ${escapeHtml(err.message)}</p>`;
      return;
    }
    box.innerHTML = buildPreviewHtml(parsed);
  }

  /** История: список записей с кнопками отката (клики ловит делегат в _onRender). */
  #renderHistory() {
    const box = this.element.querySelector(".okassen-history-content");
    if (box) box.innerHTML = buildHistoryHtml();
  }

  /** Обработчики: список onUse/хук-обработчиков и ссылок на них. */
  #renderHandlers() {
    const box = this.element.querySelector(".okassen-handlers-content");
    if (box) box.innerHTML = buildHandlersHtml();
  }

  /** Исходники: документы, содержимое которых разошлось с их JSON. */
  #renderSources() {
    const box = this.element.querySelector(".okassen-sources-content");
    if (box) box.innerHTML = buildSourcesHtml();
  }

  /** Настройки: версия модуля/формата, система и статус зависимостей. */
  #renderSettings() {
    const box = this.element.querySelector(".okassen-settings-content");
    if (!box) return;
    const L = k => game.i18n.localize(k);
    const yes = `<span class="okassen-dep-ok">${L("OKASSEN.settings.active")}</span>`;
    const no = `<span class="okassen-dep-off">${L("OKASSEN.settings.inactive")}</span>`;
    const mod = game.modules.get(MODULE_ID);
    const dae = game.modules.get("dae")?.active;
    const historyCount = game.settings.get(MODULE_ID, "importHistory")?.length ?? 0;

    const row = (label, value) => `<tr><th>${label}</th><td>${value}</td></tr>`;
    const onOff = v => v ? L("OKASSEN.settings.on") : L("OKASSEN.settings.off");
    const dupMode = L(`OKASSEN.cfg.defaultDuplicate.${getSetting("defaultDuplicate")}`);

    box.innerHTML = `
      <table class="okassen-settings-table">
        ${row(L("OKASSEN.settings.version"), escapeHtml(mod?.version ?? "?"))}
        ${row(L("OKASSEN.settings.formatVersion"), escapeHtml(String(FORMAT_VERSION)))}
        ${row(L("OKASSEN.settings.system"), `${escapeHtml(game.system.id)} v${escapeHtml(game.system.version)}`)}
        ${row(L("OKASSEN.settings.core"), escapeHtml(game.version ?? game.data?.version ?? "?"))}
        ${row("midi-qol", midiActive() ? yes : no)}
        ${row("DAE", dae ? yes : no)}
        ${row(L("OKASSEN.settings.historyCount"), String(historyCount))}
      </table>

      <h4 class="okassen-settings-head">${L("OKASSEN.settings.current")}</h4>
      <table class="okassen-settings-table">
        ${row(L("OKASSEN.cfg.defaultDuplicate.name"), escapeHtml(dupMode))}
        ${row(L("OKASSEN.cfg.historyLimit.name"), String(getSetting("historyLimit")))}
        ${row(L("OKASSEN.cfg.nestedDepth.name"), String(getSetting("nestedDepth")))}
        ${row(L("OKASSEN.cfg.schemaWarnings.name"), onOff(getSetting("schemaWarnings")))}
        ${row(L("OKASSEN.cfg.liveLint.name"), onOff(getSetting("liveLint")))}
        ${row(L("OKASSEN.cfg.autoGuide.name"), onOff(getSetting("autoGuide")))}
      </table>
      <p class="okassen-hint okassen-hint-small">${L("OKASSEN.settings.note")}</p>`;
  }

  /** Программно заменить текст в редакторе (событие input обновляет подсветку). */
  #setJson(text) {
    const textarea = this.element.querySelector(".okassen-json");
    textarea.value = text;
    textarea.dispatchEvent(new Event("input")); // подсветка + отложенная проверка
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

    // 3. Анализ зависимостей (midi-qol/DAE) и — если настройка это разрешает —
    //    сверка system со схемой dnd5e. Предупреждения, не ошибки: импорт
    //    продолжается.
    const depWarnings = [
      ...analyzeDependencies(parsed),
      ...(getSetting("schemaWarnings") ? analyzeSchema(parsed) : [])
    ];

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
            // "auto" — ответ из настройки мира, без диалога на каждый
            // элемент пачки (50 вопросов подряд — не помощь).
            const doc = await importAny(entry, { target, folder, pack, onDuplicate: "auto" });
            if (doc) ok.push(doc.name);
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
        // Текст сообщения — по тому, что реально произошло: документ мог
        // быть обновлён на месте, а не создан заново.
        const updated = lastImportOutcome() === "updated";
        const key = doc instanceof Actor
          ? (updated ? "OKASSEN.import.actorUpdated" : "OKASSEN.import.actorSuccess")
          : (updated ? "OKASSEN.import.updated" : "OKASSEN.import.success");
        this.#showMessage(
          OkassenImportDialog.#withWarnings(
            game.i18n.format(key, { name: doc.name }),
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

  /** Кнопка «Файл…»: открыть системный выбор файлов (input скрыт в шаблоне). */
  static #onPickFile(_event, _target) {
    this.element.querySelector(".okassen-file")?.click();
  }

  /** Кнопка «Скачать .json»: сохранить содержимое редактора файлом. */
  static #onDownload(_event, _target) {
    const raw = this.element.querySelector(".okassen-json").value;
    if (!raw.trim()) {
      this.#showMessage(game.i18n.localize("OKASSEN.file.nothingToSave"));
      return;
    }
    // Имя файла — по имени документа, если он разбирается; иначе общее.
    let name = "okassen-export";
    try {
      const parsed = JSON.parse(raw);
      const first = Array.isArray(parsed) ? parsed.find(d => d?.name) : parsed;
      if (first?.name) name = String(first.name).replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 60);
    } catch { /* не разобрали — сохраняем как есть, имя общее */ }

    const save = foundry.utils.saveDataToFile ?? globalThis.saveDataToFile;
    save(raw, "application/json", `${name}.json`);
  }

  /** Кнопка «Копировать»: содержимое редактора в буфер обмена. */
  static async #onCopy(_event, _target) {
    const raw = this.element.querySelector(".okassen-json").value;
    if (!raw.trim()) {
      this.#showMessage(game.i18n.localize("OKASSEN.file.nothingToSave"));
      return;
    }
    try {
      await game.clipboard.copyPlainText(raw);
      this.#showMessage(game.i18n.localize("OKASSEN.file.copied"), "success");
    } catch (err) {
      this.#showMessage(game.i18n.format("OKASSEN.file.copyFailed", { message: err.message }));
    }
  }

  /** Кнопка «Обновить» на вкладке «История»: перечитать журнал импортов. */
  static #onHistoryRefresh(_event, _target) {
    this.#renderHistory();
  }

  /**
   * Кнопка «Настройки модуля»: открыть штатное окно настроек Foundry на
   * вкладке модуля (менять значения удобнее там, где это делают всегда).
   */
  static #onOpenConfig(_event, _target) {
    try {
      game.settings.sheet.render({ force: true });
    } catch (err) {
      console.warn("[okassen] Не удалось открыть окно настроек:", err);
      ui.notifications.warn(game.i18n.localize("OKASSEN.settings.openFailed"));
    }
  }

  /** Кнопка «Обновить» на вкладке «Обработчики»: пересобрать список. */
  static #onHandlersRefresh(_event, _target) {
    this.#renderHandlers();
  }

  /** Кнопка «Обновить» на вкладке «Исходники»: пересчитать расхождения. */
  static #onSourcesRefresh(_event, _target) {
    this.#renderSources();
  }

  /**
   * Кнопка «Пересобрать всё»: каждый документ модуля переимпортируется из
   * своего исходника в режиме «Обновить на месте». Правки, сделанные руками
   * в листах, будут потеряны — поэтому спрашиваем подтверждение, а вся
   * пересборка пишется одной записью истории и откатывается одной кнопкой.
   */
  static async #onRebuildAll(_event, target) {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("OKASSEN.sources.rebuildAll") },
      content: `<p>${game.i18n.localize("OKASSEN.sources.rebuildConfirm")}</p>`
    });
    if (!ok) return;

    target.disabled = true;
    try {
      const { ok: done, failed } = await rebuildAll();
      this.#showMessage(
        game.i18n.format("OKASSEN.sources.rebuildDone", { count: done })
          + (failed.length ? "\n" + failed.join("\n") : ""),
        failed.length ? "error" : "success"
      );
    } finally {
      target.disabled = false;
      this.#renderSources();
    }
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
      this.#exportDone(arr, game.i18n.format("OKASSEN.export.bulkDone", { count: arr.length, name: pack.metadata.label }));
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
      this.#exportDone(arr, game.i18n.format("OKASSEN.export.bulkDone", { count: arr.length, name: doc.name }));
      return;
    }

    if (!(doc instanceof Item) && !(doc instanceof Actor)) {
      this.#exportError(game.i18n.format("OKASSEN.export.notItem", { uuid: uuidStr }));
      return;
    }
    const json = await buildForgeJson(doc);
    this.#exportDone(json, game.i18n.format("OKASSEN.export.done", { name: doc.name }));
  }
}

/**
 * Открыть окно импорта с заранее выбранной папкой-назначением
 * (пункт «Импорт Окассен сюда» в контекстном меню папки сайдбара).
 */
async function openImportInFolder(folder) {
  const dlg = new OkassenImportDialog();
  await dlg.render({ force: true });
  const select = dlg.element.querySelector(".okassen-folder");
  if (select && [...select.options].some(o => o.value === folder.id)) select.value = folder.id;
  return dlg;
}

/** Открыть окно импорта с уже заполненным экспортом документа. */
async function openExportDialog(doc) {
  const dlg = new OkassenImportDialog();
  await dlg.render({ force: true });
  // Папка — массовый экспорт содержимого, документ — один JSON.
  const json = doc instanceof Folder ? await buildFolderForgeJson(doc) : await buildForgeJson(doc);
  const textarea = dlg.element.querySelector(".okassen-json");
  textarea.value = JSON.stringify(json, null, 2);
  textarea.dispatchEvent(new Event("input"));
}

/* ------------------------------------------------------------------ */
/* Хуки                                                                */
/* ------------------------------------------------------------------ */

Hooks.once("init", () => {
  // Настройки регистрируем ПЕРВЫМИ: их читают остальные подсистемы
  // (политика дублей, глубина вложений, лимит истории).
  registerSettings();

  // Регистрируем хуки использования предметов и подкладывания вложенных,
  // встроенный обработчик overTime (урон/лечение по ходам).
  initOnUse();
  initBuiltinHandlers();
  initTransform();
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
  // Канал «сделай за игрока»: действия, требующие прав ведущего
  // (эффект на чужого актёра, токен на сцене). Подписка — на ready,
  // когда game.socket и список пользователей уже готовы.
  initRelay();

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
      rebuildDocument,
      rebuildAll,
      FORMAT_VERSION,
      openImportDialog: () => new OkassenImportDialog().render({ force: true }),
      openGuide
    };
  }

  // Автосоздание журнала-руководства при первом запуске (только ведущий
  // и только если настройка это разрешает).
  if (getSetting("autoGuide")) {
    ensureGuideJournal().catch(err => console.error("[okassen] Не удалось создать журнал-руководство:", err));
  }

  // Миграция контента, созданного старыми версиями формата (только ведущий).
  migrateWorld().catch(err => console.error("[okassen] Ошибка миграции:", err));

  console.log(`[okassen] ready, ${game.system.id} v${game.system.version}`);
  if (game.system.id !== "dnd5e") {
    ui.notifications.warn(game.i18n.localize("OKASSEN.notify.wrongSystem"));
  }
});

/**
 * Кнопка «Импорт Окассен» в шапке сайдбара — и у предметов, и у актёров:
 * НИПы импортируются тем же окном, а искать кнопку во вкладке предметов
 * было неочевидно.
 *
 * В v13 сайдбар — ApplicationV2, hook отдаёт HTMLElement; на всякий случай
 * поддерживаем и jQuery (если другой модуль обернул).
 */
function addDirectoryButton(html) {
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root || root.querySelector(".okassen-import-button")) return; // не дублируем

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
}

Hooks.on("renderItemDirectory", (_app, html) => addDirectoryButton(html));
Hooks.on("renderActorDirectory", (_app, html) => addDirectoryButton(html));

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
  options.push({
    name: "OKASSEN.sources.menu",
    icon: '<i class="fa-solid fa-code-compare"></i>',
    // Пункт есть только у документов, созданных модулем: сравнивать больше
    // не с чем.
    condition: li => !!sourceOf(game.items.get(directoryEntryId(li))),
    callback: async li => {
      const item = game.items.get(directoryEntryId(li));
      if (item) await openSourceDiff(item);
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
  options.push({
    name: "OKASSEN.sources.menu",
    icon: '<i class="fa-solid fa-code-compare"></i>',
    condition: li => !!sourceOf(game.actors.get(directoryEntryId(li))),
    callback: async li => {
      const actor = game.actors.get(directoryEntryId(li));
      if (actor) await openSourceDiff(actor);
    }
  });
});

/**
 * Контекстное меню ПАПКИ: импорт прямо в неё и экспорт всего содержимого.
 *
 * Имя хука в Foundry различается по версиям (getFolderContextOptions в v13+,
 * getItem/ActorDirectoryFolderContext в старых сборках), поэтому
 * подписываемся на все и защищаемся от дублей по имени пункта.
 */
function addFolderContextOptions(options) {
  const has = key => options.some(o => o.name === key);
  const folderOf = li => {
    const el = li instanceof HTMLElement ? li : li?.[0];
    const id = el?.dataset.folderId ?? el?.dataset.entryId;
    const folder = game.folders.get(id);
    return ["Item", "Actor"].includes(folder?.type) ? folder : null;
  };

  if (!has("OKASSEN.folder.importHere")) {
    options.push({
      name: "OKASSEN.folder.importHere",
      icon: '<i class="fa-solid fa-file-import"></i>',
      condition: li => !!folderOf(li),
      callback: async li => {
        const folder = folderOf(li);
        if (folder) await openImportInFolder(folder);
      }
    });
  }
  if (!has("OKASSEN.folder.exportAll")) {
    options.push({
      name: "OKASSEN.folder.exportAll",
      icon: '<i class="fa-solid fa-file-export"></i>',
      condition: li => !!folderOf(li),
      callback: async li => {
        const folder = folderOf(li);
        if (folder) await openExportDialog(folder);
      }
    });
  }
}

for (const hook of ["getFolderContextOptions", "getItemDirectoryFolderContext", "getActorDirectoryFolderContext"]) {
  Hooks.on(hook, (_app, options) => addFolderContextOptions(options));
}
