'use strict';
const crypto = require('crypto');

function sha1(s) {
  return crypto.createHash('sha1').update(String(s)).digest('hex');
}

// normalized hash used for de-duplication across sources
function bodyHash(body) {
  const n = String(body)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[`"'*_#>\-‘’“”]/g, '')
    .trim();
  return sha1(n);
}

function slugify(s) {
  return (
    String(s)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70) || 'prompt'
  );
}

function uid(sourceKey, title, body) {
  return sha1(sourceKey + '|' + slugify(title) + '|' + bodyHash(body)).slice(0, 24);
}

const clean = (s) =>
  String(s || '')
    .replace(/\r\n/g, '\n')
    .replace(/ /g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/* ------------------------------------------------------------------ *
 * Category detection
 * ------------------------------------------------------------------ */
/**
 * Topic keywords per category, in both languages.
 *
 * These were English-only, which quietly sent 38 of the 40 authored Persian
 * prompts into "general" — a Persian Instagram-caption prompt matched nothing
 * and fell through. The Persian terms carry the same weight as the English.
 */
const CATEGORY_RULES = [
  ['coding', ['code', 'coding', 'developer', 'programmer', 'javascript', 'python', 'regex', 'sql', 'api', 'debug', 'refactor', 'unit test', 'git', 'devops', 'docker', 'kubernetes', 'typescript', 'react', 'algorithm', 'stack trace', 'compiler', 'linux terminal', 'console', 'software', 'bug', 'کدنویسی', 'برنامه‌نویس', 'برنامه نویس', 'دیباگ', 'باگ', 'ریفکتور', 'بازبینی کد', 'کد ']],
  ['writing', ['write', 'writer', 'essay', 'article', 'blog', 'story', 'novel', 'poem', 'poet', 'copy', 'editor', 'proofread', 'grammar', 'rewrite', 'paraphrase', 'summar', 'screenwriter', 'script', 'narrative', 'journalist', 'ghostwriter', 'نویسندگی', 'بازنویسی', 'ویرایش', 'مقاله', 'داستان', 'متن ', 'نگارش', 'خلاصه‌سازی', 'ترجمه', 'نامه', 'اسکریپت', 'سناریو', 'منو']],
  ['marketing', ['marketing', 'seo', 'advert', 'campaign', 'brand', 'copywrit', 'landing page', 'email sequence', 'funnel', 'growth', 'social media', 'instagram', 'linkedin', 'tiktok', 'newsletter', 'headline', 'slogan', 'audience', 'conversion', 'مارکتینگ', 'تبلیغ', 'کپشن', 'اینستاگرام', 'سئو', 'برند', 'کمپین', 'هشتگ', 'پیامک تبلیغاتی', 'آگهی', 'تلگرام', 'محتوایی']],
  ['business', ['business', 'startup', 'pitch', 'investor', 'strategy', 'consultant', 'swot', 'okr', 'kpi', 'revenue', 'pricing', 'market research', 'competitor', 'manager', 'product manager', 'roadmap', 'meeting', 'proposal', 'negotiat', 'کسب‌وکار', 'کسب و کار', 'استارتاپ', 'قیمت‌گذاری', 'قرارداد', 'مذاکره', 'رقبا', 'رقیب', 'فروش', 'مشتری', 'جلسه', 'مالیات', 'فاکتور']],
  ['education', ['teach', 'tutor', 'learn', 'study', 'student', 'explain', 'lesson', 'curriculum', 'exam', 'quiz', 'flashcard', 'professor', 'course', 'homework', 'language teacher', 'آموزش', 'تدریس', 'یادگیری', 'درس', 'کنکور', 'دانش‌آموز', 'دانشجو', 'مطالعه', 'آزمون', 'معلم', 'مکالمه', 'زبان انگلیسی']],
  ['career', ['resume', 'cover letter', 'interview', 'job ', 'recruiter', 'career', 'hiring', 'portfolio', 'salary', 'promotion', 'رزومه', 'مصاحبه', 'شغل', 'استخدام', 'کارفرما', 'حقوق', 'فریلنس', 'پروپوزال', 'شبکه‌سازی']],
  ['data', ['data', 'analyst', 'analytic', 'excel', 'spreadsheet', 'statistic', 'dataset', 'chart', 'dashboard', 'pandas', 'csv', 'forecast', 'visuali', 'داده', 'تحلیل', 'اکسل', 'آمار', 'نمودار', 'گزارش فروش', 'نظرسنجی', 'پرسشنامه']],
  ['design', ['design', 'ux', 'logo', 'figma', 'wireframe', 'color palette', 'typography', 'midjourney', 'stable diffusion', 'dall-e', 'image prompt', 'illustration', 'photograph', 'render', '3d', 'طراحی', 'لوگو', 'تصویر', 'عکس', 'میدجرنی', 'گرافیک', 'پرامپت تصویری']],
  ['productivity', ['productiv', 'planner', 'todo', 'schedule', 'habit', 'time management', 'organiz', 'checklist', 'workflow', 'automat', 'note-taking', 'prioriti', 'بهره‌وری', 'برنامه‌ریزی', 'زمان‌بندی', 'چک‌لیست', 'اولویت', 'عادت', 'مدیریت زمان']],
  ['research', ['research', 'academic', 'paper', 'citation', 'literature review', 'thesis', 'scientific', 'hypothesis', 'methodolog', 'peer review', 'abstract', 'پژوهش', 'تحقیق', 'پایان‌نامه', 'پایان نامه', 'مقاله علمی', 'منبع', 'روش تحقیق', 'ژورنال']],
  ['lifestyle', ['health', 'fitness', 'workout', 'diet', 'nutrition', 'recipe', 'chef', 'travel', 'therapist', 'psycholog', 'meditat', 'sleep', 'relationship', 'parent', 'budget', 'سلامت', 'ورزش', 'تغذیه', 'رژیم', 'سفر', 'گردشگری', 'تمرین', 'خواب', 'آشپزی']],
  // NB: deliberately excludes "act as" / "you are a" — nearly every prompt in the
  // corpus opens that way, so they carry no signal about the actual topic.
  ['roleplay', ['pretend', 'roleplay', 'role play', 'in character', 'stay in character', 'dungeon', 'game master', 'text adventure', 'fictional character', 'improv', 'debate opponent', 'talk to me as']],
  ['ai-systems', ['system prompt', 'chain of thought', 'few-shot', 'prompt engineer', 'agent', 'tool use', 'function call', 'rag', 'embedding', 'fine-tun', 'llm', 'guardrail', 'evaluat']],
];

function detectCategory(title, body, tags = []) {
  const hay = (title + ' ' + body + ' ' + tags.join(' ')).toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const [slug, words] of CATEGORY_RULES) {
    let score = 0;
    for (const w of words) if (hay.includes(w)) score += w.length > 6 ? 2 : 1;
    if (score > bestScore) {
      bestScore = score;
      best = slug;
    }
  }
  return bestScore >= 2 ? best : 'general';
}

/* ------------------------------------------------------------------ *
 * Variable / placeholder extraction
 * ------------------------------------------------------------------ */
function extractVariables(body) {
  const found = new Map();
  const patterns = [
    /\{\{\s*([^{}]{1,60}?)\s*\}\}/g,
    /\{\s*([A-Za-z_؀-ۿ][A-Za-z0-9 _\-؀-ۿ]{1,50})\s*\}/g,
    /\[([A-Z؀-ۿ][A-Z0-9 _\-؀-ۿ]{2,50})\]/g,
    /<([A-Za-z][A-Za-z0-9 _\-]{2,50})>/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(body)) !== null) {
      const raw = m[1].trim();
      if (!raw || /^https?:/i.test(raw)) continue;
      if (/^(br|p|div|b|i|em|strong|code|pre|ul|li|h[1-6])$/i.test(raw)) continue;
      const key = raw.toLowerCase();
      if (!found.has(key)) found.set(key, { token: m[0], name: raw });
      if (found.size > 12) break;
    }
  }
  return [...found.values()];
}

function detectDifficulty(body, vars) {
  const len = body.length;
  if (len > 1400 || vars.length >= 4) return 'advanced';
  if (len > 450 || vars.length >= 1) return 'medium';
  return 'easy';
}

function detectLang(s) {
  // A single Arabic-script character is not enough: plenty of English prompts
  // quote one Persian or Arabic word as an example, and treating those as
  // Persian buried the real Persian originals under them.
  const fa = (String(s).match(/[؀-ۿ]/g) || []).length;
  if (fa < 12) return 'en';
  const en = (String(s).match(/[A-Za-z]/g) || []).length;
  return fa / (fa + en || 1) >= 0.25 ? 'fa' : 'en';
}

function guessModels(title, body) {
  const hay = (title + ' ' + body).toLowerCase();
  const out = [];
  if (/midjourney|stable diffusion|dall-?e|--ar |image prompt|photoreal/.test(hay)) out.push('Midjourney', 'DALL·E');
  if (/code|refactor|debug|typescript|python|sql/.test(hay)) out.push('Claude Opus', 'GPT-5');
  if (/long|document|report|research|analy/.test(hay)) out.push('Claude Opus');
  if (!out.length) out.push('Claude', 'ChatGPT', 'Gemini');
  return [...new Set(out)].slice(0, 4);
}

/* ------------------------------------------------------------------ *
 * Persian auto-documentation (what the normal user sees)
 * ------------------------------------------------------------------ */
const CAT_FA = {
  coding: 'برنامه‌نویسی و توسعه نرم‌افزار',
  writing: 'نویسندگی و تولید محتوا',
  marketing: 'مارکتینگ و فروش',
  business: 'کسب‌وکار و مدیریت',
  education: 'آموزش و یادگیری',
  career: 'شغل و رزومه',
  data: 'داده و تحلیل',
  design: 'طراحی و هنر',
  productivity: 'بهره‌وری شخصی',
  research: 'پژوهش و مقاله',
  lifestyle: 'سبک زندگی و سلامت',
  roleplay: 'نقش‌آفرینی و شبیه‌سازی',
  'ai-systems': 'مهندسی پرامپت و سیستم‌های AI',
  general: 'عمومی',
};

const CAT_GOAL = {
  coding: 'کدنویسی، بازبینی و رفع اشکال سریع‌تر',
  writing: 'نوشتن متن‌های روان و ساختارمند',
  marketing: 'ساخت پیام تبلیغاتی که واقعاً فروش می‌آورد',
  business: 'تصمیم‌گیری و برنامه‌ریزی حرفه‌ای',
  education: 'یاد گرفتن یا یاد دادن یک موضوع به شکل گام‌به‌گام',
  career: 'قوی‌تر دیده شدن در فرایند استخدام',
  data: 'فهمیدن داده‌ها و بیرون کشیدن نتیجه از آن‌ها',
  design: 'ساخت خروجی بصری دقیق و قابل کنترل',
  productivity: 'منظم کردن کارها و صرفه‌جویی در زمان',
  research: 'کار پژوهشی دقیق و قابل استناد',
  lifestyle: 'برنامه‌ریزی شخصی و سلامت روزمره',
  roleplay: 'گرفتن جواب از زاویه دید یک متخصص',
  'ai-systems': 'ساخت و تنظیم رفتار مدل‌های هوش مصنوعی',
  general: 'گرفتن جواب بهتر و دقیق‌تر از هوش مصنوعی',
};

/**
 * What the prompt asks the model to hand back. Ordered most-specific first, so
 * a prompt that wants a table is described as wanting a table rather than the
 * generic "list" its bullets would also match.
 */
const OUTPUT_KINDS = [
  [/\|\s*-{3,}\s*\||\bmarkdown table\b|\bin a table\b|\btable format\b|جدول/i, 'یک جدول'],
  [/\bjson\b|\byaml\b|\bvalid schema\b|\bstructured output\b/i, 'خروجی ساختاریافته (JSON)'],
  [
    /```|\bsource code\b|\bwrite (?:a |the )?(?:function|script|program|class)\b|\brefactor\b|\bthe following code\b|\bunit tests?\b|\bdebug\b|بازبینی کد|کدنویسی/i,
    'کد',
  ],
  [
    /\bmidjourney\b|\bstable diffusion\b|\bdall-?e\b|--ar \d|\bphotograph(?:ed|y)?\b|\bcinematic shot\b|پرامپت تصویری/i,
    'پرامپت تصویری',
  ],
  [/\bsubject line\b|\bcold email\b|\bwrite an email\b|ایمیل کاری|متن ایمیل/i, 'ایمیل'],
  [/کپشن/i, 'کپشن'],
  [/\bchecklist\b|چک‌لیست/i, 'یک چک‌لیست'],
  [
    /\b(?:study|content|project|marketing|lesson|meal|workout)?\s?(?:plan|roadmap|schedule|calendar)\b|برنامه(?:‌| )?(?:هفتگی|ماهانه|محتوایی|مطالعه|تمرین|سفر)/i,
    'یک برنامه',
  ],
  [/\breport\b|\bdetailed analysis\b|\baudit\b|گزارش/i, 'یک گزارش تحلیلی'],
  [/\btranslate\b|\btranslation\b|ترجمه/i, 'ترجمه'],
  [/\b(?:quiz|flashcards?|practice questions?|exam questions?)\b|آزمون|فلش‌کارت/i, 'مجموعه سؤال و تمرین'],
  [/\bsummar(?:y|ise|ize)\b|\btl;?dr\b|\bone[- ]sentence\b|خلاصه/i, 'یک خلاصه'],
  [/\boutline\b|\bstructure for\b|طرح کلی/i, 'یک طرح کلی'],
  [/\b(?:blog post|article|essay|newsletter)\b|مقاله/i, 'یک متن بلند'],
  [/\bstep[- ]by[- ]step\b|\bnumbered (?:list|steps)\b|گام‌به‌گام|قدم به قدم/i, 'راهنمای گام‌به‌گام'],
  [/\bbullet points?\b|\ba list of\b|فهرست/i, 'یک فهرست'],
];

