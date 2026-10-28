# =====================================================================
#  mvs-admin.ps1 — команды администратора для PowerShell, пока в приложении нет экрана
#  «Администрирование» (появится на шаге 7). Работают и с локальной копией, и с сервером:
#  команды обращаются к API приложения так же, как браузер.
#
#  Как пользоваться (PowerShell, из папки mvs-app):
#    . .\deploy\mvs-admin.ps1                    ← точка, пробел, путь: «подключить» команды
#    Connect-Mvs -Url http://localhost:5173 -Login admin     ← локально; на сервере — https://ваш-домен
#    Get-MvsUsers                                 ← список пользователей
#    New-MvsUser -Login petrov -FullName 'Петров Сергей Викторович' -Role editor -Directions mkd,networks
#    Find-MvsObject -Direction mkd -Text 'Ленина'                     ← найти объекты и их номера (Id)
#    Add-MvsAssignment -Direction mkd -Login petrov -ObjectIds 12,15  ← назначить ответственным
#    Set-MvsDirections -Login ivanova -Directions schools,streets     ← какие направления видит пользователь
#    Reset-MvsPassword -Login petrov             ← выдать новый временный пароль
#    Disable-MvsUser -Login petrov               ← отключить (удалять нельзя — на него ссылается журнал)
#
#  Роли: admin — администратор, manager — руководство, editor — редактор, viewer — просмотр.
#  Направления: schools, mkd, networks, streets.
#  Если PowerShell пишет «выполнение сценариев отключено», один раз выполните:
#    Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
# =====================================================================

$script:Mvs = $null   # адрес сайта и «сеанс» (cookie входа) после Connect-Mvs

function Invoke-Mvs {
  # Внутренняя: запрос к API. Тело отправляем как UTF-8, иначе русские буквы исказятся.
  param([string]$Method = 'GET', [Parameter(Mandatory)][string]$Path, $Body)
  if (-not $script:Mvs) { throw 'Сначала войдите: Connect-Mvs -Url ... -Login ...' }
  $req = @{ Uri = $script:Mvs.Url + $Path; Method = $Method; WebSession = $script:Mvs.Session }
  # Сервер принимает только JSON. Без тела PowerShell отправил бы POST как «форму», поэтому шлём хотя бы {}
  if ($null -eq $Body -and $Method -ne 'GET') { $Body = @{} }
  if ($null -ne $Body) {
    $req.ContentType = 'application/json; charset=utf-8'
    $req.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 5 -Compress))
  }
  try {
    Invoke-RestMethod @req
  } catch {
    # Сервер отвечает на ошибки JSON вида { error, details } — показываем понятный текст
    $msg = $_.Exception.Message
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      try {
        $e = $_.ErrorDetails.Message | ConvertFrom-Json
        $msg = $e.error
        if ($e.details -and $e.details.fields) { $msg += ': ' + (($e.details.fields | ForEach-Object { $_.message }) -join '; ') }
      } catch { $msg = $_.ErrorDetails.Message }
    }
    throw "Ошибка: $msg"
  }
}

function Connect-Mvs {
  # Вход администратором. Пароль спрашивается скрытым вводом и нигде не сохраняется.
  param(
    [Parameter(Mandatory)][string]$Url,
    [Parameter(Mandatory)][string]$Login,
    [Security.SecureString]$Password
  )
  if (-not $Password) { $Password = Read-Host "Пароль для $Login" -AsSecureString }
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password))
  $script:Mvs = @{ Url = $Url.TrimEnd('/'); Session = New-Object Microsoft.PowerShell.Commands.WebRequestSession }
  try {
    $r = Invoke-Mvs -Method POST -Path '/api/auth/login' -Body @{ login = $Login; password = $plain }
  } catch { $script:Mvs = $null; throw }
  if ($r.user.role -ne 'admin') { $script:Mvs = $null; throw 'Эти команды доступны только администратору' }
  "Вошли как $($r.user.fullName) на $Url"
}

