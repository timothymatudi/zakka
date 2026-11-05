/** Locale-aware helpers usable on server and client. */

const regionCache = new Map<string, Intl.DisplayNames>();

export function regionName(code: string | null | undefined, locale: string): string {
  if (!code) return '';
  try {
    let dn = regionCache.get(locale);
    if (!dn) {
      dn = new Intl.DisplayNames([locale], { type: 'region' });
      regionCache.set(locale, dn);
    }
    return dn.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** wa.me deep link. NEXT_PUBLIC_WHATSAPP_NUMBER is digits only, international format. */
export function whatsappLink(text: string): string {
  const number = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? '').replace(/\D/g, '');
  const base = number ? `https://wa.me/${number}` : 'https://wa.me/';
  return `${base}?text=${encodeURIComponent(text)}`;
}

export function formatNumber(n: number, locale: string, digits = 1): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n);
}

export function formatDate(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function shortOrderId(id: string): string {
  return `ZK-${id.replace(/-/g, '').slice(-8).toUpperCase()}`;
}
