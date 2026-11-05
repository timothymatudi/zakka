import 'server-only';
import { dbInsert } from './db';

export interface AffiliateClick {
  customer_id: string | null;
  offer_id: string;
  country_code: string | null;
  locale: string | null;
  channel: 'web' | 'whatsapp';
}

const g = globalThis as unknown as { __zakkaClicks?: (AffiliateClick & { clicked_at: string })[] };

/** Inserts into affiliate_clicks (Supabase) or, in mock mode, an in-memory log. */
export async function recordAffiliateClick(click: AffiliateClick): Promise<'db' | 'mock'> {
  const saved = await dbInsert('affiliate_clicks', click);
  if (saved) return 'db';
  g.__zakkaClicks ??= [];
  g.__zakkaClicks.push({ ...click, clicked_at: new Date().toISOString() });
  if (g.__zakkaClicks.length > 1000) g.__zakkaClicks.shift();
  return 'mock';
}

export function mockClickCount(): number {
  return g.__zakkaClicks?.length ?? 0;
}
