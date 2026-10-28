# Сервер (Node.js + Express)

API приложения: вход, роли, права по объектам, а дальше — расчёты и ввод данных по направлениям.

## Как устроены файлы

```
server/
├─ package.json          список библиотек и команды npm
├─ .env.example          образец настроек → скопируйте в .env
└─ src/
   ├─ index.js           запуск: проверка базы → старт сервера
   ├─ app.js             сборка: защита, сеансы, маршруты (порядок важен!)
   ├─ config.js          все настройки из .env
   ├─ db.js              подключение к MySQL: query, queryOne, withTransaction
   ├─ errors.js          ошибки с кодом ответа: badRequest, forbidden, notFound…
   ├─ middleware/        «прослойки» перед маршрутами
   │  ├─ auth.js         requireLogin, requireRole — вошёл ли и какая роль
   │  ├─ access.js       useDirection, requireObjectEdit — доступ к направлению и объекту
   │  ├─ validate.js     проверка входящих данных (zod)
   │  ├─ requireJson.js  защита от подделки запросов
   │  └─ errorHandler.js ошибки → аккуратный JSON
   ├─ services/          логика, которую используют разные маршруты
   │  ├─ access.js       ★ ПРАВИЛА ДОСТУПА — единственное место, где решается «кому что можно»
   │  ├─ users.js        чтение пользователей, роли
   │  ├─ passwords.js    хеширование, временные пароли, требования к паролю
   │  ├─ audit.js        запись в журнал изменений
   │  └─ session.js      сеанс входа
   ├─ routes/            адреса API
   │  ├─ health.js       GET  /api/health
   │  ├─ auth.js         /api/auth/login, logout, me, change-password
   │  ├─ directions.js   /api/directions, /api/directions/:direction/my-objects
   │  ├─ users.js        /api/users …                (только администратор)
   │  └─ assignments.js  /api/assignments …          (только администратор)
   └─ scripts/
      ├─ check-db.js     npm run check-db
      └─ create-admin.js npm run create-admin
```

## Тестовая база на этом компьютере (уже настроена)

На компьютере разработки установлены Node.js 24 LTS и MySQL 8.4. Тестовая база `mvs_dashboard`
создана, `schema.sql` выполнен, файл `server/.env` заполнен.

- MySQL запущен как обычный процесс (не служба Windows) и доступен только с этого компьютера.
  После перезагрузки запускайте его так: `powershell -ExecutionPolicy Bypass -File dev\start-mysql.ps1`,
  а останавливайте — `dev\stop-mysql.ps1`.
- Данные базы: `%LOCALAPPDATA%\MVS-MySQL\data`; пароль root тестовой базы — `%LOCALAPPDATA%\MVS-MySQL\root-password.txt`.
- Тестовые учётные записи (admin, редактор, руководство, просмотр): `server/test-accounts.local.txt`.
  Этот файл и `.env` в Git не попадают.

> Если захотите, чтобы MySQL запускался сам вместе с Windows, запустите от имени администратора
> «MySQL Configurator» (меню Пуск) — он создаст службу. Для разработки это не обязательно.

## Первый запуск (Windows, PowerShell)

Перед этим: установлены Node.js и MySQL, база создана и `schema.sql` выполнен
([docs/03-deployment.md](../docs/03-deployment.md), пункты A1–A3).

```bash
cd server
```

```bash
copy .env.example .env
```

Откройте `server\.env` в VS Code и впишите `DB_PASSWORD` и `SESSION_SECRET`.

```bash
npm install
```

```bash
npm run check-db
```

Должно быть: `✔ Структура в порядке`. Если ошибка — сообщение подскажет, что исправить.

```bash
npm run create-admin
```

```bash
npm run dev
```

Откройте в браузере http://localhost:3000/api/health — должно показать `{"ok":true,"db":true,…}`.

> `npm run dev` перезапускает сервер при каждом сохранении файла в папке `src`. Остановить — Ctrl+C.
> Следим только за `src` (а не за всеми файлами): иначе сервер перезапускается, когда антивирус
> проверяет библиотеки в `node_modules`, и обрывает запросы.

## Проверка API вручную (PowerShell)

Интерфейса ещё нет, поэтому проверяем запросами. `$s` хранит cookie сеанса между командами,
как это делает браузер. Выполняйте по одной.

```bash
$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
```

Вход (подставьте свой логин и пароль администратора):

```bash
Invoke-RestMethod http://localhost:3000/api/auth/login -Method Post -ContentType 'application/json' -Body '{"login":"admin","password":"ВашПароль123"}' -WebSession $s | ConvertTo-Json -Depth 5
```

Кто я и какие направления мне доступны:

