/**
 * editor.js — лёгкий JSON-редактор поверх <textarea>, без внешних библиотек.
 *
 * Возможности «как в IDE»:
 *  - номера строк (гаттер слева, синхронизирован со скроллом);
 *  - подсветка синтаксиса JSON (ключи, строки, числа, литералы, пунктуация);
 *  - подсветка ПАРНЫХ скобок у курсора: {} [] ();
 *  - Tab = отступ (2 пробела), Shift+Tab = убрать отступ, работает и для
 *    выделенного блока строк;
 *  - Enter = автоотступ (наследует отступ строки; после открывающей скобки
 *    добавляет уровень; между парой скобок раздвигает их на три строки);
 *  - контекстное автодополнение внутри строк-значений: редактор определяет
 *    КЛЮЧ, значение которого редактируется ("mechanic", "value", "type",
 *    "onUse", ...), и спрашивает подсказки у резолвера (options.completions);
 *  - строка-подсказка (options.hint) — описание механики под курсором;
 *  - живая валидация JSON в статус-строке (с дебаунсом).
 *
 * Приём: под прозрачным textarea лежит <pre> с раскрашенной копией текста.
 * Textarea принимает ввод и рисует каретку, pre — цвета.
 *
 * ПРОИЗВОДИТЕЛЬНОСТЬ (важно для документов на тысячи строк):
 *  - рендерится ТОЛЬКО ВИДИМОЕ окно строк (+запас OVERSCAN сверху/снизу),
 *    а не весь документ — innerHTML на десятки строк вместо тысяч;
 *  - слой подсветки и гаттер позиционируются transform'ом по scrollTop;
 *  - все события схлопываются в одну перерисовку за кадр (rAF);
 *  - JSON.parse для статус-строки — с дебаунсом, а не на каждый символ;
 *  - парная скобка ищется ЛЕНИВО только для скобки под кареткой, расходясь
 *    от неё построчно (JSON-строки не переносятся, поэтому состояние
 *    «внутри строки» в начале каждой строки известно) — никакого полного
 *    прохода по документу при каждой правке.
 */

const INDENT = "  ";   // единица отступа — два пробела
const LINE_H = 18;     // высота строки, px — ДОЛЖНА совпадать с line-height в CSS
const PAD = 8;         // паддинг редактора, px — должен совпадать с CSS
const OVERSCAN = 12;   // запас строк сверху/снизу видимого окна
const STATUS_DELAY = 250; // дебаунс живой валидации, мс

const OPENERS = { "{": "}", "[": "]", "(": ")" };
const CLOSERS = { "}": "{", "]": "[", ")": "(" };

/** Экранировать HTML-спецсимволы. */
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Позиции скобок ВНЕ строк-литералов в одной строке текста.
 * JSON-строки не переносятся, поэтому состояние «внутри строки» в начале
 * каждой строки всегда false — строки документа независимы.
 *
 * @param {string} lineText — текст строки (без \n)
 * @param {number} base — смещение начала строки в документе
 * @returns {Array<{ch: string, pos: number}>}
 */
function bracketsInLine(lineText, base) {
  const out = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch in OPENERS || ch in CLOSERS) out.push({ ch, pos: base + i });
  }
  return out;
}

/**
 * Раскрасить фрагмент текста в HTML. matchA/matchB — позиции подсвечиваемых
 * скобок ОТНОСИТЕЛЬНО ФРАГМЕНТА (или отрицательные, если вне его).
 * JSON-строки не пересекают границы строк текста, поэтому фрагмент из целых
 * строк токенизируется так же, как весь документ.
 */
function highlightHtml(text, matchA, matchB) {
  const re = /"(?:[^"\\\n]|\\.)*"?|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[{}\[\]()]|[:,]/g;
  let html = "";
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    html += escapeHtml(text.slice(last, m.index)); // обычный текст между токенами
    const tok = m[0];
    let cls;
    if (tok[0] === '"') {
      // Ключ или строковое значение: ключ — если дальше идёт двоеточие.
      cls = /^\s*:/.test(text.slice(m.index + tok.length, m.index + tok.length + 8)) ? "json-key" : "json-string";
    } else if (tok.length === 1 && (tok in OPENERS || tok in CLOSERS)) {
      cls = "json-punct";
      if (m.index === matchA || m.index === matchB) cls += " bracket-match";
    } else if (tok === ":" || tok === ",") {
      cls = "json-punct";
    } else if (tok === "true" || tok === "false" || tok === "null") {
      cls = "json-literal";
    } else {
      cls = "json-num";
    }
    html += `<span class="${cls}">${escapeHtml(tok)}</span>`;
    last = m.index + tok.length;
  }
  html += escapeHtml(text.slice(last));
  return html;
}

