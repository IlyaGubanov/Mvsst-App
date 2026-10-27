# =====================================================================
#  Аккуратная остановка ТЕСТОВОГО MySQL (данные сохраняются).
#  Запуск: powershell -ExecutionPolicy Bypass -File dev\stop-mysql.ps1
# =====================================================================

$mysqladmin = 'C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqladmin.exe'
$pwdFile = Join-Path $env:LOCALAPPDATA 'MVS-MySQL\root-password.txt'

if (-not (Get-Process mysqld -ErrorAction SilentlyContinue)) { Write-Host 'MySQL не запущен.'; exit 0 }

# Пароль root тестовой базы хранится в root-password.txt (строка вида «...: пароль»)
$env:MYSQL_PWD = ((Get-Content $pwdFile -Raw) -split ': ', 2)[1].Trim()
& $mysqladmin -u root --protocol=TCP -h 127.0.0.1 shutdown
Remove-Item Env:MYSQL_PWD

if ($LASTEXITCODE -eq 0) { Write-Host 'MySQL остановлен.' -ForegroundColor Green }
else { Write-Host 'Не удалось остановить MySQL (см. сообщение выше).' -ForegroundColor Red; exit 1 }
