-- =====================================================================
--  МВС СТ · Дашборд направлений — структура базы данных MySQL
--  Файл: database/schema.sql   Версия схемы: 1   (27.10.2026)
-- =====================================================================
--
--  КАК ЗАПУСТИТЬ ЭТОТ ФАЙЛ
--  -----------------------
--  Вариант 1 (командная строка):
--      mysql -u mvs_app -p mvs_dashboard < database/schema.sql
--  Вариант 2 (phpMyAdmin на хостинге):
--      выберите базу слева → вкладка «Импорт» → выберите этот файл → «Вперёд».
--  Вариант 3 (MySQL Workbench / DBeaver / HeidiSQL):
--      откройте файл и нажмите «Выполнить всё» (молния).
--
--  ⚠ Файл УДАЛЯЕТ и пересоздаёт таблицы (DROP TABLE ...).
--    Запускайте его только на ПУСТОЙ базе при первой установке.
--    Позже структура меняется отдельными файлами-миграциями (database/migrations/).
--
--  ТРЕБОВАНИЯ: MySQL 8.0+ или MariaDB 10.6+.
--
--  СОГЛАШЕНИЯ (чтобы было легче читать)
--  ------------------------------------
--  • Префиксы таблиц:  без префикса — общие таблицы;
--                      sch_ — Капремонт школ;   mkd_ — Капремонт МКД;
--                      net_ — Сети, коллекторы, водные объекты;
--                      st_  — Благоустройство улиц (отчёты: загрузка Excel и ручной ввод).
--  • id    — внутренний числовой ключ (его выдаёт сама база, AUTO_INCREMENT).
--  • code  — «старый» идентификатор из текущего дашборда ('o1', 'rec7', 'w13'…).
--            Нужен, чтобы перенести данные из HTML-файлов и не потерять связи.
--  • Проценты храним ДОЛЕЙ от 0 до 1: 0.35 = 35 %. В интерфейсе показываем ×100.
--  • Деньги — DECIMAL(15,2): точно до копейки (FLOAT для денег использовать нельзя —
--    он округляет и «теряет» копейки).
--  • Даты — DATE ('2026-10-26'), дата+время — DATETIME.
--  • is_example = 1 — значение-«пример», подставленное при переносе из Excel
--    (в текущих дашбордах такие поля подсвечиваются). Нужен для отчёта о качестве данных.
--  • example_fields — JSON-список полей строки, которые являются примерами.
--  • archived = 1 — объект скрыт из расчётов, но не удалён (удалять данные не нужно никогда).
-- =====================================================================

-- Если база ещё не создана и у вас есть права администратора MySQL,
-- раскомментируйте две строки ниже. На хостинге базу обычно создают в панели управления.
-- CREATE DATABASE IF NOT EXISTS mvs_dashboard CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- USE mvs_dashboard;

SET NAMES utf8mb4;            -- кириллица и любые символы (включая ₽ и Ø) сохраняются корректно
SET FOREIGN_KEY_CHECKS = 0;   -- временно отключаем проверку связей, чтобы удалить таблицы в любом порядке

DROP VIEW  IF EXISTS v_sch_resources_latest, v_net_object_money, v_mkd_item_period;
DROP TABLE IF EXISTS
  st_report_values, st_report_objects, st_reports, st_objects, st_work_types,
  net_object_period, net_line_fact, net_lines, net_contracts, net_objects, net_work_kinds, net_sections,
  mkd_item_status, mkd_items, mkd_objects, mkd_work_types, mkd_sections,
  sch_daily_resources, sch_object_systems, sch_systems, sch_object_materials, sch_materials,
  sch_work_progress, sch_object_works, sch_work_types, sch_expertise, sch_objects,
  kpi_snapshots, imports, audit_log, reporting_periods, organizations, people,
  user_objects, user_directions, sessions, users, app_settings, directions, schema_migrations;

SET FOREIGN_KEY_CHECKS = 1;


-- #####################################################################
--  ЧАСТЬ 1. ОБЩИЕ ТАБЛИЦЫ (пользователи, справочники, журнал, сводка)
-- #####################################################################

