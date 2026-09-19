# Okassen: Better JSON Integration (BJI)
## En:
Loader of extended JSON for Foundry VTT 13/14 + dnd5e 5.x (verified on 5.3.3; keys are backward-compatible with 4.4.4). Accepts a regular dnd5e item or actor JSON with an additional `_forge` block and programmatically builds Active Effects, nested items, lifecycle logic (onUse, equip/turn hooks), over-time damage/healing, and links effects to activities so MidiQOL applies them on a failed save.

## Installation

In Foundry: **Configuration → Add-on Modules → Install Module**, paste this into the **Manifest URL** field:

```
https://github.com/Void6Dev/Okassen-Foundry-Module-/releases/latest/download/module.json
```

Then enable the module in your world. The link always resolves to the newest release, so Foundry picks up updates on its own.

Manual install: copy (or symlink) the `okassen` folder into `Data/modules/` of your Foundry installation. The folder name must be exactly `okassen` — it matches the module's `id`.

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
- **Repeated import** — when the document already exists (matching `_forge.sourceId`, or name and type), the dialog shows a diff and offers **Update in place** (keeps uuid, folder, permissions and inventory position — only the content changes), **Replace** (delete and re-create) or **Create a copy**. The default answer is a module setting; batch import applies it silently. Note: an update is a rebuild, not a merge — `system` is replaced wholesale, so a field missing from the JSON returns to the system default.
- **Live `_forge` check** — under the editor: unknown mechanics and handlers, `applyTo` pointing at a missing activity, unknown statuses, dependency and schema warnings. Click "line N" to jump there.
- Import-time checks: unknown `system` fields (dnd5e schema) and mechanics/raw keys that need inactive **midi-qol**/**DAE** produce warnings.

Module settings (Configure Settings → Module Settings): duplicate handling, import-history size, nesting depth, schema warnings, live check, guide journal creation.

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
- **Lifecycle hooks**: `onEquip` / `onUnequip` / `onCreate` / `onDelete` / `onTurnStart` / `onTurnEnd` / `onRest` / `onDamaged` / `onHealed` / `onCombatStart` / `onCombatEnd` — same handler registry. Context carries the event details: `restType` + `rest`, `delta` + `hp` + `previousHp`, `combat`. Actors support everything except the item-only hooks (`onEquip`, `onCreate`, `onDelete`) in their own `_forge`. Turn, rest, hp and combat hooks are handled by the active GM, so they fire once rather than on every client.
- **`sourceId`** (string) → a stable identifier of your own (`"okassen.copper-staff"`). A repeated import looks the document up by it first and only then by name+type, so renaming the document in the world does not break updating. Round-trips through export.
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

## Built-in handlers

`"log"`, `"seals"`, **`"transform"` / `"revert"`**, plus general-purpose ones: `"chatCard"`, `"applyEffect"`, `"toggleEffect"`, `"rollTable"`, `"summon"`, `"macro"`.

Each reads its config from the flag of the same name (a bare string is shorthand for the main field):

| Handler | Config (`flags.okassen.<id>`) | What it does |
| --- | --- | --- |
| `chatCard` | `"text"` or `{ content, flavor, whisper: "gm" }` | Chat message; `{item}`, `{actor}`, `{target}` are substituted |
| `applyEffect` | `{ effect, to: "targets"\|"self"\|"both", duration, stack }` | Applies the item's effect to the targeted tokens (or the bearer). Without `effect` — every effect with `"transfer": false`. Re-use does not stack duplicates unless `stack: true` |
| `toggleEffect` | `{ effect }` or `{ status: "prone" }` | Toggles one of the item's effects, or a condition on the bearer |
| `rollTable` | `{ table, roll, rollMode }` | Draws from a RollTable (uuid or name) |
| `summon` | `{ actor, count, name, distance, disposition }` | Places tokens of another actor around the bearer (GM only) |
| `macro` | `{ macro, args }` | Runs a macro by name/uuid; `args` arrive as variables next to `item`/`actor`/`trigger` |

```json
"_forge": {
  "onUse": "applyEffect",
  "extraFlags": { "okassen": { "applyEffect": { "effect": "Web Slow", "to": "targets" } } }
}
```

Applying an effect to an actor the player does not own is refused by Foundry — the handler says so instead of failing silently.

**`transform` — turn the bearer into another actor with no sidebar clone and no macro.** Plain dnd5e polymorph creates a new `Name (Form)` actor whenever the token is linked; the handler unlinks the token first, so the new form is written into the token's `ActorDelta` (the only clone-free branch of `Actor5e#transformInto`, verified against dnd5e 5.3.3). The world actor and its sheet stay untouched; reverting just re-links the token, so a player can do it without GM token-creation rights.

```json
"_forge": {
  "onUse": "transform",
  "extraFlags": { "okassen": { "transform": {
    "target": "Actor.m11cHsUGypU1dZBs",
    "preset": "polymorph",
    "toggle": true
  } } }
}
```

Config (`flags.okassen.transform`; a bare string is shorthand for `target`):

- `target` — uuid of the actor to become (world or compendium). Required.
- `preset` — dnd5e preset: `polymorph` | `wildshape` | `polymorphSelf`; `settings` overrides single `TransformationSetting` fields (`keep`, `merge`, `effects`, `minimumAC`, `tempFormula`…).
- `toggle` (default `true`) — using the item again reverts the form; `"revert"` is also available as a standalone handler id.
- `unlink` (default `true`) — allow unlinking a linked token. With `false` a linked token is refused instead of transformed (no clone is created either way).
- `returnItem` (default `true`) — drop a "Return to normal form" feat into the new shape, so reverting is one click on the beast's sheet (the source spell/feat stays with the original actor and is not available while transformed). The item lives in the token delta and disappears with the form.
- `only` — uuid/id (or an array) of the actor allowed to use it; `renderSheet` — open the new form's sheet.

Requirements: the bearer needs a **token on the scene** (the form lives in the token), and players need the dnd5e "Allow Polymorphing" setting. Ready-made item: [`examples/transform.json`](examples/transform.json).

## Custom handlers

```js
game.modules.get("okassen").api.registerHandler("my-staff", ({ item, actor, trigger }) => {
  // your logic; trigger: "use" | "equip" | "unequip" | "create" | "delete"
  //                     | "turnStart" | "turnEnd" | "rest" | "damaged" | "healed"
  //                     | "combatStart" | "combatEnd"
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

В Foundry: **Настройка → Модули → Установить модуль**, вставьте в поле
**Manifest URL**:

```
https://github.com/Void6Dev/Okassen-Foundry-Module-/releases/latest/download/module.json
```

Затем включите модуль в мире. Ссылка всегда ведёт на свежий релиз, поэтому
обновления Foundry подтянет сам.

Вручную: скопируйте (или слинкуйте) папку `okassen` в `Data/modules/` вашей
инсталляции Foundry. Имя папки должно быть именно `okassen` — оно совпадает
с `id` модуля.

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
- **Повторный импорт** — если документ уже есть (совпал `_forge.sourceId` либо
  имя и тип), диалог показывает diff и предлагает **«Обновить на месте»**
  (документ остаётся тем же: uuid, папка, права и место в инвентаре сохраняются,
  меняется только содержимое), **«Заменить»** (удалить и создать заново) или
  **«Создать копию»**. Ответ по умолчанию задаётся настройкой модуля; пакетный
  импорт применяет его молча. Обновление — это пересборка, а не слияние: блок
  `system` заменяется целиком, поэтому поле, которого нет в JSON, вернётся
  к умолчанию системы.
- **Живая проверка `_forge`** — под редактором: неизвестные механики и
  обработчики, `applyTo` на несуществующую активность, неизвестные состояния,
  предупреждения о зависимостях и схеме. Клик по «строка N» — переход к месту.
- Проверки при импорте: неизвестные поля `system` (сверка со схемой dnd5e)
  и механики/сырые ключи, требующие неактивных **midi-qol**/**DAE**, дают
  предупреждения.

