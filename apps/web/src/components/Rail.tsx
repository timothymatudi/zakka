import type { SearchDocument } from '@shared/types';
import { Link } from '@/i18n/navigation';
import type { Market } from '@/lib/markets';
import { ProductCard } from './ProductCard';

export function Rail({
  title,
  subtitle,
  href,
  seeAll,
  docs,
  market,
  locale,
}: {
  title: string;
  subtitle?: string;
  href: string;
  seeAll: string;
  docs: SearchDocument[];
  market: Market;
  locale: string;
}) {
  if (docs.length === 0) return null;
  return (
    <section className="mt-10" aria-label={title}>
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold">{title}</h2>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
        <Link href={href} className="shrink-0 text-sm font-bold text-teal hover:underline">
          {seeAll} <span aria-hidden className="inline-block rtl:-scale-x-100">→</span>
        </Link>
      </div>
      <div className="rail">
        {docs.map((d) => (
          <ProductCard key={d.id} doc={d} market={market} locale={locale} />
        ))}
      </div>
    </section>
  );
}
