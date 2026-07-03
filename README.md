# Okassen: Better JSON Integration (BJI)
## En:
Loader of extended JSON for Foundry VTT 13 + dnd5e 4.4.4. Accepts a regular dnd5e item JSON with an additional `_forge` block and programmatically builds Active Effects, nested items, and onUse logic.

## Installation

Copy (or symlink) the `okassen` folder into `Data/modules/` of your Foundry installation and enable the module in your world. The folder name must be exactly `okassen` — it matches the module's `id`.

## Usage

1. Open the **Items** tab in the sidebar — an **"Okassen Import"** button appears in the header.
2. Paste JSON into the window, optionally specify the target actor's UUID (right-click an actor → "Copy UUID"; empty = create the item in the world).
3. Click **"Create"**. The window stays open — you can import several items in a row.

Programmatic access: `game.modules.get("okassen").api` — `createForgeItem(json, { target })`, `registerHandler(id, fn)`, `MECHANICS`, `openImportDialog()`.

## `_forge` format

```json
{
  "name": "Copper Staff of Adaptation",
  "type": "weapon",
  "img": "icons/weapons/staves/staff-ornate-red.webp",
  "system": {
    "description": { "value": "<p>A dwarven artifact...</p>" },
    "equipped": true
  },
  "_forge": {
    "effects": [
      {
        "label": "First Seal",
        "icon": "icons/magic/light/orb-lightbulb-gray.webp",
        "disabled": false,
        "transfer": true,
        "changes": [
          { "mechanic": "damage.melee.bonus", "value": "1d4" },
          { "mechanic": "ac.bonus", "value": 1 }
        ]
      }
    ],
    "nested": [
      {
        "name": "Staff Strike (form)",
        "type": "feat",
        "system": { "description": { "value": "<p>Bearer's ability.</p>" } }
      }
    ],
    "onUse": "log",
    "extraFlags": { "okassen": { "sealsTotal": 7 } }
  }
}
```

- `effects[]` → Active Effects on the item (`label`→`name`, `icon`→`img`, `transfer: true` by default — the effect transfers to the bearer when equipped).
- `changes[]` → either `{ "mechanic": "...", "value": ... }` via the mechanics dictionary, or a "raw" `{ "key": "system....", "mode": 2, "value": "..." }` bypassing the dictionary.
- `nested[]` → nested items (they may have their own `_forge`, depth ≤ 2).
- `onUse` → id of a registered handler (demo: `"log"` writes to chat). **The only part that requires the module to be enabled after the item is created.**
- `extraFlags` → merged into the item's `flags`.
- The original input is saved in `flags.okassen.source`; the `_forge` key itself does not end up in the item's data.

## Mechanics dictionary

Full list — in `scripts/mechanics.js` (or `api.MECHANICS` in the console). Main ones: `damage.melee.bonus`, `damage.ranged.bonus`, `damage.spell.bonus`, `attack.melee.bonus`, `ac.bonus`, `ac.flat`, `hp.max.bonus`, `speed.walk`, `speed.fly`, `ability.<str|dex|con|int|wis|cha>`, `save.<abbr>.bonus`, `check.<abbr>.bonus`, `skill.<abbr>.bonus` (all 18 skills), `init.bonus`, `advantage.init`, `save.all.bonus`, `resistance.add`, `immunity.add`, `vulnerability.add`.

Honest limitations:

- **Advantage/disadvantage** (except `advantage.init`) does not work through Active Effects in pure dnd5e 4.4.4 — the validator will reject it with an explanation; midi-qol is required (its keys can be passed via a "raw" change).
- **`ac.flat`** is applied by the system only when AC is calculated as "Flat" (`system.attributes.ac.calc === "flat"`).
- **`hp.max.bonus`** exists only on characters (NPCs have no bonuses field).
- **`resistance.add` / `immunity.add` / `vulnerability.add`** — the value must be a valid damage type from `CONFIG.DND5E.damageTypes` (e.g. `"fire"`).

## Custom onUse handlers

```js
game.modules.get("okassen").api.registerHandler("staff-of-adaptation", ({ item, actor }) => {
  // your logic: item — the used item, actor — its owner
});
```
-------------------------------------------------------------------------------

