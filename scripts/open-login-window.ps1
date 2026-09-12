# باز کردن پنجره‌ی کروم روی دسکتاپ تعاملی، برای ورود دستی به اینستاگرام.
#
# چرا این اسکریپت جداست: اپ زیر PM2 اجرا می‌شود و پنجره‌ای که خودش باز کند
# ممکن است در نشست دیگری بیفتد و اصلاً دیده نشود. یک تسک زمان‌بندی‌شده با
# ورود تعاملی، پنجره را در نشست خودِ کاربر باز می‌کند.
#
# رمز هیچ‌جا ذخیره نمی‌شود و این اسکریپت هم آن را نمی‌بیند — فقط پنجره را
# باز می‌کند و ورود را خودِ کاربر انجام می‌دهد. نشست بعد از آن در پوشه‌ی
# پروفایل می‌ماند، مثل هر مرورگر معمولی.

$ErrorActionPreference = 'Stop'
$requestFile = 'C:\ProgramData\promptaria\login-request.json'

if (-not (Test-Path $requestFile)) {
    throw "درخواست ورودی وجود ندارد در $requestFile — اول دکمه را در پنل بزن."
}

$request = Get-Content $requestFile -Raw -Encoding UTF8 | ConvertFrom-Json
$url = $request.url
$profileDir = $request.profile_dir

# هر دو مقدار از سمت اپ می‌آیند؛ اعتبارسنجی می‌شوند تا این اسکریپت نتواند
# به مقصد دلخواهِ یک فایل دست‌کاری‌شده برود.
if ($url -notmatch '^https://(www\.)?instagram\.com/') {
    throw "آدرس مجاز نیست: $url"
}
if (-not $profileDir -or $profileDir -notmatch '^[A-Za-z]:\\') {
    throw 'پوشه‌ی پروفایل معتبر نیست.'
}

$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (-not (Test-Path $chrome)) { $chrome = 'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe' }
if (-not (Test-Path $chrome)) { throw 'کروم روی این سیستم نصب نیست.' }

New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

# کروم برای هر پروفایل فقط یک پروسه اجازه می‌دهد. اگر یک کروم بی‌سر هنوز
# این پروفایل را نگه داشته باشد، پنجره‌ی تازه اصلاً باز نمی‌شود و آدرس را
# به همان پروسه‌ی نامرئی می‌دهد — کاربر کلیک می‌کند و چیزی نمی‌بیند.
# پس اول هر کرومی که روی این پروفایل است بسته می‌شود.
$stale = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
    Where-Object { $_.CommandLine -like "*$profileDir*" }
if ($stale) {
    $stale | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
}

# همان پورت دیباگ که اپ به آن وصل می‌شود، تا نشستِ همین پنجره بعداً قابل
# استفاده باشد و کاربر مجبور نباشد دو بار وارد شود.
Start-Process -FilePath $chrome -ArgumentList @(
    "--user-data-dir=$profileDir",
    '--remote-debugging-port=9222',
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    $url
)

Write-Host "پنجره باز شد. وارد شو، بعد پنجره را ببند." -ForegroundColor Green
