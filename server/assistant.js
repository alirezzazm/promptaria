'use strict';
/**
 * پرامپت‌یار — the search assistant.
 *
 * A visitor types what they actually want in Persian ("می‌خوام برای فروشگاهم
 * کپشن اینستاگرام بنویسم") and gets three things back:
 *
 *   1. a reading of what they asked for — task, domain, audience, tone, format
 *   2. a ready-to-paste prompt assembled around that reading
 *   3. the closest prompts already in the library, each with a reason
 *
 * Everything runs locally against the catalogue: no model call, no API key, no
 * per-search cost, and it works the same whether or not an external service is
 * reachable from Iran. The trade-off is that understanding is lexical rather
 * than semantic, so the vocabulary tables below are what carry the quality —
 * they map how Persian speakers actually phrase a request onto the mostly
 * English corpus.
 */
const db = require('./db');
const { CAT_FA } = require('./lib');

/* ------------------------------------------------------------------ *
 * Persian → concept vocabulary
 *
 * Each concept lists Persian surface forms a user might type and the English
 * terms that appear in the corpus. Both sides feed scoring: the Persian side
 * identifies intent, the English side finds matching prompts.
 * ------------------------------------------------------------------ */
const CONCEPTS = [
  { id: 'instagram', cat: 'marketing',
    fa: ['اینستاگرام', 'اینستا', 'کپشن', 'پست', 'استوری', 'ریلز', 'ریل', 'هشتگ', 'پیج'],
    en: ['instagram', 'caption', 'social media', 'reels', 'hashtag', 'post'] },
  { id: 'ads', cat: 'marketing',
    fa: ['تبلیغ', 'تبلیغات', 'آگهی', 'کمپین', 'بنر', 'شعار', 'اسلوگان'],
    en: ['ad copy', 'advertis', 'campaign', 'slogan', 'headline', 'promotion'] },
  { id: 'seo', cat: 'marketing',
    fa: ['سئو', 'گوگل', 'رتبه', 'کلمه کلیدی', 'کلیدواژه', 'ترافیک', 'ایندکس'],
    en: ['seo', 'keyword', 'search engine', 'ranking', 'meta description', 'serp'] },
  { id: 'email', cat: 'marketing',
    fa: ['ایمیل', 'خبرنامه', 'نیوزلتر'],
    en: ['email', 'newsletter', 'subject line', 'cold email'] },
  { id: 'sales', cat: 'business',
    fa: ['فروش', 'مشتری', 'مذاکره', 'قیمت', 'قیمت‌گذاری', 'لید'],
    en: ['sales', 'customer', 'negotiat', 'pricing', 'lead', 'objection'] },
  { id: 'startup', cat: 'business',
    fa: ['استارتاپ', 'کسب و کار', 'کسب‌وکار', 'بیزینس', 'سرمایه', 'پیچ', 'بیزنس پلن', 'طرح کسب'],
    en: ['startup', 'business plan', 'pitch', 'investor', 'market research', 'strategy'] },
  { id: 'writing', cat: 'writing',
    fa: ['نوشتن', 'مقاله', 'متن', 'محتوا', 'وبلاگ', 'بلاگ', 'نگارش', 'انشا', 'داستان', 'رمان', 'شعر'],
    en: ['write', 'article', 'blog', 'content', 'essay', 'story', 'copy'] },
  { id: 'edit', cat: 'writing',
    fa: ['ویرایش', 'بازنویسی', 'خلاصه', 'خلاصه‌سازی', 'تصحیح', 'غلط', 'روان'],
    en: ['edit', 'rewrite', 'summar', 'proofread', 'paraphrase', 'grammar'] },
  { id: 'translate', cat: 'writing',
    fa: ['ترجمه', 'انگلیسی', 'مترجم', 'زبان'],
    en: ['translat', 'english', 'language'] },
  { id: 'code', cat: 'coding',
    fa: ['کد', 'کدنویسی', 'برنامه‌نویسی', 'برنامه نویسی', 'باگ', 'دیباگ', 'ارور', 'خطا', 'ریفکتور', 'تست'],
    en: ['code', 'debug', 'refactor', 'programming', 'developer', 'bug', 'unit test'] },
  { id: 'web', cat: 'coding',
    fa: ['سایت', 'وبسایت', 'وب‌سایت', 'فرانت', 'بک‌اند', 'ری‌اکت', 'جاوااسکریپت', 'پایتون', 'اس‌کیوال'],
    en: ['website', 'frontend', 'backend', 'react', 'javascript', 'python', 'sql', 'api'] },
  { id: 'resume', cat: 'career',
    fa: ['رزومه', 'سی وی', 'کاورلتر', 'مصاحبه', 'استخدام', 'شغل', 'لینکدین', 'کارجو'],
    en: ['resume', 'cv', 'cover letter', 'interview', 'job', 'linkedin', 'hiring'] },
  { id: 'study', cat: 'education',
    fa: ['درس', 'یادگیری', 'یاد بگیرم', 'آموزش', 'تدریس', 'امتحان', 'کنکور', 'دانشجو', 'دانش‌آموز', 'مطالعه', 'توضیح بده'],
    en: ['learn', 'teach', 'tutor', 'study', 'explain', 'exam', 'quiz', 'lesson', 'student'] },
  { id: 'research', cat: 'research',
    fa: ['تحقیق', 'پژوهش', 'پایان‌نامه', 'پایان نامه', 'مقاله علمی', 'منبع', 'رفرنس', 'روش تحقیق'],
    en: ['research', 'thesis', 'academic', 'citation', 'literature review', 'methodolog', 'paper'] },
  { id: 'data', cat: 'data',
    fa: ['داده', 'دیتا', 'تحلیل', 'آمار', 'اکسل', 'نمودار', 'گزارش', 'داشبورد'],
    en: ['data', 'analy', 'statistic', 'excel', 'chart', 'dashboard', 'report', 'spreadsheet'] },
  { id: 'image', cat: 'design',
    fa: ['عکس', 'تصویر', 'میدجرنی', 'طراحی', 'لوگو', 'گرافیک', 'بنر', 'تصویرسازی', 'هنر'],
    en: ['image', 'midjourney', 'design', 'logo', 'graphic', 'illustration', 'art', 'photo', 'render'] },
  { id: 'ux', cat: 'design',
    fa: ['رابط کاربری', 'یو ای', 'یوایکس', 'وایرفریم', 'فیگما'],
    en: ['ui', 'ux', 'wireframe', 'figma', 'user interface'] },
  { id: 'plan', cat: 'productivity',
    fa: ['برنامه', 'برنامه‌ریزی', 'زمان‌بندی', 'کار', 'تسک', 'اولویت', 'عادت', 'نظم', 'بهره‌وری'],
    en: ['plan', 'schedule', 'task', 'priorit', 'habit', 'productiv', 'workflow', 'checklist'] },
  { id: 'health', cat: 'lifestyle',
    fa: ['سلامت', 'ورزش', 'تغذیه', 'رژیم', 'غذا', 'خواب', 'استرس', 'روانشناس'],
    en: ['health', 'fitness', 'nutrition', 'diet', 'workout', 'sleep', 'stress', 'therapist'] },
  { id: 'money', cat: 'lifestyle',
    fa: ['پول', 'مالی', 'بودجه', 'پس‌انداز', 'سرمایه‌گذاری', 'ارز', 'حسابداری'],
    en: ['budget', 'finance', 'saving', 'invest', 'accounting'] },
  { id: 'travel', cat: 'lifestyle',
    fa: ['سفر', 'مسافرت', 'تور', 'گردشگری'],
    en: ['travel', 'trip', 'itinerary', 'tourism'] },
  { id: 'legal', cat: 'business',
    fa: ['قرارداد', 'حقوقی', 'وکیل', 'قانون'],
    en: ['contract', 'legal', 'lawyer', 'agreement', 'terms'] },
  { id: 'prompting', cat: 'ai-systems',
    fa: ['پرامپت', 'پرامپت‌نویسی', 'ایجنت', 'سیستم پرامپت', 'مدل'],
    en: ['prompt engineer', 'system prompt', 'agent', 'chain of thought', 'few-shot'] },
  /* Added alongside the second batch of authored Persian prompts — each of
   * these was a query the matcher understood as nothing at all. */
  { id: 'realestate', cat: 'marketing',
    fa: ['ملک', 'املاک', 'آپارتمان', 'اجاره', 'رهن', 'ویلا', 'مغازه', 'دیوار', 'شیپور', 'مستغلات'],
    en: ['real estate', 'property', 'listing', 'apartment', 'rental', 'realtor'] },
  { id: 'hospitality', cat: 'business',
    fa: ['منو', 'کافه', 'رستوران', 'کافی‌شاپ', 'کافی شاپ', 'غذاخوری', 'کیترینگ', 'فست‌فود', 'قهوه', 'آشپزی'],
    en: ['menu', 'restaurant', 'cafe', 'coffee shop', 'recipe', 'food service', 'hospitality'] },
  { id: 'official', cat: 'writing',
    fa: ['نامه اداری', 'نامه رسمی', 'شکایت', 'شکایت‌نامه', 'درخواست', 'اداره', 'سازمان', 'مکاتبه', 'نامه'],
    en: ['formal letter', 'complaint', 'official letter', 'correspondence', 'memo'] },
  { id: 'language', cat: 'education',
    fa: ['مکالمه', 'اسپیکینگ', 'آیلتس', 'تافل', 'گرامر', 'لغت', 'واژگان', 'تلفظ', 'یادگیری زبان'],
    en: ['conversation practice', 'speaking', 'ielts', 'toefl', 'vocabulary', 'pronunciation', 'language tutor'] },
  { id: 'telegram', cat: 'marketing',
    fa: ['تلگرام', 'کانال', 'ایتا', 'بله', 'روبیکا'],
    en: ['telegram', 'channel', 'broadcast'] },
  { id: 'hiring', cat: 'career',
    fa: ['شرح شغل', 'آگهی استخدام', 'منابع انسانی', 'جذب', 'غربالگری', 'نیرو', 'کارمند'],
    en: ['job description', 'recruit', 'hiring', 'onboarding', 'candidate', 'hr'] },
  { id: 'survey', cat: 'data',
    fa: ['نظرسنجی', 'پرسشنامه', 'بازخورد', 'فرم', 'نظرات', 'رضایت مشتری'],
    en: ['survey', 'questionnaire', 'feedback', 'nps', 'customer satisfaction'] },
  { id: 'video', cat: 'writing',
    fa: ['ویدیو', 'ویدئو', 'یوتیوب', 'آپارات', 'اسکریپت', 'سناریو', 'پادکست', 'تدوین', 'فیلم'],
    en: ['video', 'youtube', 'script', 'podcast', 'screenplay', 'voice over', 'storyboard'] },
  { id: 'freelance', cat: 'career',
    fa: ['فریلنس', 'فریلنسر', 'پروپوزال', 'پونیشا', 'کارلنسر', 'پیشنهاد پروژه', 'دورکاری'],
    en: ['freelance', 'proposal', 'upwork', 'client pitch', 'contractor'] },
  { id: 'competitor', cat: 'business',
    fa: ['رقیب', 'رقبا', 'تحلیل رقبا', 'سهم بازار', 'بنچمارک'],
    en: ['competitor', 'competitive analysis', 'market share', 'benchmark', 'swot'] },
];

