/**
 * preprocess.js — препроцессор входного JSON: сниппеты и плейсхолдеры.
 * Выполняется ПОСЛЕ JSON.parse и ДО validate/создания документов.
 *
 * СНИППЕТЫ (_defs / $ref):
 *   { "_defs": { "fireResist": { "label": "Огнестойкость", "changes": [...] } },
 *     ...,
 *     "_forge": { "effects": [ { "$ref": "fireResist" },
 *                              { "$ref": "fireResist", "label": "Другое имя" } ] } }
 *   - { "$ref": "имя", ...переопределения } заменяется глубокой копией блока
 *     из _defs, поверх которой мержатся остальные ключи объекта;
 *   - если $ref внутри массива разворачивается в массив — элементы встраиваются;
 *   - _defs могут ссылаться друг на друга; циклы обнаруживаются и запрещены.
 *
 * ПЛЕЙСХОЛДЕРЫ (_vars / {{выражение}}):
 *   { "_vars": { "level": 5 }, ... "value": "{{level}}d6", "dc": "{{8 + floor(level/2)}}" }
 *   - строка целиком из одного плейсхолдера получает ТИП результата (число);
 *   - поддержка: числа, имена из _vars, + - * / %, скобки, унарный минус,
 *     функции floor/ceil/round/abs/min/max;
 *   - обработка включается ТОЛЬКО если у документа (или пакета) есть _vars —
 *     существующий контент с литеральными «{{}}» в текстах не пострадает.
 *
 * ПАКЕТЫ: в массиве первый элемент вида { "_defs": ..., "_vars": ... }
 * (без name/type) — общий заголовок: его сниппеты и переменные видны всем
 * документам пакета; собственные _defs/_vars документа имеют приоритет.
 */

const MAX_REF_DEPTH = 16;

/* ------------------------------------------------------------------ */
/* Выражения                                                           */
/* ------------------------------------------------------------------ */

const FUNCS = {
  floor: Math.floor, ceil: Math.ceil, round: Math.round,
  abs: Math.abs, min: Math.min, max: Math.max
};

/**
 * Вычислить арифметическое выражение с переменными.
 * Рекурсивный спуск; никакого eval — только числа, имена и известные функции.
 *
 * @param {string} src — текст выражения (без {{ }})
 * @param {object} vars — переменные из _vars
 * @returns {number|string} — результат (строка допустима только как «{{имя}}»)
 */
export function evalExpression(src, vars) {
  const fail = (key, data = {}) => {
    throw new Error(game.i18n.format(key, { expr: src.trim(), ...data }));
  };

  // Токенизация.
  const tokens = [];
  const re = /\s*(\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|[()+\-*/%,])/y;
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) {
      if (/^\s*$/.test(src.slice(pos))) break; // хвостовые пробелы
      fail("OKASSEN.errors.badExpr");
    }
    tokens.push(m[1]);
    pos = re.lastIndex;
  }
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];

  const factor = () => {
    const t = next();
    if (t === undefined) fail("OKASSEN.errors.badExpr");
    if (t === "-") return -toNumber(factor());
    if (t === "(") {
      const v = expr();
      if (next() !== ")") fail("OKASSEN.errors.badExpr");
      return v;
    }
    if (/^\d/.test(t)) return Number(t);
    if (/^[A-Za-z_]/.test(t)) {
      // Вызов функции?
      if (peek() === "(") {
        const fn = FUNCS[t];
        if (!fn) fail("OKASSEN.errors.unknownFunc", { func: t });
        next(); // "("
        const args = [];
        if (peek() !== ")") {
          args.push(toNumber(expr()));
          while (peek() === ",") { next(); args.push(toNumber(expr())); }
        }
        if (next() !== ")") fail("OKASSEN.errors.badExpr");
        return fn(...args);
      }
      // Переменная.
      if (!(t in vars)) fail("OKASSEN.errors.unknownVar", { name: t });
      return vars[t];
    }
    fail("OKASSEN.errors.badExpr");
  };

  const toNumber = (v) => {
    if (typeof v === "number") return v;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
    fail("OKASSEN.errors.exprNotNumber", { value: String(v) });
  };

  const term = () => {
    let v = factor();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = next();
      const r = toNumber(factor());
      v = op === "*" ? toNumber(v) * r : op === "/" ? toNumber(v) / r : toNumber(v) % r;
    }
    return v;
  };

  const expr = () => {
    let v = term();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const r = toNumber(term());
      v = op === "+" ? toNumber(v) + r : toNumber(v) - r;
    }
    return v;
  };

  const result = expr();
  if (i !== tokens.length) fail("OKASSEN.errors.badExpr");
  return result;
}

