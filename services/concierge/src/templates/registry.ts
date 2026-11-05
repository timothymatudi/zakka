import type { Locale } from '../shared';

/**
 * WhatsApp message template registry: the templates to submit to Meta for approval
 * (WhatsApp Manager > Message templates, or POST /{WABA_ID}/message_templates).
 * `npm run templates:export` prints the Graph API payloads for every template x locale.
 *
 * Templates are the ONLY messages allowed outside the 24-hour customer service window.
 * MARKETING templates are sent only to customers with whatsapp_opt_in = true.
 */
export type TemplateName = 'order_confirmation' | 'shipping_update' | 'delivery_update' | 'price_drop_alert' | 'weekly_deals';
export type TemplateCategory = 'UTILITY' | 'MARKETING';

export interface TemplateLocalization { body: string; button: string }

export interface TemplateDef {
  name: TemplateName;
  category: TemplateCategory;
  /** Body variables in order ({{1}}, {{2}}, ...). */
  variables: { name: string; example: string }[];
  /** Dynamic URL button: path appended to WEB_BASE_URL, with {{1}} replaced at send time. */
  buttonUrlPath: string;
  buttonUrlExample: string;
  translations: Record<Locale, TemplateLocalization>;
}

/** Meta language codes for our locales. */
export const META_LANGUAGE: Record<Locale, string> = {
  en: 'en', es: 'es', fr: 'fr', pt: 'pt_BR', ar: 'ar', zh: 'zh_CN', hi: 'hi', sw: 'sw', de: 'de', id: 'id',
};

