/**
 * guide.js — встроенный пример предмета и журнал-руководство.
 *
 * Здесь: EXAMPLE_ITEM (демонстрационный посох, кнопка «Пример» в окне импорта)
 * и создание/открытие журнала с руководством по формату _forge.
 * Журнал создаётся один раз (флаг в настройках мира); если ведущий его удалил —
 * кнопка «Руководство» в окне импорта создаст его заново по требованию.
 */

const MODULE_ID = "okassen";

/**
 * Версия содержимого руководства. Повышайте при изменении GUIDE_HTML —
 * существующий журнал в мире будет обновлён автоматически при загрузке.
 */
const GUIDE_VERSION = 8;

/**
 * Демонстрационный предмет: показывает все возможности формата разом —
 * два эффекта (включённый и выключенный), вложенную способность,
 * onUse-обработчик "log" и собственные флаги.
 */
export const EXAMPLE_ITEM = {
  name: "Медный Посох Адаптации",
  type: "weapon",
  img: "icons/weapons/staves/staff-ornate-red.webp",
  system: {
    description: { value: "<p>Дварфийский артефакт. Пример импорта Окассен: два эффекта-печати, вложенная способность и обработчик печатей. Используйте активность «Использование посоха» — каждая трата печати включает следующий выключенный эффект.</p>" },
    equipped: true,
    // Активность dnd5e — «функция самого предмета». Без активности предмет
    // нельзя «использовать», и onUse-обработчик никогда не сработает.
    activities: {
      okassenutility00: {
        _id: "okassenutility00",
        type: "utility",
        name: "Использование посоха",
        activation: { type: "action" }
      }
    }
  },
  _forge: {
    effects: [
      {
        label: "Первая печать",
        icon: "icons/magic/light/orb-lightbulb-gray.webp",
        disabled: false,
        transfer: true,
        changes: [
          { mechanic: "damage.melee.bonus", value: "1d4" },
          { mechanic: "ac.bonus", value: 1 }
        ]
      },
      {
        label: "Вторая печать",
        icon: "icons/magic/light/orb-lightbulb-gray.webp",
        disabled: true,
        transfer: true,
        changes: [
          { mechanic: "save.dex.bonus", value: 2 }
        ]
      },
      {
        label: "Третья печать: живая медь",
        icon: "icons/magic/life/heart-glowing-red.webp",
        disabled: true,
        transfer: true,
        changes: [
          // Лечение по ходам боя: 1 хит в начале хода носителя.
          // С midi-qol развернётся в flags.midi-qol.OverTime, без него
          // сработает встроенный обработчик хода Окассена.
          { mechanic: "heal.overTime", value: "1", turn: "start" }
        ]
      }
    ],
    nested: [
      {
        name: "Удар посоха (форма)",
        type: "feat",
        img: "icons/skills/melee/blade-tip-orange.webp",
        system: { description: { value: "<p>ОТДЕЛЬНАЯ способность (feat), которую носитель получает вместе с посохом. Это не «функция посоха», а второй связанный предмет: при импорте в мир он появится рядом в сайдбаре, а при выдаче посоха актёру — автоматически появится и у актёра. Функции самого посоха (урон, использование) задаются обычными полями system dnd5e.</p>" } }
      }
    ],
    // "seals" — встроенный обработчик печатей: тратит печать и включает
    // следующий выключенный эффект. Количество печатей — в extraFlags ниже.
    onUse: "seals",
    extraFlags: { okassen: { sealsTotal: 7 } }
  }
};

