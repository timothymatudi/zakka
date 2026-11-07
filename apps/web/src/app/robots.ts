import type { MetadataRoute } from 'next';
import { config } from '@/lib/config';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Private or per-visitor pages, and query-only search pages.
        disallow: ['/api/', '/*/admin', '/*/cart', '/*/checkout', '/*/account', '/*/orders'],
      },
    ],
    sitemap: `${config.webBaseUrl}/sitemap.xml`,
    host: config.webBaseUrl,
  };
}
