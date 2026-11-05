import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale, SearchOffer } from '@shared/types';
import { Link } from '@/i18n/navigation';
import { getMarket } from '@/lib/market.server';
import { getOfferPrice, getProduct } from '@/lib/products';
import { formatMoney, formatUsdAsLocal } from '@/lib/money';
import { regionName, whatsappLink } from '@/lib/format';
import { CATEGORIES } from '@/lib/mock/catalog';
import { affiliateHref, partnerName, ProductImage, productIcon } from '@/components/ProductCard';
import { AddToCartButton } from '@/components/AddToCartButton';
import { ChatIcon, ExternalIcon, StarIcon } from '@/components/icons';

type Props = { params: Promise<{ locale: Locale; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params;
  const market = await getMarket(locale);
  const p = await getProduct(id, locale, market.country);
  return p ? { title: p.title, description: p.description } : {};
}

/** Best offer = lowest price, with each delivery day costing 2% (favours fast offers at a similar price). */
function bestOffer<T extends { offer: SearchOffer; priceUsd: number; dmax: number | null }>(offers: T[]): T {
  const score = (x: T) => x.priceUsd * (1 + 0.02 * (x.dmax ?? 30));
  return offers.reduce((a, b) => (score(b) < score(a) ? b : a), offers[0]);
}

export default async function ProductPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('product');
  const tc = await getTranslations('categories');
  const tw = await getTranslations('whatsapp');
  const market = await getMarket(locale);
  const product = await getProduct(id, locale, market.country);
  if (!product) notFound();
  const country = regionName(market.country, locale);

  // Authoritative local prices from the catalog service (mock: converted sample prices).
  const priced = await Promise.all(
    product.offers.map(async (offer) => {
      const p = await getOfferPrice(offer.offer_id, market.country);
      return {
        offer,
        priceUsd: p?.price_usd ?? offer.display_price_usd,
        label: p ? formatMoney(p.price, p.currency, locale, p.currency === market.currency ? market.decimals : undefined) : formatUsdAsLocal(offer.display_price_usd, market, locale),
        dmin: p?.delivery_days_min ?? offer.delivery_days_min,
        dmax: p?.delivery_days_max ?? offer.delivery_days_max,
      };
    }),
  );
  const best = priced.length ? bestOffer(priced) : null;
  const rows = best ? [best, ...priced.filter((x) => x !== best)] : [];
  const cat = CATEGORIES.find((c) => product.category_ids.includes(c.id) || product.category_slug === c.slug);
  const icon = productIcon(product);

  return (
    <div className="pb-6">
      {cat && (
        <nav className="mb-3 text-sm text-muted">
          <Link href={`/c/${cat.slug}`} className="font-semibold text-teal hover:underline">
            {tc(cat.slug)}
          </Link>
        </nav>
      )}
      <div className="grid gap-6 md:grid-cols-2 md:gap-10">
        <div className="card p-3">
          <ProductImage doc={product} size="hero" />
        </div>
        <div>
          {product.brand && <p className="text-xs font-bold uppercase tracking-[0.1em] text-muted">{product.brand}</p>}
          <h1 className="mt-1 text-2xl font-extrabold leading-tight md:text-3xl">{product.title}</h1>
          {product.rating != null && (
            <p className="mt-2 flex items-center gap-1 text-sm">
              <StarIcon className="text-teal" />
              <span className="font-bold">{product.rating.toFixed(1)}</span>
              <span className="text-muted">· {t('reviews', { count: product.review_count })}</span>
            </p>
          )}
          {best && (
            <div className="mt-4">
              <p className="num text-3xl font-extrabold">{best.label}</p>
              {best.dmin != null && best.dmax != null && (
                <p className="mt-1 font-semibold text-teal">{t('daysTo', { min: best.dmin, max: best.dmax, country })}</p>
              )}
              <p className="mt-1 text-xs text-muted">{t('priceNote', { country })}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {best.offer.kind === 'dropship' ? (
                  <AddToCartButton
                    className="flex-1 sm:flex-none"
                    item={{
                      offerId: best.offer.offer_id,
                      productId: product.id,
                      title: product.title,
                      icon,
                      image: product.image,
                      priceUsd: best.priceUsd,
                      deliveryMin: best.dmin,
                      deliveryMax: best.dmax,
                    }}
                  />
                ) : (
                  <a
                    href={affiliateHref(best.offer, product.id, locale, market.country)}
                    target="_blank"
                    rel="sponsored nofollow noopener"
                    className="btn btn-primary flex-1 sm:flex-none"
                  >
                    {t('buyOn', { partner: partnerName(best.offer.source_code) })} <ExternalIcon />
                  </a>
                )}
                <a
                  href={whatsappLink(tw('askProductText', { title: product.title }))}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline"
                >
                  <ChatIcon width={18} height={18} /> {tw('askProduct')}
                </a>
              </div>
              {best.offer.kind === 'affiliate' && (
                <p className="mt-2 rounded-lg bg-coral-soft px-3 py-2 text-xs text-ink">
                  {t('affiliateDisclosure', { partner: partnerName(best.offer.source_code) })}
                </p>
              )}
            </div>
          )}
          {!best && <p className="card mt-4 p-4 font-semibold">{t('notShipping', { country })}</p>}
          <p className="mt-5 text-[0.95rem] leading-relaxed">{product.description}</p>
          {product.bullet_points && product.bullet_points.length > 0 && (
            <>
              <h2 className="mt-4 font-bold">{t('highlights')}</h2>
              <ul className="mt-1 list-disc space-y-0.5 ps-5 text-sm">
                {product.bullet_points.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      {rows.length > 0 && (
        <section className="mt-10" aria-labelledby="offers">
          <h2 id="offers" className="mb-3 text-xl font-extrabold">
            {t('compare', { count: rows.length })}
          </h2>
          <ul className="space-y-3">
            {rows.map((r) => {
              const isBest = r === best;
              const aff = r.offer.kind === 'affiliate';
              const partner = partnerName(r.offer.source_code);
              return (
                <li
                  key={r.offer.offer_id}
                  className={`grid grid-cols-2 items-center gap-3 rounded-[1.125rem] p-4 sm:grid-cols-[1.2fr_1fr_1fr_auto] ${isBest ? 'border-2 border-coral bg-white shadow-sm' : 'border border-line bg-white/60'}`}
                >
                  <div className="col-span-2 sm:col-span-1">
                    {isBest && (
                      <span className="mb-1 inline-block rounded-full bg-coral px-2 py-0.5 text-[11px] font-bold text-white" title={t('bestWhy')}>
                        {t('best')}
                      </span>
                    )}
                    <p className="text-xs text-muted">{t('seller')}</p>
                    <p className="font-bold">{aff ? `${partner} · ${t('affiliate')}` : t('zakkaCheckout')}</p>
                    {r.offer.ships_from && <p className="text-xs text-muted">{t('shipsFrom', { country: regionName(r.offer.ships_from, locale) })}</p>}
                  </div>
                  <div>
                    <p className="text-xs text-muted">{t('price')}</p>
                    <p className="num text-lg font-extrabold">{r.label}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">{t('delivery')}</p>
                    <p className="font-semibold text-teal">{r.dmin != null && r.dmax != null ? t('days', { min: r.dmin, max: r.dmax }) : '—'}</p>
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    {aff ? (
                      <>
                        <a
                          href={affiliateHref(r.offer, product.id, locale, market.country)}
                          target="_blank"
                          rel="sponsored nofollow noopener"
                          className="btn btn-outline w-full py-2 text-sm"
                        >
                          {t('buyOn', { partner })} <ExternalIcon />
                        </a>
                        <p className="mt-1 max-w-56 text-[11px] leading-snug text-muted">{t('affiliateDisclosure', { partner })}</p>
                      </>
                    ) : (
                      <AddToCartButton
                        className="w-full py-2 text-sm"
                        item={{
                          offerId: r.offer.offer_id,
                          productId: product.id,
                          title: product.title,
                          icon,
                          image: product.image,
                          priceUsd: r.priceUsd,
                          deliveryMin: r.dmin,
                          deliveryMax: r.dmax,
                        }}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