/** HTML-содержимое журнала-руководства (на русском — проект автора русскоязычный). */
export const GUIDE_HTML = `
<h1>Окассен — импорт предметов из JSON</h1>
<p>Модуль принимает обычный JSON предмета dnd5e с дополнительным блоком <code>_forge</code>
и программно достраивает то, что обычный импорт теряет: <strong>Active Effects</strong>,
<strong>вложенные предметы</strong> и <strong>логику при использовании</strong>.</p>

<h2>Как пользоваться</h2>
<ol>
  <li>Откройте вкладку <strong>Предметы</strong> → кнопка <strong>«Импорт Окассен»</strong>.</li>
  <li>Вставьте JSON в большое поле (кнопка <strong>«Пример»</strong> подставит готовый образец).</li>
  <li>При желании укажите <strong>UUID актёра-цели</strong> — предмет будет создан сразу на актёре
      (ПКМ по актёру в сайдбаре → «Копировать UUID»; подходит и UUID токена).
      Пусто — предмет создаётся в мире (сайдбар).</li>
  <li>Нажмите <strong>«Создать»</strong>. Окно не закрывается — можно импортировать несколько подряд.
      Ошибки показываются прямо в окне.</li>
</ol>

<h2>Инструменты окна</h2>
<ul>
  <li><strong>Живая валидация</strong> — под редактором сразу видно, корректен ли JSON;
      при ошибке указывается номер строки.</li>
  <li><strong>«Формат»</strong> — выравнивает отступы вставленного JSON.</li>
  <li><strong>Контекстное автодополнение</strong> — каретка внутри значения
      <code>"mechanic"</code> подсказывает механики с описаниями; внутри
      <code>"value"</code> у механик-множеств — допустимые ключи (типы урона,
      состояния, инструменты); <code>"type"</code> — типы урона или документов;
      <code>"onUse"</code>/<code>"onEquip"</code>/… — зарегистрированные обработчики;
      <code>"turn"</code>/<code>"save"</code> — их словари. Стрелки — выбор,
      Enter/Tab — вставить, Esc — закрыть (Ctrl+Space откроет вручную).
      Под статус-строкой появляется описание механики, на которой стоит каретка.</li>
  <li><strong>Пакетный импорт</strong> — можно вставить <em>массив</em> предметов
      <code>[ {...}, {...} ]</code>: создадутся все, ошибка в одном не прервёт остальные,
      в конце будет сводка.</li>
  <li><strong>Выбор папки</strong> — выпадающий список «Папка»: созданный документ
      сразу ляжет в выбранную папку сайдбара (папки предметов — для предметов,
      актёров — для НИПов). Вложенные предметы попадают в папку родителя.</li>
  <li><strong>Защита от дублей + diff</strong> — если предмет с тем же именем и типом уже
      существует, модуль спросит: <em>Заменить</em> (старый удаляется, новый занимает
      его место и папку), <em>Создать копию</em> или <em>Отмена</em>. Диалог показывает
      <em>что именно изменится</em> — список отличий по полям. Удобно для
      итеративной генерации: поправили JSON → импортировали заново → «Заменить».
      В пакетном импорте вопросов нет — всегда создаются копии.</li>
  <li><strong>«Экспорт»</strong> — обратная операция: вставьте UUID <em>предмета или актёра</em>
      в поле UUID (ПКМ по документу → «Копировать UUID») и нажмите «Экспорт» — расширенный JSON
      появится в редакторе (эффекты сворачиваются обратно в механики, вложения и onUse
      сохраняются; у актёра экспортируются и все его предметы). Тот же пункт есть
      в контекстном меню предмета и актёра в сайдбаре. <em>Массовый экспорт:</em> то же
      поле принимает UUID <strong>папки</strong> (<code>Folder.xxx</code> — вся папка
      с подпапками) и <strong>id компендиума</strong> (<code>world.my-items</code> —
      весь пак) — результат приходит JSON-массивом.</li>
  <li><strong>«Предпросмотр»</strong> — сухой прогон: показывает, какие документы, эффекты
      (с развёрнутыми системными ключами), вложения и обработчики будут созданы,
      плюс все предупреждения — ничего не создавая в мире.</li>
  <li><strong>«История»</strong> — журнал импортов из этого окна. «Отменить» удаляет всё,
      что создал выбранный импорт, и восстанавливает то, что он заменил.</li>
  <li><strong>«Из URL»</strong> — подтянуть JSON по прямой ссылке (raw-ссылка gist/GitHub).
      Файл только подставляется в редактор — импорт остаётся за вами.</li>
  <li><strong>«Обработчики»</strong> — список всех onUse/хук-обработчиков (API + макросы)
      и документов мира, которые на них ссылаются; незарегистрированные подсвечены.</li>
  <li><strong>Компендиум-цель</strong> — выпадающий список «Компендиум»: документы создаются
      сразу в пак (пак должен быть отперт). Вложенные предметы попадают в тот же пак.</li>
  <li><strong>Проверка зависимостей и схемы</strong> — при импорте модуль предупреждает,
      если JSON использует механики или сырые ключи, требующие неактивных midi-qol/DAE,
      и если в <code>system</code> есть поля, которых нет в схеме dnd5e (Foundry молча
      выбросил бы их).</li>
</ul>

<h2>Формат: обычный предмет + блок <code>_forge</code></h2>
<p>Всё, что вне <code>_forge</code>, — стандартные поля предмета dnd5e
(<code>name</code>, <code>type</code>, <code>img</code>, <code>system</code>).
Блок <code>_forge</code> необязателен и в данные предмета не попадает
(оригинал сохраняется в <code>flags.okassen.source</code>).</p>

<h3><code>_forge.effects</code> — активные эффекты</h3>
<p>Каждый элемент становится Active Effect на предмете:</p>
<ul>
  <li><code>label</code> — имя эффекта (можно и <code>name</code>);</li>
  <li><code>icon</code> — иконка (можно и <code>img</code>);</li>
  <li><code>disabled</code> — выключен ли (по умолчанию <code>false</code>);</li>
  <li><code>transfer</code> — переносить на носителя при экипировке (по умолчанию <code>true</code>);</li>
  <li><code>changes</code> — список изменений: <code>{ "mechanic": "ac.bonus", "value": 1 }</code>.
      Значением может быть число или формула-строка вроде <code>"1d4"</code>.</li>
</ul>

<h3>Словарь механик</h3>
<table>
  <thead><tr><th>Механика</th><th>Что делает</th></tr></thead>
  <tbody>
    <tr><td><code>damage.melee.bonus</code> / <code>damage.ranged.bonus</code></td><td>бонус урона ближних / дальних атак оружием</td></tr>
    <tr><td><code>attack.melee.bonus</code> / <code>attack.ranged.bonus</code></td><td>бонус к броскам атаки оружием</td></tr>
    <tr><td><code>damage.spell.bonus</code> / <code>attack.spell.bonus</code></td><td>то же для заклинаний (разворачивается в msak+rsak)</td></tr>
    <tr><td><code>ac.bonus</code></td><td>бонус к классу доспеха</td></tr>
    <tr><td><code>ac.flat</code></td><td>фиксированный AC (работает только при расчёте AC «Flat»)</td></tr>
    <tr><td><code>hp.max.bonus</code></td><td>бонус к максимуму хитов (только персонажи, не NPC)</td></tr>
    <tr><td><code>speed.walk</code> / <code>speed.walk.set</code></td><td>прибавка к скорости / установить скорость</td></tr>
    <tr><td><code>speed.fly</code>, <code>speed.swim</code></td><td>полёт/плавание (повышение до значения)</td></tr>
    <tr><td><code>ability.str</code> … <code>ability.cha</code></td><td>прибавка к значению характеристики (все шесть)</td></tr>
    <tr><td><code>save.str.bonus</code> … / <code>check.str.bonus</code> …</td><td>бонус спасброска / проверки характеристики</td></tr>
    <tr><td><code>skill.&lt;abbr&gt;.bonus</code></td><td>бонус навыка; аббревиатуры: acr, ani, arc, ath, dec, his, ins, itm, inv, med, nat, prc, prf, per, rel, slt, ste, sur</td></tr>
    <tr><td><code>init.bonus</code> / <code>advantage.init</code></td><td>бонус / преимущество на инициативу</td></tr>
    <tr><td><code>save.all.bonus</code>, <code>check.all.bonus</code>, <code>skill.all.bonus</code></td><td>глобальные бонусы ко всем спасброскам/проверкам/навыкам</td></tr>
    <tr><td><code>resistance.add</code>, <code>immunity.add</code>, <code>vulnerability.add</code></td><td>добавить сопротивление/иммунитет/уязвимость; значение — тип урона, например <code>"fire"</code></td></tr>
    <tr><td><code>conditionImmunity.add</code></td><td>иммунитет к состоянию; значение — ключ состояния, например <code>"frightened"</code></td></tr>
    <tr><td><code>language.add</code></td><td>добавить язык (например <code>"elvish"</code>; допускаются и свои)</td></tr>
    <tr><td><code>senses.darkvision</code> / <code>blindsight</code> / <code>tremorsense</code> / <code>truesight</code></td><td>чувство в футах (повышение до значения — не ухудшит уже имеющееся)</td></tr>
    <tr><td><code>spell.dc.bonus</code></td><td>бонус к DC заклинаний</td></tr>
    <tr><td><code>save.concentration.bonus</code></td><td>бонус к спасброскам концентрации</td></tr>
    <tr><td><code>crit.weapon.threshold</code> / <code>crit.spell.threshold</code></td><td>порог крита (например <code>19</code> = крит на 19–20)</td></tr>
    <tr><td><code>hp.temp</code></td><td>временные хиты: «не ниже N, пока эффект активен» (паттерн Героизма); для разовой выдачи используйте onUse</td></tr>
    <tr><td><code>proficiency.weapon.add</code> / <code>proficiency.armor.add</code></td><td>владение оружием/доспехами (категория <code>sim</code>/<code>mar</code>/<code>lgt</code>… или конкретный baseItem)</td></tr>
    <tr><td><code>proficiency.tool.add</code></td><td>владение инструментом; значение — id инструмента (например <code>"thief"</code>)</td></tr>
    <tr><td><code>damage.overTime</code> / <code>heal.overTime</code></td><td>урон/лечение по ходам боя — см. раздел ниже</td></tr>
  </tbody>
</table>
<p><strong>Типизированный урон:</strong> у механик <code>damage.*.bonus</code> можно указать
поле <code>type</code>: <code>{ "mechanic": "damage.melee.bonus", "value": "1d4", "type": "fire" }</code>
— значение станет <code>1d4[fire]</code>, и dnd5e посчитает это уроном огнём.</p>
<p><strong>Преимущество/помеха с midi-qol:</strong> когда midi-qol активен, механики
<code>advantage.*</code> / <code>disadvantage.*</code> (например <code>advantage.attack.mwak</code>,
<code>disadvantage.ability.save.all</code>) автоматически разворачиваются в соответствующие
ключи <code>flags.midi-qol.*</code> (значение ставьте <code>1</code>). Без midi-qol модуль
честно откажет — в чистой dnd5e таких эффектов нет (кроме <code>advantage.init</code>).</p>

<h3><code>damage.overTime</code> / <code>heal.overTime</code> — урон и лечение по ходам</h3>
<pre><code>{ "mechanic": "damage.overTime", "value": "1d6", "type": "fire",
  "turn": "start", "save": "con", "dc": 14 }
{ "mechanic": "heal.overTime", "value": "1d4+1" }</code></pre>
<ul>
  <li><code>value</code> — формула; <code>type</code> — тип урона (обязателен для damage);</li>
  <li><code>turn</code> — <code>"start"</code> (по умолчанию) или <code>"end"</code> хода носителя;</li>
  <li><code>save</code> + <code>dc</code> — спасбросок (работает только с midi-qol).</li>
</ul>
<p>С активным midi-qol механика разворачивается в <code>flags.midi-qol.OverTime</code> —
эффект живёт и без Окассена. Без midi работает встроенный обработчик хода:
он <em>требует включённый модуль</em> и не умеет спасброски (о чём предупредит импорт).</p>
<p>Полный актуальный список — в консоли (F12):
<code>game.modules.get("okassen").api.MECHANICS</code>.</p>

<h3>Сырой change (обход словаря)</h3>
<p>Если нужной механики нет, можно указать системный ключ напрямую:</p>
<pre><code>{ "key": "system.attributes.movement.burrow", "mode": 4, "value": "10" }</code></pre>
<p>Режимы: 0 CUSTOM, 1 MULTIPLY, 2 ADD, 3 DOWNGRADE, 4 UPGRADE, 5 OVERRIDE.</p>

<h3><code>_forge.nested</code> — вложенные предметы</h3>
<p><strong>Важно понимать:</strong> <code>nested</code> — это не «функция предмета»,
а <strong>отдельный связанный предмет</strong> (обычно способность-<code>feat</code>),
который предмет «выдаёт» своему носителю. Сценарий: посох при взятии в руки даёт
носителю новую способность в списке черт.</p>
<ul>
  <li>При импорте <em>в мир</em> вы увидите в сайдбаре два предмета: родителя и вложенный —
      это нормально, они связаны через <code>flags.okassen.nested</code> / <code>.parent</code>.</li>
  <li>Когда родителя перетаскивают на актёра, вложенные предметы автоматически
      создаются у того же актёра.</li>
  <li>При импорте <em>сразу на актёра</em> (поле UUID) — оба появляются на актёре сразу.</li>
  <li>Глубина вложенности — до 2 уровней.</li>
</ul>
<p><strong>Если же нужна функция у самого предмета</strong> (бросок урона, лечение,
использование с зарядами) — это «активности» dnd5e 4.x. Они задаются обычным полем
<code>system.activities</code> в JSON предмета, без участия <code>_forge</code>,
либо добавляются вручную на вкладке «Активности» листа предмета. А реакция модуля
на использование — это <code>_forge.onUse</code> (см. ниже).</p>

<h3><code>_forge.onUse</code> — логика при использовании</h3>
<p>Строка-идентификатор обработчика, который срабатывает при использовании предмета.</p>
<p><strong>Важно:</strong> хук использования в dnd5e 4.x срабатывает только у предметов
с <em>активностями</em>. Если у предмета нет ни одной активности, его нельзя «использовать»
и onUse не сработает — добавьте активность в JSON (<code>system.activities</code>, как в примере)
или на вкладке «Активности» листа предмета.</p>
<p>Встроенные обработчики:</p>
<ul>
  <li><code>"log"</code> — просто пишет в чат, что предмет использован (проверка пайплайна);</li>
  <li><code>"seals"</code> — печати артефакта: предмету нужен флаг
      <code>extraFlags.okassen.sealsTotal</code> (число печатей). Каждое использование тратит
      печать, <strong>включает первый выключенный эффект предмета</strong> и пишет итог в чат.
      Так «Медный Посох Адаптации» открывает свои печати по мере использования.</li>
</ul>
<p>Свои обработчики — двумя способами:</p>
<ol>
  <li><strong>Скрипт-макрос</strong> (проще всего, без кода вне игры): создайте макрос типа
      «скрипт» с именем <code>okassen:&lt;id&gt;</code> — например <code>okassen:heart-of-void</code>
      для предмета с <code>onUse: "heart-of-void"</code>. Внутри макроса доступны переменные
      <code>item</code>, <code>actor</code>, <code>activity</code>, <code>usageConfig</code>, <code>results</code>.</li>
  <li><strong>Через API</strong> (из своего модуля/мирового скрипта):
      <pre><code>game.modules.get("okassen").api.registerHandler("my-staff", ({ item, actor }) => {
  // ваша логика
});</code></pre></li>
</ol>
<h3>Хуки жизненного цикла — <code>_forge.onEquip</code> и другие</h3>
<p>Помимо onUse, предмет может реагировать на события своей «жизни». Значение каждого
ключа — id обработчика из того же реестра (API или макрос <code>okassen:&lt;id&gt;</code>):</p>
<ul>
  <li><code>onEquip</code> / <code>onUnequip</code> — предмет экипирован / снят;</li>
  <li><code>onCreate</code> / <code>onDelete</code> — предмет создан / удалён;</li>
  <li><code>onTurnStart</code> / <code>onTurnEnd</code> — начало / конец хода носителя в бою.</li>
</ul>
<p>У <strong>актёров</strong> (в <code>_forge</code> актёра) поддерживаются <code>onTurnStart</code>
и <code>onTurnEnd</code> — поведение НИПа на его ходу без предмета-носителя.
Контекст обработчика: <code>{ item, actor, trigger, combat? }</code> (<code>item = null</code>
для хуков актёра).</p>

<p><strong>Внимание:</strong> onUse, хуки жизненного цикла и встроенный overTime (без midi-qol) —
части, требующие ВКЛЮЧЁННОГО модуля во время игры. Эффекты и вложения после создания
работают и без него.</p>

<h3><code>_forge.extraFlags</code></h3>
<p>Объект, который мержится во <code>flags</code> создаваемого предмета — для собственных данных кампании.</p>

<h2>Сниппеты и переменные (<code>_defs</code> / <code>_vars</code>)</h2>
<p><strong>Сниппеты:</strong> опишите блок один раз в <code>_defs</code> и ссылайтесь
на него через <code>$ref</code> (лишние ключи рядом с <code>$ref</code> — переопределения):</p>
<pre><code>{
  "_defs": { "fireRes": { "label": "Огнестойкость", "changes": [
    { "mechanic": "resistance.add", "value": "fire" } ] } },
  "name": "Плащ саламандры", "type": "equipment",
  "_forge": { "effects": [
    { "$ref": "fireRes" },
    { "$ref": "fireRes", "label": "Огнестойкость (большая)" }
  ] }
}</code></pre>
<p><strong>Переменные:</strong> задайте <code>_vars</code> и используйте
<code>{{выражения}}</code> в любых строках — один шаблон масштабируется вместо
N почти-дубликатов. Поддержана арифметика и <code>floor/ceil/round/abs/min/max</code>:</p>
<pre><code>{ "_vars": { "level": 5 },
  ... "value": "{{level}}d6", "dc": "{{8 + floor(level / 2)}}" }</code></pre>
<p>В <strong>пакетном</strong> импорте первым элементом массива можно положить общий
заголовок <code>{ "_defs": ..., "_vars": ... }</code> (без name/type) — его сниппеты
и переменные видны всем документам пакета.</p>

<h2>Импорт НИПов (актёров)</h2>
<p>В то же окно можно вставлять и <strong>актёров</strong> — модуль сам распознаёт их по
<code>type</code> (<code>"npc"</code>, <code>"character"</code>). Формат: обычный актёр dnd5e
плюс необязательные расширения:</p>
<ul>
  <li><code>_forge.effects</code> — Active Effects на самом актёре (тот же формат механик);</li>
  <li><code>_forge.extraFlags</code> — свои флаги;</li>
  <li><code>items</code> — массив предметов актёра, и <strong>каждый может иметь свой
      <code>_forge</code></strong> (эффекты, вложения, onUse) — они пройдут через тот же конвейер.</li>
</ul>
<p>Мини-пример:</p>
<pre><code>{
  "name": "Страж кургана",
  "type": "npc",
  "img": "icons/magic/death/undead-skeleton-fire-green.webp",
  "system": {
    "attributes": { "hp": { "value": 45, "max": 45 } },
    "abilities": { "str": { "value": 16 }, "dex": { "value": 10 } },
    "details": { "cr": 2 }
  },
  "_forge": {
    "effects": [
      { "label": "Курганная стойкость", "changes": [
        { "mechanic": "resistance.add", "value": "necrotic" }
      ] }
    ]
  },
  "items": [
    { "name": "Ржавый меч", "type": "weapon",
      "_forge": { "effects": [ { "label": "Гниль", "changes": [
        { "mechanic": "damage.melee.bonus", "value": "1d4" } ] } ] } }
  ]
}</code></pre>
<p>Поле «UUID актёра-цели» при импорте актёра игнорируется — актёр всегда создаётся в мире.
<code>_forge.nested</code> и <code>_forge.onUse</code> на уровне актёра не поддерживаются —
это свойства предметов (валидатор подскажет).</p>

<h2>Честные ограничения</h2>
<ul>
  <li><strong>Преимущество/помеха</strong> (кроме <code>advantage.init</code>) в чистой dnd5e 4.4.4
      через Active Effects не работает — нужен модуль midi-qol. С активным midi механики
      <code>advantage.*</code>/<code>disadvantage.*</code> разворачиваются автоматически,
      без него импорт честно откажет.</li>
  <li><strong>Встроенный overTime</strong> (без midi-qol) не умеет спасброски и требует
      включённый модуль во время боя.</li>
  <li><code>ac.flat</code> действует только когда у актёра расчёт AC «Flat».</li>
  <li><code>hp.max.bonus</code> есть только у персонажей (у NPC такого поля нет).</li>
  <li>Значение для сопротивлений/иммунитетов должно быть валидным типом урона
      (<code>fire</code>, <code>cold</code>, <code>necrotic</code> и т.д.), иначе импорт откажет с подсказкой.</li>
</ul>

<h2>Полный пример</h2>
<p>Этот же JSON подставляет кнопка «Пример» в окне импорта:</p>
<pre><code>${JSON.stringify(EXAMPLE_ITEM, null, 2)}</code></pre>
`;