/* ------------------------------------------------------------------ *
 * Modifiers — tone, audience, format, length
 * ------------------------------------------------------------------ */
const TONES = [
  { id: 'رسمی و حرفه‌ای', fa: ['رسمی', 'حرفه‌ای', 'اداری', 'جدی'] },
  { id: 'صمیمی و خودمانی', fa: ['صمیمی', 'خودمانی', 'دوستانه', 'ساده', 'راحت'] },
  { id: 'تبلیغاتی و ترغیب‌کننده', fa: ['جذاب', 'تبلیغاتی', 'ترغیب', 'فروشنده', 'قانع'] },
  { id: 'آموزشی و قدم‌به‌قدم', fa: ['آموزشی', 'قدم به قدم', 'گام به گام', 'مبتدی', 'ساده بگو'] },
  { id: 'طنز و غیررسمی', fa: ['طنز', 'بامزه', 'خنده', 'شوخ'] },
];

const AUDIENCES = [
  { id: 'مشتری‌های فروشگاه اینترنتی', fa: ['مشتری', 'خریدار', 'فروشگاه'] },
  { id: 'دنبال‌کننده‌های شبکه اجتماعی', fa: ['فالوور', 'مخاطب اینستاگرام', 'دنبال‌کننده'] },
  { id: 'کارفرما یا مصاحبه‌کننده', fa: ['کارفرما', 'مصاحبه', 'استخدام'] },
  { id: 'دانشجو یا دانش‌آموز', fa: ['دانشجو', 'دانش‌آموز', 'شاگرد', 'کلاس'] },
  { id: 'تیم فنی و توسعه‌دهنده‌ها', fa: ['تیم فنی', 'برنامه‌نویس', 'دولوپر', 'توسعه‌دهنده'] },
  { id: 'سرمایه‌گذار یا مدیر ارشد', fa: ['سرمایه‌گذار', 'مدیر', 'هیئت مدیره'] },
];

