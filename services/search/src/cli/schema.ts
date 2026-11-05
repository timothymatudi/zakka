// npm run schema -- [locale]   Prints the Typesense collection schema as JSON.
import { collectionSchema } from '../schema';
import { LOCALES, type Locale } from '../types';

const locale = (process.argv[2] ?? 'en') as Locale;
if (!LOCALES.includes(locale)) {
  console.error(`unsupported locale ${locale}`);
  process.exit(1);
}
console.log(JSON.stringify(collectionSchema(locale), null, 2));
