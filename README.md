<div align="center">

# ✦ Promptaria — پرامپت‌آریا

**کتابخانه‌ای فارسی از بهترین پرامپت‌های هوش مصنوعی دنیا، که خودش را با وب‌اسکرپینگ به‌روز می‌کند.**

[promptaria.aliizz.ir](https://promptaria.aliizz.ir) · ۲۷۰۰+ پرامپت · ۱۸ منبع · ۱۴ دسته‌بندی

</div>

---

## این پروژه چیست

یک سایت کاملاً فارسی که پرامپت‌های هوش مصنوعی را از ۱۸ منبع معتبر جهانی جمع می‌کند،
دسته‌بندی و امتیازدهی می‌کند، و برای هرکدام **آموزش کامل فارسی** می‌سازد — بدون اینکه
کاربر عادی هرگز ببیند پرامپت از کجا آمده.

| کاربر عادی می‌بیند | ادمین می‌بیند |
|---|---|
| متن پرامپت + دکمه کپی | همان‌ها، به‌علاوه **لینک مستقیم منبع اصلی** |
| آموزش گام‌به‌گام فارسی «چطور استفاده کنم» | وضعیت سلامت هر منبع و تاریخچه اجراها |
| جای‌خالی‌ها، نمونه واقعی، خروجی مورد انتظار | ویرایش کامل، منتخب‌کردن، مخفی‌سازی، حذف |
| نکته‌های حرفه‌ای و مدل‌های پیشنهادی | استودیو ساخت پست اینستاگرام |

> **قاعده اصلی:** `source_url` فقط از مسیرهای `/api/admin/*` برگردانده می‌شود.
> در هیچ پاسخ عمومی — نه فهرست، نه صفحه جزئیات، نه HTML رندرشده — وجود ندارد.

## اجرا

```bash
npm install
npm run scrape     # گردآوری اولیه از همه منابع (~۳ دقیقه)
npm start          # http://localhost:3400
```

پنل مدیریت روی `/admin`. رمز اولیه از `ADMIN_PASSWORD` خوانده می‌شود و **فقط در
اولین اجرا**؛ بعد از آن هش در دیتابیس است و از تب «تنظیمات» عوض می‌شود.

| دستور | کار |
|---|---|
| `npm start` | سرور + زمان‌بند به‌روزرسانی خودکار |
| `npm run scrape` | اجرای همه منابع |
| `node scraper/run.js <key> …` | اجرای فقط چند منبع مشخص |
| `npm run reenrich` | بازتولید توضیحات فارسی بدون اسکرپ مجدد |

## سئو

سایت **کاملاً سمت سرور رندر می‌شود** — یعنی خزنده گوگل به‌جای یک پوسته خالی، متن
واقعی هر صفحه را می‌گیرد.

- آدرس‌های معنادار: `/p/<slug>-<id>`، `/c/<category>`، `/guide`، `/categories`
- `title` و `description` یکتا برای هر صفحه، `canonical`، `hreflang`، OG و Twitter Card
- داده ساختاریافته: `Article`، `HowTo`، `FAQPage`، `BreadcrumbList`، `ItemList`، `WebSite` + `SearchAction`
- `sitemap.xml` ایندکس‌شده و تکه‌تکه (۲۰۰۰ آدرس در هر فایل) با `lastmod` و `priority` بر اساس کیفیت
- `robots.txt` که `/admin`، `/api/` و `/search` را می‌بندد تا بودجه خزش هدر نرود
- آدرس دارایی‌ها نسخه‌دار است (`?v=`)، پس کش طولانی امن است
- `prefers-reduced-motion`، skip-link، ARIA و کنتراست رعایت شده

## منابع (۱۸ سایت)

| کلید | منبع | نوع |
|---|---|---|
| `awesome-chatgpt-prompts` | Awesome ChatGPT Prompts | CSV |
| `chatgpt-shortcut` | ChatGPT Shortcut / aishort.top | JSON |
| `awesome-claude-prompts` | Awesome Claude Prompts | Markdown |
| `awesome-prompts-gptstore` | Awesome Prompts (GPT Store) | فایل ریپو |
| `linexjlin-gpts` | GPTs Prompts | فایل ریپو |
| `llm-prompt-library` | LLM Prompt Library | فایل ریپو |
| `chatgpt-system-prompts` | ChatGPT System Prompts | فایل ریپو |
| `ai-tools-system-prompts` | System Prompts of AI Tools | فایل ریپو |
| `ms-prompts-for-edu` | Microsoft Prompts for Edu | فایل ریپو |
| `dev-chatgpt-prompts` | Dev ChatGPT Prompts | Markdown |
| `data-science-prompts` | Data Science Prompts | Markdown |
| `yokoffing-prompts` | ChatGPT Prompts (yokoffing) | Markdown |
| `mr-ranedeer` | Mr. Ranedeer AI Tutor | تک‌فایل |
| `promptingguide` | Prompt Engineering Guide | HTML |
| `semrush` | Semrush Blog | HTML |
| `hubspot` | HubSpot Blog | HTML |
| `writesonic` | Writesonic Blog | HTML |
| `greataiprompts` | GreatAIPrompts | HTML |

افزودن منبع جدید = یک آبجکت در [`scraper/sources.js`](scraper/sources.js) با یکی از
آداپترهای `csv`، `github-files`، `markdown`، `json-cards`، `single`، `html`، `html-article`.

**حذف تکراری:** بدنه هر پرامپت نرمال‌سازی و SHA-1 می‌شود؛ همان متن از منبع دیگر دوباره
درج نمی‌شود. تغییر متن در منبع اصلی `update` می‌دهد، نه رکورد تازه.

## استودیو اینستاگرام

از هر پرامپت یک پست کامل می‌سازد:

- **کپشن فارسی** با قلاب، توضیح، سه قدم استفاده و CTA (با شمارنده ۲۲۰۰ کاراکتری)
- **۲۸ هشتگ** متناسب با دسته‌بندی، به‌علاوه ست جدا برای کامنت اول
- **کاروسل ۴ تا ۶ اسلایدی** ۱۰۸۰×۱۳۵۰ که در مرورگر روی canvas رندر می‌شود
  (بدون هیچ وابستگی نیتیو سمت سرور) و قابل دانلود است

**انتشار خودکار** اختیاری است و به Meta Graph API وصل می‌شود. لازم دارد:
حساب اینستاگرام Business یا Creator، یک صفحه فیسبوک متصل، و توکن بلندمدت با
دسترسی‌های `instagram_basic` + `instagram_content_publish` + `pages_show_list`.
تا وقتی این‌ها در تب اینستاگرام وارد نشوند، فقط بخش ساخت پست فعال است.

## معماری

```
server/
  index.js      Express: API عمومی + ادمین، مسیرهای SSR، زمان‌بند
  seo.js        رندر سمت سرور همه صفحات + داده ساختاریافته + sitemap
  db.js         اسکیمای SQLite روی node:sqlite (بدون وابستگی نیتیو)
  lib.js        دسته‌بندی، استخراج جای‌خالی، امتیاز کیفیت، تولید متن فارسی
  instagram.js  ساخت کپشن/هشتگ/استوری‌بورد + انتشار Graph API
  categories.js ۱۴ دسته‌بندی
  reenrich.js   بازتولید توضیحات از روی بدنه ذخیره‌شده
scraper/
  sources.js    فهرست ۱۸ منبع
  adapters.js   ۷ آداپتر استخراج
  run.js        اجرا، حذف تکراری، درج/به‌روزرسانی، ثبت لاگ
public/         فرانت‌اند بدون فریم‌ورک (JS فقط لایه تعاملی است)
```

بدون فریم‌ورک فرانت، بدون build step، بدون وابستگی نیتیو — فقط
`express`، `cheerio` و `cookie-parser`.

## استقرار

پشت nginx با گواهی Let's Encrypt، زیر PM2. اپ فقط روی `127.0.0.1` گوش می‌دهد
و nginx تنها درِ ورودی عمومی است. نمونه کانفیگ در [`ecosystem.config.js`](ecosystem.config.js).

## لایسنس

کد تحت MIT. متن خودِ پرامپت‌ها متعلق به منابع اصلی است و لایسنس هرکدام در
`scraper/sources.js` ثبت شده.
