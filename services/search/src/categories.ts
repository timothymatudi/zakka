// Category directory: slug/id -> localized names. Used at query time so index
// documents don't carry 10 copies of every category name.
import type { Locale, RawCategory } from './types';
import { normalize } from './text';

export class CategoryDirectory {
  private bySlug = new Map<string, RawCategory>();
  private byId = new Map<string, RawCategory>();
  private byName = new Map<string, string>();

  constructor(categories: RawCategory[] = []) {
    for (const c of categories) {
      this.bySlug.set(c.slug, c);
      this.byId.set(c.id, c);
      for (const n of Object.values(c.names)) if (n) this.byName.set(normalize(n), c.slug);
    }
  }

  get size(): number {
    return this.bySlug.size;
  }

  slugs(): string[] {
    return [...this.bySlug.keys()];
  }

  name(slug: string, locale: Locale): string {
    const c = this.bySlug.get(slug);
    return c?.names[locale] ?? c?.names.en ?? slug;
  }

  /** Accepts a slug, an id, or a localized name (any locale); returns the slug or null. */
  resolve(value: string): string | null {
    const v = value.trim();
    if (this.bySlug.has(v)) return v;
    const lower = v.toLowerCase();
    if (this.bySlug.has(lower)) return lower;
    const byId = this.byId.get(v);
    if (byId) return byId.slug;
    return this.byName.get(normalize(v)) ?? null;
  }

  /** Root-to-leaf chain for a category id. */
  chain(id: string | null): RawCategory[] {
    const out: RawCategory[] = [];
    const seen = new Set<string>();
    let c = id ? this.byId.get(id) : undefined;
    while (c && !seen.has(c.id)) {
      seen.add(c.id);
      out.unshift(c);
      c = c.parent_id ? this.byId.get(c.parent_id) : undefined;
    }
    return out;
  }
}
