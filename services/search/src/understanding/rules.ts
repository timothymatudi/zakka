// Rule-based query understanding (mock mode, and the fallback when the AI call
// fails). Handles price caps with currencies, "fast"/"within N days" phrases,
// filler words and category hints across the phase-1 locales.
import type { QueryUnderstanding } from '../types';
import { currencyForCountry } from '../money';
import { normalize } from '../text';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alt = (xs: string[]) => [...xs].sort((a, b) => b.length - a.length).map(escapeRe).join('|');

/** Currency tokens (lowercase) -> ISO code. 'LOCAL' means the shopper's country currency. */
const CURRENCY: Record<string, string> = {
  usd: 'USD', 'us$': 'USD', $: 'USD', dollar: 'USD', dollars: 'USD', dola: 'USD', dólares: 'USD', dolares: 'USD', 'دولار': 'USD', '美元': 'USD', डॉलर: 'USD',
  eur: 'EUR', '€': 'EUR', euro: 'EUR', euros: 'EUR',
  gbp: 'GBP', '£': 'GBP', pounds: 'GBP',
  kes: 'KES', ksh: 'KES', kshs: 'KES', 'ksh.': 'KES', bob: 'KES',
  tzs: 'TZS', tsh: 'TZS', ugx: 'UGX', ush: 'UGX', rwf: 'RWF',
  shilingi: 'LOCAL', shillings: 'LOCAL', sh: 'LOCAL',
  ngn: 'NGN', '₦': 'NGN', naira: 'NGN',
  ghs: 'GHS', cedi: 'GHS', cedis: 'GHS', zar: 'ZAR', rand: 'ZAR',
  egp: 'EGP', 'جنيه': 'EGP', mad: 'MAD',
  aed: 'AED', dirham: 'AED', dirhams: 'AED', 'درهم': 'AED',
  sar: 'SAR', riyal: 'SAR', riyals: 'SAR', 'ريال': 'SAR',
  inr: 'INR', '₹': 'INR', rs: 'INR', 'rs.': 'INR', rupees: 'INR', 'रुपये': 'INR', 'रुपए': 'INR', 'रु': 'INR',
  idr: 'IDR', rp: 'IDR', 'rp.': 'IDR', rupiah: 'IDR',
  cny: 'CNY', rmb: 'CNY', '¥': 'CNY', '元': 'CNY', '块': 'CNY', '人民币': 'CNY',
  brl: 'BRL', 'r$': 'BRL', reais: 'BRL', mxn: 'MXN', pesos: 'MXN',
};

/** Phrases that put a cap on price when they precede the amount. */
const UNDER_BEFORE = [
  'under', 'below', 'less than', 'cheaper than', 'max', 'maximum', 'up to', 'upto', 'no more than', 'budget', 'within',
  'chini ya', 'isiyozidi', 'isizidi', 'si zaidi ya', 'hadi',
  'menos de', 'por menos de', 'hasta', 'máximo', 'maximo',
  'abaixo de', 'até', 'ate', 'no máximo',
  'moins de', "jusqu'à", 'jusqu’à', 'pas plus de',
  'unter', 'bis', 'weniger als', 'höchstens', 'maximal',
  'di bawah', 'dibawah', 'kurang dari', 'maksimal', 'maks',
  'أقل من', 'اقل من', 'تحت', 'بأقل من', 'حتى', 'لا يزيد عن',
  '低于', '不超过', '少于', '最多',
  'से कम', 'तक',
];
/** Phrases that cap price when they follow the amount. */
const UNDER_AFTER = ['or less', 'or below', 'max', 'au chini', 'na chini', 'o menos', 'ou moins', 'ou menos', 'oder weniger', 'atau kurang', 'أو أقل', '以下', '以内', '之内', '或更少', 'से कम', 'तक', 'के अंदर'];

const DAY_WORDS = ['days', 'day', 'siku', 'días', 'dias', 'día', 'dia', 'jours', 'jour', 'tagen', 'tage', 'tag', 'hari', 'أيام', 'ايام', 'يوم', 'يومين', '天内', '天以内', '日内', '天', 'दिन', 'दिनों'];
const NEXT_DAY = ['tomorrow', 'next day', 'next-day', 'overnight', 'kesho', 'mañana', 'manana', 'demain', 'morgen', 'amanhã', 'amanha', 'besok', 'غدا', 'غداً', '明天', '次日', 'कल'];
const FAST = ['fast', 'quick', 'quickly', 'express', 'asap', 'urgent', 'fast delivery', 'fast shipping', 'haraka', 'upesi', 'rápido', 'rapido', 'rápida', 'rapida', 'rapide', 'vite', 'schnell', 'cepat', 'kilat', 'سريع', 'سريعة', 'بسرعة', '快速', '快递', '快', '加急', 'जल्दी', 'तेज़'];
export const FAST_DAYS = 5;

