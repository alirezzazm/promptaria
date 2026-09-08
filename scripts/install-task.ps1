# نصب تسک زمان‌بندی‌شده‌ی نگهداری Promptaria.
#
# چرا جدا از تایمر داخل اپ: تایمر داخلی فقط وقتی کار می‌کند که پروسه بالا باشد.
# این تسک مستقل است، پس حتی اگر اپ خوابیده یا وسط دیپلوی باشد، کتابخانه به‌روز می‌ماند.
#
# دو بار در روز اجرا می‌شود (۰۴:۰۰ و ۱۶:۰۰) و اگر سرور آن موقع خاموش بوده،
# بعد از روشن شدن جبران می‌کند.

$ErrorActionPreference = 'Stop'
$taskName = 'promptaria-maintain'
$app      = 'C:\Users\Administrator\Desktop\claud\promptaria'
$node     = (Get-Command node).Source

if (-not (Test-Path (Join-Path $app 'scripts\maintain.js'))) {
    Write-Host "اسکریپت نگهداری پیدا نشد در $app" -ForegroundColor Red
    exit 1
}

# اگر از قبل هست، برش دار تا تعریف تازه بنشیند
Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue |
    Unregister-ScheduledTask -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction -Execute $node `
    -Argument 'scripts\maintain.js' -WorkingDirectory $app

$triggers = @(
    (New-ScheduledTaskTrigger -Daily -At 4am),
    (New-ScheduledTaskTrigger -Daily -At 4pm)
)

# StartWhenAvailable: اگر سرور سر ساعت خاموش بود، بعداً جبران می‌کند.
# S4U: بدون ذخیره‌ی رمز اجرا می‌شود، مثل بقیه‌ی تسک‌های این سرور.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 10)

$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers `
    -Settings $settings -Principal $principal `
    -Description 'Promptaria: اسکرپ منابع، همگام‌سازی پرامپت‌های فارسی، بازتولید توضیحات و پاک‌سازی' | Out-Null

$t = Get-ScheduledTask -TaskName $taskName
Write-Host "تسک ثبت شد: $($t.TaskName) — وضعیت $($t.State)" -ForegroundColor Green
Write-Host 'زمان اجرا: هر روز ۰۴:۰۰ و ۱۶:۰۰'
Write-Host "لاگ: $app\logs\maintain.log"
