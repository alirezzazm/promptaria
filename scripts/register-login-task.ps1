# ثبت تسکی که پنجره‌ی ورود اینستاگرام را روی دسکتاپ باز می‌کند.
#
# یک بار اجرا می‌شود. بعد از آن، دکمه‌ی «ورود به اینستاگرام» در پنل فقط همین
# تسک را صدا می‌زند و پنجره در نشست تعاملی کاربر باز می‌شود.

$ErrorActionPreference = 'Stop'

$taskName = 'promptaria-ig-login'
$ps1 = 'C:\Users\Administrator\Desktop\claud\promptaria\scripts\open-login-window.ps1'

if (-not (Test-Path $ps1)) { throw "اسکریپت پیدا نشد: $ps1" }

Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue |
    Unregister-ScheduledTask -Confirm:$false -ErrorAction SilentlyContinue

$argument = '-NoProfile -ExecutionPolicy Bypass -File "' + $ps1 + '"'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argument

# Interactive: بدون این، پنجره در نشست ۰ باز می‌شود و کاربر هیچ‌وقت نمی‌بیندش.
$principal = New-ScheduledTaskPrincipal -UserId 'Administrator' -LogonType Interactive -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName $taskName -Action $action `
    -Principal $principal -Settings $settings `
    -Description 'Promptaria: باز کردن پنجره ورود اینستاگرام روی دسکتاپ' | Out-Null

$t = Get-ScheduledTask -TaskName $taskName
Write-Host "تسک ثبت شد: $($t.TaskName) — وضعیت $($t.State)" -ForegroundColor Green