/** Подставить плейсхолдеры во все строки структуры (рекурсивно). */
function applyVars(value, vars) {
  if (typeof value === "string") {
    // Строка целиком из одного плейсхолдера — сохраняем тип результата.
    const whole = /^\{\{([^{}]+)\}\}$/.exec(value);
    if (whole) return evalExpression(whole[1], vars);
    return value.replace(/\{\{([^{}]+)\}\}/g, (_, e) => String(evalExpression(e, vars)));
  }
  if (Array.isArray(value)) return value.map(v => applyVars(v, vars));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = applyVars(v, vars);
    return out;
  }
  return value;
}

/* ------------------------------------------------------------------ */
/* Сниппеты                                                            */
/* ------------------------------------------------------------------ */

/**
 * Рекурсивно раскрыть $ref-ссылки.
 * @param {*} value — фрагмент структуры
 * @param {object} defs — словарь сниппетов
 * @param {Set<string>} stack — имена по цепочке раскрытия (детект циклов)
 * @param {number} depth — предохранитель от слишком глубоких структур
 */
function resolveRefs(value, defs, stack, depth = 0) {
  if (depth > MAX_REF_DEPTH * 8) {
    throw new Error(game.i18n.localize("OKASSEN.errors.refTooDeep"));
  }

  if (Array.isArray(value)) {
    // $ref, раскрывшийся в массив, встраивается поэлементно.
    return value.flatMap(el => {
      const resolved = resolveRefs(el, defs, stack, depth + 1);
      const wasRef = el && typeof el === "object" && !Array.isArray(el) && "$ref" in el;
      return wasRef && Array.isArray(resolved) ? resolved : [resolved];
    });
  }

  if (value && typeof value === "object") {
    if ("$ref" in value) {
      const name = value.$ref;
      if (typeof name !== "string" || !(name in defs)) {
        throw new Error(game.i18n.format("OKASSEN.errors.unknownRef", {
          name: String(name),
          available: Object.keys(defs).sort().join(", ") || "—"
        }));
      }
      if (stack.has(name)) {
        throw new Error(game.i18n.format("OKASSEN.errors.refCycle", {
          chain: [...stack, name].join(" → ")
        }));
      }
      const nextStack = new Set(stack).add(name);
      const base = resolveRefs(foundry.utils.deepClone(defs[name]), defs, nextStack, depth + 1);

      // Остальные ключи объекта — переопределения поверх сниппета.
      const overrides = {};
      for (const [k, v] of Object.entries(value)) {
        if (k !== "$ref") overrides[k] = resolveRefs(v, defs, stack, depth + 1);
      }
      if (Object.keys(overrides).length) {
        if (!base || typeof base !== "object" || Array.isArray(base)) {
          throw new Error(game.i18n.format("OKASSEN.errors.refNotMergeable", { name }));
        }
        return foundry.utils.mergeObject(base, overrides, { inplace: false });
      }
      return base;
    }

    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveRefs(v, defs, stack, depth + 1);
    return out;
  }

  return value;
}

/* ------------------------------------------------------------------ */
/* Вход                                                                */
/* ------------------------------------------------------------------ */

/** Обработать один документ с учётом пакетных сниппетов/переменных. */
function processDoc(doc, outerDefs, outerVars) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return doc;

  const defs = { ...outerDefs, ...(typeof doc._defs === "object" ? doc._defs : {}) };
  const vars = { ...outerVars, ...(typeof doc._vars === "object" ? doc._vars : {}) };

  let out = foundry.utils.deepClone(doc);
  delete out._defs;
  delete out._vars;

  if (Object.keys(defs).length) out = resolveRefs(out, defs, new Set());
  if (Object.keys(vars).length) out = applyVars(out, vars);
  return out;
}

/**
 * Препроцессинг входа: раскрыть сниппеты и плейсхолдеры.
 * Вход не мутируется; на выходе — новая структура без _defs/_vars/$ref.
 *
 * @param {object|Array} parsed — распарсенный JSON (документ или массив)
 * @returns {object|Array} — раскрытая структура той же формы
 *   (пакетный заголовок _defs/_vars из массива удаляется)
 * @throws {Error} — неизвестная ссылка, цикл, ошибка выражения
 */
export function preprocess(parsed) {
  if (Array.isArray(parsed)) {
    const docs = [...parsed];
    let batchDefs = {};
    let batchVars = {};
    const head = docs[0];
    // Заголовок пакета: только _defs/_vars, без name/type.
    if (head && typeof head === "object" && !Array.isArray(head)
      && !head.name && !head.type && (head._defs || head._vars)) {
      batchDefs = typeof head._defs === "object" ? head._defs : {};
      batchVars = typeof head._vars === "object" ? head._vars : {};
      docs.shift();
    }
    return docs.map(d => processDoc(d, batchDefs, batchVars));
  }
  return processDoc(parsed, {}, {});
}