const FORMATS = [
  { id: 'فهرست شماره‌دار', fa: ['لیست', 'فهرست', 'بندبند', 'شماره'] },
  { id: 'جدول', fa: ['جدول', 'تیبل'] },
  { id: 'متن بلند با تیتر', fa: ['مقاله', 'متن بلند', 'تیتر', 'بخش‌بندی'] },
  { id: 'متن کوتاه', fa: ['کوتاه', 'مختصر', 'خلاصه', 'یک پاراگراف'] },
  { id: 'کد', fa: ['کد', 'اسکریپت', 'تابع'] },
];

/* ------------------------------------------------------------------ *
 * Persian-aware normalisation
 * ------------------------------------------------------------------ */
const AR_TO_FA = { 'ي': 'ی', 'ك': 'ک', 'ة': 'ه', 'ؤ': 'و', 'إ': 'ا', 'أ': 'ا', 'آ': 'ا' };
const FA_DIGITS = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };

function normalise(s) {
  return String(s || '')
    .replace(/[يكةؤإأآ]/g, (c) => AR_TO_FA[c] || c)
    .replace(/[۰-۹]/g, (c) => FA_DIGITS[c])
    .replace(/‌/g, ' ')      // ZWNJ reads as a word break for matching
    .replace(/[ًٌٍَُِّْ]/g, '')      // harakat
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

const STOP = new Set([
  'می', 'خوام', 'میخوام', 'برای', 'یه', 'یک', 'که', 'را', 'رو', 'از', 'به', 'با', 'در', 'و', 'تا',
  'کن', 'کنم', 'بده', 'بنویس', 'چطور', 'چگونه', 'است', 'هست', 'باشد', 'شود', 'های', 'ها', 'این',
  'آن', 'من', 'ما', 'شما', 'خودم', 'دارم', 'دارد', 'کنید', 'بگو', 'لطفا', 'the', 'a', 'for', 'to', 'of',
]);

const tokens = (s) => normalise(s).split(' ').filter((t) => t.length > 1 && !STOP.has(t));

/** Persian is lightly inflected here; trimming common suffixes lifts recall. */
function stem(t) {
  return t
    .replace(/(هایی|هایم|هایت|هایش|های|ها)$/, '')
    .replace(/(ترین|تر)$/, '')
    .replace(/(ام|ات|اش|مان|تان|شان)$/, '');
}

/* ------------------------------------------------------------------ *
 * Reading the request
 * ------------------------------------------------------------------ */
function matchList(list, norm) {
  const hits = [];
  for (const entry of list) {
    for (const term of entry.fa) {
      if (norm.includes(normalise(term))) {
        hits.push(entry);
        break;
      }
    }
  }
  return hits;
}

/**
 * Single words match whole tokens, not substrings.
 *
 * Substring matching made short concept words hijack longer unrelated ones —
 * "برنامه‌نویسی" in a query about a CV was scoring the coding concept above the
 * career one. A small suffix tolerance keeps inflections like "کدم" matching
 * "کد" without letting "کد" match every word that happens to contain it.
 */
function termHits(term, norm, tokenSet) {
  const n = normalise(term);
  if (!n) return 0;
  if (n.includes(' ')) return norm.includes(n) ? 3 : 0;
  if (tokenSet.has(n)) return 2;
  for (const t of tokenSet) {
    if (n.length >= 3 && t.startsWith(n) && t.length - n.length <= 2) return 2;
  }
  return 0;
}

function understand(query) {
  const norm = normalise(query);
  const toks = tokens(query).map(stem);
  const tokenSet = new Set([...tokens(query), ...toks]);

  // concepts, scored by how specifically they matched
  const scored = [];
  for (const c of CONCEPTS) {
    let score = 0;
    // "برنامه‌نویسی" and "برنامه نویسی" normalise identically — count once
    const seen = new Set();
    for (const term of c.fa) {
      const n = normalise(term);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      score += termHits(term, norm, tokenSet);
    }
    for (const term of c.en) if (norm.includes(term)) score += 2;
    if (score) scored.push({ ...c, score });
  }
  scored.sort((a, b) => b.score - a.score);

  const concepts = scored.slice(0, 3);
  const category = concepts.length ? concepts[0].cat : null;
  const tone = matchList(TONES, norm)[0] || null;
  const audience = matchList(AUDIENCES, norm)[0] || null;
  const format = matchList(FORMATS, norm)[0] || null;

  // English search terms drawn from the matched concepts, for corpus lookup
  const enTerms = [...new Set(concepts.flatMap((c) => c.en))].slice(0, 12);

  return { query: String(query || '').trim(), norm, toks, concepts, category, tone, audience, format, enTerms };
}

/* ------------------------------------------------------------------ *
 * Finding prompts
 * ------------------------------------------------------------------ */
const SEL = `
  SELECT p.uid, p.slug, COALESCE(p.title_fa, p.title) AS title, p.title AS title_en, p.summary, p.body, p.difficulty, p.quality, p.copies, p.views,
         p.tags, p.featured, c.slug AS cat_slug, c.name_fa AS cat_name, c.icon
  FROM prompts p LEFT JOIN categories c ON c.id = p.category_id
  WHERE p.status = 'published'`;

function findPrompts(read, limit = 6) {
  const terms = [...new Set([...read.enTerms, ...read.toks])].filter((t) => t.length > 2).slice(0, 14);
  if (!terms.length && !read.category) return [];

  const rows = db
    .prepare(`${SEL} ${read.category ? 'AND c.slug = ?' : ''} ORDER BY p.quality DESC LIMIT 900`)
    .all(...(read.category ? [read.category] : []));

  // widen to the whole corpus when one category is too thin to answer well
  const pool =
    rows.length >= 40
      ? rows
      : db.prepare(`${SEL} ORDER BY p.quality DESC LIMIT 1200`).all();

  const scored = pool
    .map((r) => {
      const hayTitle = (r.title || '').toLowerCase();
      const hayBody = ((r.summary || '') + ' ' + (r.body || '') + ' ' + (r.tags || '')).toLowerCase();
      let score = 0;
      const why = [];

      for (const t of terms) {
        if (hayTitle.includes(t)) {
          score += 12;
          if (why.length < 3 && t.length > 3) why.push(t);
        } else if (hayBody.includes(t)) {
          score += 3;
        }
      }
      if (read.category && r.cat_slug === read.category) score += 8;
      score += (r.quality || 50) / 12;
      score += Math.min(6, (r.copies || 0) / 3);
      if (r.featured) score += 3;
      // very long prompts are rarely the right first suggestion
      if ((r.body || '').length > 5000) score -= 4;
      return { r, score, why };
    })
    .filter((x) => x.score > 12)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ r, why }) => ({
    id: r.uid,
    slug: r.slug,
    title: r.title,
    summary: r.summary,
    category: r.cat_slug,
    category_name: r.cat_name,
    category_icon: r.icon,
    difficulty: r.difficulty,
    quality: r.quality,
    url: `/p/${r.slug}-${r.uid}`,
    reason: reasonFor(r, why, read),
  }));
}

