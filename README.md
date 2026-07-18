# Okassen: Better JSON Integration (BJI)
## En:
Loader of extended JSON for Foundry VTT 13/14 + dnd5e 5.x (verified on 5.3.3; keys are backward-compatible with 4.4.4). Accepts a regular dnd5e item or actor JSON with an additional `_forge` block and programmatically builds Active Effects, nested items, lifecycle logic (onUse, equip/turn hooks), over-time damage/healing, and links effects to activities so MidiQOL applies them on a failed save.

## Installation

Copy (or symlink) the `okassen` folder into `Data/modules/` of your Foundry installation and enable the module in your world. The folder name must be exactly `okassen` — it matches the module's `id`.

## Usage

1. Open the **Items** tab in the sidebar — an **"Okassen Import"** button appears in the header.
2. Paste JSON into the window, optionally pick a target actor (UUID), a folder or a compendium.
3. Click **"Create"**. The window stays open — you can import several items in a row.

Window tools:

- **Preview** — dry run: shows the documents, resolved effect changes, nested items, handlers and all warnings without creating anything.
- **History** — every import is logged; **Undo** deletes everything that import created and restores what it replaced.
- **From URL** — fetch JSON by a direct link (gist/GitHub raw); it is only placed into the editor.
- **Handlers** — browser of registered onUse/hook handlers and the world documents referencing them.
- **Export** — item/actor UUID → extended JSON in the editor. Also accepts a **folder UUID** (`Folder.xxx`) or a **pack id** (`world.my-items`) for bulk export as a JSON array.
- **Duplicate protection with diff** — on name+type collision the dialog shows exactly which fields "Replace" would change.
- Import-time checks: unknown `system` fields (dnd5e schema) and mechanics/raw keys that need inactive **midi-qol**/**DAE** produce warnings.

Programmatic access: `game.modules.get("okassen").api` — `createForgeItem(json, { target, folder, pack })`, `createForgeActor`, `importAny`, `preprocess`, `analyzeDependencies`, `analyzeSchema`, `registerHandler(id, fn)`, `MECHANICS`, `buildForgeJson`, `FORMAT_VERSION`, `openImportDialog()`.

## `_forge` format

```json
{
  "name": "Copper Staff of Adaptation",
  "type": "weapon",
  "img": "icons/weapons/staves/staff-ornate-red.webp",
  "system": { "description": { "value": "<p>A dwarven artifact...</p>" }, "equipped": true },
  "_forge": {
    "effects": [
      {
        "label": "First Seal",
        "icon": "icons/magic/light/orb-lightbulb-gray.webp",
        "disabled": false,
        "transfer": true,
        "duration": { "rounds": 10 },
        "changes": [
          { "mechanic": "damage.melee.bonus", "value": "1d4", "type": "fire" },
          { "mechanic": "ac.bonus", "value": 1 },
          { "mechanic": "heal.overTime", "value": "1d4", "turn": "start" }
        ]
      },
      {
        "id": "web-slow",
        "label": "Web Slow",
        "transfer": false,
        "duration": { "rounds": 1 },
        "applyTo": ["mySaveActivityId"],
        "changes": [
          { "mechanic": "disadvantage.attack.all", "value": 1 },
          { "key": "system.attributes.movement.walk", "mode": 1, "value": "0.5" }
        ]
      }
    ],
    "nested": [
      { "name": "Staff Strike (form)", "type": "feat",
        "system": { "description": { "value": "<p>Bearer's ability.</p>" } } }
    ],
    "onUse": "log",
    "onEquip": "my-equip-handler",
    "onTurnStart": "my-turn-handler",
    "extraFlags": { "okassen": { "sealsTotal": 7 } }
  }
}
```

- `effects[]` → Active Effects (`label`→`name`, `icon`→`img`, `transfer: true` by default).
- `changes[]` → `{ "mechanic": "...", "value": ... }` via the mechanics dictionary, or a raw `{ "key", "mode", "value" }`. Damage bonuses accept a `type` field (`"1d4"` + `"fire"` → `1d4[fire]`).
- **`applyTo`** (array of activity ids on the same document) → the effect's id is written into `system.activities.<id>.effects`, so dnd5e/**MidiQOL** apply it to the activity's targets — for a **save** activity, MidiQOL applies it to those who **fail**. No more manual drag-and-drop. Entries may also be objects `{ "activity": "<id>", ...extraFields }`.
- **`id`** (or a raw 16-char `_id`) → a stable effect id. Needed by `applyTo` and by lossless Export→Import round-trips (the same seed always yields the same id, so "Replace" keeps activity links intact). Omit it and Foundry assigns a random id.
- **`statuses`** (array) → condition/status ids shown as token icons (e.g. `"frightened"`, `"poisoned"`). ⚠ In dnd5e 5.x some conditions carry their own rules automation — `restrained`/`grappled` zero the target's speed, `incapacitated` removes actions — so attaching that status can override your own `changes`. Pick a status for its mechanics, not just its icon.
- **`flags`** (object) → passed straight through to the effect: `flags.midi-qol.*`, your own, or `flags.dae.specialDuration` (e.g. `["1Attack"]`) — note that specialDuration was a Times-Up trigger; there is no Times-Up for Foundry v14, and core v14+ auto-removes effects by their normal `duration` instead, so prefer plain durations.
- **`tint`** → icon tint color.
- `nested[]` → nested items (own `_forge` allowed, depth ≤ 2).
- `onUse` → handler id fired on item use.
- **Lifecycle hooks**: `onEquip` / `onUnequip` / `onCreate` / `onDelete` / `onTurnStart` / `onTurnEnd` — same handler registry. Actors support `onTurnStart`/`onTurnEnd` in their own `_forge`.
- `extraFlags` → merged into the document's `flags`.
- Created documents are stamped with `flags.okassen.formatVersion` — future module versions can migrate them.

**Snippets and variables**: a top-level `_defs` block defines reusable fragments referenced anywhere via `{ "$ref": "name", ...overrides }`; `_vars` + `{{expressions}}` (arithmetic, `floor/ceil/round/abs/min/max`) let one template scale. In a batch array the first element may be a header `{ "_defs": ..., "_vars": ... }` shared by all documents.

## Mechanics dictionary

Full list — in `scripts/mechanics.js` (or `api.MECHANICS`). Highlights: `damage.*.bonus` / `attack.*.bonus` (weapon & spell), `ac.bonus`, `hp.max.bonus`, `hp.temp`, `speed.*`, `ability.<abbr>`, `save/check/skill bonuses`, `init.bonus`, `advantage.init`, `resistance/immunity/vulnerability.add`, `conditionImmunity.add`, `language.add`, `proficiency.weapon/armor/tool.add`, `senses.*`, `spell.dc.bonus`, `crit.*.threshold`, **`damage.overTime` / `heal.overTime`** (per-turn damage/healing: with midi-qol → `flags.midi-qol.OverTime`, without it → a built-in turn handler).

**midi-qol-only mechanics** (curated; require midi-qol active — otherwise the import refuses with an explanation, same as `advantage.*`): `grants.advantage.attack.all` / `grants.disadvantage.attack.all` (attackers roll against the bearer with advantage/disadvantage), `fail.save.all` / `fail.check.all` (the bearer auto-fails saves/checks), `dr.all` / `dr.nonmagical` (flat damage reduction; value is a number/formula).

**overTime `condition`**: `damage.overTime` / `heal.overTime` accept an optional `condition` (a midi-qol expression) → `applyCondition=` on the OverTime flag. Example: `{ "mechanic": "heal.overTime", "value": "5", "condition": "!@flags.okassen.regenBlocked" }` — regeneration self-skips while that actor flag is set. Only works with midi-qol.

Honest limitations:

- **Advantage/disadvantage** (except `advantage.init`) needs midi-qol; when midi-qol is active, `advantage.*`/`disadvantage.*` mechanics expand to its flags automatically, otherwise the validator refuses with an explanation.
- The built-in overTime path (no midi) cannot roll saves and needs the module enabled during combat.
- **`ac.flat`** only applies when AC calculation is "Flat"; **`hp.max.bonus`** exists on characters only.
- `resistance/immunity/vulnerability.add` values must be valid damage types; `proficiency.tool.add` value must be a tool id.
- **onUse, lifecycle hooks and built-in overTime require the module to stay enabled.** Effects and nested items keep working without it.

## Custom handlers

```js
game.modules.get("okassen").api.registerHandler("my-staff", ({ item, actor, trigger }) => {
  // your logic; trigger: "use" | "equip" | "unequip" | "create" | "delete" | "turnStart" | "turnEnd"
});
```

Or create a script macro named `okassen:<id>` — no code files needed.

-------------------------------------------------------------------------------

## Ru:
Загрузчик расширенного JSON для Foundry VTT 13/14 + dnd5e 5.x (проверено на
5.3.3; ключи совместимы с 4.4.4). Принимает обычный JSON предмета или актёра
dnd5e с дополнительным блоком `_forge` и программно достраивает Active Effects,
вложенные предметы, логику жизненного цикла (onUse, хуки экипировки/хода),
урон/лечение по ходам и привязку эффектов к активностям — чтобы MidiQOL сам
накладывал их при провале спасброска.

## Установка

Скопируйте (или слинкуйте) папку `okassen` в `Data/modules/` вашей инсталляции
Foundry и включите модуль в мире. Имя папки должно быть именно `okassen` —
оно совпадает с `id` модуля.

## Использование

1. Откройте вкладку **Предметы** в сайдбаре — в шапке появится кнопка
   **«Импорт Окассен»**.
2. Вставьте JSON в окно; при желании укажите актёра-цель (UUID), папку
   или компендиум.
3. Нажмите **«Создать»**. Окно не закрывается — можно импортировать несколько
   документов подряд.

Инструменты окна:

- **Предпросмотр** — сухой прогон: документы, развёрнутые changes, вложения,
  обработчики и все предупреждения — без создания чего-либо.
- **История** — каждый импорт логируется; «Отменить» удаляет созданное этим
  импортом и восстанавливает заменённое.
- **Из URL** — подтянуть JSON по прямой ссылке (raw-ссылка gist/GitHub);
  файл только подставляется в редактор.
- **Обработчики** — браузер зарегистрированных onUse/хук-обработчиков и
  документов мира, которые на них ссылаются.
- **Экспорт** — UUID предмета/актёра → расширенный JSON в редакторе. Поле
  принимает также **UUID папки** (`Folder.xxx`) и **id компендиума**
  (`world.my-items`) — массовый экспорт JSON-массивом.
- **Защита от дублей с diff** — при совпадении имени и типа диалог показывает,
  какие именно поля изменит «Заменить».
- Проверки при импорте: неизвестные поля `system` (сверка со схемой dnd5e)
  и механики/сырые ключи, требующие неактивных **midi-qol**/**DAE**, дают
  предупреждения.