/**
 * Инициализировать редактор внутри контейнера .okassen-editor.
 * Источник истины — сам textarea; программная замена текста должна
 * диспатчить событие "input", чтобы подсветка обновилась.
 *
 * @param {HTMLElement} container — элемент .okassen-editor из шаблона
 * @param {HTMLElement|null} [statusEl] — элемент статус-строки для живой валидации
 * @param {object} [options]
 * @param {Function|null} [options.completions] — резолвер подсказок:
 *   (ctx: {key, prefix, before}) => Array<{label, detail}> | null.
 *   key — JSON-ключ, значение которого редактируется; prefix — набранный
 *   текст; before — текст перед строкой (для контекстных решений).
 * @param {Function|null} [options.hint] — (ctx|null) => string: подсказка
 *   для строки под кареткой; выводится в options.hintEl.
 * @param {HTMLElement|null} [options.hintEl] — элемент для вывода подсказки
 */
export function initJsonEditor(container, statusEl = null, { completions = null, hint = null, hintEl = null } = {}) {
  if (!container || container.dataset.okassenEditor) return; // не инициализируем дважды
  container.dataset.okassenEditor = "1";

  const textarea = container.querySelector(".okassen-json");
  const pre = container.querySelector(".okassen-highlight");
  const code = pre.querySelector("code");
  const gutter = container.querySelector(".okassen-gutter");

  // Гаттер: replaceChildren выбрасывает любой статический текст из шаблона.
  const gutterInner = document.createElement("div");
  gutterInner.className = "okassen-gutter-inner";
  gutter.replaceChildren(gutterInner);

  /* ------------------------------------------------------------------ */
  /* Модель: пересчитывается только при ИЗМЕНЕНИИ текста                 */
  /* ------------------------------------------------------------------ */

  let lines = [""];       // строки документа
  let lineOffsets = [0];  // смещение начала каждой строки в тексте
  let matchA = -1;        // абсолютные позиции подсвечиваемой пары скобок
  let matchB = -1;

  const rebuildModel = () => {
    const v = textarea.value;
    lines = v.split("\n");
    lineOffsets = new Array(lines.length);
    let off = 0;
    for (let i = 0; i < lines.length; i++) {
      lineOffsets[i] = off;
      off += lines[i].length + 1;
    }
  };

  /**
   * Ленивый поиск пары для скобки в позиции pos: расходимся от неё построчно
   * со счётчиком глубины. Стоимость пропорциональна расстоянию до пары,
   * а не размеру документа.
   *
   * @param {number} pos — позиция скобки в тексте
   * @returns {number|null} — позиция парной скобки или null
   */
  const matchBracketAt = (pos) => {
    const { line } = lineColFromPos(pos);
    const lineBrs = bracketsInLine(lines[line], lineOffsets[line]);
    const idx = lineBrs.findIndex(b => b.pos === pos);
    if (idx < 0) return null; // скобка внутри строки-литерала — не считается

    const ch = lineBrs[idx].ch;
    if (ch in OPENERS) {
      // Вперёд: остаток текущей строки, затем следующие строки.
      let depth = 0;
      let li = line;
      let brs = lineBrs.slice(idx);
      while (li < lines.length) {
        for (const b of brs) {
          if (b.ch in OPENERS) depth++;
          else if (--depth === 0) return OPENERS[ch] === b.ch ? b.pos : null;
        }
        li++;
        if (li < lines.length) brs = bracketsInLine(lines[li], lineOffsets[li]);
      }
      return null;
    }

    // Назад: начало текущей строки, затем предыдущие строки (в обратном порядке).
    let depth = 0;
    let li = line;
    let brs = lineBrs.slice(0, idx + 1);
    while (li >= 0) {
      for (let k = brs.length - 1; k >= 0; k--) {
        const b = brs[k];
        if (b.ch in CLOSERS) depth++;
        else if (--depth === 0) return CLOSERS[ch] === b.ch ? b.pos : null;
      }
      li--;
      if (li >= 0) brs = bracketsInLine(lines[li], lineOffsets[li]);
    }
    return null;
  };

  /** Пересчитать подсвечиваемую пару скобок по текущей каретке.
   *  Приоритет — скобка СЛЕВА от каретки (как в VS Code), затем справа. */
  const updateMatch = () => {
    matchA = matchB = -1;
    if (textarea.selectionStart !== textarea.selectionEnd) return;
    const v = textarea.value;
    const pos = textarea.selectionStart;
    for (const p of [pos - 1, pos]) {
      const ch = v[p];
      if (ch && (ch in OPENERS || ch in CLOSERS)) {
        const m = matchBracketAt(p);
        if (m !== null) {
          matchA = p;
          matchB = m;
          return;
        }
      }
    }
  };

  /* ------------------------------------------------------------------ */
  /* Вид: рендер ТОЛЬКО видимого окна строк                              */
  /* ------------------------------------------------------------------ */

  const renderView = () => {
    const st = textarea.scrollTop;
    const sl = textarea.scrollLeft;
    const first = Math.max(0, Math.floor(st / LINE_H) - OVERSCAN);
    const last = Math.min(
      lines.length - 1,
      Math.ceil((st + textarea.clientHeight) / LINE_H) + OVERSCAN
    );

    // Подсветка: только видимый фрагмент; позиции скобок переводим
    // в координаты фрагмента.
    const offset = lineOffsets[first] ?? 0;
    const slice = lines.slice(first, last + 1).join("\n");
    code.innerHTML = highlightHtml(slice, matchA - offset, matchB - offset);
    code.style.transform = `translate(${-sl}px, ${first * LINE_H - st}px)`;

    // Номера строк видимого окна.
    let nums = "";
    for (let i = first; i <= last; i++) nums += (i + 1) + "\n";
    gutterInner.textContent = nums;
    gutterInner.style.transform = `translateY(${first * LINE_H - st}px)`;

    if (popup) positionPopup();
  };

  /**
   * Планировщик перерисовки: сколько бы событий (ввод при зажатой клавише,
   * скролл, движение каретки) ни пришло за один кадр — тяжёлая работа
   * (пересборка модели, карта скобок, innerHTML) выполняется ОДИН раз,
   * в ближайшем requestAnimationFrame.
   *
   * @param {boolean} modelChanged — текст изменился (нужна пересборка модели)
   */
  let rafId = 0;
  let dirtyModel = false;
  const scheduleRender = (modelChanged) => {
    if (modelChanged) dirtyModel = true;
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      if (dirtyModel) {
        dirtyModel = false;
        rebuildModel();
        scheduleStatus();
      }
      updateMatch();
      renderView();
    });
  };

  /** Номер строки и колонка по позиции в тексте — бинарным поиском по
   *  lineOffsets, без разрезания всего документа. */
  const lineColFromPos = (pos) => {
    let lo = 0;
    let hi = lineOffsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineOffsets[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo, col: pos - lineOffsets[lo] };
  };

  /* ------------------------------------------------------------------ */
  /* Живая валидация JSON — с дебаунсом                                  */
  /* ------------------------------------------------------------------ */

  let statusTimer = null;
  const scheduleStatus = () => {
    if (!statusEl) return;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(updateStatus, STATUS_DELAY);
  };

  const updateStatus = () => {
    if (!statusEl) return;
    const text = textarea.value;
    if (!text.trim()) {
      statusEl.textContent = "";
      statusEl.className = "okassen-status-text";
      return;
    }
    try {
      JSON.parse(text);
      statusEl.textContent = game.i18n.format("OKASSEN.editor.valid", { lines: lines.length });
      statusEl.className = "okassen-status-text ok";
    } catch (err) {
      const m = /position (\d+)/.exec(err.message);
      const line = m ? text.slice(0, Number(m[1])).split("\n").length : "?";
      statusEl.textContent = game.i18n.format("OKASSEN.editor.invalid", { line, message: err.message });
      statusEl.className = "okassen-status-text error";
    }
  };

  /** Полный пересчёт (отложенный до кадра): после изменения текста. */
  const render = () => scheduleRender(true);

  /** Лёгкое обновление (отложенное): движение каретки без изменения текста. */
  const renderCursor = () => scheduleRender(false);

  /* ------------------------------------------------------------------ */
  /* Автодополнение механик (открывается само внутри "mechanic": "...")  */
  /* ------------------------------------------------------------------ */

  let popup = null;       // элемент выпадающего списка (null = закрыт)
  let popupItems = [];    // отфильтрованные подсказки
  let popupIndex = 0;     // индекс выбранной строки
  let popupAnchor = 0;    // позиция в тексте, с которой начинается подставляемое

  // Ширина моноширинного символа — для позиционирования попапа под кареткой.
  const charW = (() => {
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = getComputedStyle(textarea).font;
    return ctx.measureText("M").width || 7.2;
  })();

  /**
   * Каретка внутри строки-ЗНАЧЕНИЯ какого-то ключа? ("key": "<каретка>")
   * Возвращает ключ, набранный префикс и текст перед строкой — резолвер
   * подсказок сам решает, есть ли что предложить для этого ключа.
   * @returns {{start: number, prefix: string, key: string, before: string}|null}
   */
  const stringContext = () => {
    const v = textarea.value;
    const pos = textarea.selectionStart;
    const qi = v.lastIndexOf('"', pos - 1);
    if (qi < 0) return null;
    const inside = v.slice(qi + 1, pos);
    if (inside.includes('"') || inside.includes("\n")) return null;
    // Хвост перед открывающей кавычкой: `"ключ": ` — не гоняем регэксп по
    // всему документу, 400 символов достаточно для контекста change-объекта.
    const before = v.slice(Math.max(0, qi - 400), qi);
    const m = /"([A-Za-z_$][A-Za-z0-9_.$]*)"\s*:\s*$/.exec(before);
    if (!m) return null;
    return { start: qi + 1, prefix: inside, key: m[1], before };
  };

  /** Подсказки для текущего контекста (или null, если их нет). */
  const completionsFor = (ctx) => {
    if (!completions || !ctx) return null;
    const items = completions(ctx);
    return Array.isArray(items) && items.length ? items : null;
  };

  const closeCompletions = () => {
    popup?.remove();
    popup = null;
    popupItems = [];
  };

  const positionPopup = () => {
    if (!popup) return;
    // Бинарный поиск по lineOffsets вместо разрезания всего документа.
    const { line, col } = lineColFromPos(popupAnchor);
    popup.style.top = `${PAD + (line + 1) * LINE_H - textarea.scrollTop}px`;
    popup.style.left = `${Math.max(0, Math.min(PAD + col * charW - textarea.scrollLeft, textarea.clientWidth - 280))}px`;
  };

  const renderPopup = () => {
    if (!popup) return;
    popup.innerHTML = popupItems.map((c, i) =>
      `<div class="okassen-complete-item${i === popupIndex ? " active" : ""}" data-i="${i}">` +
      `<span class="cc-label">${escapeHtml(c.label)}</span>` +
      `<span class="cc-detail">${escapeHtml(c.detail ?? "")}</span></div>`
    ).join("");
    popup.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  };

  const applyCompletion = () => {
    const item = popupItems[popupIndex];
    if (!item) return closeCompletions();
    textarea.setRangeText(item.label, popupAnchor, textarea.selectionStart, "end");
    closeCompletions();
    render();
  };

  const openCompletions = () => {
    const ctx = stringContext();
    const all = completionsFor(ctx);
    if (!all) return;
    closeCompletions();
    popupItems = all.filter(c => c.label.startsWith(ctx.prefix));
    if (!popupItems.length) return;
    popupAnchor = ctx.start;
    popupIndex = 0;
    popup = document.createElement("div");
    popup.className = "okassen-complete";
    // mousedown, а не click — срабатывает до blur textarea.
    popup.addEventListener("mousedown", (e) => {
      const row = e.target.closest(".okassen-complete-item");
      if (!row) return;
      e.preventDefault();
      popupIndex = Number(row.dataset.i);
      applyCompletion();
    });
    container.querySelector(".okassen-editor-main").appendChild(popup);
    renderPopup();
    positionPopup();
  };

  /** Пересчитать фильтр попапа после ввода символов (попап уже открыт). */
  const updateCompletionFilter = () => {
    if (!popup) return;
    const ctx = stringContext();
    const all = completionsFor(ctx);
    if (!all) return closeCompletions();
    popupItems = all.filter(c => c.label.startsWith(ctx.prefix));
    if (!popupItems.length) return closeCompletions();
    popupAnchor = ctx.start;
    popupIndex = Math.min(popupIndex, popupItems.length - 1);
    renderPopup();
    positionPopup();
  };

  /**
   * Авто-режим: попап открывается САМ, как только каретка оказывается внутри
   * строки-значения с подсказками (клик, стрелки, ввод), и закрывается, когда
   * каретка уходит. Ctrl+Space оставлен как ручной дублёр.
   * Заодно обновляется строка-подсказка (описание механики под кареткой).
   */
  const syncAutoComplete = () => {
    const ctx = stringContext();
    if (hint && hintEl) hintEl.textContent = hint(ctx) ?? "";
    if (!completions) return;
    if (!completionsFor(ctx)) return closeCompletions();
    if (popup) updateCompletionFilter();
    else openCompletions();
  };

  /* ------------------------------------------------------------------ */
  /* Клавиатура: попап, Tab/Shift+Tab/Enter                              */
  /* ------------------------------------------------------------------ */

  const onKeydown = (e) => {
    const ta = textarea;
    const v = ta.value;
    const s = ta.selectionStart;
    const end = ta.selectionEnd;

    // Открытый попап автодополнения перехватывает навигацию.
    if (popup) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        popupIndex = (popupIndex + 1) % popupItems.length;
        renderPopup();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        popupIndex = (popupIndex - 1 + popupItems.length) % popupItems.length;
        renderPopup();
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applyCompletion();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeCompletions();
        return;
      }
    }

    // Ctrl+Space — открыть автодополнение вручную (например, после Esc).
    if (e.ctrlKey && e.code === "Space") {
      e.preventDefault();
      openCompletions();
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      const multiline = v.slice(s, end).includes("\n");
      if (!e.shiftKey && !multiline) {
        // Простой Tab — вставить отступ в позицию каретки.
        ta.setRangeText(INDENT, s, end, "end");
      } else {
        // Блочный отступ: затрагиваем все выделенные строки целиком.
        const blockStart = v.lastIndexOf("\n", s - 1) + 1;
        const blockLines = v.slice(blockStart, end).split("\n");
        const changed = blockLines.map(l => e.shiftKey ? l.replace(/^ {1,2}/, "") : INDENT + l);
        ta.setRangeText(changed.join("\n"), blockStart, end, "select");
      }
      render();
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const lineStart = v.lastIndexOf("\n", s - 1) + 1;
      const indent = (v.slice(lineStart).match(/^[ \t]*/) ?? [""])[0];
      const prev = v[s - 1];
      const next = v[end];
      let insert = "\n" + indent;
      let caret;
      if ((prev === "{" && next === "}") || (prev === "[" && next === "]")) {
        // Каретка между парой скобок: раздвигаем на три строки, каретка в середине.
        insert = "\n" + indent + INDENT + "\n" + indent;
        caret = s + 1 + indent.length + INDENT.length;
      } else if (prev === "{" || prev === "[") {
        insert = "\n" + indent + INDENT;
      }
      ta.setRangeText(insert, s, end, "end");
      if (caret !== undefined) ta.selectionStart = ta.selectionEnd = caret;
      render();
      return;
    }
  };

  /* ------------------------------------------------------------------ */
  /* Подписки                                                            */
  /* ------------------------------------------------------------------ */

  textarea.addEventListener("input", () => {
    render();
    syncAutoComplete(); // ввод внутри "mechanic" сам открывает/фильтрует попап
  });
  textarea.addEventListener("scroll", () => scheduleRender(false));
  textarea.addEventListener("keydown", onKeydown);
  // Движение каретки (клик, стрелки) — подсветка скобок + авто-попап механик.
  textarea.addEventListener("click", () => {
    renderCursor();
    syncAutoComplete();
  });
  textarea.addEventListener("keyup", (e) => {
    if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") {
      renderCursor();
      syncAutoComplete();
    }
  });
  // Ушёл фокус — попап больше не нужен (задержка, чтобы успел отработать клик по нему).
  textarea.addEventListener("blur", () => setTimeout(closeCompletions, 150));

  render();
}