/**
 * Найти существующий журнал-руководство (по флагу модуля).
 * @returns {JournalEntry|undefined}
 */
function findGuideJournal() {
  return game.journal.find(j => j.getFlag(MODULE_ID, "guide"));
}

/** Создать журнал-руководство. */
async function createGuideJournal() {
  const journal = await JournalEntry.implementation.create({
    name: game.i18n.localize("OKASSEN.guide.title"),
    flags: { [MODULE_ID]: { guide: true, guideVersion: GUIDE_VERSION } },
    pages: [{
      name: game.i18n.localize("OKASSEN.guide.pageName"),
      type: "text",
      text: { content: GUIDE_HTML, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS?.HTML ?? 1 }
    }]
  });
  ui.notifications.info(game.i18n.format("OKASSEN.guide.created", { name: journal.name }));
  return journal;
}

/** Обновить текст руководства, если версия в журнале устарела. */
async function updateGuideIfOutdated(journal) {
  if (journal.getFlag(MODULE_ID, "guideVersion") === GUIDE_VERSION) return;
  const page = journal.pages.contents[0];
  if (page) await page.update({ "text.content": GUIDE_HTML });
  await journal.setFlag(MODULE_ID, "guideVersion", GUIDE_VERSION);
  console.log(`[okassen] Журнал-руководство обновлён до версии ${GUIDE_VERSION}`);
}

/**
 * Открыть руководство (кнопка «Руководство» в окне импорта).
 * Если журнал удалён — создаём заново.
 */
export async function openGuide() {
  const journal = findGuideJournal() ?? await createGuideJournal();
  journal.sheet.render(true);
}

/**
 * Автосоздание руководства при первом запуске мира с модулем.
 * Только для ведущего; повторно не создаётся (флаг в настройках мира),
 * чтобы не возвращать журнал тому, кто удалил его намеренно.
 */
export async function ensureGuideJournal() {
  if (!game.user.isGM) return;
  const journal = findGuideJournal();
  if (journal) {
    // Журнал есть — при необходимости обновляем содержимое до текущей версии.
    await updateGuideIfOutdated(journal);
    return;
  }
  // Журнала нет: создаём только если ещё ни разу не создавали
  // (удалённый намеренно журнал не возвращаем; кнопка «Руководство» создаст по требованию).
  if (game.settings.get(MODULE_ID, "guideCreated")) return;
  await createGuideJournal();
  await game.settings.set(MODULE_ID, "guideCreated", true);
}