/** Filler words removed from keywords (compared after normalize()). */
const STOPWORDS = new Set(
  [
    // en
    'a', 'an', 'the', 'for', 'with', 'and', 'or', 'of', 'to', 'in', 'on', 'me', 'my', 'i', 'im', 'want', 'need', 'looking', 'show', 'find', 'get', 'buy', 'please', 'some', 'that', 'is', 'are', 'good', 'best', 'cheap', 'cheapest', 'affordable', 'budget', 'nice', 'great', 'top', 'delivery', 'shipping', 'deliver', 'ship', 'price', 'less', 'than', 'under', 'below', 'within', 'en', 'dans', 'em', 'dalam', 'delivered', 'arrive', 'arrives', 'arriving',
    // sw
    'nataka', 'nahitaji', 'natafuta', 'nipe', 'nitafutie', 'tafadhali', 'nzuri', 'bora', 'ya', 'za', 'wa', 'la', 'kwa', 'na', 'chini', 'bei', 'nafuu', 'rahisi', 'ndani', 'kali', 'safi',
    // es / pt
    'quiero', 'busco', 'necesito', 'un', 'una', 'unos', 'unas', 'para', 'de', 'del', 'con', 'el', 'la', 'los', 'las', 'barato', 'barata', 'baratos', 'baratas', 'bueno', 'buena', 'menos', 'envio', 'quero', 'preciso', 'um', 'uma', 'com', 'do', 'da', 'bom', 'boa',
    // fr
    'je', 'veux', 'cherche', 'pas', 'cher', 'chere', 'pour', 'avec', 'des', 'le', 'les', 'une', 'du', 'bon', 'bonne', 'moins', 'livraison',
    // de
    'ich', 'suche', 'brauche', 'gunstig', 'gunstige', 'billig', 'billige', 'fur', 'mit', 'ein', 'eine', 'einen', 'der', 'die', 'das', 'gute', 'guter', 'lieferung',
    // id
    'saya', 'mau', 'ingin', 'cari', 'murah', 'untuk', 'dengan', 'yang', 'di', 'bawah', 'bagus', 'pengiriman',
    // ar (normalized forms)
    'اريد', 'ابحث', 'عن', 'رخيص', 'رخيصه', 'ل', 'مع', 'من', 'في', 'جيد', 'جيده', 'افضل', 'توصيل',
    // hi
    'मुझे', 'चाहिए', 'सस्ता', 'सस्ते', 'सस्ती', 'के', 'लिए', 'का', 'की', 'को', 'में', 'अच्छा', 'अच्छी', 'कम', 'से',
  ].map(normalize),
);

/** Chinese has no spaces: these substrings are removed from the query text. */
const ZH_FILLERS = ['我想要', '我要', '我想买', '帮我找', '请', '买', '便宜的', '便宜', '好的', '最好的', '的', '一个', '一款', '发货', '送达', '配送'];

