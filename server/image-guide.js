'use strict';
/**
 * The teaching text for image prompts — the ones that come with a picture of
 * what they produced (prompts.image_url).
 *
 * lib.enrich() writes guidance for chat prompts: "send it as the first
 * message, then describe your topic in the next one", best on Claude. For
 * "turn this photo into a figure" that is wrong on every line — the prompt is
 * the whole request, it often needs a photo uploaded first, and Claude does not
 * draw. The scraper applies this over enrich() for every row with an image, and
 * scripts/image-guides.js re-applies it to rows already stored.
 */

const isFa = (s) => /[؀-ۿ]/.test(String(s || ''));

// The gallery states its upload requirements in English ("Need to upload a
// reference image"); content/input-notes-fa.json holds the Persian for each.
const NOTES_FA = require('../content/input-notes-fa.json');

/** Persian upload note for a scraped one; unknown English falls back to the generic ask. */
function noteFa(note) {
  const n = String(note || '').trim();
  if (!n || isFa(n)) return n;
  return NOTES_FA[n] || 'اول عکس مرجع را آپلود کن.';
}

function imageGuide({ title, inputNote }) {
  const needs = !!(inputNote && String(inputNote).trim());
  const name = isFa(title) ? `«${title}» ` : '';

  const summary = needs
    ? `پرامپت تصویری ${name}که روی عکس خودت کار می‌کند: عکس را به Gemini یا ChatGPT بده، این متن را بفرست و نتیجه‌ای شبیه نمونه‌ی همین صفحه بگیر.`
    : `پرامپت تصویری ${name}برای Gemini (نانو بنانا) و ChatGPT — نمونه‌ی خروجی‌اش را همین‌جا می‌بینی؛ کپی کن و همان را بساز.`;

  const how_to = [
    'این یک پرامپت **تصویری** است: خروجی‌اش عکس است، نه متن. عکس بالای صفحه نمونه‌ای است که همین متن ساخته.',
    '**۱) ابزار تصویرساز را باز کن.** بهترین نتیجه را Gemini با مدل Nano Banana می‌دهد؛ ChatGPT (ساخت تصویر) هم خوب جواب می‌دهد. Claude تصویر نمی‌سازد.',
    needs
      ? `**۲) اول عکس را آپلود کن.** ${inputNote} بدون عکس ورودی، مدل چیزی برای تبدیل ندارد و از خودش تصویر می‌سازد.`
      : '**۲) عکس ورودی لازم نیست.** مستقیم پرامپت را بفرست.',
    '**۳) پرامپت را همان‌طور که هست بچسبان و بفرست.** متن انگلیسی را ترجمه نکن؛ مدل‌های تصویری با انگلیسی دقیق‌تر کار می‌کنند. برای شخصی‌سازی فقط کلمه‌های موضوع، رنگ یا متن روی تصویر را عوض کن.',
    '**۴) با یک جمله اصلاح کن.** لازم نیست همه‌چیز را از اول بفرستی؛ بنویس «پس‌زمینه را ساده‌تر کن»، «نور را گرم‌تر کن» یا «همین را عمودی بساز».',
    '**۵) اگر دور بود، دوباره بساز.** هر اجرا کمی فرق می‌کند. دو سه بار ساختن و انتخاب بهترین، معمولاً از بازنویسی پرامپت سریع‌تر است.',
  ].join('\n\n');

  const example_use = needs
    ? 'عکس را آپلود کن، پرامپت را بفرست. اگر خواستی چیزی عوض شود، در پیام بعد بنویس: «همین را با پس‌زمینه‌ی سفید و نور استودیویی بساز و چهره را دقیقاً مثل عکس نگه دار.»'
    : 'پرامپت را همان‌طور بفرست. برای نسخه‌ی خودت، موضوع یا متن داخل آن را عوض کن؛ مثلاً اسم برند خودت را جای متن نمونه بگذار.';

  const expected_out = needs
    ? 'تصویری شبیه نمونه‌ی بالای صفحه، ساخته‌شده از روی عکسی که دادی.'
    : 'تصویری شبیه نمونه‌ی بالای صفحه. هر بار ساختن کمی فرق می‌کند.';

  const tips = [
    'نوشته‌ی فارسی روی تصویر هنوز نقطه‌ضعف مدل‌های تصویری است و حروف را به‌هم می‌ریزد. متن را انگلیسی بنویس یا بعداً در ویرایشگر اضافه کن.',
    needs
      ? 'برای اینکه چهره عوض نشود، آخر پرامپت اضافه کن: keep the face exactly the same as the uploaded photo.'
      : 'برای یکدست ماندن یک سری تصویر، بهترین خروجی را دوباره آپلود کن و بنویس «با همین سبک، این بار…».',
    'نسبت تصویر را آخر پرامپت بگو: vertical 9:16 برای استوری، square 1:1 برای پست، 16:9 برای بنر.',
  ];

  return {
    summary,
    how_to,
    example_use,
    expected_out,
    tips,
    best_models: ['Gemini (Nano Banana)', 'ChatGPT'],
    difficulty: 'easy',
    // Short bodies score low in enrich(), but these come with proof of what they
    // make — rank them with the library's good prompts, not below them.
    quality: 84,
  };
}

module.exports = { imageGuide, noteFa };
