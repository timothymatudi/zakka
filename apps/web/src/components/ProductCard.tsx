import { getTranslations } from 'next-intl/server';
import type { SearchDocument, SearchOffer } from '@shared/types';
import { Link } from '@/i18n/navigation';
import { formatOfferPrice } from '@/lib/money';
import { regionName } from '@/lib/format';
import type { Market } from '@/lib/markets';
import { CATEGORIES } from '@/lib/mock/catalog';
import { ExternalIcon, StarIcon, TruckIcon } from './icons';

const TILE_TINTS = ['#E3F1EF', '#FEEAE6', '#F2ECE2', '#E8EEF7', '#F5EBD9'];

export function productIcon(doc: SearchDocument & { icon?: string }): string {
  if (doc.icon) return doc.icon;
  const cat = CATEGORIES.find((c) => doc.category_ids.includes(c.id) || doc.category_path.includes(c.slug));
  return cat?.icon ?? '🛍️';
}

export function ProductImage({ doc, size = 'card' }: { doc: SearchDocument & { icon?: string }; size?: 'card' | 'hero' }) {
  const tint = TILE_TINTS[(doc.id.charCodeAt(doc.id.length - 1) + doc.id.charCodeAt(doc.id.length - 2)) % TILE_TINTS.length];
  if (doc.image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote product images from any host
      <img src={doc.image} alt="" loading="lazy" decoding="async" className="aspect-square w-full rounded-xl bg-white object-contain" />
    );
  }
  return (
    <div className="grid aspect-square w-full place-items-center rounded-xl" style={{ background: tint }} aria-hidden>
      <span className={size === 'hero' ? 'text-[7rem]' : 'text-5xl'}>{productIcon(doc)}</span>
    </div>
  );
}

export function affiliateHref(offer: SearchOffer, productId: string, locale: string, country: string) {
  const qs = new URLSearchParams({ p: productId, l: locale, c: country });
  return `/api/out/${encodeURIComponent(offer.offer_id)}?${qs}`;
}

// Owner rule: customer-facing pages never name suppliers or partners (admin pages may).

export async function ProductCard({ doc, market, locale }: { doc: SearchDocument & { icon?: string }; market: Market; locale: string }) {
  const t = await getTranslations('product');
  const offer = doc.offers[0];
  if (!offer) return null;
  const isAff = offer.kind === 'affiliate';
  const country = regionName(market.country, locale);

  return (
    <article className="card flex h-full flex-col overflow-hidden p-2.5">
      <Link href={`/p/${doc.id}`} className="group flex flex-1 flex-col gap-2">
        <div className="relative">
          <ProductImage doc={doc} />
          <span
            className={`absolute start-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-bold ${
              isAff ? 'bg-white text-ink ring-1 ring-line' : 'bg-teal text-white'
            }`}
          >
            {isAff ? t('affiliate') : t('zakkaCheckout')}
          </span>
        </div>
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug group-hover:text-teal">{doc.title}</h3>
        {doc.rating != null && (
          <p className="flex items-center gap-1 text-xs text-muted">
            <StarIcon className="text-teal" />
            <span className="font-semibold text-ink">{doc.rating.toFixed(1)}</span>
            <span>({t('reviews', { count: doc.review_count })})</span>
          </p>
        )}
        <div className="mt-auto">
          {doc.offers.length > 1 && <span className="text-xs text-muted">{t('from')} </span>}
          <span className="num text-lg font-extrabold text-ink">{formatOfferPrice(offer, market, locale)}</span>
          {offer.delivery_days_min != null && offer.delivery_days_max != null && (
            <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-teal">
              <TruckIcon width={14} height={14} />
              {t('daysTo', { min: offer.delivery_days_min, max: offer.delivery_days_max, country })}
            </p>
          )}
        </div>
      </Link>
      {isAff && (
        <div className="mt-2 border-t border-line pt-2">
          <p className="text-[11px] leading-snug text-muted">{t('affiliateDisclosure')}</p>
          <a
            href={affiliateHref(offer, doc.id, locale, market.country)}
            target="_blank"
            rel="sponsored nofollow noopener"
            className="mt-1.5 inline-flex items-center gap-1 text-xs font-bold text-teal hover:underline"
          >
            {t('buyOn')}
            <ExternalIcon />
          </a>
        </div>
      )}
    </article>
  );
}