export const TEMPLATES: Record<TemplateName, TemplateDef> = {
  order_confirmation: {
    name: 'order_confirmation',
    category: 'UTILITY',
    variables: [
      { name: 'order_ref', example: 'ZK-1A2B3C4D' },
      { name: 'total', example: 'KES 3,099' },
      { name: 'delivery_estimate', example: '5-9 days' },
    ],
    buttonUrlPath: '/orders/{{1}}',
    buttonUrlExample: '6f1c2b9e-3d1a-4c55-9e2f-0a1b2c3d4e5f',
    translations: {
      en: { body: 'Thanks for your Zakka order {{1}}. Total paid: {{2}}. Estimated delivery: {{3}}. We will message you when it ships.', button: 'View order' },
      es: { body: 'Gracias por tu pedido Zakka {{1}}. Total pagado: {{2}}. Entrega estimada: {{3}}. Te escribiremos cuando se envíe.', button: 'Ver pedido' },
      fr: { body: 'Merci pour votre commande Zakka {{1}}. Total payé : {{2}}. Livraison estimée : {{3}}. Nous vous écrirons à l\'expédition.', button: 'Voir la commande' },
      pt: { body: 'Obrigado pelo seu pedido Zakka {{1}}. Total pago: {{2}}. Entrega estimada: {{3}}. Avisaremos quando for enviado.', button: 'Ver pedido' },
      ar: { body: 'شكرًا لطلبك من زكّا {{1}}. المبلغ المدفوع: {{2}}. التوصيل المتوقع: {{3}}. سنراسلك عند شحن الطلب.', button: 'عرض الطلب' },
      zh: { body: '感谢你的 Zakka 订单 {{1}}。已付金额：{{2}}。预计送达：{{3}}。发货后我们会通知你。', button: '查看订单' },
      hi: { body: 'आपके ज़क्का ऑर्डर {{1}} के लिए धन्यवाद। कुल भुगतान: {{2}}। अनुमानित डिलीवरी: {{3}}। शिप होने पर हम आपको बताएँगे।', button: 'ऑर्डर देखें' },
      sw: { body: 'Asante kwa oda yako ya Zakka {{1}}. Jumla iliyolipwa: {{2}}. Inatarajiwa kufika: {{3}}. Tutakujulisha ikisafirishwa.', button: 'Ona oda' },
      de: { body: 'Danke für deine Zakka-Bestellung {{1}}. Bezahlt: {{2}}. Voraussichtliche Lieferung: {{3}}. Wir melden uns beim Versand.', button: 'Bestellung ansehen' },
      id: { body: 'Terima kasih atas pesanan Zakka {{1}}. Total dibayar: {{2}}. Perkiraan tiba: {{3}}. Kami kabari saat dikirim.', button: 'Lihat pesanan' },
    },
  },
  shipping_update: {
    name: 'shipping_update',
    category: 'UTILITY',
    variables: [
      { name: 'order_ref', example: 'ZK-1A2B3C4D' },
      { name: 'carrier', example: 'DHL' },
      { name: 'tracking_number', example: 'JD014600003828' },
    ],
    buttonUrlPath: '/orders/{{1}}',
    buttonUrlExample: '6f1c2b9e-3d1a-4c55-9e2f-0a1b2c3d4e5f',
    translations: {
      en: { body: 'Good news: your Zakka order {{1}} has shipped with {{2}}. Tracking number: {{3}}.', button: 'Track order' },
      es: { body: 'Buenas noticias: tu pedido Zakka {{1}} se envió con {{2}}. Número de seguimiento: {{3}}.', button: 'Seguir pedido' },
      fr: { body: 'Bonne nouvelle : votre commande Zakka {{1}} a été expédiée avec {{2}}. Numéro de suivi : {{3}}.', button: 'Suivre la commande' },
      pt: { body: 'Boa notícia: seu pedido Zakka {{1}} foi enviado pela {{2}}. Código de rastreio: {{3}}.', button: 'Rastrear pedido' },
      ar: { body: 'خبر سار: تم شحن طلبك من زكّا {{1}} عبر {{2}}. رقم التتبع: {{3}}.', button: 'تتبّع الطلب' },
      zh: { body: '好消息：你的 Zakka 订单 {{1}} 已由 {{2}} 发出。运单号：{{3}}。', button: '追踪订单' },
      hi: { body: 'खुशखबरी: आपका ज़क्का ऑर्डर {{1}} {{2}} से शिप हो गया है। ट्रैकिंग नंबर: {{3}}।', button: 'ऑर्डर ट्रैक करें' },
      sw: { body: 'Habari njema: oda yako ya Zakka {{1}} imesafirishwa na {{2}}. Namba ya ufuatiliaji: {{3}}.', button: 'Fuatilia oda' },
      de: { body: 'Gute Nachricht: Deine Zakka-Bestellung {{1}} ist mit {{2}} unterwegs. Sendungsnummer: {{3}}.', button: 'Sendung verfolgen' },
      id: { body: 'Kabar baik: pesanan Zakka {{1}} sudah dikirim dengan {{2}}. Nomor resi: {{3}}.', button: 'Lacak pesanan' },
    },
  },
  delivery_update: {
    name: 'delivery_update',
    category: 'UTILITY',
    variables: [
      { name: 'order_ref', example: 'ZK-1A2B3C4D' },
      { name: 'status', example: 'out for delivery' },
      { name: 'expected', example: 'today' },
    ],
    buttonUrlPath: '/orders/{{1}}',
    buttonUrlExample: '6f1c2b9e-3d1a-4c55-9e2f-0a1b2c3d4e5f',
    translations: {
      en: { body: 'Update on your Zakka order {{1}}: {{2}}. Expected delivery: {{3}}.', button: 'View order' },
      es: { body: 'Novedades de tu pedido Zakka {{1}}: {{2}}. Entrega prevista: {{3}}.', button: 'Ver pedido' },
      fr: { body: 'Suivi de votre commande Zakka {{1}} : {{2}}. Livraison prévue : {{3}}.', button: 'Voir la commande' },
      pt: { body: 'Atualização do seu pedido Zakka {{1}}: {{2}}. Entrega prevista: {{3}}.', button: 'Ver pedido' },
      ar: { body: 'تحديث على طلبك من زكّا {{1}}: {{2}}. التوصيل المتوقع: {{3}}.', button: 'عرض الطلب' },
      zh: { body: '你的 Zakka 订单 {{1}} 有更新：{{2}}。预计送达：{{3}}。', button: '查看订单' },
      hi: { body: 'आपके ज़क्का ऑर्डर {{1}} पर अपडेट: {{2}}। अनुमानित डिलीवरी: {{3}}।', button: 'ऑर्डर देखें' },
      sw: { body: 'Taarifa ya oda yako ya Zakka {{1}}: {{2}}. Inatarajiwa kufika: {{3}}.', button: 'Ona oda' },
      de: { body: 'Neuigkeiten zu deiner Zakka-Bestellung {{1}}: {{2}}. Voraussichtliche Zustellung: {{3}}.', button: 'Bestellung ansehen' },
      id: { body: 'Info pesanan Zakka {{1}}: {{2}}. Perkiraan tiba: {{3}}.', button: 'Lihat pesanan' },
    },
  },
  price_drop_alert: {
    name: 'price_drop_alert',
    category: 'MARKETING',
    variables: [
      { name: 'product_title', example: 'Wireless earbuds with charging case' },
      { name: 'new_price', example: 'KES 2,499' },
      { name: 'old_price', example: 'KES 3,099' },
      { name: 'country', example: 'Kenya' },
    ],
    buttonUrlPath: '/p/{{1}}',
    buttonUrlExample: '6f1c2b9e-3d1a-4c55-9e2f-0a1b2c3d4e5f',
    translations: {
      en: { body: 'Price drop: {{1}} is now {{2}} (was {{3}}), delivered to {{4}}. Reply STOP to unsubscribe.', button: 'View deal' },
      es: { body: 'Bajada de precio: {{1}} ahora cuesta {{2}} (antes {{3}}), con entrega en {{4}}. Responde STOP para darte de baja.', button: 'Ver oferta' },
      fr: { body: 'Baisse de prix : {{1}} passe à {{2}} (au lieu de {{3}}), livré en {{4}}. Répondez STOP pour vous désabonner.', button: 'Voir l\'offre' },
      pt: { body: 'Baixou o preço: {{1}} agora por {{2}} (antes {{3}}), com entrega em {{4}}. Responda STOP para sair.', button: 'Ver oferta' },
      ar: { body: 'انخفاض في السعر: {{1}} أصبح {{2}} (بدلًا من {{3}}) مع التوصيل إلى {{4}}. أرسل STOP لإلغاء الاشتراك.', button: 'عرض العرض' },
      zh: { body: '降价提醒：{{1}} 现价 {{2}}（原价 {{3}}），可配送至 {{4}}。回复 STOP 退订。', button: '查看优惠' },
      hi: { body: 'कीमत घटी: {{1}} अब {{2}} में (पहले {{3}}), {{4}} में डिलीवरी। सदस्यता हटाने के लिए STOP भेजें।', button: 'डील देखें' },
      sw: { body: 'Bei imeshuka: {{1}} sasa ni {{2}} (ilikuwa {{3}}), inaletwa {{4}}. Jibu STOP kujiondoa.', button: 'Ona ofa' },
      de: { body: 'Preissenkung: {{1}} kostet jetzt {{2}} (vorher {{3}}), Lieferung nach {{4}}. Antworte STOP zum Abmelden.', button: 'Angebot ansehen' },
      id: { body: 'Harga turun: {{1}} kini {{2}} (sebelumnya {{3}}), dikirim ke {{4}}. Balas STOP untuk berhenti.', button: 'Lihat promo' },
    },
  },
  weekly_deals: {
    name: 'weekly_deals',
    category: 'MARKETING',
    variables: [
      { name: 'deals_summary', example: 'Earbuds from KES 1,999, smartwatches from KES 3,499, phone cases from KES 499' },
    ],
    buttonUrlPath: '/deals?ref={{1}}',
    buttonUrlExample: 'wa_weekly',
    translations: {
      en: { body: "This week's Zakka deals for you: {{1}}. Prices include delivery. Reply STOP to unsubscribe.", button: 'See deals' },
      es: { body: 'Ofertas Zakka de esta semana para ti: {{1}}. Precios con envío incluido. Responde STOP para darte de baja.', button: 'Ver ofertas' },
      fr: { body: 'Les bons plans Zakka de la semaine : {{1}}. Livraison incluse. Répondez STOP pour vous désabonner.', button: 'Voir les offres' },
      pt: { body: 'Ofertas Zakka da semana para você: {{1}}. Preços com frete incluído. Responda STOP para sair.', button: 'Ver ofertas' },
      ar: { body: 'عروض زكّا لهذا الأسبوع: {{1}}. الأسعار تشمل التوصيل. أرسل STOP لإلغاء الاشتراك.', button: 'عرض العروض' },
      zh: { body: '本周 Zakka 精选优惠：{{1}}。价格已含运费。回复 STOP 退订。', button: '查看优惠' },
      hi: { body: 'इस हफ़्ते ज़क्का के ऑफ़र: {{1}}। कीमतों में डिलीवरी शामिल है। सदस्यता हटाने के लिए STOP भेजें।', button: 'ऑफ़र देखें' },
      sw: { body: 'Ofa za Zakka wiki hii: {{1}}. Bei zinajumuisha usafirishaji. Jibu STOP kujiondoa.', button: 'Ona ofa' },
      de: { body: 'Deine Zakka-Angebote der Woche: {{1}}. Preise inkl. Versand. Antworte STOP zum Abmelden.', button: 'Angebote ansehen' },
      id: { body: 'Promo Zakka minggu ini: {{1}}. Harga termasuk ongkir. Balas STOP untuk berhenti.', button: 'Lihat promo' },
    },
  },
};

/** Graph API payload for POST /{WABA_ID}/message_templates. */
export function metaSubmissionPayload(name: TemplateName, locale: Locale, webBaseUrl: string): Record<string, unknown> {
  const def = TEMPLATES[name];
  const tr = def.translations[locale];
  return {
    name: def.name,
    language: META_LANGUAGE[locale],
    category: def.category,
    components: [
      { type: 'BODY', text: tr.body, example: { body_text: [def.variables.map((v) => v.example)] } },
      {
        type: 'BUTTONS',
        buttons: [{ type: 'URL', text: tr.button, url: webBaseUrl + def.buttonUrlPath, example: [webBaseUrl + def.buttonUrlPath.replace('{{1}}', def.buttonUrlExample)] }],
      },
    ],
  };
}

/** Local preview of a filled template (logs, simulator, DB body column). */
export function renderTemplate(name: TemplateName, locale: Locale, params: string[]): string {
  return TEMPLATES[name].translations[locale].body.replace(/\{\{(\d+)\}\}/g, (_, i: string) => params[Number(i) - 1] ?? '');
}
