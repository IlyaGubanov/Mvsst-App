# =====================================================================
#  Запуск ТЕСТОВОГО MySQL на этом компьютере (для разработки).
#  Запуск: правой кнопкой по файлу → «Выполнить с помощью PowerShell»
#          или в PowerShell:  powershell -ExecutionPolicy Bypass -File dev\start-mysql.ps1
#
#  Тестовая база не установлена как служба Windows, поэтому после перезагрузки
#  компьютера её нужно запускать этим скриптом. Данные лежат в %LOCALAPPDATA%\MVS-MySQL.
#  MySQL слушает только 127.0.0.1 — с других компьютеров он недоступен.
# =====================================================================

$mysqld = 'C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld.exe'
$folder = Join-Path $env:LOCALAPPDATA 'MVS-MySQL'

if (-not (Test-Path $mysqld)) { Write-Host 'MySQL 8.4 не установлен (нет mysqld.exe).' -ForegroundColor Red; exit 1 }
if (-not (Test-Path "$folder\my.ini")) { Write-Host "Нет настроек тестовой базы: $folder\my.ini" -ForegroundColor Red; exit 1 }

if (Get-Process mysqld -ErrorAction SilentlyContinue) { Write-Host 'MySQL уже запущен.' -ForegroundColor Green; exit 0 }

# MySQL не понимает кириллицу в пути (имя пользователя «Администратор»),
# поэтому берём короткое латинское имя папки, например C:\Users\836D~1\...
$short = (New-Object -ComObject Scripting.FileSystemObject).GetFolder($folder).ShortPath

Start-Process -FilePath $mysqld -ArgumentList "--defaults-file=`"$short\my.ini`"" -WindowStyle Hidden

for ($i = 0; $i -lt 30; $i++) {
  if (Test-NetConnection 127.0.0.1 -Port 3306 -InformationLevel Quiet -WarningAction SilentlyContinue) {
    Write-Host 'MySQL запущен (127.0.0.1:3306).' -ForegroundColor Green; exit 0
  }
  Start-Sleep -Milliseconds 700
}
Write-Host "MySQL не ответил за 20 секунд. Журнал ошибок: $folder\mysql-error.log" -ForegroundColor Red
exit 1