-- ---------------------------------------------------------------------
-- schema_migrations — какие файлы из database/migrations уже применены к этой базе.
-- Заполняет команда npm run migrate. Не редактируйте вручную.
-- ---------------------------------------------------------------------
CREATE TABLE schema_migrations (
  version     VARCHAR(100) NOT NULL PRIMARY KEY,   -- имя файла без .sql: '002_legacy_import_fields'
  applied_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Применённые миграции (служебная)';

-- ---------------------------------------------------------------------
-- directions — направления (модули дашборда). Ровно 4 строки, см. INSERT в конце.
-- Пороги отставания хранятся здесь, чтобы администратор менял их без программиста.
-- ---------------------------------------------------------------------
CREATE TABLE directions (
  id            TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  code          VARCHAR(20)  NOT NULL UNIQUE,          -- 'schools' | 'mkd' | 'networks' | 'streets' (используется в адресах: /schools)
  name          VARCHAR(150) NOT NULL,                 -- «Капремонт школ 2026–2027»
  unit_label    VARCHAR(30)  NOT NULL,                 -- как называть объекты в сводке: «школ», «адресов», «объектов»
  cycle         ENUM('daily','period','report') NOT NULL, -- как вносятся данные: по дням / отчётными периодами / отчётами (Excel или вручную)
  period_start_days SET('mon','tue','wed','thu','fri','sat','sun') NULL, -- для cycle='period': в какие дни недели начинаются периоды, напр. 'mon,thu'
  is_readonly   TINYINT(1)   NOT NULL DEFAULT 0,       -- 1 = ручной ввод запрещён (сейчас у всех направлений ввод есть)
  thr_warn      DECIMAL(5,2) NOT NULL,                 -- порог «Отставание», п.п. (факт − план < −thr_warn)
  thr_crit      DECIMAL(5,2) NOT NULL,                 -- порог «Критично», п.п.
  sort_order    TINYINT      NOT NULL DEFAULT 0,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Направления работ (модули дашборда)';

-- ---------------------------------------------------------------------
-- users — учётные записи для входа в приложение.
-- Пароль НИКОГДА не хранится в открытом виде — только его «отпечаток» (хеш bcrypt).
-- Роли (назначает администратор):
--   admin   — всё: пользователи, права, справочники, пороги, ввод по любому объекту;
--   manager — «Руководство»: просмотр сводки и ВСЕХ направлений, без ввода;
--   editor  — «Редактор»: просмотр направлений из user_directions
--             + ввод ТОЛЬКО по объектам, назначенным ему в user_objects;
--   viewer  — «Просмотр»: только просмотр направлений из user_directions.
-- Кураторы входят сами — это обычные пользователи (как правило, editor) со своими объектами.
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id                    INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  login                 VARCHAR(60)  NOT NULL UNIQUE,    -- логин для входа (латиница, без пробелов)
  password_hash         VARCHAR(255) NOT NULL,           -- bcrypt-хеш, создаётся сервером
  full_name             VARCHAR(150) NOT NULL,           -- «Соколов Д. А.» — так пользователь виден в журнале
  email                 VARCHAR(150) NULL,
  role                  ENUM('admin','manager','editor','viewer') NOT NULL DEFAULT 'viewer',
  is_active             TINYINT(1)   NOT NULL DEFAULT 1, -- 0 = вход запрещён (уволился, заблокирован). Не удаляем — журнал ссылается
  must_change_password  TINYINT(1)   NOT NULL DEFAULT 1, -- 1 = при первом входе попросить сменить пароль
  failed_logins         SMALLINT UNSIGNED NOT NULL DEFAULT 0, -- защита от подбора пароля
  locked_until          DATETIME     NULL,
  last_login_at         DATETIME     NULL,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Пользователи приложения';

-- ---------------------------------------------------------------------
-- user_directions — какие направления видит пользователь с ролью editor или viewer.
-- admin и manager видят все направления, для них строки здесь не нужны.
-- Связь «многие ко многим»: один человек может видеть несколько направлений.
-- ---------------------------------------------------------------------
CREATE TABLE user_directions (
  user_id       INT UNSIGNED     NOT NULL,
  direction_id  TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, direction_id),
  CONSTRAINT fk_ud_user FOREIGN KEY (user_id)      REFERENCES users(id)      ON DELETE CASCADE,
  CONSTRAINT fk_ud_dir  FOREIGN KEY (direction_id) REFERENCES directions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Доступ к направлениям (просмотр)';

-- ---------------------------------------------------------------------
-- user_objects — за какие объекты отвечает пользователь (право на ВВОД данных).
-- Назначает администратор. Редактор может менять данные только этих объектов
-- (у МКД — всех позиций назначенного адреса).
--
-- object_id — id из таблицы объектов того направления, которое указано в direction_id:
--   schools → sch_objects.id, mkd → mkd_objects.id, networks → net_objects.id, streets → st_objects.id.
-- Поэтому внешнего ключа на объект здесь нет (он ссылался бы на 4 разные таблицы) —
-- правильность object_id проверяет сервер при назначении. Объекты не удаляются (только archived),
-- так что «висячих» ссылок не возникает.
-- ---------------------------------------------------------------------
CREATE TABLE user_objects (
  user_id       INT UNSIGNED     NOT NULL,
  direction_id  TINYINT UNSIGNED NOT NULL,
  object_id     INT UNSIGNED     NOT NULL,
  assigned_by   INT UNSIGNED     NULL,                 -- какой администратор назначил
  assigned_at   DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, direction_id, object_id),
  KEY ix_uo_object (direction_id, object_id),          -- быстрый ответ на вопрос «кто отвечает за этот объект?»
  CONSTRAINT fk_uo_user FOREIGN KEY (user_id)      REFERENCES users(id)      ON DELETE CASCADE,
  CONSTRAINT fk_uo_dir  FOREIGN KEY (direction_id) REFERENCES directions(id) ON DELETE CASCADE,
  CONSTRAINT fk_uo_by   FOREIGN KEY (assigned_by)  REFERENCES users(id)      ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Ответственные за объекты (право на ввод)';

-- ---------------------------------------------------------------------
-- sessions — «сеансы» вошедших пользователей. Таблицу заполняет сервер сам
-- (библиотека express-mysql-session). Структура задана библиотекой — не меняйте её.
-- ---------------------------------------------------------------------
CREATE TABLE sessions (
  session_id  VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
  expires     INT UNSIGNED NOT NULL,
  data        MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Сеансы входа (служебная)';

-- ---------------------------------------------------------------------
-- people — справочник сотрудников: кураторы, ответственные за ввод, ответственные по позициям.
-- Это НЕ то же самое, что users: человек может быть куратором, но не заходить в систему.
-- Если сотрудник заходит в систему — заполните user_id.
-- ---------------------------------------------------------------------
CREATE TABLE people (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(20)  NULL UNIQUE,                 -- 'p1'… из МКД (для переноса данных)
  full_name   VARCHAR(150) NOT NULL,                    -- «Петров С.В.»
  position    VARCHAR(150) NULL,                        -- «Куратор направления»
  phone       VARCHAR(40)  NULL,
  email       VARCHAR(150) NULL,
  user_id     INT UNSIGNED NULL UNIQUE,                 -- связь с учётной записью (если есть)
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  is_example  TINYINT(1)   NOT NULL DEFAULT 0,
  CONSTRAINT fk_people_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Сотрудники (кураторы, ответственные)';

-- ---------------------------------------------------------------------
-- organizations — подрядчики, субподрядчики, проектировщики, экспертиза.
-- ---------------------------------------------------------------------
CREATE TABLE organizations (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(20)  NULL UNIQUE,                 -- 'g1'… из МКД
  name        VARCHAR(255) NOT NULL UNIQUE,             -- АНО «МосводостокСтройТрест»
  short_name  VARCHAR(100) NULL,
  inn         VARCHAR(12)  NULL,                        -- ИНН (10 или 12 цифр), по желанию
  note        VARCHAR(500) NULL,
  is_example  TINYINT(1)   NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Организации';

-- ---------------------------------------------------------------------
-- reporting_periods — отчётные периоды (для МКД и Сетей).
-- Отчёты сдаются ДВА РАЗА В НЕДЕЛЮ, в МКД и в Сетях одинаково:
--   период 1: понедельник – среда   (пн 26.10 – ср 28.10)
--   период 2: четверг – воскресенье (чт 29.10 – вс 01.11)
-- Дни начала берутся из directions.period_start_days ('mon,thu'); границы проверяет сервер:
-- период, начатый в пн, заканчивается в ср, начатый в чт — в вс.
-- plan_date — на какую дату считается «план»:
--   • новые периоды — последний день периода (ср или вс);
--   • перенесённые из старых HTML недели — как считали прежние модули: МКД — пятница недели,
--     Сети — сам понедельник (так история и контрольные цифры kpi_defaults.json не меняются).
-- Сервер открывает период автоматически при первом вводе за него; закрывает администратор —
-- после закрытия ввод за период запрещён.
-- ---------------------------------------------------------------------
CREATE TABLE reporting_periods (
  direction_id  TINYINT UNSIGNED NOT NULL,
  period_start  DATE         NOT NULL,                  -- первый день периода: пн или чт ('2026-10-26')
  period_end    DATE         NOT NULL,                  -- последний день (включительно): ср или вс
  plan_date     DATE         NOT NULL,                  -- дата для расчёта плана (обычно = period_end)
  is_legacy     TINYINT(1)   NOT NULL DEFAULT 0,        -- 1 = неделя, перенесённая из старых HTML-файлов
  is_closed     TINYINT(1)   NOT NULL DEFAULT 0,
  closed_by     INT UNSIGNED NULL,
  closed_at     DATETIME     NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (direction_id, period_start),
  CONSTRAINT chk_rp_dates CHECK (period_end >= period_start),
  CONSTRAINT fk_rp_dir  FOREIGN KEY (direction_id) REFERENCES directions(id),
  CONSTRAINT fk_rp_user FOREIGN KEY (closed_by)    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Отчётные периоды';

-- ---------------------------------------------------------------------
-- audit_log — журнал изменений: КТО, КОГДА, ЧТО изменил. Записи только добавляются.
-- changes — JSON вида {"pct":[0.40,0.55],"status":["work","ks"]}  (было → стало).
-- ---------------------------------------------------------------------
CREATE TABLE audit_log (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  user_id       INT UNSIGNED NULL,
  user_name     VARCHAR(150) NOT NULL,                  -- копия ФИО на момент записи (если пользователя переименуют — журнал не «поплывёт»)
  direction_id  TINYINT UNSIGNED NULL,                  -- NULL = общее действие (вход, справочники)
  entity        VARCHAR(40)  NOT NULL,                  -- 'mkd_item', 'net_object', 'user'…
  entity_id     VARCHAR(40)  NULL,                      -- id изменённой записи
  entity_name   VARCHAR(255) NULL,                      -- «Усачева ул. 62» — чтобы журнал читался без расшифровки id
  action        ENUM('create','update','delete','archive','import','export','login','logout','other') NOT NULL,
  summary       VARCHAR(500) NOT NULL,                  -- человекочитаемо: «Статус: В работе → КС-2 подписаны»
  changes       JSON         NULL,
  ip            VARCHAR(45)  NULL,                      -- IPv4 или IPv6
  KEY ix_audit_dir_time (direction_id, created_at),
  KEY ix_audit_entity   (entity, entity_id),
  KEY ix_audit_user     (user_id, created_at),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id)      REFERENCES users(id)      ON DELETE SET NULL,
  CONSTRAINT fk_audit_dir  FOREIGN KEY (direction_id) REFERENCES directions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Журнал изменений (аудит)';

-- ---------------------------------------------------------------------
-- imports — история загрузок Excel/JSON (кто, какой файл, чем закончилось).
-- ---------------------------------------------------------------------
CREATE TABLE imports (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  direction_id  TINYINT UNSIGNED NOT NULL,
  user_id       INT UNSIGNED NULL,
  file_name     VARCHAR(255) NOT NULL,
  file_kind     ENUM('xlsx','json','html') NOT NULL,   -- html = перенос из старого дашборда
  status        ENUM('running','ok','partial','error') NOT NULL DEFAULT 'running',
  rows_total    INT UNSIGNED NOT NULL DEFAULT 0,
  rows_ok       INT UNSIGNED NOT NULL DEFAULT 0,
  message       TEXT         NULL,                      -- предупреждения и ошибки разбора
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at   DATETIME     NULL,
  CONSTRAINT fk_imp_dir  FOREIGN KEY (direction_id) REFERENCES directions(id),
  CONSTRAINT fk_imp_user FOREIGN KEY (user_id)      REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Загрузки файлов';

-- ---------------------------------------------------------------------
-- kpi_snapshots — рассчитанные показатели направления для «Сводки» на дату.
-- payload — JSON в том же формате, что сейчас отдают модули (см. docs/01-architecture.md, §4).
-- Сервер пересчитывает и сохраняет снимок после каждого изменения данных —
-- так сводка открывается мгновенно, и копится история для графика «динамика по неделям».
-- ---------------------------------------------------------------------
CREATE TABLE kpi_snapshots (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  direction_id  TINYINT UNSIGNED NOT NULL,
  as_of         DATE         NOT NULL,                  -- на какую дату/неделю срез
  fact          DECIMAL(7,4) NULL,                      -- дублируем из payload для быстрых графиков
  plan          DECIMAL(7,4) NULL,
  payload       JSON         NOT NULL,
  computed_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_kpi (direction_id, as_of),
  CONSTRAINT fk_kpi_dir FOREIGN KEY (direction_id) REFERENCES directions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Снимки показателей для сводки';

-- ---------------------------------------------------------------------
-- app_settings — прочие настройки «ключ → значение» (JSON).
-- Примеры ключей: 'app.title', 'summary.thresholds', 'mkd.doc_totals'.
-- ---------------------------------------------------------------------
CREATE TABLE app_settings (
  setting_key    VARCHAR(80) NOT NULL PRIMARY KEY,
  setting_value  JSON        NOT NULL,
  updated_by     INT UNSIGNED NULL,
  updated_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_set_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Настройки приложения';


-- #####################################################################
--  ЧАСТЬ 2. КАПРЕМОНТ ШКОЛ (sch_)
--  Готовность = Σ (вес вида работ × % выполнения). План — линейно между
--  датами начала и окончания вида работ (даты общие для всех школ).
-- #####################################################################

-- Школы (объекты). Финансы хранятся прямо здесь — у каждой школы одна строка лимита.
CREATE TABLE sch_objects (
  id                     INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code                   VARCHAR(20)  NOT NULL UNIQUE,  -- 'o1'
  name                   VARCHAR(255) NOT NULL,         -- «Новопеределкинская ул., д. 13, к. 1»
  short_name             VARCHAR(100) NOT NULL,         -- «Новопеределкинская, 13к1»
  okrug                  VARCHAR(10)  NULL,             -- 'ЗАО'
  district               VARCHAR(100) NULL,             -- 'Ново-Переделкино'
  building_type          VARCHAR(50)  NULL,             -- тип здания по проекту: «Каре», «Самолетик», «Вертолетик»
  area_m2                DECIMAL(10,1) NULL,            -- площадь здания, м²
  territory_ha           DECIMAL(8,4)  NULL,            -- площадь территории, га
  contractor_org_id      INT UNSIGNED NULL,             -- генподрядчик
  designer_org_id        INT UNSIGNED NULL,             -- проектировщик
  responsible_person_id  INT UNSIGNED NULL,             -- ответственный
  kitchen_status         VARCHAR(50)  NULL,             -- «НЕ ГОТОВ» …
  ii_complex             VARCHAR(20)  NULL,             -- комплексные испытания: «ДА»/«НЕТ»
  ii_source_demo         VARCHAR(255) NULL,             -- адрес школы-образца для испытаний
  limit_total            DECIMAL(15,2) NULL,            -- лимит всего, ₽
  limit_2026             DECIMAL(15,2) NULL,            -- лимит 2026, ₽
  paid                   DECIMAL(15,2) NULL,            -- оплачено, ₽
  proc_pay_total         DECIMAL(7,4)  NULL,            -- общая доля оплаты закупок (0..1)
  sort_order             SMALLINT     NOT NULL DEFAULT 0,
  archived               TINYINT(1)   NOT NULL DEFAULT 0,
  updated_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by             INT UNSIGNED NULL,
  CONSTRAINT fk_sch_contr FOREIGN KEY (contractor_org_id)     REFERENCES organizations(id) ON DELETE SET NULL,
  CONSTRAINT fk_sch_des   FOREIGN KEY (designer_org_id)       REFERENCES organizations(id) ON DELETE SET NULL,
  CONSTRAINT fk_sch_resp  FOREIGN KEY (responsible_person_id) REFERENCES people(id)        ON DELETE SET NULL,
  CONSTRAINT fk_sch_upd   FOREIGN KEY (updated_by)            REFERENCES users(id)         ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Школы';

-- Проектирование и Мосгосэкспертиза (МГЭ): одна строка на школу («один к одному»).
CREATE TABLE sch_expertise (
  object_id      INT UNSIGNED NOT NULL PRIMARY KEY,
  designer_name  VARCHAR(255) NULL,                     -- проектировщик (как в документе)
  reviewer       VARCHAR(50)  NULL,                     -- кто сопровождает: «ТРЕСТ», «ДКР»
  pir_start      DATE NULL,                             -- начало ПИР
  project_done   DATE NULL,                             -- проект готов
  exp_in         DATE NULL,                             -- подано в экспертизу
  exp_out        DATE NULL,                             -- заключение получено
  status         VARCHAR(150) NULL,                     -- «ПОЛУЧЕНО ПОЛОЖИТЕЛЬНОЕ ЗАКЛЮЧЕНИЕ»
  handover       DATE NULL,                             -- передача площадки
  CONSTRAINT fk_schexp_obj FOREIGN KEY (object_id) REFERENCES sch_objects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Школы: проектирование и МГЭ';

-- Справочник видов работ («Светофор»). weight — вес в общей готовности (сейчас сумма весов 0,83).
CREATE TABLE sch_work_types (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(20)  NOT NULL UNIQUE,             -- 'w13'
  name        VARCHAR(200) NOT NULL,                    -- «Демонтажные работы»
  group_name  VARCHAR(100) NOT NULL DEFAULT 'Прочее',   -- «Конструктив и демонтаж»
  weight      DECIMAL(6,4) NOT NULL DEFAULT 0,          -- 0.03
  plan_start  DATE NULL,                                -- плановое начало вида работ
  plan_end    DATE NULL,                                -- плановое окончание
  unit        VARCHAR(20)  NULL,                        -- 'м³'
  sort_order  SMALLINT     NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Школы: виды работ';

-- Вид работ на конкретной школе: проектный объём + ТЕКУЩЕЕ выполнение.
-- Текущее = последняя запись из истории sch_work_progress. Сервер при каждом вводе
-- в одной транзакции добавляет строку в историю и обновляет эту таблицу —
-- так экраны «на сегодня» открываются быстро, а история не теряется.
CREATE TABLE sch_object_works (
  object_id     INT UNSIGNED NOT NULL,
  work_type_id  INT UNSIGNED NOT NULL,
  pct           DECIMAL(7,4)  NOT NULL DEFAULT 0,       -- выполнение 0..1
  plan_volume   DECIMAL(14,3) NULL,                     -- объём по проекту
  fact_volume   DECIMAL(14,3) NULL,                     -- выполнено
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by    INT UNSIGNED  NULL,
  PRIMARY KEY (object_id, work_type_id),
  CONSTRAINT chk_schw_pct CHECK (pct BETWEEN 0 AND 1),
  CONSTRAINT fk_schw_obj  FOREIGN KEY (object_id)    REFERENCES sch_objects(id)    ON DELETE CASCADE,
  CONSTRAINT fk_schw_type FOREIGN KEY (work_type_id) REFERENCES sch_work_types(id),
  CONSTRAINT fk_schw_user FOREIGN KEY (updated_by)   REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Школы: выполнение работ (текущее)';

-- История выполнения работ ПО ДНЯМ: одна строка = школа × вид работ × дата.
-- Заполняется ежедневно. Из неё строятся фактическая S-кривая, динамика и «что изменилось за день».
-- Если за день по виду работ ничего не вносили — строки нет, берётся последняя предыдущая.
CREATE TABLE sch_work_progress (
  object_id     INT UNSIGNED  NOT NULL,
  work_type_id  INT UNSIGNED  NOT NULL,
  report_date   DATE          NOT NULL,                 -- за какой день данные
  pct           DECIMAL(7,4)  NOT NULL DEFAULT 0,       -- выполнение на эту дату, 0..1 (накопительно)
  fact_volume   DECIMAL(14,3) NULL,                     -- выполненный объём на эту дату (накопительно)
  source        ENUM('manual','excel','import') NOT NULL DEFAULT 'manual',
  entered_by    INT UNSIGNED  NULL,
  entered_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (object_id, work_type_id, report_date),
  KEY ix_schp_date (report_date),
  CONSTRAINT chk_schp_pct CHECK (pct BETWEEN 0 AND 1),
  CONSTRAINT fk_schp_work FOREIGN KEY (object_id, work_type_id)
    REFERENCES sch_object_works(object_id, work_type_id) ON DELETE CASCADE,
  CONSTRAINT fk_schp_user FOREIGN KEY (entered_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Школы: история выполнения работ по дням';

-- Справочник материалов/оборудования для закупок.
CREATE TABLE sch_materials (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code          VARCHAR(20)  NOT NULL UNIQUE,           -- 'm01'
  category      VARCHAR(100) NOT NULL,                  -- «Фасад»
  name          VARCHAR(200) NOT NULL,                  -- «Короед»
  period_text   VARCHAR(60)  NULL,                      -- «14.07.2026-10.08.2026» как в источнике
  period_start  DATE NULL,                              -- то же, но датами (для сортировки и графиков)
  period_end    DATE NULL,
  sort_order    SMALLINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Школы: материалы';

-- Закупки по школе: оплата → поставка → монтаж.
CREATE TABLE sch_object_materials (
  object_id      INT UNSIGNED NOT NULL,
  material_id    INT UNSIGNED NOT NULL,
  maker          VARCHAR(150) NULL,                     -- производитель
  supplier       VARCHAR(150) NULL,                     -- поставщик
  qty            DECIMAL(14,3) NULL,
  unit           VARCHAR(20)  NULL,
  pay_pct        DECIMAL(5,4) NOT NULL DEFAULT 0,       -- оплачено 0..1
  delivered_pct  DECIMAL(5,4) NOT NULL DEFAULT 0,       -- поставлено 0..1
  installed_pct  DECIMAL(5,4) NOT NULL DEFAULT 0,       -- смонтировано 0..1
  delivery_date  DATE NULL,                             -- плановая дата поставки
  done_date      DATE NULL,                             -- плановая дата завершения
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by     INT UNSIGNED NULL,
  PRIMARY KEY (object_id, material_id),
  CONSTRAINT fk_schm_obj  FOREIGN KEY (object_id)   REFERENCES sch_objects(id)   ON DELETE CASCADE,
  CONSTRAINT fk_schm_mat  FOREIGN KEY (material_id) REFERENCES sch_materials(id),
  CONSTRAINT fk_schm_user FOREIGN KEY (updated_by)  REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Школы: закупки';

-- Справочник инженерных систем (для индивидуальных испытаний).
CREATE TABLE sch_systems (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(20)  NOT NULL UNIQUE,             -- 's01'
  name        VARCHAR(200) NOT NULL,                    -- «Противодымная вентиляция»
  sort_order  SMALLINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Школы: инженерные системы';

-- Состояние системы на школе.
CREATE TABLE sch_object_systems (
  object_id    INT UNSIGNED NOT NULL,
  system_id    INT UNSIGNED NOT NULL,
  state        VARCHAR(60)  NULL,                       -- «работоспособна» …
  has_id_docs  TINYINT(1)   NOT NULL DEFAULT 0,         -- есть исполнительная документация
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by   INT UNSIGNED NULL,
  PRIMARY KEY (object_id, system_id),
  CONSTRAINT fk_schs_obj  FOREIGN KEY (object_id) REFERENCES sch_objects(id) ON DELETE CASCADE,
  CONSTRAINT fk_schs_sys  FOREIGN KEY (system_id) REFERENCES sch_systems(id),
  CONSTRAINT fk_schs_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Школы: испытания систем';

-- Ресурсы на объекте по дням (люди и техника). «Текущие ресурсы» = последняя дата (см. VIEW ниже).
-- Две группы ресурсов: на здании (people, tech) и на благоустройстве территории (*_landscape).
-- Всего на объекте = people + people_landscape; техника — так же.
CREATE TABLE sch_daily_resources (
  object_id         INT UNSIGNED NOT NULL,
  report_date       DATE         NOT NULL,
  people            SMALLINT UNSIGNED NOT NULL DEFAULT 0,   -- люди на здании
  tech              SMALLINT UNSIGNED NOT NULL DEFAULT 0,   -- техника на здании
  people_landscape  SMALLINT UNSIGNED NOT NULL DEFAULT 0,   -- люди на благоустройстве (в старых данных peopleBl)
  tech_landscape    SMALLINT UNSIGNED NOT NULL DEFAULT 0,   -- техника на благоустройстве (techBl)
  source       ENUM('manual','excel','import') NOT NULL DEFAULT 'manual',
  entered_by   INT UNSIGNED NULL,
  entered_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (object_id, report_date),
  KEY ix_schr_date (report_date),
  CONSTRAINT fk_schr_obj  FOREIGN KEY (object_id)  REFERENCES sch_objects(id) ON DELETE CASCADE,
  CONSTRAINT fk_schr_user FOREIGN KEY (entered_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Школы: ресурсы по дням';


-- #####################################################################
--  ЧАСТЬ 3. КАПРЕМОНТ МКД (mkd_)
--  Адрес (объект) → позиции (вид работ по договору) → недельные статусы позиций.
--  Готовность — по позициям, взвешенная стоимостью договора; КС-2/Оплачено = 100 %.
-- #####################################################################

-- Лоты (разделы).
CREATE TABLE mkd_sections (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(20)  NOT NULL UNIQUE,             -- 's1'
  name        VARCHAR(100) NOT NULL,                    -- «Лот 1»
  note        VARCHAR(255) NULL,                        -- «Барвихинская — Рублевское ш. (позиции 1–109)»
  sort_order  SMALLINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='МКД: лоты';

-- Виды работ (ПСД, фасад, кровля…).
CREATE TABLE mkd_work_types (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(20)  NOT NULL UNIQUE,             -- 'psd'
  name        VARCHAR(100) NOT NULL,                    -- краткое
  full_name   VARCHAR(255) NULL,                        -- полное
  group_name  VARCHAR(100) NULL,                        -- «Проектирование»
  unit        VARCHAR(20)  NULL,
  sort_order  SMALLINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='МКД: виды работ';

-- Адреса (многоквартирные дома).
CREATE TABLE mkd_objects (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code                VARCHAR(20)  NOT NULL UNIQUE,     -- 'o1'
  address             VARCHAR(255) NOT NULL,            -- «Барвихинская ул. 16 к.2»
  section_id          INT UNSIGNED NULL,
  curator_person_id   INT UNSIGNED NULL,                -- куратор
  entry_person_id     INT UNSIGNED NULL,                -- ответственный за ввод (справочно, из старых данных; ПРАВО на ввод — в user_objects)
  note                VARCHAR(1000) NULL,
  archived            TINYINT(1) NOT NULL DEFAULT 0,
  example_fields      JSON NULL,                        -- какие поля — примеры
  CONSTRAINT fk_mkdo_sec   FOREIGN KEY (section_id)        REFERENCES mkd_sections(id) ON DELETE SET NULL,
  CONSTRAINT fk_mkdo_cur   FOREIGN KEY (curator_person_id) REFERENCES people(id)       ON DELETE SET NULL,
  CONSTRAINT fk_mkdo_entry FOREIGN KEY (entry_person_id)   REFERENCES people(id)       ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='МКД: адреса';

-- Позиции: конкретный вид работ на адресе со своей стоимостью и сроками.
CREATE TABLE mkd_items (
  id                     INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code                   VARCHAR(20)  NOT NULL UNIQUE,  -- 'i1'
  object_id              INT UNSIGNED NOT NULL,
  work_type_id           INT UNSIGNED NOT NULL,
  item_no                SMALLINT UNSIGNED NULL,        -- № позиции в сводной таблице
  src_row                SMALLINT UNSIGNED NULL,        -- строка в исходном Excel (для сверки)
  contract_amount        DECIMAL(15,2) NOT NULL DEFAULT 0, -- стоимость по договору, ₽
  inwork_amount          DECIMAL(15,2) NULL,            -- сумма «в работе» (если отличается от договора)
  approx_amount          DECIMAL(15,2) NULL,            -- ориентировочная (прогноз)
  plan_start             DATE NULL,
  plan_end               DATE NULL,
  responsible_person_id  INT UNSIGNED NULL,
  org_id                 INT UNSIGNED NULL,             -- исполнитель
  note                   VARCHAR(1000) NULL,
  archived               TINYINT(1) NOT NULL DEFAULT 0,
  example_fields         JSON NULL,
  KEY ix_mkdi_obj (object_id),
  CONSTRAINT fk_mkdi_obj  FOREIGN KEY (object_id)             REFERENCES mkd_objects(id) ON DELETE CASCADE,
  CONSTRAINT fk_mkdi_type FOREIGN KEY (work_type_id)          REFERENCES mkd_work_types(id),
  CONSTRAINT fk_mkdi_resp FOREIGN KEY (responsible_person_id) REFERENCES people(id)        ON DELETE SET NULL,
  CONSTRAINT fk_mkdi_org  FOREIGN KEY (org_id)                REFERENCES organizations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='МКД: позиции';

-- Состояние позиции на отчётный период.
-- status: plan — не начато; work — в работе; stop — приостановлено;
--         ks — КС-2 подписаны, к оплате; paid — оплачено; excl — исключено.
-- Если за период записи нет — берётся последняя предыдущая (это делает сервер).
CREATE TABLE mkd_item_status (
  item_id               INT UNSIGNED NOT NULL,
  period_start          DATE         NOT NULL,          -- начало отчётного периода (reporting_periods)
  status                ENUM('plan','work','stop','ks','paid','excl') NOT NULL DEFAULT 'plan',
  pct                   DECIMAL(7,4)  NOT NULL DEFAULT 0, -- физическая готовность 0..1
  ks_amount             DECIMAL(15,2) NOT NULL DEFAULT 0, -- закрыто КС-2, ₽ (накопительно)
  paid_amount           DECIMAL(15,2) NOT NULL DEFAULT 0, -- оплачено, ₽ (накопительно)
  note                  VARCHAR(1000) NULL,             -- примечание к статусу за период
  entered_by_user_id    INT UNSIGNED NULL,              -- кто внёс (в новой системе)
  entered_by_person_id  INT UNSIGNED NULL,              -- кто внёс (из старых данных, 'p3')
  entered_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_example            TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, period_start),
  KEY ix_mkdw_period (period_start),
  CONSTRAINT chk_mkdw_pct CHECK (pct BETWEEN 0 AND 1),
  CONSTRAINT fk_mkdw_item   FOREIGN KEY (item_id)              REFERENCES mkd_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_mkdw_user   FOREIGN KEY (entered_by_user_id)   REFERENCES users(id)  ON DELETE SET NULL,
  CONSTRAINT fk_mkdw_person FOREIGN KEY (entered_by_person_id) REFERENCES people(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='МКД: статусы позиций по отчётным периодам';


-- #####################################################################
--  ЧАСТЬ 4. СЕТИ, КОЛЛЕКТОРЫ, ВОДНЫЕ ОБЪЕКТЫ (net_)
--  Объект → договоры, линии (виды работ с проектным объёмом) → недельный факт.
--  Готовность объекта = факт/проект по линиям; итог взвешен стоимостью договоров.
-- #####################################################################

-- Разделы: Реконструкция, Аварийные, Тех. присоединение, Коллекторы, Пруды.
CREATE TABLE net_sections (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(20)  NOT NULL UNIQUE,             -- 'rec'
  title       VARCHAR(150) NOT NULL,                    -- «Реконструкция сетей»
  short_title VARCHAR(50)  NULL,                        -- «Реконструкция» (для подписей)
  sort_order  SMALLINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Сети: разделы';

-- Справочник видов работ (open — открытая прокладка, closed — закрытая (ГНБ) и т.д.).
CREATE TABLE net_work_kinds (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(30)  NOT NULL UNIQUE,             -- 'open'
  name        VARCHAR(150) NOT NULL,                    -- «Открытая прокладка»
  unit        VARCHAR(20)  NOT NULL DEFAULT 'п.м',
  group_name  VARCHAR(100) NULL,
  sort_order  SMALLINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Сети: виды работ';

-- Объекты.
CREATE TABLE net_objects (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code                VARCHAR(20)  NOT NULL UNIQUE,     -- 'rec7'
  seq_no              SMALLINT UNSIGNED NULL,           -- № в сводной таблице
  section_id          INT UNSIGNED NOT NULL,
  name                VARCHAR(1000) NOT NULL,           -- полное наименование (у тех. присоединения — до ~600 символов)
  short_name          VARCHAR(255) NOT NULL,
  source_status       VARCHAR(60)  NULL,                -- статус из таблицы («Выполнено»). Расчётный статус считает сервер
  plan_start          DATE NULL,                        -- начало работ
  plan_end            DATE NULL,                        -- окончание работ
  sub_org_id          INT UNSIGNED NULL,                -- субподрядчик
  designer_org_id     INT UNSIGNED NULL,                -- проектировщик
  curator_person_id   INT UNSIGNED NULL,                -- куратор ГУП МВС
  doc_psd             VARCHAR(100) NULL,                -- документы: '+', 'нет', 'в работе' или свободный текст
  doc_dwg             VARCHAR(100) NULL,
  doc_mge             VARCHAR(100) NULL,
  doc_sogl            VARCHAR(100) NULL,                -- согласования
  doc_sogl_g          VARCHAR(100) NULL,
  doc_order           VARCHAR(255) NULL,                -- ордер ОАТИ: «У0615810 от 14.07.2026 до 30.10.2026»
  note                VARCHAR(1000) NULL,
  note_end            VARCHAR(255) NULL,                -- примечание к сроку окончания из источника
  archived            TINYINT(1) NOT NULL DEFAULT 0,
  example_fields      JSON NULL,
  KEY ix_neto_sec (section_id),
  CONSTRAINT fk_neto_sec FOREIGN KEY (section_id)        REFERENCES net_sections(id),
  CONSTRAINT fk_neto_sub FOREIGN KEY (sub_org_id)        REFERENCES organizations(id) ON DELETE SET NULL,
  CONSTRAINT fk_neto_des FOREIGN KEY (designer_org_id)   REFERENCES organizations(id) ON DELETE SET NULL,
  CONSTRAINT fk_neto_cur FOREIGN KEY (curator_person_id) REFERENCES people(id)        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Сети: объекты';

-- Договоры объекта (у объекта может быть несколько договоров).
CREATE TABLE net_contracts (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  object_id      INT UNSIGNED NOT NULL,
  contract_no    VARCHAR(60)  NULL,                     -- «180/25-МВССТ»
  contract_date  DATE NULL,
  end_date       DATE NULL,
  cost           DECIMAL(15,2) NOT NULL DEFAULT 0,      -- стоимость, ₽
  advance        DECIMAL(15,2) NOT NULL DEFAULT 0,      -- выплаченный аванс, ₽
  ks_total       DECIMAL(15,2) NOT NULL DEFAULT 0,      -- закрыто КС по договору (из таблицы), ₽
  sort_order     SMALLINT NOT NULL DEFAULT 0,
  KEY ix_netc_obj (object_id),
  CONSTRAINT fk_netc_obj FOREIGN KEY (object_id) REFERENCES net_objects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Сети: договоры';

-- Линии — виды работ объекта с проектным объёмом («Открытая прокладка Ø400 — 10 п.м»).
CREATE TABLE net_lines (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  object_id     INT UNSIGNED NOT NULL,
  code          VARCHAR(30)  NOT NULL,                  -- 'open0' (уникален внутри объекта)
  kind_id       INT UNSIGNED NOT NULL,
  label         VARCHAR(200) NOT NULL,                  -- «Открытая прокладка Ø400»
  unit          VARCHAR(20)  NOT NULL DEFAULT 'п.м',
  plan_volume   DECIMAL(14,3) NULL,                     -- проектный объём
  diameter      VARCHAR(20)  NULL,                      -- '400'
  sn            VARCHAR(20)  NULL,                      -- кольцевая жёсткость трубы (SN)
  sort_order    SMALLINT NOT NULL DEFAULT 0,
  UNIQUE KEY ux_netl (object_id, code),
  CONSTRAINT fk_netl_obj  FOREIGN KEY (object_id) REFERENCES net_objects(id) ON DELETE CASCADE,
  CONSTRAINT fk_netl_kind FOREIGN KEY (kind_id)   REFERENCES net_work_kinds(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Сети: линии (проектные объёмы)';

-- Факт по линии на отчётный период — НАКОПИТЕЛЬНО (сколько всего сделано к концу периода).
CREATE TABLE net_line_fact (
  line_id      INT UNSIGNED NOT NULL,
  period_start DATE NOT NULL,                           -- начало отчётного периода
  fact_volume  DECIMAL(14,3) NOT NULL DEFAULT 0,
  entered_by   INT UNSIGNED NULL,
  entered_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (line_id, period_start),
  KEY ix_netf_period (period_start),
  CONSTRAINT fk_netf_line FOREIGN KEY (line_id)    REFERENCES net_lines(id) ON DELETE CASCADE,
  CONSTRAINT fk_netf_user FOREIGN KEY (entered_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Сети: факт по отчётным периодам';

-- Показатели объекта за период: закрыто КС (накопительно), рабочие, техника.
CREATE TABLE net_object_period (
  object_id    INT UNSIGNED NOT NULL,
  period_start DATE NOT NULL,                           -- начало отчётного периода
  ks_closed    DECIMAL(15,2) NOT NULL DEFAULT 0,        -- ₽, накопительно
  workers      SMALLINT UNSIGNED NOT NULL DEFAULT 0,    -- рабочих на объекте
  machines     SMALLINT UNSIGNED NOT NULL DEFAULT 0,    -- единиц техники
  entered_by   INT UNSIGNED NULL,
  entered_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (object_id, period_start),
  KEY ix_netw_period (period_start),
  CONSTRAINT fk_netw_obj  FOREIGN KEY (object_id)  REFERENCES net_objects(id) ON DELETE CASCADE,
  CONSTRAINT fk_netw_user FOREIGN KEY (entered_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Сети: ресурсы и КС по отчётным периодам';


-- #####################################################################
--  ЧАСТЬ 5. БЛАГОУСТРОЙСТВО УЛИЦ (st_) — отчёты на дату
--  Отчёт (дата, программа) → строки по объектам → значения по видам работ.
--  Отчёт появляется двумя способами:
--    • загрузка Excel (source='import');
--    • ручной ввод (source='manual'): сервер создаёт отчёт на новую дату, копирует в него
--      объекты, проектные объёмы и последний факт из предыдущего отчёта, а ответственные
--      дописывают свой факт, статус, людей, технику и замечания по назначенным объектам.
-- #####################################################################

-- Виды работ (бортовой камень, тротуар, фрезерование…).
CREATE TABLE st_work_types (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(30)  NOT NULL UNIQUE,             -- 'curbOld'
  name        VARCHAR(150) NOT NULL,                    -- «Бортовой камень»
  unit        VARCHAR(20)  NULL,                        -- 'пог. м'
  sort_order  SMALLINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Благоустройство: виды работ';

-- Объекты (улицы, проезды) с координатами для карты.
CREATE TABLE st_objects (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code             VARCHAR(190) NOT NULL UNIQUE,        -- ключ из названия ('8яулицатекстильщиков')
  name             VARCHAR(500) NOT NULL,
  okrug            VARCHAR(10)  NULL,
  lat              DECIMAL(10,7) NULL,                  -- широта
  lon              DECIMAL(10,7) NULL,                  -- долгота
  geo_precision    VARCHAR(255) NULL,                   -- «Местоположение улицы; границы участка не заданы»
  geo_source       VARCHAR(255) NULL,                   -- ссылка OpenStreetMap
  geo_verified     TINYINT(1) NOT NULL DEFAULT 0,
  archived         TINYINT(1) NOT NULL DEFAULT 0       -- скрыт: не копируется в новые отчёты
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Благоустройство: объекты';

-- Отчёты. program: kbu — комплексное благоустройство, current — текущий ремонт.
CREATE TABLE st_reports (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  program      ENUM('kbu','current') NOT NULL,
  report_date  DATE NOT NULL,
  source       ENUM('import','manual') NOT NULL DEFAULT 'import', -- загружен из Excel или ведётся вручную
  sheet_name   VARCHAR(100) NULL,                       -- имя листа Excel («23.04.2025»), для ручных — NULL
  import_id    INT UNSIGNED NULL,                       -- из какой загрузки
  is_closed    TINYINT(1)   NOT NULL DEFAULT 0,         -- 1 = отчёт утверждён, правки запрещены
  created_by   INT UNSIGNED NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_st_rep (program, report_date),
  CONSTRAINT fk_strep_imp  FOREIGN KEY (import_id)  REFERENCES imports(id) ON DELETE SET NULL,
  CONSTRAINT fk_strep_user FOREIGN KEY (created_by) REFERENCES users(id)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Благоустройство: отчёты';

-- Строка отчёта по объекту.
CREATE TABLE st_report_objects (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  report_id   INT UNSIGNED NOT NULL,
  object_id   INT UNSIGNED NOT NULL,
  status      VARCHAR(80)  NULL,                        -- «Ведутся работы», «Работы завершены», «Сдан ЦККБ»
  source_row  SMALLINT UNSIGNED NULL,                   -- строка в Excel
  people      SMALLINT UNSIGNED NULL,
  tech        SMALLINT UNSIGNED NULL,
  remarks     SMALLINT UNSIGNED NULL,                   -- количество замечаний
  source_meta JSON NULL,                                -- прочие столбцы строки из Excel («№», «Комплекс» …)
  entered_by  INT UNSIGNED NULL,                        -- кто внёс вручную (для импорта — NULL)
  entered_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_stro (report_id, object_id),
  CONSTRAINT fk_stro_user FOREIGN KEY (entered_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_stro_rep FOREIGN KEY (report_id) REFERENCES st_reports(id) ON DELETE CASCADE,
  CONSTRAINT fk_stro_obj FOREIGN KEY (object_id) REFERENCES st_objects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Благоустройство: строки отчёта';

-- Значения: проект / факт по виду работ в строке отчёта.
CREATE TABLE st_report_values (
  report_object_id  INT UNSIGNED NOT NULL,
  work_type_id      INT UNSIGNED NOT NULL,
  plan_volume       DECIMAL(14,3) NULL,                 -- p — по проекту
  fact_volume       DECIMAL(14,3) NULL,                 -- f — выполнено
  alt_fact_volume   DECIMAL(14,3) NULL,                 -- a — второй столбец факта (в части отчётов); в готовности не участвует
  source_pct        DECIMAL(9,6)  NULL,                 -- % из таблицы (для сверки; при ручном вводе — NULL)
  entered_by        INT UNSIGNED  NULL,
  entered_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (report_object_id, work_type_id),
  CONSTRAINT fk_strv_user FOREIGN KEY (entered_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_strv_ro   FOREIGN KEY (report_object_id) REFERENCES st_report_objects(id) ON DELETE CASCADE,
  CONSTRAINT fk_strv_type FOREIGN KEY (work_type_id)     REFERENCES st_work_types(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Благоустройство: объёмы';


-- #####################################################################
--  ЧАСТЬ 6. ПРЕДСТАВЛЕНИЯ (VIEW) — «сохранённые запросы» для удобства.
--  Их можно читать как обычные таблицы: SELECT * FROM v_sch_resources_latest;
--  Сложные расчёты (план на дату, взвешенная готовность, статусы) делает сервер на Node.js,
--  а здесь — только простые сборки данных.
-- #####################################################################

-- Последние ресурсы (люди/техника) по каждой школе.
CREATE VIEW v_sch_resources_latest AS
SELECT r.*
FROM sch_daily_resources r
JOIN (SELECT object_id, MAX(report_date) AS d FROM sch_daily_resources GROUP BY object_id) last
  ON last.object_id = r.object_id AND last.d = r.report_date;

-- Деньги по объекту «Сетей»: сумма всех договоров объекта.
CREATE VIEW v_net_object_money AS
SELECT o.id AS object_id, o.code, o.section_id,
       COALESCE(SUM(c.cost), 0)    AS cost,
       COALESCE(SUM(c.advance), 0) AS advance,
       COALESCE(SUM(c.ks_total),0) AS ks_total
FROM net_objects o
LEFT JOIN net_contracts c ON c.object_id = o.id
GROUP BY o.id, o.code, o.section_id;

-- Позиция МКД + адрес + вид работ + статус за период (удобно для выгрузок и проверки).
CREATE VIEW v_mkd_item_period AS
SELECT w.period_start, i.id AS item_id, i.code AS item_code, o.address, s.name AS section,
       t.name AS work_type, i.contract_amount, i.plan_start, i.plan_end,
       w.status, w.pct, w.ks_amount, w.paid_amount, w.entered_at
FROM mkd_item_status w
JOIN mkd_items      i ON i.id = w.item_id
JOIN mkd_objects    o ON o.id = i.object_id
LEFT JOIN mkd_sections   s ON s.id = o.section_id
JOIN mkd_work_types t ON t.id = i.work_type_id;


-- #####################################################################
--  ЧАСТЬ 7. НАЧАЛЬНЫЕ ДАННЫЕ
-- #####################################################################

-- Направления и пороги (в п.п.) — значения взяты из текущих дашбордов.
-- period_start_days 'mon,thu' — два отчёта в неделю: пн–ср и чт–вс.
INSERT INTO directions (id, code, name, unit_label, cycle, period_start_days, is_readonly, thr_warn, thr_crit, sort_order) VALUES
  (1, 'schools',  'Капремонт школ 2026–2027',          'школ',     'daily',  NULL,      0,  2.00, 10.00, 1),
  (2, 'mkd',      'Капремонт МКД — 2026',               'адресов',  'period', 'mon,thu', 0,  5.00, 15.00, 2),
  (3, 'networks', 'Сети, коллекторы, водные объекты',   'объектов', 'period', 'mon,thu', 0,  5.00, 15.00, 3),
  (4, 'streets',  'Благоустройство улиц',               'объектов', 'report', NULL,      0,  2.00, 10.00, 4);

-- Пороги статуса направления в «Сводке» (факт − план): < −2 п.п. — отставание, < −10 п.п. — критично.
INSERT INTO app_settings (setting_key, setting_value) VALUES
  ('app.title',          JSON_QUOTE('МВС СТ · Ход работ по направлениям')),
  ('summary.thresholds', JSON_OBJECT('warn', 2, 'crit', 10));

-- Миграции, изменения которых уже включены в этот файл (чтобы npm run migrate их не повторял)
INSERT INTO schema_migrations (version) VALUES ('002_legacy_import_fields'), ('003_net_object_long_names');

-- Первого администратора создаёт команда сервера (пароль будет зашифрован):
--     npm run create-admin
-- Вставлять пользователя вручную через SQL не нужно — нужен bcrypt-хеш пароля.

-- Готово! Проверка: SHOW FULL TABLES;  — 40 строк с типом BASE TABLE и 3 строки VIEW (всего 43).