/** Named tools worth calling out — they tell the reader where the prompt is used. */
const TOOLS = [
  [/\bmidjourney\b/i, 'میدجرنی'],
  [/\bexcel\b|\bspreadsheet\b|\bgoogle sheets\b/i, 'اکسل'],
  [/\bsql\b|\bpostgres\b|\bmysql\b/i, 'SQL'],
  [/\bpython\b/i, 'پایتون'],
  [/\bjavascript\b|\btypescript\b|\breact\b/i, 'جاوااسکریپت'],
  [/\bnotion\b/i, 'نوشن'],
  [/\blinkedin\b/i, 'لینکدین'],
  [/\binstagram\b/i, 'اینستاگرام'],
  [/\bwordpress\b|\bseo\b/i, 'سئو و وردپرس'],
];

/**
 * A description built from what this particular prompt actually contains.
 *
 * The previous version had exactly two sentence shapes crossed with fourteen
 * category goals, so the whole corpus shared fifteen openings and every card
 * on the site read the same. Variety here comes from the body: the format it
 * asks for, whether it interviews you first, how many rules it imposes, how
 * long the answer should be. Two prompts differ in their summaries because
 * they differ, not because a random frame was picked.
 */
function buildSummary(title, body, catSlug) {
  const goal = CAT_GOAL[catSlug] || CAT_GOAL.general;
  const raw = String(body || '');

  const role = (() => {
    // Persian prompts open "تو یک ... هستی", which the English pattern never
    // matched — so every authored Persian prompt looked role-less.
    // Two Persian shapes: "تو یک X هستی" and the relative form
    // "تو یک X‌ای که …", which the first pattern walks straight past.
    const fa =
      raw.match(/(?:تو|شما)\s+(?:یک|یه)\s+([^.،\n؛:!?]{3,60}?)\s+(?:هستی|هستید|باش)/) ||
      raw.match(/(?:تو|شما)\s+(?:یک|یه)\s+([^.،\n؛:!?]{3,60}?)(?:‌ای|ای)?\s+که\s/);
    if (fa) {
      const r = fa[1].replace(/["'`«»]/g, '').replace(/(?:‌ای|ای)$/, '').trim();
      if (r.length >= 3) return r.length >= 55 ? r.slice(0, 55).replace(/\s+\S*$/, '').trim() : r;
    }
    const m = raw.match(
      /(?:i want you to act as|i want you to be|you will act as|act as|you are|you're|pretend to be)\s+(?:an?|the)?\s*([^.,\n;:!?]{3,60})/i
    );
    if (!m) return null;
    let r = m[1].replace(/["'`]/g, '').trim();
    // "You are to act as my prompt engineer" captures the whole tail; strip the
    // second lead-in and any possessive so the role is just the noun phrase.
    r = r.replace(/^(?:to\s+)?(?:act\s+as|be)\s+/i, '').replace(/^(?:an?|the|my|your)\s+/i, '').trim();
    if (r.length >= 55) r = r.slice(0, 55).replace(/\s+\S*$/, '').trim();
    // Adverbs and filler slip through the pattern ("you are totally …"); a real
    // role has a noun in it, not a single -ly word.
    if (!r || r.length < 4 || /^\w+ly$/i.test(r) || /^(?:going|about|not|very|really|totally|here|now)\b/i.test(r)) {
      return null;
    }
    return r;
  })();

  const format = (OUTPUT_KINDS.find(([re]) => re.test(raw)) || [])[1] || null;
  const asksFirst =
    /\bask (?:me )?(?:a series of |several |some |\d+ )?questions?\b|\bbefore (?:you |we )?(?:begin|start|proceed)\b|\bone question at a time\b/i.test(
      raw
    ) || /(?:اول|ابتدا|قبل از شروع)[^.\n]{0,30}(?:سؤال|سوال)|یک سؤال بپرس|سؤال بپرس/.test(raw);
  // Persian prompts number their steps with Persian digits, which \d misses.
  const steps =
    (raw.match(/^\s*\d+[.)]\s/gm) || []).length + (raw.match(/^\s*[۰-۹]+[.)]\s/gm) || []).length;
  const rules =
    (raw.match(/\b(?:do not|don't|never|avoid|must not|refrain from)\b/gi) || []).length +
    (raw.match(/(?:نکن|نباید|هرگز|پرهیز کن|خودداری کن)/g) || []).length;
  const lengthSpec =
    raw.match(/\b(\d{2,4})\s*(words|characters|paragraphs)\b/i) ||
    (() => {
      const m = raw.match(/([۰-۹\d]{2,4})\s*(کلمه|کاراکتر|پاراگراف)/);
      if (!m) return null;
      const n = m[1].replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
      return [m[0], n, m[2]];
    })();
  const sections = (raw.match(/^#{1,3}\s+\S/gm) || []).length;
  // Placeholders come in several house styles: {{name}}, [FIELD], and plain
  // [details]. The markdown-link case ("[text](url)") is excluded so prose
  // links are not counted as fields to fill in.
  const vars = (raw.match(/\{\{[^}]{1,60}\}\}|\[[A-Za-z][^\]\n]{1,40}\](?!\()/g) || []).length;
  const tool = (TOOLS.find(([re]) => re.test(raw)) || [])[1] || null;

  // Build a few concrete clauses, then keep the two or three that exist. The
  // mix of which clauses fire is what makes one summary differ from the next.
  const facts = [];
  if (asksFirst) facts.push('اول چند سؤال از تو می‌پرسد و بعد شروع می‌کند');
  if (format) facts.push(`خروجی را به شکل ${format} می‌دهد`);
  if (steps >= 3) facts.push(`کار را در ${toFa(steps)} قدم شماره‌گذاری‌شده پیش می‌برد`);
  else if (sections >= 3) facts.push(`جواب را در ${toFa(sections)} بخش جدا سازمان می‌دهد`);
  if (lengthSpec) {
    const u = lengthSpec[2];
    const unit = /word|کلمه/i.test(u) ? 'کلمه' : /character|کاراکتر/i.test(u) ? 'کاراکتر' : 'پاراگراف';
    facts.push(`طول خروجی را حدود ${toFa(Number(lengthSpec[1]))} ${unit} تعیین می‌کند`);
  }
  if (rules >= 4) facts.push(`${toFa(rules)} قید و «نباید» دارد تا جواب از مسیر خارج نشود`);
  if (vars >= 2) facts.push(`${toFa(vars)} جای‌خالی دارد که با اطلاعات خودت پر می‌شود`);
  if (tool) facts.push(`مخصوص کار با ${tool} است`);

  const head = role
    ? `مدل را در نقش «${role}» می‌نشاند`
    : `برای ${goal} نوشته شده`;

  if (!facts.length && role) {
    // A short role-only prompt ("I want you to act as an astrologer.") has
    // nothing structural to report, and quoting its one English line adds
    // nothing a Persian reader can use.
    return `مدل را در نقش «${role}» می‌نشاند و برای ${goal} به کار می‌آید.`;
  }

  if (!facts.length) {
    // Nothing structural and no role — fall back to the opening instruction,
    // which at least differs per prompt.
    const first = clean(raw)
      .split('\n')
      .map((l) => l.replace(/^[#>*\-\s]+/, '').trim())
      .find((l) => l.length > 25 && l.replace(/[^\p{L}\p{N}]/gu, '').length / l.length > 0.55) || clean(raw);
    let s = first.split(/(?<=[.!?؟])\s/)[0] || first;
    if (s.length > 150) s = s.slice(0, 147).replace(/\s+\S*$/, '') + '…';
    return `${head} و کارش این است: «${s}»`;
  }

  const picked = facts.slice(0, 2);
  const tail = picked.length === 2 ? `${picked[0]}، و ${picked[1]}` : picked[0];
  return clip220(`${head}، ${tail}.`);
}

/** Persian digits, so numbers inside a Persian sentence don't read as foreign. */
function toFa(n) {
  return String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}
const clip220 = (s) => (s.length <= 220 ? s : s.slice(0, 217).replace(/\s+\S*$/, '') + '…');

function buildHowTo({ title, body, catSlug, vars, difficulty }) {
  const steps = [];
  steps.push(
    '**۱) کپی کن.** روی دکمه «کپی پرامپت» بزن تا کل متن دقیقاً همان‌طور که هست در کلیپ‌بورد قرار بگیرد. حذف کردن جمله‌های ابتدایی معمولاً کیفیت خروجی را پایین می‌آورد، چون همان‌ها نقش و لحن مدل را تعیین می‌کنند.'
  );
  steps.push(
    '**۲) در یک گفتگوی تازه بچسبان.** این پرامپت را به عنوان *اولین* پیام یک چت جدید بفرست. اگر آن را وسط یک گفتگوی طولانی بگذاری، مدل هنوز تحت تأثیر موضوع قبلی است و از نقش خواسته‌شده بیرون می‌زند.'
  );

  if (vars.length) {
    const list = vars.map((v) => '`' + v.token + '`').join('، ');
    steps.push(
      `**۳) جای‌خالی‌ها را پر کن.** در این متن ${vars.length} جای‌خالی وجود دارد: ${list}. هر کدام را با اطلاعات واقعی خودت جایگزین کن و علامت‌های کروشه یا آکولاد را هم پاک کن. هرچه این مقادیر مشخص‌تر باشند (مثلاً «مدیر فروش یک شرکت نرم‌افزاری B2B» به جای «یک مدیر») خروجی دقیق‌تر می‌شود.`
    );
  } else {
    steps.push(
      '**۳) بلافاصله بعد از آن، موضوع خودت را بنویس.** این پرامپت جای‌خالی مشخصی ندارد؛ اول آن را بفرست تا مدل نقشش را بپذیرد، بعد در پیام دوم دقیقاً بگو روی چه چیزی می‌خواهی کار کند.'
    );
  }

  steps.push(
    '**۴) به مدل زمینه بده.** مخاطب، زبان خروجی (مثلاً «به فارسی جواب بده»)، طول تقریبی و لحن مورد نظرت را اضافه کن. بیشتر جواب‌های ضعیف نتیجه نبودِ همین سه خط اضافه‌اند، نه ضعف خودِ پرامپت.'
  );
  steps.push(
    '**۵) یک بار اصلاح کن.** جواب اول را نهایی فرض نکن. بنویس «این بخش را کوتاه‌تر کن»، «مثال واقعی اضافه کن» یا «سه نسخه متفاوت بده». دور دوم تقریباً همیشه بهتر از دور اول است.'
  );

  if (catSlug === 'coding')
    steps.push('**۶) کد را قبل از اجرا بخوان.** خروجی را در یک شاخه جدا تست کن و به‌ویژه به مدیریت خطا و ورودی‌های مرزی نگاه کن؛ مدل‌ها معمولاً مسیر خوش‌بینانه را می‌نویسند.');
  if (catSlug === 'design')
    steps.push('**۶) پارامترها را تنظیم کن.** نسبت ابعاد، سبک و میزان جزئیات را متناسب با ابزار تصویری‌ای که استفاده می‌کنی تغییر بده؛ همان پرامپت در ابزارهای مختلف خروجی متفاوتی می‌دهد.');
  if (catSlug === 'research' || catSlug === 'data')
    steps.push('**۶) اعداد و منابع را راستی‌آزمایی کن.** مدل ممکن است ارجاع یا آمار بسازد. هر عددی که قرار است جایی استفاده شود را از منبع اصلی چک کن.');

  const level = difficulty === 'easy' ? 'ساده' : difficulty === 'medium' ? 'متوسط' : 'پیشرفته';
  const intro = `این یک پرامپت در سطح «${level}» از دسته ${CAT_FA[catSlug] || CAT_FA.general} است. برای اینکه بهترین نتیجه را بگیری، این مسیر را دنبال کن:`;
  return intro + '\n\n' + steps.join('\n\n');
}

function buildTips(catSlug, vars, difficulty) {
  const tips = [
    'اگر خروجی کلی و بی‌روح بود، یک نمونه از «خروجی خوب از نظر خودت» به مدل نشان بده؛ یک نمونه بیشتر از ده خط توضیح اثر دارد.',
    'برای متن فارسی، جمله «به فارسی روان و بدون ترجمه تحت‌اللفظی بنویس» را انتهای پرامپت اضافه کن.',
  ];
  if (vars.length) tips.push('جای‌خالی‌ها را خالی نگذار؛ اگر مقداری را نمی‌دانی، به جای حذفش بنویس «فرض کن ...» تا مدل سرخود چیزی از خودش نسازد.');
  if (difficulty === 'advanced') tips.push('این پرامپت طولانی است؛ روی مدل‌های قوی‌تر (مثل Claude Opus یا GPT-5) نتیجه محسوساً بهتری می‌دهد.');
  if (catSlug === 'coding') tips.push('نسخه زبان و فریم‌ورک را صریح بنویس (مثلاً «Node.js 24 و TypeScript 5») تا کد قدیمی تحویل نگیری.');
  if (catSlug === 'marketing') tips.push('مخاطب هدف را با جزئیات بنویس؛ «زن ۳۰ تا ۴۰ ساله علاقه‌مند به دکور دست‌ساز» خیلی بهتر از «مشتری عادی» جواب می‌دهد.');
  if (catSlug === 'roleplay') tips.push('اگر مدل از نقش بیرون زد، فقط بنویس «به نقش برگرد» — لازم نیست کل پرامپت را دوباره بفرستی.');
  if (catSlug === 'education') tips.push('سطح خودت را اعلام کن («من مبتدی هستم») تا توضیح متناسب با تو باشد.');
  return tips.slice(0, 5);
}

function exampleFor(name, catSlug) {
  const n = name.toLowerCase();
  if (/topic|subject|موضوع/.test(n)) return 'لوستر دست‌ساز مکرومه';
  if (/audience|target|مخاطب/.test(n)) return 'زنان ۲۵ تا ۴۵ ساله علاقه‌مند به دکوراسیون';
  if (/lang|زبان/.test(n)) return 'فارسی';
  if (/tone|لحن|style/.test(n)) return 'صمیمی و حرفه‌ای';
  if (/name|نام/.test(n)) return 'بوبی‌آرت';
  if (/product|محصول/.test(n)) return 'لوستر رافیا دست‌باف';
  if (/company|business|شرکت/.test(n)) return 'یک فروشگاه اینترنتی صنایع دستی';
  if (/code|function|snippet/.test(n)) return 'قطعه کد خودت را اینجا بچسبان';
  if (/role|job|شغل/.test(n)) return 'توسعه‌دهنده فرانت‌اند';
  if (/number|count|length|تعداد/.test(n)) return '۵';
  if (/goal|هدف/.test(n)) return 'افزایش فروش در سه ماه آینده';
  return catSlug === 'coding' ? 'TypeScript' : 'مقدار واقعی خودت را بنویس';
}

function buildExample(title, catSlug, vars) {
  if (vars.length) {
    return (
      'بعد از فرستادن پرامپت، جای‌خالی‌ها را این‌طور پر کن:\n\n' +
      vars.map((v) => `• ${v.token} ← «${exampleFor(v.name, catSlug)}»`).join('\n') +
      '\n\nسپس بنویس: «حالا با همین اطلاعات شروع کن و اول یک طرح کلی بده، بعد وارد جزئیات شو.»'
    );
  }
  const ex = {
    coding: 'این تابع که کندی دارد را برایت می‌فرستم؛ گلوگاه را پیدا کن و نسخه بهینه را با توضیح تغییرات بده.',
    writing: 'یک مقاله ۸۰۰ کلمه‌ای درباره «چرا لوستر دست‌ساز به فضای خانه شخصیت می‌دهد» با لحن صمیمی بنویس.',
    marketing: 'برای یک فروشگاه اینترنتی لوستر دست‌ساز، سه متن تبلیغاتی اینستاگرام بنویس که روی حس خانه گرم تمرکز دارد.',
    business: 'یک برنامه ۹۰ روزه برای راه‌اندازی فروش عمده محصولات دست‌ساز بده، با شاخص‌های قابل اندازه‌گیری.',
    education: 'مفهوم «شبکه عصبی» را طوری توضیح بده که یک دانش‌آموز دبیرستانی کاملاً بفهمد، با یک مثال روزمره.',
    career: 'رزومه‌ام را برای موقعیت «توسعه‌دهنده فرانت‌اند» بازنویسی کن و دستاوردها را عددی کن.',
    data: 'این جدول فروش ماهانه را تحلیل کن، سه روند مهم را بگو و بگو کدام‌ها معنادار نیستند.',
    design: 'یک صحنه داخلی مینیمال با نور طبیعی و یک لوستر مکرومه، عکاسی معماری، نور طلایی عصر.',
    productivity: 'برنامه هفتگی من با ۵ پروژه موازی را بازچینی کن و بگو کدام را باید حذف کنم.',
    research: 'برای موضوع «تأثیر نور طبیعی بر بهره‌وری» یک ساختار مقاله با فرضیه و روش پیشنهاد بده.',
    lifestyle: 'یک برنامه غذایی هفتگی ساده برای کسی که وقت آشپزی کم دارد بنویس.',
    roleplay: 'حالا در نقش همان متخصص، به این وضعیت من نگاه کن و بگو اولین کاری که باید بکنم چیست.',
    'ai-systems': 'این پرامپت سیستمی را برای یک ربات پشتیبانی فارسی بازنویسی کن و محدودیت‌های ایمنی را اضافه کن.',
    general: 'موضوع من این است: ... . با همین نقشی که گرفتی، شروع کن.',
  };
  return 'پرامپت را بفرست، بعد در پیام بعدی چیزی شبیه این بنویس:\n\n«' + (ex[catSlug] || ex.general) + '»';
}

function buildExpected(catSlug) {
  const m = {
    coding: 'یک پاسخ ساختارمند شامل تشخیص مشکل، کد اصلاح‌شده، و توضیح خط‌به‌خط تغییرات.',
    writing: 'متنی با تیتر، مقدمه، بدنه بخش‌بندی‌شده و جمع‌بندی، آماده ویرایش نهایی.',
    marketing: 'چند نسخه متفاوت از پیام تبلیغاتی، به همراه دلیل انتخاب هر زاویه.',
    business: 'یک خروجی تصمیم‌محور: گزینه‌ها، ریسک‌ها و پیشنهاد نهایی با دلیل.',
    education: 'توضیح گام‌به‌گام از ساده به پیچیده، با مثال و چند سؤال تمرینی.',
    career: 'نسخه بازنویسی‌شده به همراه فهرست تغییرات و دلیل هرکدام.',
    data: 'خلاصه یافته‌ها، جدول یا فهرست شاخص‌ها، و هشدار درباره محدودیت داده‌ها.',
    design: 'توصیف بصری دقیق آماده استفاده در ابزار تصویرساز، با پارامترهای پیشنهادی.',
    productivity: 'یک برنامه عملی زمان‌بندی‌شده با اولویت مشخص برای هر مورد.',
    research: 'ساختار علمی با فرضیه، روش، و نکات قابل استناد (که باید راستی‌آزمایی شوند).',
    lifestyle: 'برنامه شخصی‌سازی‌شده عملی، همراه با نکات اجرایی روزمره.',
    roleplay: 'پاسخی از زبان یک متخصص، با لحن و دایره واژگان همان حرفه.',
    'ai-systems': 'یک پرامپت یا پیکربندی آماده استفاده، به همراه توضیح منطق پشت هر بخش.',
    general: 'پاسخی منظم، مرحله‌بندی‌شده و قابل استفاده مستقیم.',
  };
  return m[catSlug] || m.general;
}

function qualityScore({ title, body, vars, sourceTrust }) {
  let q = 40;
  const len = body.length;
  if (len > 180) q += 10;
  if (len > 450) q += 10;
  if (len > 900) q += 5;
  if (len > 4000) q -= 10;
  if (vars.length) q += 8;
  if (/\n\s*[-*\d]/.test(body)) q += 6; // structured list
  if (/step|مرحله|first|then/i.test(body)) q += 4;
  if (title.length > 8 && title.length < 90) q += 5;
  q += Math.round((sourceTrust - 60) / 5);
  return Math.max(5, Math.min(99, q));
}

function enrich(raw, sourceTrust = 70) {
  const title = clean(raw.title).slice(0, 160);
  const body = clean(raw.body);
  const tags = (raw.tags || []).map((t) => String(t).trim()).filter(Boolean).slice(0, 8);
  const catSlug = raw.category || detectCategory(title, body, tags);
  const vars = extractVariables(body);
  const difficulty = detectDifficulty(body, vars);
  return {
    title,
    body,
    slug: slugify(title),
    tags,
    categorySlug: catSlug,
    variables: vars,
    difficulty,
    lang: detectLang(title + body),
    summary: buildSummary(title, body, catSlug),
    how_to: buildHowTo({ title, body, catSlug, vars, difficulty }),
    tips: buildTips(catSlug, vars, difficulty),
    example_use: buildExample(title, catSlug, vars),
    expected_out: buildExpected(catSlug),
    best_models: guessModels(title, body),
    quality: qualityScore({ title, body, vars, sourceTrust }),
  };
}

module.exports = { sha1, bodyHash, slugify, uid, clean, enrich, detectCategory, extractVariables, CAT_FA };
