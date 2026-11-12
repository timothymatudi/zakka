import type { MetadataRoute } from 'next';

/** Served at /manifest.webmanifest, so the site can be added to a phone's home screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Zakka',
    short_name: 'Zakka',
    description: 'Search products from around the world and see the real total price and delivery time to your country.',
    start_url: '/',
    display: 'standalone',
    background_color: '#FBF8F3',
    theme_color: '#0F766E',
    icons: [
      { src: '/icon.svg', type: 'image/svg+xml', sizes: 'any' },
      { src: '/apple-icon.png', type: 'image/png', sizes: '180x180' },
    ],
  };
}
