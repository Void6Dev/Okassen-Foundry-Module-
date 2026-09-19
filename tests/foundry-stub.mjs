/**
 * foundry-stub.mjs — минимальное окружение Foundry для запуска модулей в Node.
 *
 * Модуль рассчитан на глобали Foundry (game, CONFIG, CONST, foundry.utils,
 * ui.notifications, Hooks) и читает часть из них ещё на импорте (например,
 * mechanics.js берёт CONST.ACTIVE_EFFECT_MODES). Поэтому заглушки ставятся
 * ДО первого import модуля — см. loadModule() ниже.
 *
 * Заглушки намеренно простые: цель — проверять НАШУ логику (механики,
 * препроцессор, проверки, сравнение), а не воспроизводить ядро Foundry.
 */

import { pathToFileURL } from "node:url";
import path from "node:path";

/** Реализация нужных функций foundry.utils поверх обычного JS. */
const utils = {
  deepClone: v => structuredClone(v),

  getProperty: (obj, p) => String(p).split(".").reduce((o, k) => (o == null ? o : o[k]), obj),

  setProperty: (obj, p, value) => {
    const parts = String(p).split(".");
    let cur = obj;
    for (const k of parts.slice(0, -1)) cur = (cur[k] ??= {});
    cur[parts.at(-1)] = value;
    return true;
  },

  mergeObject: (a, b, { inplace = true } = {}) => {
    const out = inplace ? (a ?? {}) : structuredClone(a ?? {});
    const walk = (dst, src) => {
      for (const [k, v] of Object.entries(src ?? {})) {
        if (v && typeof v === "object" && !Array.isArray(v) && dst[k] && typeof dst[k] === "object") walk(dst[k], v);
        else dst[k] = structuredClone(v);
      }
    };
    walk(out, b);
    return out;
  },

  flattenObject: obj => {
    const out = {};
    const walk = (o, prefix) => {
      for (const [k, v] of Object.entries(o ?? {})) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === "object" && !Array.isArray(v)) walk(v, key);
        else out[key] = v;
      }
    };
    walk(obj, "");
    return out;
  },

  isEmpty: o => !o || Object.keys(o).length === 0,

  randomID: () => Math.random().toString(36).slice(2, 18)
};

/** Документ-пустышка: хранит данные и умеет toObject/getFlag. */
export class StubDocument {
  constructor(data = {}, documentName = "Item") {
    this._source = structuredClone(data);
    this.documentName = documentName;
    this.effects = (data.effects ?? []).map(fx => new StubEffect(fx));
  }

  get name() { return this._source.name; }
  get type() { return this._source.type; }
  get system() { return this._source.system ?? {}; }
  get flags() { return this._source.flags ?? {}; }
  get uuid() { return `${this.documentName}.${this._source._id ?? "stub"}`; }
  get parent() { return this._parent ?? null; }

  getFlag(scope, key) { return utils.getProperty(this.flags, `${scope}.${key}`); }
  toObject() { return structuredClone(this._source); }
}

/** Эффект-пустышка для сравнения по именам. */
export class StubEffect {
  constructor(data = {}) { this._source = structuredClone(data); }
  get id() { return this._source._id ?? null; }
  get name() { return this._source.name; }
  get transfer() { return this._source.transfer; }
  getFlag(scope, key) { return utils.getProperty(this._source.flags ?? {}, `${scope}.${key}`); }
  toObject() { return structuredClone(this._source); }
}

/** Коллекция-пустышка с find/get/getName, как у WorldCollection. */
export class StubCollection extends Array {
  get(id) { return this.find(d => d._source?._id === id) ?? null; }
  getName(name) { return this.find(d => d.name === name) ?? null; }
}

/**
 * Поставить глобали Foundry. Вызывать ДО импорта модулей проекта.
 * @param {object} [overrides] — что подменить в game/CONFIG (см. использование в тестах)
 */
export function installFoundryStubs({ settings = {}, items = [], actors = [], midi = false } = {}) {
  const settingsStore = new Map(Object.entries(settings));

  globalThis.foundry = {
    utils,
    data: { fields: { SchemaField: class SchemaField {} } }
  };

  globalThis.CONST = {
    ACTIVE_EFFECT_MODES: { CUSTOM: 0, MULTIPLY: 1, ADD: 2, DOWNGRADE: 3, UPGRADE: 4, OVERRIDE: 5 },
    TOKEN_DISPOSITIONS: { FRIENDLY: 1, NEUTRAL: 0, HOSTILE: -1 }
  };

  globalThis.CONFIG = {
    Item: { dataModels: { weapon: {}, consumable: {}, feat: {}, equipment: {}, base: {} } },
    Actor: { dataModels: { npc: {}, character: {}, base: {} } },
    statusEffects: [{ id: "prone" }, { id: "poisoned" }, { id: "frightened" }],
    DND5E: {
      abilities: { str: { label: "Strength" }, dex: { label: "Dexterity" } },
      skills: { acr: { label: "Acrobatics" } },
      damageTypes: { fire: { label: "Fire" }, cold: { label: "Cold" } },
      conditionTypes: { prone: { label: "Prone" } },
      tools: { thief: { label: "Thieves' Tools" } }
    }
  };

  globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
  globalThis.Hooks = { on() {}, once() {}, callAll() {} };

  globalThis.Item = { implementation: class StubItem extends StubDocument {
    constructor(data) { super(data, "Item"); }
  } };
  globalThis.Actor = { implementation: class StubActor extends StubDocument {
    constructor(data) { super(data, "Actor"); }
  } };

  globalThis.game = {
    i18n: {
      localize: k => k,
      format: (k, d) => `${k} ${JSON.stringify(d ?? {})}`,
      has: () => false,
      lang: "en"
    },
    settings: {
      register: (mod, key, cfg) => {
        if (!settingsStore.has(`${mod}.${key}`)) settingsStore.set(`${mod}.${key}`, cfg.default);
      },
      get: (mod, key) => {
        const k = `${mod}.${key}`;
        if (!settingsStore.has(k)) throw new Error(`setting ${k} is not registered`);
        return settingsStore.get(k);
      },
      set: (mod, key, value) => settingsStore.set(`${mod}.${key}`, value)
    },
    modules: { get: id => ({ active: id === "midi-qol" ? midi : false }) },
    items: StubCollection.from(items),
    actors: StubCollection.from(actors),
    macros: Object.assign(StubCollection.from([]), { getName: () => null }),
    packs: { get: () => null },
    folders: { get: () => null, has: () => false },
    system: { id: "dnd5e", version: "5.3.3" },
    user: { isGM: true, id: "user1", targets: new Set() },
    users: { activeGM: { isSelf: true } },
    release: { generation: 13 },
    version: "13.347"
  };

  return { settingsStore };
}

/** Импорт модуля проекта по имени файла (scripts/<name>). */
export function loadModule(name) {
  const file = path.resolve(process.cwd(), "scripts", name);
  return import(pathToFileURL(file).href);
}