/** Category hints: word -> category slug, with a priority (product nouns beat activity words). */
const CATEGORY_WORDS: [string[], string, number][] = [
  [['phone', 'phones', 'smartphone', 'smartphones', 'mobile', 'simu', 'teléfono', 'telefono', 'celular', 'móvil', 'movil', 'téléphone', 'telephone', 'handy', 'ponsel', 'هاتف', 'جوال', 'موبايل', '手机', 'फोन', 'फ़ोन', 'मोबाइल'], 'phones', 3],
  [['earbuds', 'earphones', 'headphones', 'headset', 'earbud', 'airpods', 'auriculares', 'audífonos', 'audifonos', 'écouteurs', 'ecouteurs', 'casque', 'kopfhörer', 'kopfhorer', 'ohrhörer', 'fones', 'earphone', 'headphone', 'سماعات', 'سماعة', '耳机', 'ईयरबड्स', 'हेडफ़ोन', 'हेडफोन', 'vipokea'], 'headphones', 3],
  [['speaker', 'speakers', 'spika', 'altavoz', 'altavoces', 'enceinte', 'lautsprecher', 'مكبر', '音箱', 'स्पीकर'], 'speakers', 3],
  [['laptop', 'laptops', 'notebook', 'kompyuta', 'portátil', 'computadora', 'ordinateur', 'computer', 'لابتوب', '笔记本', '电脑', 'लैपटॉप', 'keyboard', 'mouse'], 'computers', 3],
  [['smartwatch', 'watch', 'tracker', 'band', 'saa', 'reloj', 'montre', 'uhr', 'relógio', 'jam', 'ساعة', '手表', '手环', 'घड़ी'], 'wearables', 2],
  [['charger', 'cable', 'powerbank', 'power bank', 'case', 'chaja', 'cargador', 'chargeur', 'ladegerät', 'carregador', 'شاحن', '充电器', 'चार्जर'], 'accessories', 2],
  [['blender', 'kettle', 'fryer', 'cooker', 'pan', 'pot', 'blenda', 'birika', 'licuadora', 'mixeur', 'mixer', 'liquidificador', 'خلاط', 'قلاية', '搅拌机', 'कुकर', 'kitchen', 'jikoni'], 'kitchen', 2],
  [['dress', 'shirt', 'tshirt', 't-shirt', 'jacket', 'nguo', 'shati', 'fulana', 'vestido', 'camisa', 'camiseta', 'robe', 'chemise', 'kleid', 'hemd', 'baju', 'kaos', 'فستان', 'قميص', '连衣裙', '衬衫', 'ड्रेस', 'शर्ट'], 'clothing', 2],
  [['shoes', 'sneakers', 'trainers', 'boots', 'viatu', 'raba', 'zapatos', 'zapatillas', 'chaussures', 'baskets', 'schuhe', 'sapatos', 'tênis', 'sepatu', 'حذاء', 'أحذية', '鞋', '运动鞋', 'जूते'], 'shoes', 3],
  [['bag', 'backpack', 'tote', 'begi', 'mkoba', 'mochila', 'bolso', 'sac', 'tasche', 'rucksack', 'tas', 'حقيبة', '包', '背包', 'बैग'], 'bags', 2],
  [['serum', 'moisturizer', 'cream', 'lotion', 'skincare', 'losheni', 'krimu', 'crema', 'crème', 'creme', 'كريم', '精华', '面霜', 'लोशन'], 'skincare', 2],
  [['yoga', 'dumbbell', 'dumbbells', 'gym', 'mazoezi', 'fitness', 'pesas', 'haltères', 'hanteln', 'يوغا', '瑜伽', '哑铃', 'योग'], 'fitness', 1],
  [['tent', 'camping', 'lantern', 'bottle', 'hema', 'tienda de campaña', 'tente', 'zelt', 'خيمة', '帐篷', '水杯'], 'outdoor', 1],
  [['toy', 'toys', 'lego', 'vinyago', 'juguete', 'juguetes', 'jouet', 'jouets', 'spielzeug', 'brinquedo', 'mainan', 'لعبة', 'ألعاب', '玩具', 'खिलौना', 'खिलौने'], 'toys', 2],
  [['diapers', 'nappies', 'baby', 'nepi', 'pañales', 'bebé', 'couches', 'bébé', 'windeln', 'fraldas', 'popok', 'حفاضات', '尿布', '婴儿', 'डायपर'], 'baby', 2],
];
const CATEGORY_INDEX = new Map<string, { slug: string; prio: number }>();
for (const [words, slug, prio] of CATEGORY_WORDS) for (const w of words) CATEGORY_INDEX.set(normalize(w), { slug, prio });

