# 3. Руководство по развёртыванию

> Порядок: **Часть A** — подготовить свой компьютер (Windows) и база данных.
> **Часть B** — выбрать, где будет работать приложение.
> **Часть C** — развернуть на сервере Linux (рекомендуется). **Часть D** — вариант для сервера Windows.
> **Часть E** — обновления, резервные копии, неполадки.
>
> Части A1–A4 можно делать уже сейчас. Команды запуска сервера и сборки (A5, C6–C8) заработают после шагов 2–5,
> когда появится код в папках `server/` и `client/`.

---

## A. Компьютер разработчика (Windows)

### A1. Установить программы

| Программа | Зачем | Где взять |
|---|---|---|
| **Node.js 24 LTS** | запуск сервера и сборка React; вместе с ним ставится `npm` | nodejs.org → «LTS» |
| **Git** | история версий кода, загрузка на сервер | git-scm.com |
| **VS Code** | редактор кода | code.visualstudio.com |
| **MySQL Server 8.4 LTS** | база данных для разработки | dev.mysql.com/downloads/installer |
| **DBeaver** или **HeidiSQL** | просмотр базы мышкой | dbeaver.io / heidisql.com |

Можно поставить одной командой в PowerShell (winget уже есть в Windows 11):

```bash
winget install OpenJS.NodeJS.LTS Git.Git Microsoft.VisualStudioCode Oracle.MySQL dbeaver.dbeaver
```

После установки **закройте и откройте PowerShell заново** и проверьте:

```bash
node -v
```

Должно вывести `v24.…`. Аналогично `npm -v`, `git --version`.

> 💡 При установке MySQL мастер спросит пароль пользователя `root` — запишите его в надёжное место
> (менеджер паролей). Тип конфигурации — «Development Computer», порт — 3306.

### A2. Создать базу и пользователя приложения

Приложение **не должно** работать под `root`. Создаём отдельного пользователя с правами только на свою базу.
Откройте DBeaver/HeidiSQL под `root` (или в PowerShell: `mysql -u root -p`) и выполните:

```sql
CREATE DATABASE mvs_dashboard CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- придумайте свой длинный пароль вместо ЗАМЕНИТЕ_ПАРОЛЬ
CREATE USER 'mvs_app'@'localhost' IDENTIFIED BY 'ЗАМЕНИТЕ_ПАРОЛЬ';

-- права: читать/писать данные, создавать таблицы и представления; НЕТ права управлять другими базами
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES, CREATE VIEW, SHOW VIEW
  ON mvs_dashboard.* TO 'mvs_app'@'localhost';
FLUSH PRIVILEGES;
```

> `DROP` нужен только для первой установки и миграций. На «боевом» сервере после установки его можно отозвать:
> `REVOKE DROP ON mvs_dashboard.* FROM 'mvs_app'@'localhost';`

### A3. Создать таблицы

В PowerShell из папки `mvs-app`:

```bash
cmd /c "mysql -u mvs_app -p mvs_dashboard < database\schema.sql"
```

(В PowerShell знак `<` не работает, поэтому команда обёрнута в `cmd /c`. Если `mysql` «не найден» — добавьте
папку `C:\Program Files\MySQL\MySQL Server 8.4\bin` в переменную PATH или запустите файл через DBeaver: открыть → «Выполнить скрипт».)

Проверка — в DBeaver выполните `SHOW FULL TABLES;`: 40 таблиц и 3 представления (или после установки сервера — `npm run check-db`).

### A4. Завести Git-репозиторий

```bash
git init
```

Файл `.gitignore` уже лежит в проекте: он не даёт случайно опубликовать `node_modules` и `.env` с паролями.
Для хранения кода удобно создать **приватный** репозиторий на GitHub, GitFlic или GitVerse.

### A5. Запуск в режиме разработки (после шагов 2 и 5)

```bash
cd server
copy .env.example .env      # затем откройте .env и впишите пароль к базе
npm install                 # скачать библиотеки (один раз и после изменений package.json)
npm run check-db            # проверить подключение к базе и что все таблицы на месте
npm run create-admin        # создать первого администратора
npm run import-legacy -- --dir "C:\путь\к\распакованному\архиву"   # перенести данные из старых HTML (один раз)
npm run dev                 # сервер на http://localhost:3000, перезапускается при правке кода
```

Во втором окне PowerShell:

```bash
cd client
npm install
npm run dev                 # интерфейс на http://localhost:5173 (запросы /api идут на сервер 3000)
```

---

## B. Где разместить приложение

