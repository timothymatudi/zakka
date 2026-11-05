import type { Locale } from '../shared';

/**
 * Lightweight, offline language detection for the 10 phase-1 locales.
 * Script detection for ar/zh/hi; stop-word scoring for Latin-script languages.
 * Returns null when unsure so the caller keeps the stored locale.
 */
const WORDS: Partial<Record<Locale, string[]>> = {
  en: ['the', 'and', 'i', 'want', 'need', 'cheap', 'buy', 'for', 'my', 'where', 'is', 'order', 'please', 'hi', 'hello', 'show', 'me', 'looking', 'with', 'under', 'best', 'help', 'what', 'how', 'thanks', 'yes', 'no', 'to', 'talk', 'human', 'agent', 'track', 'can', 'you'],
  sw: ['nataka', 'nini', 'bei', 'rahisi', 'oda', 'agizo', 'yangu', 'iko', 'wapi', 'habari', 'tafadhali', 'nunua', 'kununua', 'na', 'ya', 'kwa', 'hii', 'gani', 'sana', 'asante', 'ndiyo', 'hapana', 'nisaidie', 'jambo', 'mambo'],
  es: ['quiero', 'barato', 'baratos', 'barata', 'baratas', 'el', 'los', 'las', 'para', 'dónde', 'donde', 'está', 'mi', 'pedido', 'hola', 'por', 'favor', 'comprar', 'unos', 'unas', 'gracias', 'necesito', 'busco', 'auriculares'],
  fr: ['je', 'veux', 'pas', 'cher', 'chère', 'le', 'les', 'des', 'pour', 'où', 'est', 'ma', 'mon', 'commande', 'bonjour', 'salut', 'acheter', 'une', 'merci', 'cherche', 'écouteurs', 'avec'],
  pt: ['quero', 'barato', 'baratos', 'os', 'para', 'onde', 'está', 'meu', 'minha', 'pedido', 'olá', 'oi', 'comprar', 'um', 'uma', 'você', 'obrigado', 'obrigada', 'preciso', 'fones', 'com'],
  de: ['ich', 'will', 'möchte', 'billig', 'billige', 'günstige', 'der', 'die', 'das', 'für', 'wo', 'ist', 'meine', 'bestellung', 'hallo', 'kaufen', 'ein', 'eine', 'und', 'danke', 'suche', 'kopfhörer', 'mit'],
  id: ['saya', 'mau', 'ingin', 'murah', 'yang', 'untuk', 'di', 'mana', 'pesanan', 'halo', 'beli', 'dan', 'ini', 'tolong', 'apa', 'terima', 'kasih', 'cari', 'butuh', 'dengan'],
};

export function detectLanguage(text: string): Locale | null {
  const t = text.trim();
  if (!t) return null;
  const count = (re: RegExp) => (t.match(re) ?? []).length;
  const letters = count(/\p{L}/gu) || 1;
  if (count(/[؀-ۿݐ-ݿ]/g) / letters > 0.3) return 'ar';
  if (count(/[ऀ-ॿ]/g) / letters > 0.3) return 'hi';
  if (count(/[一-鿿㐀-䶿]/g) / letters > 0.3) return 'zh';

  const tokens = t.toLowerCase().normalize('NFC').split(/[^\p{L}]+/u).filter(Boolean);
  let best: Locale | null = null;
  let bestScore = 0;
  let tie = false;
  for (const [loc, words] of Object.entries(WORDS) as [Locale, string[]][]) {
    const set = new Set(words);
    const score = tokens.reduce((n, w) => n + (set.has(w) ? 1 : 0), 0);
    if (score > bestScore) { best = loc; bestScore = score; tie = false; }
    else if (score === bestScore && score > 0) tie = true;
  }
  return bestScore > 0 && !tie ? best : null;
}