Программный доступ: `game.modules.get("okassen").api` —
`createForgeItem(json, { target, folder, pack })`, `createForgeActor`, `importAny`,
`preprocess`, `analyzeDependencies`, `analyzeSchema`, `registerHandler(id, fn)`,
`MECHANICS`, `buildForgeJson`, `FORMAT_VERSION`, `openImportDialog()`.

## Формат `_forge`

Пример — в английской половине выше (формат общий). Ключевое:

- `effects[]` → Active Effects (`label`→`name`, `icon`→`img`, `transfer: true`
  по умолчанию).
- `changes[]` → `{ "mechanic": "...", "value": ... }` через словарь механик либо
  «сырой» `{ "key", "mode", "value" }`. У бонусов урона есть поле `type`
  (`"1d4"` + `"fire"` → `1d4[fire]`).
- **`applyTo`** (массив id активностей этого же документа) → id эффекта дописывается
  в `system.activities.<id>.effects`, и dnd5e/**MidiQOL** накладывают эффект на цель
  активности; для **save**-активности MidiQOL вешает его на **провалившего**
  спасбросок. Больше не нужно тащить эффект вручную. Элемент может быть и объектом
  `{ "activity": "<id>", ...доп.поля }`.
- **`id`** (или «сырой» 16-символьный `_id`) → стабильный id эффекта. Нужен для
  `applyTo` и для round-trip экспорта (одно и то же семя даёт тот же id, поэтому
  «Заменить» не рвёт привязки активностей). Без него Foundry присвоит случайный.
- **`statuses`** (массив) → id состояний/condition (иконки на токене:
  `"frightened"`, `"poisoned"` и т.д.). ⚠ В dnd5e 5.x часть состояний несёт
  собственную автоматику правил: `restrained`/`grappled` зануляют скорость цели,
  `incapacitated` убирает действия — такой статус может перебить ваши `changes`.
  Выбирайте состояние по его механике, а не только по иконке.
- **`flags`** (объект) → пробрасывается в эффект как есть: `flags.midi-qol.*`,
  свои, либо `flags.dae.specialDuration` (напр. `["1Attack"]`) — но это был
  триггер Times-Up, которого для Foundry v14 нет; ядро v14+ само снимает эффекты
  по обычному полю `duration`, поэтому лучше задавать обычные длительности.
- **`tint`** → цвет-оттенок иконки эффекта.
- `nested[]` → вложенные предметы (свой `_forge`, глубина ≤ 2).
- `onUse` → id обработчика при использовании предмета.
- **Хуки жизненного цикла**: `onEquip` / `onUnequip` / `onCreate` / `onDelete` /
  `onTurnStart` / `onTurnEnd` — тот же реестр обработчиков. У актёров в их
  `_forge` поддерживаются `onTurnStart`/`onTurnEnd`.
- `extraFlags` → мержится во `flags` документа.
- Созданные документы штампуются `flags.okassen.formatVersion` — будущие версии
  модуля смогут их мигрировать.

**Сниппеты и переменные**: блок `_defs` описывает переиспользуемые фрагменты,
на которые можно ссылаться через `{ "$ref": "имя", ...переопределения }`;
`_vars` + `{{выражения}}` (арифметика, `floor/ceil/round/abs/min/max`) позволяют
масштабировать один шаблон. В пакетном массиве первым элементом может идти общий
заголовок `{ "_defs": ..., "_vars": ... }`.

## Словарь механик

Полный список — в `scripts/mechanics.js` (или `api.MECHANICS`). Главное:
`damage.*.bonus` / `attack.*.bonus` (оружие и заклинания), `ac.bonus`,
`hp.max.bonus`, `hp.temp`, `speed.*`, `ability.<abbr>`, бонусы спасбросков/
проверок/навыков, `init.bonus`, `advantage.init`, `resistance/immunity/
vulnerability.add`, `conditionImmunity.add`, `language.add`,
`proficiency.weapon/armor/tool.add`, `senses.*`, `spell.dc.bonus`,
`crit.*.threshold`, **`damage.overTime` / `heal.overTime`** (урон/лечение по
ходам: с midi-qol → `flags.midi-qol.OverTime`, без него — встроенный обработчик
хода).

**Механики только для midi-qol** (курированные; требуют активного midi-qol —
иначе импорт честно откажет, как и `advantage.*`): `grants.advantage.attack.all` /
`grants.disadvantage.attack.all` (атакующие бьют по носителю с преимуществом/
помехой), `fail.save.all` / `fail.check.all` (носитель автоматически проваливает
спасброски/проверки), `dr.all` / `dr.nonmagical` (плоское снижение урона; значение —
число/формула).

**`condition` у overTime**: `damage.overTime` / `heal.overTime` принимают
необязательное `condition` (выражение midi-qol) → `applyCondition=` во флаге
OverTime. Пример: `{ "mechanic": "heal.overTime", "value": "5", "condition":
"!@flags.okassen.regenBlocked" }` — регенерация сама пропускает ход, пока стоит
флаг актёра. Работает только с midi-qol.

Честные ограничения:

- **Преимущество/помеха** (кроме `advantage.init`) требует midi-qol; при активном
  midi механики `advantage.*`/`disadvantage.*` разворачиваются в его флаги
  автоматически, без него валидатор откажет с пояснением.
- Встроенный путь overTime (без midi) не умеет спасброски и требует включённый
  модуль во время боя.
- **`ac.flat`** действует только при расчёте AC «Flat»; **`hp.max.bonus`** есть
  только у персонажей.
- Значения `resistance/immunity/vulnerability.add` — валидные типы урона;
  значение `proficiency.tool.add` — id инструмента.
- **onUse, хуки жизненного цикла и встроенный overTime требуют включённого
  модуля.** Эффекты и вложения работают и без него.

## Свои обработчики

```js
game.modules.get("okassen").api.registerHandler("my-staff", ({ item, actor, trigger }) => {
  // ваша логика; trigger: "use" | "equip" | "unequip" | "create" | "delete" | "turnStart" | "turnEnd"
});
```

Либо скрипт-макрос с именем `okassen:<id>` — без файлов и перезагрузок.
