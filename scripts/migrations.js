/**
 * migrations.js — версия формата _forge и миграции созданного контента.
 *
 * Каждый документ, созданный модулем, штампуется flags.okassen.formatVersion.
 * Когда будущая версия модуля изменит формат (переименует механику, перенесёт
 * флаг), она добавит функцию в MIGRATIONS — и на загрузке мира ведущим все
 * документы со старым штампом будут дотянуты до текущей версии.
 *
 * Документы БЕЗ штампа (созданные до этой версии модуля) мигрируются с
 * версии 0 — все шаги применяются по порядку.
 */

const MODULE_ID = "okassen";

/** Текущая версия формата _forge. Повышать при несовместимых изменениях. */
export const FORMAT_VERSION = 1;

/**
 * Реестр миграций: целевая версия → async (doc) => void.
 * Функция ДОЛЖНА привести документ с формата (N-1) к формату N;
 * штамп после неё обновляет прогон, самой функции его трогать не нужно.
 *
 * Пример на будущее:
 *   MIGRATIONS[2] = async (doc) => { await doc.update({...}); };
 */
export const MIGRATIONS = {};

/**
 * Штамп версии в объект флагов создаваемого документа (до Item.create).
 * @param {object} flags — объект flags, который будет записан в документ
 */
export function stampFormatVersion(flags) {
  foundry.utils.setProperty(flags, `${MODULE_ID}.formatVersion`, FORMAT_VERSION);
}

/** Документ создан модулем? (есть служебные флаги okassen) */
function isForgeDocument(doc) {
  return doc.flags?.[MODULE_ID] !== undefined;
}

/** Прогнать один документ через все недостающие шаги миграции. */
async function migrateDocument(doc) {
  let version = Number(doc.getFlag(MODULE_ID, "formatVersion") ?? 0);
  if (version >= FORMAT_VERSION) return false;
  for (let v = version + 1; v <= FORMAT_VERSION; v++) {
    const fn = MIGRATIONS[v];
    if (fn) await fn(doc);
  }
  await doc.setFlag(MODULE_ID, "formatVersion", FORMAT_VERSION);
  return true;
}

/**
 * Миграция всего мира. Вызывается на ready только у ведущего.
 * Ошибка на одном документе не прерывает остальные.
 */
export async function migrateWorld() {
  if (!game.user.isGM) return;

  // Быстрый выход: миграций нет — сканировать нечего, кроме документов
  // совсем без штампа, которые тоже трогать не нужно, пока FORMAT_VERSION === 1
  // и MIGRATIONS пуст (формат 0 и формат 1 совпадают по содержимому).
  const hasSteps = Object.keys(MIGRATIONS).length > 0;
  if (!hasSteps) return;

  const targets = [];
  for (const item of game.items) if (isForgeDocument(item)) targets.push(item);
  for (const actor of game.actors) {
    if (isForgeDocument(actor)) targets.push(actor);
    for (const item of actor.items) if (isForgeDocument(item)) targets.push(item);
  }

  let migrated = 0;
  for (const doc of targets) {
    try {
      if (await migrateDocument(doc)) migrated++;
    } catch (err) {
      console.error(`[okassen] Миграция документа "${doc.name}" не удалась:`, err);
    }
  }
  if (migrated) {
    console.log(`[okassen] Мигрировано документов: ${migrated} (формат ${FORMAT_VERSION})`);
    ui.notifications.info(game.i18n.format("OKASSEN.notify.migrated", { count: migrated, version: FORMAT_VERSION }));
  }
}
