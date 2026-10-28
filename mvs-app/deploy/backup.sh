#!/usr/bin/env bash
# =====================================================================
#  Резервная копия базы mvs_dashboard (сервер Linux).
#
#  Пароль берётся из ~/.my.cnf (права 600), в этом файле его нет:
#      [client]
#      user=mvs_app
#      password=ваш_пароль_от_базы
#
#  Ручной запуск:   bash /var/www/mvs/mvs-app/deploy/backup.sh
#  Каждую ночь:     crontab -e  →  30 2 * * * bash /var/www/mvs/mvs-app/deploy/backup.sh
#  Восстановление:  gunzip < /var/backups/mvs/mvs_ДАТА.sql.gz | mysql mvs_dashboard
# =====================================================================

set -euo pipefail                       # при любой ошибке — остановиться, а не делать вид, что всё хорошо

DB=mvs_dashboard
DIR=${BACKUP_DIR:-/var/backups/mvs}    # куда класть копии
KEEP_DAYS=${KEEP_DAYS:-30}             # сколько дней хранить

mkdir -p "$DIR"
FILE="$DIR/mvs_$(date +%F_%H%M).sql.gz"

# --single-transaction — копия «на один момент» без остановки работы;
# --no-tablespaces — без этого флага пользователю mvs_app не хватает прав (нужен PROCESS)
mysqldump --single-transaction --no-tablespaces --default-character-set=utf8mb4 "$DB" | gzip > "$FILE.tmp"
mv "$FILE.tmp" "$FILE"                  # готовый файл появляется целиком — недописанных копий не бывает

# Удалить копии старше KEEP_DAYS дней
find "$DIR" -name 'mvs_*.sql.gz' -mtime +"$KEEP_DAYS" -delete

echo "Копия готова: $FILE ($(du -h "$FILE" | cut -f1))"