Настройки модуля (**Настройка → Настройки модулей**): что делать с дубликатом,
размер истории импорта, глубина вложений, предупреждения о схеме, живая
проверка, создание журнала-руководства.

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
  `onTurnStart` / `onTurnEnd` / `onRest` / `onDamaged` / `onHealed` /
  `onCombatStart` / `onCombatEnd` — тот же реестр обработчиков. В контексте
  приходят подробности события: `restType` + `rest`, `delta` + `hp` +
  `previousHp`, `combat`. У актёров в их `_forge` поддерживается всё, кроме
  предметных хуков (`onEquip`, `onCreate`, `onDelete`). Ходовые хуки, отдых,
  хиты и бой обрабатывает активный ведущий — событие срабатывает один раз,
  а не у каждого клиента.
- **`sourceId`** (строка) → собственный стабильный идентификатор
  (`"okassen.copper-staff"`). Повторный импорт ищет документ сначала по нему
  и только потом по имени и типу, поэтому переименование документа в мире не
  мешает обновлению. Переживает круг «экспорт → импорт».
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

## Встроенные обработчики

`"log"`, `"seals"`, **`"transform"` / `"revert"`** и обработчики общего
назначения: `"chatCard"`, `"applyEffect"`, `"toggleEffect"`, `"rollTable"`,
`"summon"`, `"macro"`.

