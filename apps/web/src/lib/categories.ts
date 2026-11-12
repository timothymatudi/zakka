import 'server-only';
import { dbSelect } from './db';
import { hasSupabase } from './config';
import { CATEGORIES, type MockCategory } from './mock/catalog';

export type Category = MockCategory;

let cached: Category[] | null = null;

/** Top-level categories. Live: from Supabase; mock: the static list. Cached per server process. */
export async function getCategories(): Promise<Category[]> {
  if (cached) return cached;
  if (hasSupabase()) {
    const rows = await dbSelect<{ id: string; slug: string; icon: string | null; sort: number }>(
      'categories',
      'is_top_level=eq.true&select=id,slug,icon,sort&order=sort.asc',
    );
    if (rows && rows.length > 0) {
      cached = rows.map((r) => ({ id: r.id, slug: r.slug, icon: r.icon ?? '🛍️', sort: r.sort }));
      return cached;
    }
  }
  return CATEGORIES;
}