```bash
Invoke-RestMethod http://localhost:3000/api/auth/me -WebSession $s | ConvertTo-Json -Depth 5
```

Создать редактора с доступом к МКД (ответ покажет временный пароль):

```bash
Invoke-RestMethod http://localhost:3000/api/users -Method Post -ContentType 'application/json' -Body '{"login":"petrov","fullName":"Petrov S. V.","role":"editor","directions":["mkd"]}' -WebSession $s | ConvertTo-Json -Depth 5
```

Список пользователей:

```bash
Invoke-RestMethod http://localhost:3000/api/users -WebSession $s | ConvertTo-Json -Depth 5
```

> ⚠ В Windows PowerShell 5.1 русские буквы внутри `-Body` могут исказиться — для проверок
> используйте латиницу. В интерфейсе (шаг 5) такой проблемы не будет.
>
> Назначать объекты (`/api/assignments`) можно будет после шага 3, когда в базе появятся объекты.

## Изменения структуры базы — миграции

```bash
npm run migrate -- --status
```

Показывает, какие файлы из `database/migrations/` уже применены. `npm run migrate` применяет новые.
Повторный запуск безопасен. На рабочем сервере перед `migrate` делайте резервную копию базы.

## Перенос данных из старых HTML-дашбордов

```bash
npm run import-legacy -- --dir "C:\путь\к\распакованному\архиву"
```

- Папка — корень распакованного `МВС_СТ_дашборд.zip` (файлы ищутся в `src/originals/` и `modules/`)
  или папка, где лежат `schools.html`, `mkd.html`, `networks.html`, `streets.html`.
- `--only mkd,networks` — только эти направления. `--replace` — удалить данные направления и перенести заново
  (назначения ответственных по нему тоже сбрасываются).
- Каждое направление — отдельная транзакция. После записи команда сверяет число строк и денежные итоги
  с исходником; если хоть что-то не сошлось — всё по направлению отменяется.
- История загрузок и полный список предупреждений — в таблице `imports`.

Код переноса: `src/importers/legacy/` (по файлу на направление, общие помощники — `common.js`).

## Показатели (KPI) и «Сводка»

Формулы всех направлений — в `src/services/kpi/` (по файлу на направление, общие помощники — `common.js`,
сводка и снимки — `index.js`). Они перенесены из прежних HTML-модулей один в один.

| Адрес | Что отдаёт |
|---|---|
| `GET /api/overview[?date=ГГГГ-ММ-ДД]` | сводка по доступным пользователю направлениям: статус (ok / warn / crit / na) и полный KPI |
| `GET /api/directions/:direction/kpi[?date=]` | показатели одного направления на дату |
| `GET /api/directions/:direction/kpi/history` | сохранённые снимки по отчётным точкам (для графика динамики) |

```bash
npm run verify-kpi -- --file "C:\путь\к\архиву\src\kpi_defaults.json" --date 2026-10-27
```

Сверяет расчёт сервера с показателями прежних модулей поле за полем. Запускайте после любых
изменений формул: если что-то «уехало», команда покажет, какое поле и насколько.

```bash
npm run recalc-kpi
```

Пересчитывает и сохраняет снимки за все отчётные точки (после переноса данных, смены формул или порогов).

> Пороги статуса направления в «Сводке» — в `app_settings` (ключ `summary.thresholds`, по умолчанию 2 и 10 п.п.),
> пороги статусов объектов — в таблице `directions` (`thr_warn`, `thr_crit`).

## Капремонт МКД — `/api/mkd` (routes/mkd.js)

| Адрес | Что делает | Кто может |
|---|---|---|
| `GET /api/mkd/meta` | лоты, виды работ, сотрудники, периоды, текущий период, «мои адреса» | кому открыто МКД |
| `GET /api/mkd/objects[?period=]` | реестр адресов с расчётом на период | кому открыто МКД |
| `GET /api/mkd/objects/:id[?period=]` | карточка адреса: позиции и история статусов | кому открыто МКД |
| `PUT /api/mkd/periods/:start/status` | ввод статусов позиций за период (только изменённые) | ответственный за адрес, admin |
| `POST /api/mkd/periods/:start/close` · `/reopen` | закрыть / открыть период | admin |

Правила ввода (проверяются и в браузере, и на сервере):
- оплачено не больше закрытого КС-2; статусы «КС-2 подписаны» и «Оплачено» требуют сумму КС-2 (готовность = 100 %);
- период не в будущем и не закрыт; новый период открывается автоматически — только текущий (пн–ср или чт–вс);
- каждое изменение записывается в журнал («было → стало»), снимок показателей «Сводки» пересчитывается сразу.

