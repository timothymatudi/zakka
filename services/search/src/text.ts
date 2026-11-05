// Locale-aware text normalization used by the memory engine and the rule-based
// query parser. Typesense does its own tokenization (see schema.ts).

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/;
const CJK_RUN = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]+/g;

export function normalize(text: string): string {
  return (
    text
      .normalize('NFKD')
      // Latin combining diacritics (é -> e). Devanagari vowel signs are kept.
      .replace(/[̀-ͯ]/g, '')
      // Arabic harakat and tatweel
      .replace(/[ً-ْـ]/g, '')
      // Arabic letter variants
      .replace(/[آأإ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .toLowerCase()
      .normalize('NFC')
  );
}

/**
 * Tokens for matching. Space-delimited scripts split on non-letters; CJK runs
 * (no spaces) become overlapping character bigrams, plus the single character
 * when a run has length 1. That gives decent recall for zh without a dictionary.
 */
export function tokenize(text: string): string[] {
  const n = normalize(text);
  const out: string[] = [];
  for (const piece of n.split(/[^\p{L}\p{N}\p{M}]+/u)) {
    if (!piece) continue;
    if (!CJK.test(piece)) {
      out.push(piece);
      continue;
    }
    // Mixed piece: split latin/digit parts from CJK runs.
    const nonCjk = piece.replace(CJK_RUN, ' ').split(' ').filter(Boolean);
    out.push(...nonCjk);
    for (const run of piece.match(CJK_RUN) ?? []) {
      if (run.length === 1) out.push(run);
      for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
    }
  }
  return out;
}

export function hasCjk(text: string): boolean {
  return CJK.test(text);
}