Каждый читает конфиг из одноимённого флага (строка = краткая запись главного поля):

| Обработчик | Конфиг (`flags.okassen.<id>`) | Что делает |
| --- | --- | --- |
| `chatCard` | `"текст"` или `{ content, flavor, whisper: "gm" }` | Сообщение в чат; подставляет `{item}`, `{actor}`, `{target}` |
| `applyEffect` | `{ effect, to: "targets"\|"self"\|"both", duration, stack }` | Накладывает эффект предмета на выбранные цели (или на носителя). Без `effect` — все эффекты с `"transfer": false`. Повторное применение не копит дубли, если не задан `stack: true` |
| `toggleEffect` | `{ effect }` или `{ status: "prone" }` | Переключает эффект предмета или состояние носителя |
| `rollTable` | `{ table, roll, rollMode }` | Бросок по таблице (uuid или имя) |
| `summon` | `{ actor, count, name, distance, disposition }` | Ставит токены другого актёра вокруг носителя (только ведущий) |
| `macro` | `{ macro, args }` | Вызывает макрос по имени/uuid; `args` приходят переменными рядом с `item`/`actor`/`trigger` |

```json
"_forge": {
  "onUse": "applyEffect",
  "extraFlags": { "okassen": { "applyEffect": { "effect": "Паутина", "to": "targets" } } }
}
```

Наложить эффект на чужого актёра Foundry игроку не даст — обработчик честно
сообщает об этом, а не молчит.

**`transform` — превращает носителя в другого актёра без клона в сайдбаре и без макроса.** Штатное превращение dnd5e для связанного токена создаёт актёра «Имя (Форма)» — клона; обработчик сначала отвязывает токен, поэтому новая форма пишется в `ActorDelta` самого токена (единственная ветка `Actor5e#transformInto` без клона, сверено с dnd5e 5.3.3). Мировой актёр и его лист не меняются, а возврат — это просто восстановление связи токена, поэтому он доступен игроку без прав на создание токенов.

```json
"_forge": {
  "onUse": "transform",
  "extraFlags": { "okassen": { "transform": {
    "target": "Actor.m11cHsUGypU1dZBs",
    "preset": "polymorph",
    "toggle": true
  } } }
}
```

Конфиг (`flags.okassen.transform`; строка вместо объекта = только `target`):

- `target` — uuid актёра, в которого превращаемся (мир или компендиум). Обязателен.
- `preset` — пресет dnd5e: `polymorph` | `wildshape` | `polymorphSelf`; `settings` точечно переопределяет поля `TransformationSetting` (`keep`, `merge`, `effects`, `minimumAC`, `tempFormula`…).
- `toggle` (по умолчанию `true`) — повторное использование возвращает исходную форму; есть и отдельный обработчик `"revert"`.
- `unlink` (по умолчанию `true`) — можно ли отвязывать связанный токен. При `false` связанный токен не превращается вовсе (клон не создаётся в любом случае).
- `returnItem` (по умолчанию `true`) — положить в новую форму черту «Вернуть облик», чтобы возврат был в один клик с листа зверя (исходное заклинание/черта остаётся у исходного актёра и в форме недоступно). Предмет живёт в дельте токена и исчезает вместе с формой.
- `only` — uuid/id (или массив) актёра, у которого предмет работает; `renderSheet` — открывать лист новой формы.

Требования: у носителя должен быть **токен на сцене** (форма живёт в токене), а игрокам нужна настройка dnd5e «Разрешить игрокам превращения». Готовый предмет: [`examples/transform.json`](examples/transform.json).

## Свои обработчики

```js
game.modules.get("okassen").api.registerHandler("my-staff", ({ item, actor, trigger }) => {
  // ваша логика; trigger: "use" | "equip" | "unequip" | "create" | "delete"
  //                       | "turnStart" | "turnEnd" | "rest" | "damaged" | "healed"
  //                       | "combatStart" | "combatEnd"
});
```

Либо скрипт-макрос с именем `okassen:<id>` — без файлов и перезагрузок.
