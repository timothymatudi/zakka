/**
 * Owner rule: customer-facing WhatsApp text never names our suppliers or affiliate partners.
 * Dropship items are "Sold by Zakka"; affiliate items are "Partner store · Affiliate".
 * Carrier names (DHL, Aramex, ...) are allowed.
 */
export const PARTNER_NAMES = [
  'CJ Dropshipping', 'CJdropshipping', 'CJ', 'AliExpress', 'Ali Express', 'Spocket', 'Printful',
  'Amazon', 'Temu', 'Shein', 'Jumia', 'Noon', 'Flipkart',
  // Worldwide sources ("Impact" alone is an ordinary word, so only its domain is matched)
  'eBay', 'Awin', 'Rakuten', 'Admitad', 'impact.com',
];

/** Whole-word, case-insensitive match of any partner name (so "noon" in "afternoon" is not flagged). */
export const PARTNER_NAME_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(${PARTNER_NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s*')).join('|')})(?![\\p{L}\\p{N}])`,
  'giu',
);

export const mentionsPartner = (text: string) => { PARTNER_NAME_RE.lastIndex = 0; return PARTNER_NAME_RE.test(text); };

/** Replaces partner names in free text (e.g. AI replies) with a neutral phrase. */
export function scrubPartnerNames(text: string, replacement = 'a partner store'): string {
  return text.replace(PARTNER_NAME_RE, replacement);
}
