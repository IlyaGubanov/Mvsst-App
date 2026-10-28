# 3. Развёртывание: сначала на своём компьютере, потом на сервере

Инструкция пошаговая: выполняйте команды по порядку, после каждой части есть проверка «всё ли получилось».
Команды для Windows — в **PowerShell**, для сервера Linux — в терминале сервера (подключение по SSH).

| Часть | Что получится | Время |
|---|---|---|
| [1. Локально (Windows)](#1-локально-на-своём-компьютере-windows) | приложение работает на вашем ПК: http://localhost:5173 | 30–60 мин |
| [2. Сервер Linux](#2-сервер-linux-ubuntu-2404--рекомендуется) | приложение в интернете или в сети организации: https://ваш-домен | 1–2 ч |
| [3. Вариант: Windows Server](#3-вариант-сервер-windows-без-nginx) | то же на сервере Windows | 1–2 ч |
| [4. Обслуживание](#4-обслуживание-обновления-копии-неполадки) | обновления, резервные копии, что делать при сбоях | — |

## 0. Как устроено приложение (чтобы понимать, что мы запускаем)

```
 Браузер ──► Nginx (сервер Linux) ──► /api/…  ──► Node.js (server/) ──► MySQL (база mvs_dashboard)
                 │
                 └──► всё остальное ──► готовые файлы интерфейса (client/dist)
```

- **MySQL** — база данных: объекты, отчёты, пользователи, журнал.
- **Сервер Node.js** (`mvs-app/server`) — вся логика: вход, права, расчёты, сохранение. Отвечает на адреса `/api/…`.
- **Интерфейс React** (`mvs-app/client`) — то, что видит пользователь. Для сервера он **собирается** (`npm run build`)
  в папку `client/dist` — это обычные файлы HTML/JS/CSS.
- На своём ПК (разработка) интерфейс запускает **Vite** на порту 5173 и пересылает `/api` на сервер Node.js (порт 3000).
- На сервере файлы интерфейса отдаёт **Nginx**, а `/api` пересылает в Node.js. Node.js держит запущенным **PM2**.

Готовые файлы для сервера лежат в папке [`deploy/`](../deploy):

| Файл | Зачем |
|---|---|
| `deploy/nginx/mvs-app.conf` | настройка сайта в Nginx |
| `deploy/nginx/security-headers.conf` | защитные заголовки страниц |
| `deploy/ecosystem.config.cjs` | запуск сервера Node.js через PM2 |
| `deploy/backup.sh` | резервная копия базы |
| `deploy/update.sh` | обновление приложения одной командой |
| `deploy/mvs-admin.ps1` | команды администратора (пользователи, ответственные) — пока нет экрана администрирования |

---

## 1. Локально, на своём компьютере (Windows)

### 1.1. Установить программы

| Программа | Зачем |
|---|---|
| **Node.js 24 LTS** (подойдёт и 22.12+) | запуск сервера и сборка интерфейса; вместе с ним ставится `npm` |
| **Git** | скачать код из GitHub и отправлять изменения |
| **MySQL Server 8.4** | база данных |
| **VS Code** | редактор (удобно открывать файлы настроек) |

Откройте PowerShell и выполните (winget уже есть в Windows 10/11):

```bash
winget install OpenJS.NodeJS.LTS Git.Git Oracle.MySQL Microsoft.VisualStudioCode
```

**Закройте PowerShell и откройте заново** (чтобы он увидел новые программы) и проверьте:

```bash
node -v
```

Должно быть `v24.…` (или `v22.12` и новее). Также `npm -v` и `git --version` должны показать номера версий.

### 1.2. Настроить MySQL

1. Меню «Пуск» → **MySQL Configurator** → Next.
2. Тип: **Development Computer**, порт **3306**.
3. Придумайте пароль пользователя **root** и сохраните его в менеджере паролей.
4. Отметьте «Configure MySQL Server as a Windows Service» и «Start the MySQL Server at System Startup» —
   тогда база будет запускаться сама вместе с Windows.
5. Next → Execute → Finish.

Чтобы не набирать длинный путь, запомните программу `mysql` в переменной (её надо задавать в каждом новом окне PowerShell):

```bash
$mysql = 'C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe'
```

### 1.3. Скачать код

Храните проект в папке **без русских букв в пути** (программа `mysql` с ними не дружит), например `C:\Projects`:

```bash
git clone https://github.com/IlyaGubanov/Mvsst-App.git C:\Projects\Mvsst-App
```

```bash
cd C:\Projects\Mvsst-App\mvs-app
```

> Если репозиторий приватный, Git откроет в браузере окно входа в GitHub — войдите, Git это запомнит.
> Дальше все команды выполняются из папки `C:\Projects\Mvsst-App\mvs-app`, если не сказано иное.

### 1.4. Создать базу данных

Приложение работает **не под root**, а под своим пользователем с правами только на свою базу. Войдите в MySQL:

```bash
& $mysql -u root -p
```

Введите пароль root. Появится приглашение `mysql>` — вставьте команды (вместо `ПРИДУМАЙТЕ_ПАРОЛЬ` — свой
длинный пароль, сохраните его: он понадобится в `.env`):

```sql
CREATE DATABASE mvs_dashboard CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'mvs_app'@'localhost' IDENTIFIED BY 'ПРИДУМАЙТЕ_ПАРОЛЬ';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES, CREATE VIEW, SHOW VIEW
  ON mvs_dashboard.* TO 'mvs_app'@'localhost';
exit
```

Создайте таблицы (40 таблиц и 3 представления):

```bash
& $mysql -u mvs_app -p --default-character-set=utf8mb4 mvs_dashboard -e "source database/schema.sql"
```

### 1.5. Настройки сервера (`server/.env`)

```bash
cd server
```

```bash
copy .env.example .env
```

Получите длинную случайную строку для подписи входа (скопируйте результат):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Откройте файл настроек:

```bash
notepad .env
```

Заполните и сохраните:

| Строка | Что вписать |
|---|---|
| `DB_PASSWORD=` | пароль пользователя `mvs_app` из шага 1.4 |
| `SESSION_SECRET=` | случайная строка из команды выше |

Остальное оставьте как есть (`NODE_ENV=development`, `PORT=3000`). Файл `.env` содержит пароли и **никогда не
попадает в Git** — это уже настроено в `.gitignore`.

### 1.6. Установить библиотеки и создать администратора

Всё ещё в папке `server`:

```bash
npm install
```

```bash
npm run check-db
```

Должно быть `✔ Структура в порядке`. Если ошибка — текст подскажет, что не так (чаще всего пароль в `.env`).

```bash
npm run create-admin
```

Команда спросит логин (например, `admin`), ФИО и пароль (при вводе пароль не отображается — так и должно быть).

### 1.7. Перенести данные из прежнего дашборда

Распакуйте архив дашборда в папку без русских букв:

```bash
Expand-Archive "$HOME\Downloads\МВС_СТ_дашборд (1).zip" C:\Projects\mvs-data
```

Имя папки внутри архива при распаковке часто превращается в «кракозябры» — не страшно: команда ниже сама найдёт
нужную папку (ту, где лежат `modules\` и `src\`):

```bash
$dir = (Get-ChildItem C:\Projects\mvs-data -Recurse -Filter streets.html | Where-Object { $_.Directory.Name -eq 'modules' } | Select-Object -First 1).Directory.Parent.FullName
```

```bash
npm run import-legacy -- --dir "$dir"
```

Команда перенесёт школы, МКД, сети и благоустройство и сама сверит итоги с исходником (если хоть что-то
не сойдётся — направление не запишется, и вы увидите причину). Затем посчитайте историю показателей:

```bash
npm run recalc-kpi
```

### 1.8. Запуск

Нужны **два окна PowerShell**.

Окно 1 — сервер (из папки `mvs-app\server`):

```bash
npm run dev
```

Окно 2 — интерфейс:

```bash
cd C:\Projects\Mvsst-App\mvs-app\client
```

```bash
npm install
```

```bash
npm run dev
```

Откройте **http://localhost:5173** и войдите администратором из шага 1.6.

✅ **Проверка:** видна «Сводка» с четырьмя направлениями, открываются разделы, на вкладке
«Благоустройство → Карта» видна карта. Адрес http://localhost:3000/api/health показывает `{"ok":true,"db":true,…}`.

Остановить — `Ctrl+C` в каждом окне. В следующий раз — только два `npm run dev` (MySQL запускается сам).

### 1.9. Пользователи и ответственные

Экран «Администрирование» появится на шаге 7. Пока пользователей создают командами из файла
`deploy\mvs-admin.ps1`. Откройте **третье** окно PowerShell в папке `mvs-app`:

```bash
cd C:\Projects\Mvsst-App\mvs-app
```

```bash
. .\deploy\mvs-admin.ps1
```

(точка, пробел, путь — «подключить» команды; если PowerShell ответит «выполнение сценариев отключено», выполните
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` и повторите).

```bash
Connect-Mvs -Url http://localhost:5173 -Login admin
```

Примеры (полный список — в начале файла `deploy\mvs-admin.ps1`):

| Задача | Команда |
|---|---|
| Список пользователей | `Get-MvsUsers` |
| Редактор по МКД и Сетям | `New-MvsUser -Login petrov -FullName 'Петров Сергей Викторович' -Role editor -Directions mkd,networks` |
| Руководство (видит всё, не вносит) | `New-MvsUser -Login boss -FullName 'Иванов Иван' -Role manager` |
| Просмотр только школ | `New-MvsUser -Login ivanova -FullName 'Иванова Анна' -Role viewer -Directions schools` |
| Найти объекты и их номера | `Find-MvsObject -Direction mkd -Text 'Ленина'` |
| Назначить ответственным | `Add-MvsAssignment -Direction mkd -Login petrov -ObjectIds 12,15` |
| Новый временный пароль | `Reset-MvsPassword -Login petrov` |
| Отключить пользователя | `Disable-MvsUser -Login petrov` |

Новому пользователю команда покажет **временный пароль** — передайте его лично; при первом входе приложение
попросит придумать свой.

### 1.10. Обновить код на своём ПК

Если код менялся (например, вы забрали новую версию из GitHub):

```bash
git pull
```

Затем в `server`: `npm install` и `npm run migrate` (применит изменения структуры базы, если они есть);
в `client`: `npm install`. И перезапустите оба `npm run dev`.

### 1.11. (Необязательно) Проверить «как на сервере»

Собрать интерфейс и запустить сервер в рабочем режиме — так, как он будет работать на сервере без Nginx:

```bash
cd C:\Projects\Mvsst-App\mvs-app\client
```

```bash
npm run build
```

```bash
cd ..\server
```

```bash
$env:NODE_ENV='production'; $env:SERVE_CLIENT='true'; $env:COOKIE_SECURE='false'; $env:PORT='3100'; npm start
```

Откройте http://localhost:3100. Остановить — `Ctrl+C`; закройте это окно PowerShell, чтобы временные настройки сбросились.

---

## 2. Сервер Linux (Ubuntu 24.04) — рекомендуется

### 2.0. Что понадобится

| Вариант | Цена | Когда подходит |
|---|---|---|
| **VPS (виртуальный сервер)** у хостера | ~300–800 ₽/мес | ✅ рекомендуется: полный контроль, всё по этой инструкции |
| Сервер организации (Linux) | бесплатно | данные не должны покидать сеть организации |
| Сервер Windows | бесплатно, если есть | Linux недоступен — [часть 3](#3-вариант-сервер-windows-без-nginx) |
| Хостинг «только PHP» | — | ❌ не подходит: на нём не запустить Node.js |

Минимум: **Ubuntu 24.04 LTS, 2 ГБ памяти, 20 ГБ диска**. Для HTTPS — **домен** (например, `dash.example.ru`);
для внутренней сети — постоянный IP и сертификат от ИТ-службы.

> ⚠ ФИО и телефоны сотрудников — персональные данные (152-ФЗ). Уточните у службы безопасности требования к
> размещению (сервер в РФ, доступ только из сети организации).

Ниже: `IP_СЕРВЕРА` — адрес сервера от хостера, `dash.example.ru` — ваш домен. Подставляйте свои значения.

### 2.1. Первое подключение и защита сервера

С компьютера Windows (ssh встроен в Windows 10/11):

```bash
ssh root@IP_СЕРВЕРА
```

На сервере:

```bash
apt update && apt upgrade -y
```

```bash
adduser deploy
```

```bash
usermod -aG sudo deploy
```

```bash
timedatectl set-timezone Europe/Moscow
```

(`deploy` — рабочий пользователь вместо root; придумайте ему пароль. Часовой пояс важен: от даты зависит «план на сегодня».)

**Вход по ключу вместо пароля** (надёжнее). На **своём компьютере** в новом окне PowerShell:

```bash
ssh-keygen -t ed25519
```

(Enter на все вопросы.) Отправьте ключ на сервер:

```bash
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh deploy@IP_СЕРВЕРА "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"
```

Проверьте, что вход работает **без пароля**:

```bash
ssh deploy@IP_СЕРВЕРА
```

Только после успешного входа по ключу запретите вход по паролю (на сервере):

```bash
echo "PasswordAuthentication no" | sudo tee /etc/ssh/sshd_config.d/90-no-password.conf
```

```bash
sudo systemctl restart ssh
```

Брандмауэр — открыты только SSH и веб (80, 443):

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable
```

Дальше всё делаем под `deploy` (`ssh deploy@IP_СЕРВЕРА`).

### 2.2. Установить Node.js, MySQL, Nginx, PM2

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
```

```bash
sudo apt install -y nodejs mysql-server nginx git unzip
```

```bash
sudo npm install -g pm2
```

Проверка: `node -v` → `v24.…`, `mysql --version` → `8.0.…` или новее (MySQL 8.0 из Ubuntu подходит;
приложение проверялось на 8.4), `nginx -v`, `pm2 -v`.

### 2.3. База данных

```bash
sudo mysql_secure_installation
```

Отвечайте «Y»: удалить анонимных пользователей, тестовую базу, запретить вход root по сети.
Затем войдите в MySQL (root на Ubuntu входит через `sudo`, без пароля):

```bash
sudo mysql
```

И выполните те же команды, что в 1.4 (с **новым** паролем — не тем, что на ПК):

```sql
CREATE DATABASE mvs_dashboard CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'mvs_app'@'localhost' IDENTIFIED BY 'ПРИДУМАЙТЕ_ПАРОЛЬ';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES, CREATE VIEW, SHOW VIEW
  ON mvs_dashboard.* TO 'mvs_app'@'localhost';
exit
```

Сохраните пароль для резервных копий и команд `mysql` (тогда его не придётся вводить каждый раз):

```bash
nano ~/.my.cnf
```

Впишите (сохранить — `Ctrl+O`, `Enter`; выйти — `Ctrl+X`):

```ini
[client]
user=mvs_app
password=ПАРОЛЬ_ИЗ_КОМАНДЫ_ВЫШЕ
default-character-set=utf8mb4
```

```bash
chmod 600 ~/.my.cnf
```

### 2.4. Получить код

```bash
sudo mkdir -p /var/www/mvs && sudo chown deploy:deploy /var/www/mvs
```

**Если репозиторий публичный:**

```bash
git clone https://github.com/IlyaGubanov/Mvsst-App.git /var/www/mvs
```

**Если приватный** — дайте серверу ключ «только для чтения» (Deploy key):

```bash
ssh-keygen -t ed25519 -C "mvs-server" -f ~/.ssh/github_mvs -N ""
```

```bash
cat ~/.ssh/github_mvs.pub
```

Скопируйте выведенную строку → GitHub → репозиторий **Mvsst-App** → **Settings → Deploy keys → Add deploy key**
(название «mvs-server», галочку «Allow write access» **не** ставить) → Add key. Затем на сервере:

```bash
printf "Host github.com\n  IdentityFile ~/.ssh/github_mvs\n  IdentitiesOnly yes\n" >> ~/.ssh/config
```

```bash
git clone git@github.com:IlyaGubanov/Mvsst-App.git /var/www/mvs
```

(на вопрос «Are you sure you want to continue connecting» ответьте `yes`).

Создайте таблицы:

```bash
cd /var/www/mvs/mvs-app
```

```bash
mysql mvs_dashboard < database/schema.sql
```

### 2.5. Настройки сервера (`.env`)

```bash
cd /var/www/mvs/mvs-app/server && cp .env.example .env && chmod 600 .env
```

```bash
openssl rand -hex 32
```

(скопируйте результат — это `SESSION_SECRET`)

```bash
nano .env
```

Поменяйте строки:

```ini
NODE_ENV=production
DB_PASSWORD=пароль_mvs_app_из_шага_2.3
SESSION_SECRET=строка_из_openssl
TRUST_PROXY=true
SERVE_CLIENT=false
```

| Настройка | Зачем |
|---|---|
| `NODE_ENV=production` | рабочий режим: вход только по HTTPS, подробности ошибок не показываются пользователям |
| `TRUST_PROXY=true` | сервер стоит за Nginx: без этого он не поймёт, что вход был по HTTPS, и **вход не будет работать** |
| `SERVE_CLIENT=false` | интерфейс отдаёт Nginx |
| `COOKIE_SECURE` | не трогайте: при `production` вход работает только по HTTPS. Сайт без HTTPS — см. 2.10, вариант Б |

### 2.6. Установить библиотеки, собрать интерфейс, создать администратора

```bash
cd /var/www/mvs/mvs-app/server && npm ci --omit=dev
```

```bash
npm run check-db
```

```bash
npm run create-admin
```

```bash
cd /var/www/mvs/mvs-app/client && npm ci && npm run build
```

Сборка создаст папку `client/dist` — её и будет отдавать Nginx.

### 2.7. Данные

Выберите **один** из способов.

**А. Перенести из архива прежнего дашборда** (чистая база, как в 1.7). На **своём компьютере**:

```bash
scp "$HOME\Downloads\МВС_СТ_дашборд (1).zip" deploy@IP_СЕРВЕРА:/tmp/dashboard.zip
```

На сервере:

```bash
unzip -q /tmp/dashboard.zip -d /tmp/dash
```

```bash
cd /var/www/mvs/mvs-app/server && npm run import-legacy -- --dir "$(dirname "$(dirname "$(find /tmp/dash -path '*modules/streets.html' | head -1)")")"
```

(команда сама найдёт папку архива — ту, где лежат `modules/` и `src/`, — даже если её имя по-русски или искажено)

```bash
npm run recalc-kpi && rm -rf /tmp/dash /tmp/dashboard.zip
```

**Б. Перенести базу с вашего компьютера** — если вы уже вносили данные локально и хотите их сохранить.
На своём компьютере (из папки `mvs-app`):

```bash
& 'C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqldump.exe' -u mvs_app -p --single-transaction --no-tablespaces --default-character-set=utf8mb4 mvs_dashboard --result-file=mvs_local.sql
```

```bash
scp mvs_local.sql deploy@IP_СЕРВЕРА:/tmp/
```

На сервере:

```bash
mysql mvs_dashboard < /tmp/mvs_local.sql && rm /tmp/mvs_local.sql
```

> ⚠ Вместе с базой переедут и пользователи с вашего ПК (в том числе тестовые). После входа проверьте
> `Get-MvsUsers` и отключите лишних (`Disable-MvsUser`). Файл `mvs_local.sql` на своём ПК удалите — в нём данные.

### 2.8. Запуск сервера Node.js через PM2

```bash
cd /var/www/mvs/mvs-app && pm2 start deploy/ecosystem.config.cjs
```

```bash
pm2 save
```

```bash
pm2 startup
```

`pm2 startup` выведет команду, начинающуюся с `sudo env PATH=…` — **скопируйте её и выполните**: так сервер
будет запускаться сам после перезагрузки.

✅ **Проверка:**

```bash
curl -s http://127.0.0.1:3000/api/health
```

Ответ `{"ok":true,"db":true,…}`. Если нет — `pm2 logs mvs-api` покажет причину.

### 2.9. Nginx

```bash
sudo cp /var/www/mvs/mvs-app/deploy/nginx/mvs-app.conf /etc/nginx/sites-available/mvs-app
```

```bash
sudo nano /etc/nginx/sites-available/mvs-app
```

Замените `dash.example.ru` в строке `server_name` на свой домен (или IP сервера). Затем:

```bash
sudo ln -s /etc/nginx/sites-available/mvs-app /etc/nginx/sites-enabled/ && sudo rm -f /etc/nginx/sites-enabled/default
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

`nginx -t` должен ответить `syntax is ok` и `test is successful`.

### 2.10. HTTPS

**Вариант А — есть домен (сайт в интернете).**

1. У регистратора домена создайте **A-запись**: `dash` → `IP_СЕРВЕРА`. Подождите 10–60 минут
   (проверка: `ping dash.example.ru` показывает IP сервера).
2. Получите бесплатный сертификат Let's Encrypt:

```bash
sudo apt install -y certbot python3-certbot-nginx
```

```bash
sudo certbot --nginx -d dash.example.ru
```

Certbot спросит e-mail и сам допишет HTTPS в настройки Nginx; на вопрос о перенаправлении выберите
**redirect** (http → https). Продление — автоматически; проверка: `sudo certbot renew --dry-run`.

**Вариант Б — внутренняя сеть без домена.**

- Лучше всего — попросить у ИТ-службы сертификат для сервера и прописать его в Nginx
  (`listen 443 ssl; ssl_certificate …; ssl_certificate_key …;`).
- Если HTTPS пока невозможен, сайт будет работать по `http://IP_СЕРВЕРА`, но:
  1. в `server/.env` добавьте `COOKIE_SECURE=false` и выполните `pm2 reload mvs-api`;
  2. в `deploy/nginx/security-headers.conf` удалите `; upgrade-insecure-requests` и строку
     `Strict-Transport-Security`, затем `sudo systemctl reload nginx`.

  ⚠ Без HTTPS пароли передаются по сети в открытом виде — допустимо только временно и только в закрытой сети.

### 2.11. Первый вход и пользователи

1. Откройте `https://dash.example.ru` — страница входа → войдите администратором из шага 2.6.
2. Проверьте с телефона.
3. Создайте сотрудников с **своего компьютера** теми же командами, что в 1.9, только с адресом сервера:

```bash
. .\deploy\mvs-admin.ps1
```

```bash
Connect-Mvs -Url https://dash.example.ru -Login admin
```

### 2.12. Резервные копии базы

Скрипт `deploy/backup.sh` делает копию в `/var/backups/mvs` и удаляет копии старше 30 дней.

```bash
sudo mkdir -p /var/backups/mvs && sudo chown deploy:deploy /var/backups/mvs
```

```bash
bash /var/www/mvs/mvs-app/deploy/backup.sh
```

Должно напечатать `Копия готова: /var/backups/mvs/mvs_….sql.gz`. Каждую ночь в 02:30:

```bash
crontab -e
```

(при первом запуске выберите редактор `nano`) и допишите строку:

```
30 2 * * * bash /var/www/mvs/mvs-app/deploy/backup.sh >> /var/backups/mvs/backup.log 2>&1
```

**Восстановление из копии** (заменит текущие данные!):

```bash
gunzip < /var/backups/mvs/mvs_2026-10-28_0230.sql.gz | mysql mvs_dashboard
```

> 💡 Копия на том же сервере не спасёт, если сломается сам сервер. Раз в неделю скачивайте копии к себе
> (на своём ПК: `scp "deploy@IP_СЕРВЕРА:/var/backups/mvs/*.gz" .`). И хотя бы раз попробуйте восстановить
> копию — непроверенная копия = нет копии.

---

## 3. Вариант: сервер Windows (без Nginx)

1. На сервере выполните шаги **1.1–1.6** (программы, MySQL как служба, код в `C:\Projects\Mvsst-App`, база, `.env`,
   `npm install`, администратор). Для сервера вместо `npm install` в `server` можно `npm ci --omit=dev`.
2. Данные — как в 1.7 (из архива) или 2.7-Б (перенос базы).
3. Соберите интерфейс: в `client` — `npm ci`, затем `npm run build`.
4. В `server\.env`:

```ini
NODE_ENV=production
PORT=3000
SERVE_CLIENT=true
COOKIE_SECURE=false
```

   (`SERVE_CLIENT=true` — Node.js сам отдаёт интерфейс; `COOKIE_SECURE=false` — пока нет HTTPS. Когда ИТ-служба
   поставит перед сервером HTTPS — IIS с ARR, Caddy или Nginx для Windows, — уберите эту строку и добавьте `TRUST_PROXY=true`.)

5. Запуск как службы Windows — программа **NSSM** (nssm.cc, или `winget install NSSM.NSSM`), PowerShell **от имени
   администратора**:

```bash
nssm install mvs-api "C:\Program Files\nodejs\node.exe" "src\index.js"
```

```bash
nssm set mvs-api AppDirectory C:\Projects\Mvsst-App\mvs-app\server
```

```bash
nssm set mvs-api AppStdout C:\Projects\Mvsst-App\mvs-app\server\service.log
```

```bash
nssm start mvs-api
```

6. Откройте порт только для сети организации:

```bash
New-NetFirewallRule -DisplayName "MVS app" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Domain
```

   Адрес для сотрудников: `http://ИМЯ_ИЛИ_IP_СЕРВЕРА:3000`.

7. Резервные копии — «Планировщик заданий» Windows, ежедневно, действие «Запустить программу»:
   `C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqldump.exe` с аргументами
   `--defaults-extra-file=C:\mvs-backup\my.cnf --single-transaction --no-tablespaces mvs_dashboard --result-file=C:\mvs-backup\mvs.sql`
   (в `my.cnf` — те же строки `[client]`, что в 2.3; доступ к папке — только администраторам).
   Чтобы хранить несколько дней, копируйте файл в отдельную папку с датой в имени или настройте резервное копирование
   средствами ИТ-службы.

Обновление на Windows Server: `git pull` → в `server`: `npm ci --omit=dev`, `npm run migrate` → в `client`:
`npm ci`, `npm run build` → `nssm restart mvs-api`.

---

## 4. Обслуживание: обновления, копии, неполадки

### 4.1. Как выпустить новую версию

1. Изменили и проверили код на своём ПК → `git commit` → `git push` (отправить на GitHub).
2. На сервере одной командой:

```bash
bash /var/www/mvs/mvs-app/deploy/update.sh
```

Скрипт сам сделает копию базы, заберёт код, обновит библиотеки, применит изменения структуры базы,
соберёт интерфейс и перезапустит сервер. В конце — проверка `/api/health`. Пользователям достаточно обновить
страницу (`Ctrl+F5`).

### 4.2. Полезные команды на сервере

| Команда | Что делает |
|---|---|
| `pm2 status` | работает ли сервер Node.js |
| `pm2 logs mvs-api` | журнал сервера (выйти — `Ctrl+C`) |
| `pm2 reload mvs-api` | перезапуск без перерыва (после правки `.env`) |
| `sudo systemctl status nginx mysql` | состояние Nginx и MySQL |
| `sudo tail -50 /var/log/nginx/error.log` | ошибки Nginx |
| `cd /var/www/mvs/mvs-app/server && npm run migrate -- --status` | какие изменения структуры базы применены |
| `ls -lh /var/backups/mvs` | резервные копии |

### 4.3. Если что-то не работает

| Признак | Где смотреть | Частая причина и решение |
|---|---|---|
| Сайт не открывается | `sudo nginx -t`, `sudo ufw status` | ошибка в настройке Nginx; не открыты порты 80/443; домен ещё не указывает на сервер |
| «502 Bad Gateway» | `pm2 status`, `pm2 logs mvs-api` | сервер Node.js не запущен или упал — причина в журнале (часто ошибка в `.env`) |
| Ввожу пароль — снова страница входа | `.env` | вход по `http://` при `NODE_ENV=production` → нужен HTTPS или `COOKIE_SECURE=false` (2.10-Б); за Nginx нет `TRUST_PROXY=true` |
| Страница белая, в консоли браузера ошибки `https://…` | `security-headers.conf` | сайт без HTTPS, а заголовки «только HTTPS» не убраны (2.10-Б) |
| «Не удалось подключиться к базе» | `pm2 logs`, `sudo systemctl status mysql` | неверный `DB_PASSWORD` в `.env`; MySQL остановлен |
| Вместо русских букв «????» | — | база создана не в `utf8mb4` — пересоздайте по 1.4/2.3 |
| Карта серая, маркеры есть | доступ сервера/пользователя в интернет | подложка карты грузится с tile.openstreetmap.org — во внутренней сети без интернета её нет |
| После обновления старый интерфейс | — | не выполнен `npm run build` или кэш браузера — `Ctrl+F5` |
| Неверный «план на сегодня» | `timedatectl` | часовой пояс сервера не Москва |
| `npm run import-legacy` пишет о расхождениях | текст команды | архив не тот или изменён; данные направления не записываются, пока не сойдутся |
| Забыли пароль администратора | на сервере: `cd server && npm run create-admin` | введите тот же логин — команда предложит сменить пароль |

### 4.4. Чек-лист «готово к работе»

- [ ] Сайт открывается по HTTPS, `http://` перенаправляет на `https://`
- [ ] `https://ваш-домен/api/health` отвечает `{"ok":true,"db":true,…}`
- [ ] У каждого сотрудника своя учётная запись, тестовые пользователи отключены
- [ ] `.env` и `~/.my.cnf` с правами 600, `.env` не лежит в Git
- [ ] Ночная копия базы создаётся, восстановление проверено хотя бы раз
- [ ] Вход по SSH только по ключу, брандмауэр включён
- [ ] Раз в месяц: `sudo apt update && sudo apt upgrade -y` (обновления безопасности)