function reasonFor(row, why, read) {
  const bits = [];
  if (read.category && row.cat_slug === read.category)
    bits.push(`از همان دسته‌ی ${CAT_FA[read.category] || row.cat_name} است`);
  if (why.length) bits.push(`مستقیماً به «${why.slice(0, 2).join('» و «')}» می‌پردازد`);
  if (row.quality >= 85) bits.push('یکی از باکیفیت‌ترین‌های کتابخانه است');
  else if (row.copies > 5) bits.push('کاربران زیاد ازش استفاده کرده‌اند');
  if (!bits.length) bits.push('نزدیک‌ترین چیزی است که به خواسته‌ات پیدا کردم');
  return bits.join(' و ') + '.';
}

/* ------------------------------------------------------------------ *
 * Building a prompt for exactly this request
 * ------------------------------------------------------------------ */
const ROLE_BY_CONCEPT = {
  instagram: 'یک سوشال‌مدیا مارکتر با تجربه در رشد پیج‌های فارسی',
  ads: 'یک کپی‌رایتر تبلیغاتی که کارش فروش است نه فقط زیبانویسی',
  seo: 'یک متخصص سئو با ده سال تجربه روی سایت‌های فارسی',
  email: 'یک متخصص ایمیل‌مارکتینگ با تمرکز روی نرخ باز شدن و کلیک',
  sales: 'یک مدیر فروش باتجربه که با مشتری ایرانی کار کرده',
  startup: 'یک مشاور کسب‌وکار که استارتاپ‌های مرحله اول را بالا آورده',
  writing: 'یک نویسنده و ویراستار حرفه‌ای فارسی',
  edit: 'یک ویراستار سخت‌گیر که متن را روان و بدون حشو می‌کند',
  translate: 'یک مترجم حرفه‌ای که ترجمه‌اش بوی ترجمه نمی‌دهد',
  code: 'یک مهندس نرم‌افزار ارشد که کد را بازبینی و بهینه می‌کند',
  web: 'یک توسعه‌دهنده فول‌استک با تسلط بر وب مدرن',
  resume: 'یک مشاور شغلی که رزومه‌های موفق نوشته',
  study: 'یک معلم خصوصی که مفاهیم سخت را ساده توضیح می‌دهد',
  research: 'یک پژوهشگر دانشگاهی با تسلط بر روش تحقیق',
  data: 'یک تحلیلگر داده که از عدد، تصمیم بیرون می‌کشد',
  image: 'یک کارگردان هنری که پرامپت‌های تصویری دقیق می‌نویسد',
  ux: 'یک طراح محصول با تمرکز بر تجربه کاربری',
  plan: 'یک مربی بهره‌وری که برنامه‌های عملی و قابل اجرا می‌چیند',
  health: 'یک مربی سلامت که توصیه‌های عملی و ایمن می‌دهد',
  money: 'یک مشاور مالی شخصی که ساده و شفاف توضیح می‌دهد',
  travel: 'یک برنامه‌ریز سفر که مسیرهای واقع‌بینانه می‌چیند',
  legal: 'یک کارشناس حقوقی که زبان قرارداد را ساده می‌کند',
  prompting: 'یک مهندس پرامپت که خروجی مدل را قابل پیش‌بینی می‌کند',
};