## Ru:
Загрузчик расширенного JSON для Foundry VTT 13 + dnd5e 4.4.4. Принимает обычный
JSON предмета dnd5e с дополнительным блоком `_forge` и программно достраивает
Active Effects, вложенные предметы и onUse-логику.

## Установка

Скопируйте (или слинкуйте) папку `okassen` в `Data/modules/` вашей инсталляции
Foundry и включите модуль в мире. Имя папки должно быть именно `okassen` —
оно совпадает с `id` модуля.

## Использование

1. Откройте вкладку **Предметы** в сайдбаре — в шапке появится кнопка
   **«Импорт Окассен»**.
2. Вставьте JSON в окно, при желании укажите UUID актёра-цели
   (ПКМ по актёру → «Копировать UUID»; пусто = создать предмет в мире).
3. Нажмите **«Создать»**. Окно не закрывается — можно импортировать несколько
   предметов подряд.

Программный доступ: `game.modules.get("okassen").api` —
`createForgeItem(json, { target })`, `registerHandler(id, fn)`, `MECHANICS`,
`openImportDialog()`.

## Формат `_forge`

```json
{
  "name": "Медный Посох Адаптации",
  "type": "weapon",
  "img": "icons/weapons/staves/staff-ornate-red.webp",
  "system": {
    "description": { "value": "<p>Дварфийский артефакт...</p>" },
    "equipped": true
  },
  "_forge": {
    "effects": [
      {
        "label": "Первая печать",
        "icon": "icons/magic/light/orb-lightbulb-gray.webp",
        "disabled": false,
        "transfer": true,
        "changes": [
          { "mechanic": "damage.melee.bonus", "value": "1d4" },
          { "mechanic": "ac.bonus", "value": 1 }
        ]
      }
    ],
    "nested": [
      {
        "name": "Удар посоха (форма)",
        "type": "feat",
        "system": { "description": { "value": "<p>Способность носителя.</p>" } }
      }
    ],
    "onUse": "log",
    "extraFlags": { "okassen": { "sealsTotal": 7 } }
  }
}
```

- `effects[]` → Active Effects на предмете (`label`→`name`, `icon`→`img`,
  `transfer: true` по умолчанию — эффект переносится на носителя при экипировке).
- `changes[]` → либо `{ "mechanic": "...", "value": ... }` через словарь механик,
  либо «сырой» `{ "key": "system....", "mode": 2, "value": "..." }` в обход словаря.
- `nested[]` → вложенные предметы (сами могут иметь `_forge`, глубина ≤ 2).
- `onUse` → id зарегистрированного обработчика (демо: `"log"` пишет в чат).
  **Единственная часть, требующая включённого модуля после создания предмета.**
- `extraFlags` → мержится во `flags` предмета.
- Оригинальный вход сохраняется в `flags.okassen.source`; сам ключ `_forge`
  в данные предмета не попадает.

## Словарь механик

Полный список — в `scripts/mechanics.js` (или `api.MECHANICS` в консоли).
Основные: `damage.melee.bonus`, `damage.ranged.bonus`, `damage.spell.bonus`,
`attack.melee.bonus`, `ac.bonus`, `ac.flat`, `hp.max.bonus`, `speed.walk`,
`speed.fly`, `ability.<str|dex|con|int|wis|cha>`, `save.<abbr>.bonus`,
`check.<abbr>.bonus`, `skill.<abbr>.bonus` (все 18 навыков), `init.bonus`,
`advantage.init`, `save.all.bonus`, `resistance.add`, `immunity.add`,
`vulnerability.add`.

Честные ограничения:

- **Преимущество/помеха** (кроме `advantage.init`) в чистой dnd5e 4.4.4 через
  Active Effects не работает — валидатор откажет с пояснением; нужен midi-qol
  (его ключи можно передать «сырым» change'ем).
- **`ac.flat`** применяется системой только при расчёте AC «Flat»
  (`system.attributes.ac.calc === "flat"`).
- **`hp.max.bonus`** есть только у персонажей (у NPC поля bonuses нет).
- **`resistance.add` / `immunity.add` / `vulnerability.add`** — значением должен
  быть валидный тип урона из `CONFIG.DND5E.damageTypes` (например `"fire"`).

## Свои onUse-обработчики

```js
game.modules.get("okassen").api.registerHandler("staff-of-adaptation", ({ item, actor }) => {
  // ваша логика: item — использованный предмет, actor — его владелец
});
```