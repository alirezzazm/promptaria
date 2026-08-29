'use strict';
const db = require('./db');

const CATEGORIES = [
  ['coding',       'برنامه‌نویسی',        'Coding & Dev',      '⌨️', 'کدنویسی، دیباگ، ریفکتور، تست و بازبینی کد', 10],
  ['writing',      'نویسندگی',            'Writing',           '✍️', 'مقاله، داستان، ویرایش، بازنویسی و خلاصه‌سازی متن', 20],
  ['marketing',    'مارکتینگ و فروش',      'Marketing',         '📣', 'تبلیغ‌نویسی، سئو، شبکه‌های اجتماعی و کمپین', 30],
  ['business',     'کسب‌وکار',             'Business',          '💼', 'استراتژی، برنامه‌ریزی، ارائه به سرمایه‌گذار و مدیریت', 40],
  ['design',       'طراحی و هنر',          'Design & Art',      '🎨', 'پرامپت‌های تصویری، UI/UX، لوگو و سبک بصری', 50],
  ['education',    'آموزش',                'Education',         '🎓', 'یادگیری گام‌به‌گام، تدریس، آزمون و تمرین', 60],
  ['career',       'شغل و رزومه',          'Career',            '🧭', 'رزومه، کاورلتر، مصاحبه شغلی و مسیر شغلی', 70],
  ['data',         'داده و تحلیل',         'Data & Analytics',  '📊', 'تحلیل داده، اکسل، آمار و مصورسازی', 80],
  ['productivity', 'بهره‌وری',             'Productivity',      '⚡', 'برنامه‌ریزی، اتوماسیون و مدیریت زمان', 90],
  ['research',     'پژوهش',                'Research',          '🔬', 'مقاله علمی، مرور ادبیات و روش تحقیق', 100],
  ['lifestyle',    'سبک زندگی',            'Lifestyle',         '🌿', 'سلامت، تغذیه، سفر، مالی شخصی و روابط', 110],
  ['roleplay',     'نقش‌آفرینی',           'Roleplay',          '🎭', 'گرفتن نقش یک متخصص یا شبیه‌سازی موقعیت', 120],
  ['ai-systems',   'مهندسی پرامپت',        'Prompt Engineering','🧠', 'پرامپت سیستمی، ایجنت، و تنظیم رفتار مدل', 130],
  ['general',      'عمومی',                'General',           '✨', 'پرامپت‌های کاربردی روزمره در هر موضوعی', 999],
];

function ensureCategories() {
  const stmt = db.prepare(`
    INSERT INTO categories (slug, name_fa, name_en, icon, description, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name_fa = excluded.name_fa, name_en = excluded.name_en,
      icon = excluded.icon, description = excluded.description, sort_order = excluded.sort_order
  `);
  for (const c of CATEGORIES) stmt.run(...c);
}

module.exports = { ensureCategories, CATEGORIES };