function buildPrompt(read) {
  const top = read.concepts[0];
  const role = (top && ROLE_BY_CONCEPT[top.id]) || 'یک متخصص باتجربه در همین حوزه';
  const task = read.query || 'کاری که در ادامه توضیح می‌دهم';

  const lines = [];
  lines.push(`تو ${role} هستی.`);
  lines.push('');
  lines.push(`کاری که از تو می‌خواهم: ${task}`);
  lines.push('');
  lines.push('این نکته‌ها را رعایت کن:');
  if (read.audience) lines.push(`• مخاطب: ${read.audience.id}`);
  else lines.push('• مخاطب: [اینجا بنویس برای چه کسی است]');
  if (read.tone) lines.push(`• لحن: ${read.tone.id}`);
  else lines.push('• لحن: [مثلاً صمیمی، رسمی، تبلیغاتی]');
  if (read.format) lines.push(`• قالب خروجی: ${read.format.id}`);
  else lines.push('• قالب خروجی: [مثلاً فهرست، جدول، متن بلند با تیتر]');
  lines.push('• زبان: فارسی روان و بدون ترجمه تحت‌اللفظی');
  lines.push('');
  lines.push('قبل از شروع، اگر چیزی از صورت مسئله برایت مبهم است حداکثر سه سؤال بپرس.');
  lines.push('بعد از آن، اول یک طرح کلی کوتاه بده و بعد وارد جزئیات شو.');

  if (top && (top.id === 'code' || top.id === 'web'))
    lines.push('در کد، مدیریت خطا و ورودی‌های مرزی را هم در نظر بگیر و نسخه‌ی زبان/فریم‌ورک را ذکر کن.');
  if (top && (top.id === 'data' || top.id === 'research'))
    lines.push('هر عدد یا ارجاعی که مطمئن نیستی را صراحتاً به‌عنوان «نیازمند راستی‌آزمایی» علامت بزن.');
  if (top && (top.id === 'instagram' || top.id === 'ads'))
    lines.push('سه نسخه‌ی متفاوت بده و بگو هر کدام روی چه انگیزه‌ای از مخاطب دست می‌گذارد.');

  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * Explaining the reading back to the user
 * ------------------------------------------------------------------ */
function explain(read, found) {
  const p = [];

  if (!read.concepts.length) {
    p.push(
      'از توضیحت نتوانستم موضوع دقیق را تشخیص بدهم، ولی یک پرامپت پایه برایت ساختم که با هر موضوعی کار می‌کند. ' +
        'اگر یک جمله دقیق‌تر بنویسی — مثلاً «می‌خوام برای فروشگاه لوستر دست‌سازم کپشن اینستاگرام بنویسم» — نتیجه خیلی بهتر می‌شود.'
    );
    return p;
  }

  const catFa = CAT_FA[read.category] || 'عمومی';
  const conceptNames = read.concepts.map((c) => c.id);
  p.push(
    `خواسته‌ات را این‌طور فهمیدم: کاری در حوزه‌ی **${catFa}**` +
      (read.audience ? ` برای **${read.audience.id}**` : '') +
      (read.tone ? ` با لحن **${read.tone.id}**` : '') +
      (read.format ? ` و خروجی به شکل **${read.format.id}**` : '') +
      '.'
  );

  const missing = [];
  if (!read.audience) missing.push('مخاطب');
  if (!read.tone) missing.push('لحن');
  if (!read.format) missing.push('قالب خروجی');
  if (missing.length) {
    p.push(
      `در پرامپتی که ساختم، جای **${missing.join('**، **')}** را خالی گذاشتم. ` +
        'پر کردن همین‌ها بیشترین تأثیر را روی کیفیت جواب دارد — مدل حدس نمی‌زند، باید بگویی.'
    );
  }

  if (found.length) {
    p.push(
      `${found.length} پرامپت آماده هم در کتابخانه پیدا کردم که به همین کار می‌خورند. ` +
        'اگر یکی‌شان نزدیک بود، آن را بردار؛ پرامپت ساخته‌شده وقتی به کار می‌آید که خواسته‌ات خیلی خاص باشد.'
    );
  } else {
    p.push(
      'پرامپت آماده‌ای که دقیقاً به این کار بخورد پیدا نکردم، پس روی پرامپتی که ساختم حساب کن. ' +
        'می‌توانی از دسته‌بندی‌ها هم موارد نزدیک را ببینی.'
    );
  }

  // one concrete, concept-specific tip
  const tips = {
    instagram: 'برای اینستاگرام، جمله‌ی اول کپشن مهم‌ترین بخش است — از مدل بخواه پنج نسخه از فقط همان جمله بدهد.',
    seo: 'کلمه کلیدی اصلی‌ات را صریح بنویس، وگرنه مدل حدس می‌زند و متن حول کلمه‌ی اشتباه ساخته می‌شود.',
    code: 'قطعه کد واقعی‌ات را هم بچسبان؛ بدون کد، جواب کلی و کم‌فایده می‌شود.',
    resume: 'دستاوردهایت را با عدد بنویس («فروش را ۳۰٪ بالا بردم») — همین بیشترین تفاوت را در رزومه می‌سازد.',
    study: 'سطح فعلی‌ات را بگو («مبتدی هستم») تا توضیح در حد تو باشد نه بالاتر.',
    data: 'نمونه‌ی چند سطر از داده‌ات را بچسبان تا مدل ساختار را ببیند.',
    image: 'سبک، نورپردازی و نسبت ابعاد را جدا بنویس؛ پرامپت تصویری بدون این‌ها تصادفی می‌شود.',
  };
  const tip = read.concepts.map((c) => tips[c.id]).find(Boolean);
  if (tip) p.push('یک نکته: ' + tip);

  return p;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */
function ask(query) {
  const q = String(query || '').trim().slice(0, 400);
  if (q.length < 3) {
    return {
      ok: false,
      error: 'یک جمله بنویس که بگوید می‌خواهی با هوش مصنوعی چه کار کنی.',
    };
  }

  const read = understand(q);
  const found = findPrompts(read);

  return {
    ok: true,
    query: q,
    understood: {
      category: read.category,
      category_name: read.category ? CAT_FA[read.category] : null,
      concepts: read.concepts.map((c) => c.id),
      audience: read.audience ? read.audience.id : null,
      tone: read.tone ? read.tone.id : null,
      format: read.format ? read.format.id : null,
    },
    explanation: explain(read, found),
    generated_prompt: buildPrompt(read),
    matches: found,
  };
}

module.exports = { ask, understand, normalise };
