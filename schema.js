/**
 * schema.js — сверка блока system с живой моделью данных dnd5e.
 *
 * Синтаксически корректный JSON — ещё не корректный предмет: Foundry МОЛЧА
 * выбрасывает поля, которых нет в схеме документа (SchemaField.clean).
 * Здесь мы обходим raw.system против CONFIG.Item/Actor.dataModels[type].schema
 * и возвращаем предупреждения о неизвестных полях — автор видит опечатку
 * («sistem.attributes», «descriprion») до того, как удивится в игре.
 *
 * Это ПРЕДУПРЕЖДЕНИЯ, не ошибки: рекурсия консервативна — заходим только
 * в SchemaField (жёсткие наборы полей) и элементы массивов; словари
 * (MappingField: activities, tools) и свободные ObjectField принимаем
 * как есть, чтобы не давать ложных срабатываний на полиморфных данных.
 */

/** Максимум перечисляемых полей в одном предупреждении. */
const MAX_LISTED = 8;

/** Поле — SchemaField-подобное (жёсткий набор дочерних полей)? */
function isSchemaLike(field) {
  return field && typeof field === "object" && field.fields
    && field instanceof foundry.data.fields.SchemaField;
}

/**
 * Рекурсивный обход значения против поля схемы.
 * @param {*} value — значение из JSON
 * @param {object} field — DataField, описывающий это значение
 * @param {string} path — путь для сообщений ("system.attributes")
 * @param {string[]} unknown — накопитель путей неизвестных полей
 */
function walkField(value, field, path, unknown) {
  if (value === null || typeof value !== "object") return;

  // Массив против ArrayField/SetField — проверяем элементы.
  if (Array.isArray(value)) {
    const element = field?.element;
    if (!element) return;
    value.forEach((v, i) => walkField(v, element, `${path}[${i}]`, unknown));
    return;
  }

  // Жёсткий набор полей: неизвестные ключи Foundry выбросит — предупреждаем.
  if (isSchemaLike(field)) {
    for (const [k, v] of Object.entries(value)) {
      const child = field.fields[k];
      if (!child) unknown.push(`${path}.${k}`);
      else walkField(v, child, `${path}.${k}`, unknown);
    }
  }
  // Всё остальное (MappingField, ObjectField, полиморфные словари) — принимаем.
}

/**
 * Проверить один документ (предмет или актёра) против модели данных системы.
 * @param {object} raw — распарсенный JSON документа
 * @param {string[]} out — накопитель предупреждений
 */
function analyzeDocument(raw, out) {
  if (!raw || typeof raw !== "object" || typeof raw.type !== "string") return;

  const isActor = raw.type in (CONFIG.Actor?.dataModels ?? {});
  const model = (isActor ? CONFIG.Actor : CONFIG.Item)?.dataModels?.[raw.type];
  if (model?.schema && raw.system && typeof raw.system === "object") {
    const unknown = [];
    walkField(raw.system, model.schema, "system", unknown);
    if (unknown.length) {
      const listed = unknown.slice(0, MAX_LISTED).join(", ");
      const more = unknown.length > MAX_LISTED ? ` (+${unknown.length - MAX_LISTED})` : "";
      out.push(game.i18n.format("OKASSEN.schema.unknownFields", {
        name: raw.name ?? "?",
        fields: listed + more
      }));
    }
  }

  // Вложенные предметы и предметы актёра — тем же проходом.
  for (const def of raw._forge?.nested ?? []) analyzeDocument(def, out);
  for (const def of raw.items ?? []) analyzeDocument(def, out);
}

/**
 * Сверить вход (документ или массив) со схемами системы.
 * @param {object|Array} parsed — распарсенный JSON
 * @returns {string[]} — предупреждения (пусто = все поля известны)
 */
export function analyzeSchema(parsed) {
  const out = [];
  try {
    const docs = Array.isArray(parsed) ? parsed : [parsed];
    for (const doc of docs) analyzeDocument(doc, out);
  } catch (err) {
    // Сверка со схемой — вспомогательная: её сбой не должен ломать импорт.
    console.warn("[okassen] Сверка со схемой системы не удалась:", err);
  }
  return out;
}
