import { jsonLdString } from '@/lib/seo';

/** schema.org structured data. The JSON is escaped ("<" -> <) so text can never end the script tag. */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}