function Get-MvsUsers {
  (Invoke-Mvs -Path '/api/users').users |
    Select-Object login, fullName, roleName, @{ n = 'directions'; e = { $_.directions -join ', ' } }, objectsCount, isActive, mustChangePassword |
    Format-Table -AutoSize
}

function Get-MvsUserId([string]$Login) {
  $u = (Invoke-Mvs -Path '/api/users').users | Where-Object { $_.login -eq $Login.ToLower() }
  if (-not $u) { throw "Пользователь «$Login» не найден" }
  $u.id
}

function New-MvsUser {
  param(
    [Parameter(Mandatory)][string]$Login,
    [Parameter(Mandatory)][string]$FullName,
    [ValidateSet('admin', 'manager', 'editor', 'viewer')][string]$Role = 'editor',
    [ValidateSet('schools', 'mkd', 'networks', 'streets')][string[]]$Directions = @(),
    [string]$Email
  )
  $body = @{ login = $Login; fullName = $FullName; role = $Role; directions = @($Directions) }
  if ($Email) { $body.email = $Email }
  $r = Invoke-Mvs -Method POST -Path '/api/users' -Body $body
  "Создан: $($r.user.login) — $($r.user.fullName) ($($r.user.roleName))"
  "ВРЕМЕННЫЙ ПАРОЛЬ: $($r.tempPassword)"
  'Передайте его лично. При первом входе приложение попросит придумать свой пароль.'
}

function Reset-MvsPassword {
  param([Parameter(Mandatory)][string]$Login)
  $r = Invoke-Mvs -Method POST -Path "/api/users/$(Get-MvsUserId $Login)/reset-password"
  "Новый временный пароль для ${Login}: $($r.tempPassword)"
}

function Set-MvsDirections {
  param(
    [Parameter(Mandatory)][string]$Login,
    [ValidateSet('schools', 'mkd', 'networks', 'streets')][string[]]$Directions = @()
  )
  $r = Invoke-Mvs -Method PUT -Path "/api/users/$(Get-MvsUserId $Login)/directions" -Body @{ directions = @($Directions) }
  "Направления ${Login}: $((@($r.user.directions) | ForEach-Object { if ($_.code) { $_.code } else { $_ } }) -join ', ')"
}

function Disable-MvsUser {
  param([Parameter(Mandatory)][string]$Login)
  $null = Invoke-Mvs -Method PUT -Path "/api/users/$(Get-MvsUserId $Login)" -Body @{ isActive = $false }
  "Пользователь $Login отключён"
}

function Find-MvsObject {
  # Объекты направления: номер (Id) для назначения, название, кто ответственный
  param(
    [Parameter(Mandatory)][ValidateSet('schools', 'mkd', 'networks', 'streets')][string]$Direction,
    [string]$Text = ''
  )
  (Invoke-Mvs -Path "/api/assignments?direction=$Direction").objects |
    Where-Object { -not $_.archived -and $_.name -like "*$Text*" } |
    Select-Object id, name, @{ n = 'responsible'; e = { ($_.responsible | ForEach-Object { $_.fullName }) -join ', ' } } |
    Format-Table -AutoSize -Wrap
}

function Add-MvsAssignment {
  # Назначить (или снять: -Mode remove; заменить весь список: -Mode replace) объекты редактору
  param(
    [Parameter(Mandatory)][ValidateSet('schools', 'mkd', 'networks', 'streets')][string]$Direction,
    [Parameter(Mandatory)][string]$Login,
    [Parameter(Mandatory)][int[]]$ObjectIds,
    [ValidateSet('add', 'remove', 'replace')][string]$Mode = 'add'
  )
  $r = Invoke-Mvs -Method PUT -Path '/api/assignments/user' -Body @{ direction = $Direction; userId = (Get-MvsUserId $Login); objectIds = @($ObjectIds); mode = $Mode }
  "Готово: добавлено $($r.added), снято $($r.removed), всего у $Login в «$Direction» — $($r.total)"
}