/** "20,000" -> 20000, "1.299,50" -> 1299.5, "19.99" -> 19.99, "20.000" -> 20000. */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/\s/g, '');
  const lastSep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  if (lastSep >= 0) {
    const decimals = s.length - lastSep - 1;
    if (decimals === 3) s = s.replace(/[.,]/g, ''); // thousands separators only
    else s = s.slice(0, lastSep).replace(/[.,]/g, '') + '.' + s.slice(lastSep + 1);
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const CUR_RE = alt(Object.keys(CURRENCY));
const NUM = String.raw`\d{1,3}(?:[,.\s]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d+)?`;
const PRICE_RE = new RegExp(
  String.raw`(?<![\p{Script=Latin}\d])(?:(${CUR_RE})\s*)?(${NUM})\s*(k\b|elfu\b|千|万|mil\b|ribu\b|हज़ार|हजार)?\s*(${CUR_RE})?(?![\p{Script=Latin}\d])`,
  'giu',
);
const DAYS_RE = new RegExp(String.raw`(?:siku\s*(\d+))|(\d+)\s*(?:-\s*\d+\s*)?(${alt(DAY_WORDS)})(?![\p{Script=Latin}])`, 'giu');
const WORD_BOUNDARY_SAFE = (w: string) => /^[\p{Script=Latin}\s'’-]+$/u.test(w);

function phraseRe(words: string[]): RegExp {
  const latin = words.filter(WORD_BOUNDARY_SAFE);
  const other = words.filter((w) => !WORD_BOUNDARY_SAFE(w));
  const parts: string[] = [];
  if (latin.length) parts.push(String.raw`(?<![\p{L}])(?:${alt(latin)})(?![\p{L}])`);
  if (other.length) parts.push(`(?:${alt(other)})`);
  return new RegExp(parts.join('|'), 'giu');
}
const FAST_RE = phraseRe(FAST);
const NEXT_DAY_RE = phraseRe(NEXT_DAY);
const UNDER_BEFORE_END = new RegExp(String.raw`(?:${alt(UNDER_BEFORE)})\s*$`, 'iu');
const UNDER_AFTER_START = new RegExp(String.raw`^\s*(?:${alt(UNDER_AFTER)})`, 'iu');
const UNDER_ANY = phraseRe([...UNDER_BEFORE, ...UNDER_AFTER]);

const MULTIPLIERS: Record<string, number> = { k: 1000, elfu: 1000, '千': 1000, '万': 10000, mil: 1000, ribu: 1000, 'हज़ार': 1000, 'हजार': 1000 };

export function parseQueryRules(query: string, ctx: { country: string }): QueryUnderstanding {
  let text = ` ${query.toLowerCase().replace(/\s+/g, ' ').trim()} `;
  let max_days: number | null = null;
  let max_price: number | null = null;
  let currency: string | null = null;
  const cut = (start: number, end: number) => {
    text = text.slice(0, start) + ' '.repeat(end - start) + text.slice(end);
  };

  // Swahili "elfu 20" = 20,000; normalize to "20000" before the price pass.
  text = text.replace(/\belfu\s+(\d+(?:[.,]\d+)?)/giu, (_, n: string) => {
    const v = parseAmount(n);
    return v == null ? _ : String(v * 1000);
  });

  // 1) Delivery time: "within 3 days", "ndani ya siku 3", "3天内".
  for (const m of [...text.matchAll(DAYS_RE)]) {
    const n = Number(m[1] ?? m[2]);
    if (n > 0 && n < 120) {
      max_days = max_days == null ? n : Math.min(max_days, n);
      cut(m.index!, m.index! + m[0].length);
    }
  }
  if (NEXT_DAY_RE.test(text)) {
    max_days = Math.min(max_days ?? 2, 2);
    text = text.replace(NEXT_DAY_RE, (s) => ' '.repeat(s.length));
  }
  NEXT_DAY_RE.lastIndex = 0;
  if (FAST_RE.test(text)) {
    max_days = max_days ?? FAST_DAYS;
    text = text.replace(FAST_RE, (s) => ' '.repeat(s.length));
  }
  FAST_RE.lastIndex = 0;

  // 2) Price cap: needs a currency or an "under"-style phrase next to the amount.
  for (const m of [...text.matchAll(PRICE_RE)]) {
    const [whole, curBefore, amountRaw, mult, curAfter] = m;
    const start = m.index!;
    const end = start + whole.length;
    const before = text.slice(Math.max(0, start - 24), start);
    const after = text.slice(end, end + 16);
    const cur = curBefore ?? curAfter;
    const capped = UNDER_BEFORE_END.test(before) || UNDER_AFTER_START.test(after);
    if (!cur && !capped) continue;
    let amount = parseAmount(amountRaw);
    if (amount == null || amount <= 0) continue;
    if (mult) amount *= MULTIPLIERS[mult.toLowerCase()] ?? 1;
    const code = cur ? CURRENCY[cur.toLowerCase()] : 'LOCAL';
    currency = code === 'LOCAL' || !code ? currencyForCountry(ctx.country) : code;
    max_price = amount;
    cut(start, end);
    break;
  }
  if (max_price != null) text = text.replace(UNDER_ANY, (s) => ' '.repeat(s.length));

  // 3) Keywords: drop filler words; for Chinese, strip filler substrings.
  for (const f of ZH_FILLERS) text = text.split(f).join(' ');
  const tokens = text
    .split(/[\s,.;:!?¿¡()"'“”‘’،؟。，！？、]+/u)
    .map((t) => t.trim())
    .filter((t) => t && !STOPWORDS.has(normalize(t)) && !/^\d+$/.test(t));
  const keywords = tokens.join(' ');

  // 4) Category hint from the original query.
  let hint: { slug: string; prio: number } | null = null;
  const qn = normalize(query);
  for (const tok of qn.split(/[^\p{L}\p{N}\p{M}-]+/u)) {
    const h = CATEGORY_INDEX.get(tok);
    if (h && (!hint || h.prio > hint.prio)) hint = h;
  }
  for (const [w, h] of CATEGORY_INDEX) {
    // CJK / multi-word keys: substring match.
    if ((/[一-鿿]/.test(w) || w.includes(' ')) && qn.includes(w) && (!hint || h.prio > hint.prio)) hint = h;
  }

  return { keywords, category_hint: hint?.slug ?? null, max_price, currency, max_days, source: 'rules' };
}
