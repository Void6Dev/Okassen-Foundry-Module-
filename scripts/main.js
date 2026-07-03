/**
 * main.js — точка входа модуля Okassen: Better JSON Integration (BJI).
 *
 * Здесь: регистрация хуков, кнопка «Импорт Окассен» в сайдбаре предметов,
 * окно импорта (ApplicationV2 + Handlebars) и публичное API модуля.
 */

import { createForgeItem } from "./loader.js";
import { initOnUse, registerHandler, HANDLERS } from "./onuse.js";
import { initNestedHooks } from "./nested.js";
import { MECHANICS, resolveMechanic } from "./mechanics.js";

const MODULE_ID = "okassen";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

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
    position: { width: 620, height: "auto" },
    // Обработчики на data-action (клик по кнопке), НЕ submit формы —
    // так нет конфликтов с поведением <form>.
    actions: {
      create: OkassenImportDialog.#onCreate,
      clear: OkassenImportDialog.#onClear
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/import-dialog.hbs` }
  };

  /** Показать сообщение в самом окне (ошибка/успех), не в консоли. */
  #showMessage(text, type = "error") {
    const box = this.element.querySelector(".okassen-message");
    if (!box) return;
    box.hidden = false;
    box.textContent = text;
    box.classList.toggle("error", type === "error");
    box.classList.toggle("success", type === "success");
  }

  #hideMessage() {
    const box = this.element.querySelector(".okassen-message");
    if (box) box.hidden = true;
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

    // 3. Создание. createForgeItem сам логирует и показывает уведомления;
    //    здесь дублируем текст в окно, чтобы результат был виден на месте.
    try {
      const item = await createForgeItem(parsed, { target });
      this.#showMessage(
        game.i18n.format("OKASSEN.import.success", { name: item.name }),
        "success"
      );
    } catch (err) {
      this.#showMessage(err.message);
    }
  }

  /** Кнопка «Очистить»: сброс полей и сообщения. */
  static #onClear(_event, _target) {
    this.element.querySelector(".okassen-json").value = "";
    this.element.querySelector(".okassen-target").value = "";
    this.#hideMessage();
  }
}

/* ------------------------------------------------------------------ */
/* Хуки                                                                */
/* ------------------------------------------------------------------ */

Hooks.once("init", () => {
  // Регистрируем хуки использования предметов и подкладывания вложенных.
  initOnUse();
  initNestedHooks();
});

Hooks.once("ready", () => {
  // Публичное API: автор кампании регистрирует свои onUse-обработчики
  // и может импортировать предметы из макросов/консоли.
  const mod = game.modules.get(MODULE_ID);
  if (mod) {
    mod.api = {
      createForgeItem,
      registerHandler,
      handlers: HANDLERS,
      MECHANICS,
      resolveMechanic,
      openImportDialog: () => new OkassenImportDialog().render({ force: true })
    };
  }

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