Отчётные периоды — `services/periods.js`; общий расчёт МКД для «Сводки», реестра и карточки — `services/kpi/mkd.js`.

## Сети, коллекторы, водные объекты — `/api/networks` (routes/networks.js)

| Адрес | Что делает | Кто может |
|---|---|---|
| `GET /api/networks/meta` | разделы, виды работ, периоды, текущий период, «мои объекты» | кому открыты Сети |
| `GET /api/networks/objects[?period=]` | реестр объектов + итоги по 5 разделам на период | кому открыты Сети |
| `GET /api/networks/objects/:id[?period=]` | карточка: договоры, линии (проект/факт), динамика по всем периодам | кому открыты Сети |
| `PUT /api/networks/periods/:start/facts` | ввод факта по линиям, закрытых КС, рабочих и техники | ответственный за объект, admin |
| `POST /api/networks/periods/:start/close` · `/reopen` | закрыть / открыть период (общие маршруты — `routes/periodAdmin.js`) | admin |

Особенность: показатели объекта берутся из ПОСЛЕДНЕГО периода с данными, причём факт линий — за тот же
период (так считал прежний модуль). Поэтому сервер при вводе всегда сохраняет полный снимок объекта:
все линии + КС, рабочие, техника (невведённые линии переносятся из прежнего периода).

Правила ввода: факт, КС — неотрицательные числа (накопительно); рабочие и техника — целые от 0.
Предупреждения (не мешают сохранить): факт или КС уменьшились, факт больше проекта, КС больше договоров.
Расчёт — `services/kpi/networks.js` (`computeNetworksState`, `objectSeries`).

## Капремонт школ — `/api/schools` (routes/schools.js)

| Адрес | Что делает | Кто может |
|---|---|---|
| `GET /api/schools/meta` | виды работ (группы, веса, сроки), материалы, системы, «мои школы», дата последнего ввода | кому открыты Школы |
| `GET /api/schools/overview[?date=]` | итоги, школы, группы работ, экспертиза, S-кривая на дату | кому открыты Школы |
| `GET /api/schools/objects/:id[?date=]` | карточка: работы с историей ввода, ресурсы по дням, закупки, испытания, МГЭ | кому открыты Школы |
| `GET /api/schools/procurement[?date=]` | закупки всех школ: оплата → поставка → монтаж, просрочки, итоги по категориям | кому открыты Школы |
| `GET /api/schools/systems` | индивидуальные испытания: системы × школы | кому открыты Школы |
| `PUT /api/schools/days/:date` | ввод за день: выполнение видов работ и люди/техника | ответственный за школу, admin |

У школ нет отчётных периодов — данные вносятся **по дням** (`sch_work_progress`, `sch_daily_resources`).
На любую дату берётся последняя запись не позже неё. Поэтому ввод задним числом добавляет запись в историю,
но не затирает более свежие: «текущее» выполнение (`sch_object_works`) меняется, только если дата ввода — самая поздняя.

Тело `PUT`: `{ objects: [{ objectId, works: [{ workTypeId, pct: 0..100, factVolume | null }], resources: { people, tech, peopleLandscape, techLandscape } | null }] }`.
Если у работы есть проектный объём и передан `factVolume`, процент считается из объёма (не больше 100 %).
Дата — не в будущем. Изменения пишутся в журнал, снимок показателей «Сводки» пересчитывается на сегодня.
Расчёт — `services/kpi/schools.js` (`computeSchoolsState`, `sCurve`).

## Как добавлять новый маршрут (на следующих шагах)

```js
// routes/mkd.js
router.put('/objects/:id/status',
  useDirection('mkd'),                        // 1. пользователь видит МКД?
  requireObjectEdit((req) => req.params.id),  // 2. он ответственный за этот адрес?
  validate(statusSchema),                     // 3. данные корректны?
  async (req, res) => {                       // 4. сохранить + журнал в одной транзакции
    await withTransaction(async (conn) => {
      await query('UPDATE …', [...], conn);
      await audit(conn, { req, … });
    });
    res.json({ ok: true });
  });
```

## Частые ошибки

| Сообщение | Что сделать |
|---|---|
| `не задана настройка DB_PASSWORD` | нет файла `.env` или в нём пустое значение |
| `MySQL не отвечает` | запустите службу MySQL (Win+R → services.msc → MySQL84 → Запустить) |
| `отказал во входе пользователю` | неверный `DB_USER`/`DB_PASSWORD` |
| `Не хватает таблиц` | выполните `database/schema.sql`, затем `npm run check-db` |
| `EADDRINUSE :3000` | порт занят — закройте другой запущенный сервер или поменяйте `PORT` |
| `Сначала смените временный пароль` | войдите и вызовите `/api/auth/change-password` |
