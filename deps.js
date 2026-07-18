/**
 * deps.js — осознание зависимостей от других модулей.
 *
 * Часть механик и «сырых» ключей работает только при активных midi-qol или DAE.
 * Здесь: детект активных модулей и анализ входного JSON — какие места
 * требуют отсутствующий модуль. Анализ возвращает ЧЕЛОВЕКОЧИТАЕМЫЕ
 * предупреждения (не ошибки): импорт не блокируется, но автор узнаёт,
 * что эффект молча не сработает, ДО того как это всплывёт в игре.
 */

/** midi-qol включён в этом мире? */
export function midiActive() {
  return game.modules.get("midi-qol")?.active === true;
}

/** Dynamic Active Effects (DAE) включён в этом мире? */
export function daeActive() {
  return game.modules.get("dae")?.active === true;
}

/** Times-Up включён? На Foundry v13 он отвечал за авто-снятие эффектов по
 *  истечении длительности и за DAE specialDuration. Для v14 модуля нет —
 *  ядро Foundry v14 делает основную часть этого само (см. coreAutoExpiry). */
export function timesUpActive() {
  return game.modules.get("times-up")?.active === true;
}

/** Ядро Foundry (v14+) само снимает эффекты по истечении длительности —
 *  Times-Up для этого больше не нужен. */
export function coreAutoExpiry() {
  const gen = Number(game.release?.generation ?? parseInt(game.version, 10) ?? 0);
  return Number.isFinite(gen) && gen >= 14;
}

/** Истёкшие эффекты снимаются сами (ядром v14+ или модулем Times-Up на v13)? */
export function autoExpiryAvailable() {
  return coreAutoExpiry() || timesUpActive();
}

/**
 * Проверить один change на зависимость от модулей.
 * @param {object} ch — запись из _forge.effects[].changes[]
 * @param {string} where — «предмет „X“, эффект „Y“» для текста предупреждения
 * @param {string[]} out — накопитель предупреждений
 */
function analyzeChange(ch, where, out) {
  // Сырые ключи чужих модулей.
  if (typeof ch.key === "string") {
    if (ch.key.startsWith("flags.midi-qol.") && !midiActive()) {
      out.push(game.i18n.format("OKASSEN.deps.midiKey", { where, key: ch.key }));
    }
    if (ch.key.startsWith("flags.dae.") && !daeActive()) {
      out.push(game.i18n.format("OKASSEN.deps.daeKey", { where, key: ch.key }));
    }
  }

  if (typeof ch.mechanic !== "string") return;

  // Преимущество/помеха (кроме advantage.init) и курированные midi-механики
  // (grants.* / fail.* / dr.*) — только через midi-qol.
  const needsMidi = (/^(advantage|disadvantage)\./.test(ch.mechanic) && ch.mechanic !== "advantage.init")
    || /^(grants|fail|dr)\./.test(ch.mechanic);
  if (needsMidi && !midiActive()) {
    out.push(game.i18n.format("OKASSEN.deps.advantage", { where, mechanic: ch.mechanic }));
  }

  // overTime со спасброском: встроенный обработчик спасброски не умеет.
  if (/\.overTime$/.test(ch.mechanic) && (ch.save || ch.dc) && !midiActive()) {
    out.push(game.i18n.format("OKASSEN.deps.overTimeSave", { where }));
  }
}

/** Обойти один документ (предмет или актёра) и его _forge. */
function analyzeDocument(raw, out, label = null) {
  if (!raw || typeof raw !== "object") return;
  const name = label ?? raw.name ?? "?";
  const forge = raw._forge;
  const autoExpiry = autoExpiryAvailable();

  for (const fx of forge?.effects ?? []) {
    const where = game.i18n.format("OKASSEN.deps.where", { name, effect: fx.name ?? fx.label ?? "?" });
    for (const ch of fx.changes ?? []) analyzeChange(ch, where, out);

    // Проброшенные флаги эффекта: midi-qol / DAE (specialDuration и пр.).
    if (fx.flags && typeof fx.flags === "object") {
      if (fx.flags["midi-qol"] !== undefined && !midiActive()) {
        out.push(game.i18n.format("OKASSEN.deps.midiKey", { where, key: "flags.midi-qol.*" }));
      }
      if (fx.flags.dae !== undefined && !daeActive()) {
        out.push(game.i18n.format("OKASSEN.deps.daeKey", { where, key: "flags.dae.*" }));
      }
      // specialDuration («1Attack» и пр.) — это триггер-флаг, который на v13
      // применял Times-Up. Ядро v14 снимает эффекты по обычной длительности, но
      // именно этот флаг-триггер — не гарантированно; предупреждаем, если ни
      // Times-Up, ни (как приблизительная замена) авто-снятие ядром недоступны.
      if (fx.flags.dae?.specialDuration !== undefined && !autoExpiry) {
        out.push(game.i18n.format("OKASSEN.deps.specialDuration", { where }));
      }
    }

    // Длительность в раундах/ходах/секундах: истёкший эффект снимается сам либо
    // ядром Foundry v14+, либо модулем Times-Up (v13). Иначе dnd5e лишь показывает
    // счётчик. Одно предупреждение на импорт.
    const dur = fx.duration ?? {};
    if ((dur.rounds != null || dur.turns != null || dur.seconds != null) && !autoExpiry) {
      out.push(game.i18n.localize("OKASSEN.deps.timedNoTimesUp"));
    }
  }

  // Вложенные предметы и предметы актёра.
  for (const def of forge?.nested ?? []) analyzeDocument(def, out);
  for (const def of raw.items ?? []) analyzeDocument(def, out);
}

/**
 * Проанализировать вход (документ или массив документов) на зависимости.
 * @param {object|Array} parsed — распарсенный JSON до/после preprocess
 * @returns {string[]} — предупреждения (пусто = всё удовлетворено)
 */
export function analyzeDependencies(parsed) {
  const out = [];
  const docs = Array.isArray(parsed) ? parsed : [parsed];
  for (const doc of docs) analyzeDocument(doc, out);
  return [...new Set(out)]; // одинаковые предупреждения не повторяем
}