| Вариант | Цена | Сложность | Когда подходит |
|---|---|---|---|
| **VPS (виртуальный сервер) Linux** | ~300–800 ₽/мес (1–2 ядра, 2 ГБ ОЗУ, 20+ ГБ диска) | средняя, всё по этой инструкции | ✅ **рекомендуется**: полный контроль, Node.js + MySQL на одной машине |
| Свой сервер организации (Linux) | бесплатно | средняя | данные не должны покидать сеть организации; доступ только из внутренней сети/VPN |
| Свой сервер Windows Server | бесплатно (если сервер есть) | выше | Linux недоступен (часть D) |
| Хостинг с поддержкой Node.js (панель cPanel/ISPmanager «Node.js-приложение») | ~200–500 ₽/мес | низкая–средняя | работает, но меньше контроля; проверьте, что есть Node.js 22+ и MySQL 8 |
| Обычный хостинг «только PHP» | — | — | ❌ не подходит: Node.js-сервер там не запустить |

Минимальные требования: **2 ГБ ОЗУ** (MySQL + Node.js + сборка React), Ubuntu 24.04 LTS, доменное имя
(например, `dash.example.ru`) или фиксированный IP во внутренней сети.

> ⚠ Если в отчётах есть сведения ограниченного распространения, уточните требования вашей службы
> безопасности (размещение в РФ, доступ только из сети организации, 152-ФЗ для персональных данных —
> ФИО и телефоны сотрудников относятся к ним).

---

## C. Развёртывание на сервере Linux (Ubuntu 24.04)

Команды выполняются в терминале сервера. Подключение с Windows: `ssh root@IP_СЕРВЕРА`
(ssh встроен в Windows 11; IP и пароль выдаёт хостинг).

### C1. Первичная настройка и защита

```bash
apt update && apt upgrade -y
adduser deploy                      # рабочий пользователь вместо root
usermod -aG sudo deploy
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable   # брандмауэр: открыты только SSH, 80, 443
timedatectl set-timezone Europe/Moscow                      # важно: «план на сегодня» зависит от даты
```

Дальше работаем под `deploy`: `ssh deploy@IP_СЕРВЕРА`.

> 💡 Совет: настройте вход по SSH-ключу (`ssh-keygen` на своём ПК, затем `ssh-copy-id deploy@IP`) и запретите вход по паролю.

### C2. Установить Node.js, MySQL, Nginx

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs mysql-server nginx git
sudo npm install -g pm2
sudo mysql_secure_installation        # ответьте «Y» на всё: убрать тестовую базу, анонимов и т.д.
```

### C3. База данных

```bash
sudo mysql
```

Внутри — те же команды, что в A2 (создать базу и пользователя `mvs_app`), затем `exit`.

### C4. Получить код

```bash
sudo mkdir -p /var/www/mvs-app && sudo chown deploy:deploy /var/www/mvs-app
git clone АДРЕС_ВАШЕГО_РЕПОЗИТОРИЯ /var/www/mvs-app
cd /var/www/mvs-app
mysql -u mvs_app -p mvs_dashboard < database/schema.sql      # только при первой установке!
```

### C5. Настройки сервера (.env)

```bash
cd /var/www/mvs-app/server
cp .env.example .env
nano .env            # редактор: правка стрелками, сохранить Ctrl+O, Enter, выйти Ctrl+X
chmod 600 .env       # читать файл может только владелец
```

Что будет в `.env` (окончательный список — в `.env.example` на шаге 2):

```ini
NODE_ENV=production
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_NAME=mvs_dashboard
DB_USER=mvs_app
DB_PASSWORD=ваш_пароль_от_базы
SESSION_SECRET=длинная_случайная_строка   # получить: openssl rand -hex 32
TZ=Europe/Moscow
```

### C6. Установка, сборка, первый администратор

```bash
cd /var/www/mvs-app/server && npm ci --omit=dev
npm run create-admin
cd ../client && npm ci && npm run build      # готовые файлы интерфейса появятся в client/dist
```

### C7. Запуск через PM2 (сервер работает постоянно)

```bash
cd /var/www/mvs-app/server
pm2 start src/index.js --name mvs-api
pm2 save
pm2 startup          # PM2 выведет команду sudo ... — скопируйте и выполните её (автозапуск после перезагрузки)
```

Полезное: `pm2 status`, `pm2 logs mvs-api`, `pm2 restart mvs-api`.

### C8. Nginx: сайт и проксирование API

Создайте файл `sudo nano /etc/nginx/sites-available/mvs-app`:

```nginx
server {
    listen 80;
    server_name dash.example.ru;               # ваш домен или IP

    root /var/www/mvs-app/client/dist;         # собранный React
    index index.html;
    client_max_body_size 25m;                  # загрузка Excel-отчётов

    # Запросы к API передаём в Node.js
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Все остальные адреса (/mkd, /networks/rec7) отдаём index.html — маршруты разбирает React
    location / {
        try_files $uri /index.html;
    }

    # Файлы сборки с хешем в имени можно кэшировать надолго
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

Включить и проверить:

```bash
sudo ln -s /etc/nginx/sites-available/mvs-app /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### C9. Домен и HTTPS

1. В панели регистратора домена создайте **A-запись**: `dash` → IP сервера. Подождите 10–60 минут.
2. Получите бесплатный сертификат:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d dash.example.ru
```

Certbot сам настроит HTTPS и автопродление. Проверка продления: `sudo certbot renew --dry-run`.

> Для сервера **только во внутренней сети** без домена Let's Encrypt не подойдёт — сертификат выдаёт
> ИТ-служба организации (внутренний центр сертификации), его пути указываются в Nginx.

### C10. Проверка

- Откройте `https://dash.example.ru` → страница входа → войдите администратором.
- `https://dash.example.ru/api/health` → `{"ok":true,"db":true}` (этот адрес сделаем на шаге 2).
- Откройте сайт с телефона.

---

## D. Вариант: свой сервер Windows Server

1. Установите Node.js 24 LTS, MySQL 8.4, Git (как в A1). Часовой пояс сервера — Москва.
2. Шаги A2–A3 (база), C4–C6 (код, `.env`, сборка) — те же команды в PowerShell.
3. В `.env` добавьте `SERVE_CLIENT=true` — тогда Node.js сам будет отдавать собранный интерфейс,
   и Nginx не нужен (это предусмотрим в коде на шаге 2).
4. Запуск как службы Windows — через **NSSM** (nssm.cc):
   `nssm install mvs-api "C:\Program Files\nodejs\node.exe" "C:\mvs-app\server\src\index.js"`,
   в поле «Startup directory» — `C:\mvs-app\server`, затем `nssm start mvs-api`.
5. Откройте порт в брандмауэре Windows (только для внутренней сети). Для HTTPS поставьте перед Node.js
   IIS с модулями URL Rewrite + ARR или Caddy — сертификат даёт ИТ-служба.

---

## E. Эксплуатация

### E1. Обновление приложения (новая версия кода)

```bash
cd /var/www/mvs-app
./scripts/backup.sh                       # 1. копия базы перед обновлением
git pull                                  # 2. забрать новый код
cd server && npm ci --omit=dev
npm run migrate                           # 3. применить новые изменения структуры базы (если есть)
pm2 restart mvs-api                       # 4. перезапустить сервер
cd ../client && npm ci && npm run build                 # 5. интерфейс
```

### E2. Резервные копии базы

Создайте файл `/var/www/mvs-app/scripts/backup.sh` (вместе с проектом он появится на шаге 8):

```bash
#!/bin/bash
# Ежедневная копия базы, хранить 30 дней
DIR=/var/backups/mvs
mkdir -p $DIR
mysqldump --single-transaction --routines mvs_dashboard | gzip > $DIR/mvs_$(date +%F_%H%M).sql.gz
find $DIR -name 'mvs_*.sql.gz' -mtime +30 -delete
```

Пароль для `mysqldump` положите в `~/.my.cnf` (права 600):

```ini
[client]
user=mvs_app
password=ваш_пароль_от_базы
```

Автозапуск каждую ночь в 02:30: `crontab -e` и строка
`30 2 * * * /var/www/mvs-app/scripts/backup.sh`

**Восстановление:** `gunzip < /var/backups/mvs/mvs_2026-10-27_0230.sql.gz | mysql mvs_dashboard`

> 💡 Копия на том же сервере не спасёт от поломки сервера. Раз в неделю скачивайте копию к себе
> (`scp deploy@IP:/var/backups/mvs/*.gz .`) или настройте отправку в облачное хранилище.
> И хотя бы раз попробуйте восстановить копию на тестовую базу — непроверенная копия = нет копии.

### E3. Где смотреть, если что-то не работает

| Признак | Где смотреть | Частая причина |
|---|---|---|
| Сайт не открывается вообще | `sudo systemctl status nginx`, `sudo nginx -t` | ошибка в конфиге Nginx, DNS ещё не обновился, порт закрыт в ufw |
| «502 Bad Gateway» | `pm2 status`, `pm2 logs mvs-api` | Node.js-сервер упал или не запущен |
| Ошибка подключения к базе | `pm2 logs`, `sudo systemctl status mysql` | неверный пароль в `.env`, MySQL остановлен |
| Вместо кириллицы «????» | кодировка таблиц | база создана не в `utf8mb4` |
| После обновления «старый» интерфейс | — | не выполнен `npm run build` или кэш браузера (Ctrl+F5) |
| Неверный «план на сегодня» | `timedatectl` | часовой пояс сервера не Москва |
| Не загружается Excel | `client_max_body_size` в Nginx | файл больше лимита |

### E4. Чек-лист «готово к работе»

- [ ] HTTPS работает, http перенаправляет на https
- [ ] Пароль администратора сменён, у каждого сотрудника своя учётная запись
- [ ] `.env` с правами 600, не лежит в Git
- [ ] Ночная резервная копия создаётся (проверить файл в `/var/backups/mvs`)
- [ ] Восстановление из копии проверено на тестовой базе
- [ ] Вход по SSH только по ключу, брандмауэр включён
- [ ] `sudo apt upgrade` раз в месяц (обновления безопасности)
