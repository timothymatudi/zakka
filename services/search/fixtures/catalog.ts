// Sample catalog used by `npm run index -- --from-fixtures` and by the
// in-memory engine. 60 realistic products across dropship and affiliate
// sources, shipping from several countries. Prices are `display_price_usd`
// as the catalog service would write them (markup already applied for
// dropship). URLs are placeholders on example.com; images are placeholders.
import type { Locale, SourceCode } from '../src/types';

type Tr = Partial<Record<Locale, [title: string, description: string, bullets?: string[]]>>;

export interface FixtureCategory {
  slug: string;
  parent: string | null;
  names: Partial<Record<Locale, string>>;
}

export interface FixtureOffer {
  source: SourceCode;
  price: number;
  days: [number, number];
  from: string;
  to: string[];
}

export interface FixtureProduct {
  n: number;
  cat: string;
  brand: string | null;
  rating: number | null;
  reviews: number;
  pop: number;
  t: Tr;
  offers: FixtureOffer[];
}

const EA = ['KE', 'TZ', 'UG', 'RW'];
const WA = ['NG', 'GH'];
const GCC = ['AE', 'SA', 'QA', 'KW', 'OM', 'BH'];
const EU = ['DE', 'FR', 'ES', 'IT', 'NL', 'PT'];
const NA = ['US', 'CA'];
const WORLD = [...EA, ...WA, 'ZA', 'EG', 'MA', ...GCC, 'IN', 'PK', 'ID', 'CN', ...NA, 'GB', ...EU, 'BR', 'MX', 'AU'];
const NOT_CN = WORLD.filter((c) => c !== 'CN');

// offer helpers per source
const cj = (price: number, d: [number, number] = [8, 15], to = NOT_CN): FixtureOffer => ({ source: 'cj', price, days: d, from: 'CN', to });
const aeds = (price: number, d: [number, number] = [10, 20], to = NOT_CN): FixtureOffer => ({ source: 'aliexpress_ds', price, days: d, from: 'CN', to });
const spocket = (price: number, from = 'US', d: [number, number] = [3, 7]): FixtureOffer => ({ source: 'spocket', price, days: d, from, to: from === 'US' ? NA : [...EU, 'GB'] });
const printful = (price: number, from = 'US', d: [number, number] = [4, 8]): FixtureOffer => ({ source: 'printful', price, days: d, from, to: from === 'US' ? [...NA, 'GB', 'AU'] : [...EU, 'GB'] });
const amazon = (price: number, market: 'US' | 'AE' | 'IN' = 'US'): FixtureOffer =>
  market === 'US' ? { source: 'amazon', price, days: [1, 3], from: 'US', to: ['US'] }
  : market === 'AE' ? { source: 'amazon', price, days: [1, 2], from: 'AE', to: ['AE', 'SA'] }
  : { source: 'amazon', price, days: [1, 4], from: 'IN', to: ['IN'] };
const temu = (price: number): FixtureOffer => ({ source: 'temu', price, days: [7, 12], from: 'CN', to: [...NA, 'GB', ...EU, ...GCC, 'MX', 'BR', 'AU'] });
const shein = (price: number): FixtureOffer => ({ source: 'shein', price, days: [6, 10], from: 'CN', to: [...NA, 'GB', ...EU, ...GCC, 'MX', 'BR', 'AU', 'ZA', 'IN'] });
const aeaff = (price: number): FixtureOffer => ({ source: 'aliexpress_aff', price, days: [12, 25], from: 'CN', to: NOT_CN });
const jumia = (price: number, cc: 'KE' | 'NG' | 'EG' = 'KE'): FixtureOffer => ({ source: 'jumia', price, days: [1, 4], from: cc, to: [cc] });
const noon = (price: number, from: 'AE' | 'SA' | 'EG' = 'AE'): FixtureOffer => ({ source: 'noon', price, days: [1, 3], from, to: from === 'EG' ? ['EG'] : ['AE', 'SA'] });
const flipkart = (price: number): FixtureOffer => ({ source: 'flipkart', price, days: [2, 5], from: 'IN', to: ['IN'] });

export const CATEGORIES: FixtureCategory[] = [
  { slug: 'electronics', parent: null, names: { en: 'Electronics', sw: 'Elektroniki', es: 'Electrónica', fr: 'Électronique', ar: 'إلكترونيات', zh: '电子产品', hi: 'इलेक्ट्रॉनिक्स', de: 'Elektronik', pt: 'Eletrônicos', id: 'Elektronik' } },
  { slug: 'phones', parent: 'electronics', names: { en: 'Phones', sw: 'Simu', es: 'Teléfonos', fr: 'Téléphones', ar: 'هواتف', zh: '手机', hi: 'फ़ोन', de: 'Handys', pt: 'Celulares', id: 'Ponsel' } },
  { slug: 'audio', parent: 'electronics', names: { en: 'Audio', sw: 'Sauti', es: 'Audio', fr: 'Audio', ar: 'صوتيات', zh: '音频', hi: 'ऑडियो', de: 'Audio', pt: 'Áudio', id: 'Audio' } },
  { slug: 'headphones', parent: 'audio', names: { en: 'Headphones & Earbuds', sw: 'Vipokea sauti', es: 'Auriculares', fr: 'Écouteurs', ar: 'سماعات', zh: '耳机', hi: 'हेडफ़ोन', de: 'Kopfhörer', pt: 'Fones de ouvido', id: 'Earphone' } },
  { slug: 'speakers', parent: 'audio', names: { en: 'Speakers', sw: 'Spika', es: 'Altavoces', fr: 'Enceintes', ar: 'مكبرات صوت', zh: '音箱', hi: 'स्पीकर', de: 'Lautsprecher', pt: 'Caixas de som', id: 'Speaker' } },
  { slug: 'computers', parent: 'electronics', names: { en: 'Computers', sw: 'Kompyuta', es: 'Computadoras', fr: 'Ordinateurs', ar: 'حواسيب', zh: '电脑', hi: 'कंप्यूटर', de: 'Computer', pt: 'Computadores', id: 'Komputer' } },
  { slug: 'wearables', parent: 'electronics', names: { en: 'Wearables', sw: 'Saa janja', es: 'Wearables', fr: 'Objets connectés', ar: 'أجهزة قابلة للارتداء', zh: '智能穿戴', hi: 'वियरेबल्स', de: 'Wearables', pt: 'Vestíveis', id: 'Wearable' } },
  { slug: 'accessories', parent: 'electronics', names: { en: 'Chargers & Accessories', sw: 'Chaja na vifaa', es: 'Cargadores y accesorios', fr: 'Chargeurs et accessoires', ar: 'شواحن وملحقات', zh: '充电器与配件', hi: 'चार्जर और एक्सेसरीज़', de: 'Ladegeräte & Zubehör', pt: 'Carregadores e acessórios', id: 'Charger & aksesoris' } },
  { slug: 'home', parent: null, names: { en: 'Home', sw: 'Nyumbani', es: 'Hogar', fr: 'Maison', ar: 'المنزل', zh: '家居', hi: 'घर', de: 'Zuhause', pt: 'Casa', id: 'Rumah' } },
  { slug: 'kitchen', parent: 'home', names: { en: 'Kitchen', sw: 'Jikoni', es: 'Cocina', fr: 'Cuisine', ar: 'المطبخ', zh: '厨房', hi: 'रसोई', de: 'Küche', pt: 'Cozinha', id: 'Dapur' } },
  { slug: 'decor', parent: 'home', names: { en: 'Decor & Lighting', sw: 'Mapambo', es: 'Decoración', fr: 'Déco', ar: 'ديكور', zh: '装饰', hi: 'सजावट', de: 'Deko', pt: 'Decoração', id: 'Dekorasi' } },
  { slug: 'fashion', parent: null, names: { en: 'Fashion', sw: 'Mitindo', es: 'Moda', fr: 'Mode', ar: 'أزياء', zh: '时尚', hi: 'फ़ैशन', de: 'Mode', pt: 'Moda', id: 'Fashion' } },
  { slug: 'clothing', parent: 'fashion', names: { en: 'Clothing', sw: 'Nguo', es: 'Ropa', fr: 'Vêtements', ar: 'ملابس', zh: '服装', hi: 'कपड़े', de: 'Kleidung', pt: 'Roupas', id: 'Pakaian' } },
  { slug: 'shoes', parent: 'fashion', names: { en: 'Shoes', sw: 'Viatu', es: 'Zapatos', fr: 'Chaussures', ar: 'أحذية', zh: '鞋', hi: 'जूते', de: 'Schuhe', pt: 'Sapatos', id: 'Sepatu' } },
  { slug: 'bags', parent: 'fashion', names: { en: 'Bags', sw: 'Mikoba', es: 'Bolsos', fr: 'Sacs', ar: 'حقائب', zh: '包', hi: 'बैग', de: 'Taschen', pt: 'Bolsas', id: 'Tas' } },
  { slug: 'beauty', parent: null, names: { en: 'Beauty', sw: 'Urembo', es: 'Belleza', fr: 'Beauté', ar: 'الجمال', zh: '美妆', hi: 'सौंदर्य', de: 'Beauty', pt: 'Beleza', id: 'Kecantikan' } },
  { slug: 'skincare', parent: 'beauty', names: { en: 'Skincare', sw: 'Utunzaji wa ngozi', es: 'Cuidado de la piel', fr: 'Soins de la peau', ar: 'العناية بالبشرة', zh: '护肤', hi: 'त्वचा की देखभाल', de: 'Hautpflege', pt: 'Cuidados com a pele', id: 'Perawatan kulit' } },
  { slug: 'hair', parent: 'beauty', names: { en: 'Hair', sw: 'Nywele', es: 'Cabello', fr: 'Cheveux', ar: 'الشعر', zh: '美发', hi: 'बाल', de: 'Haare', pt: 'Cabelo', id: 'Rambut' } },
  { slug: 'sports', parent: null, names: { en: 'Sports & Outdoors', sw: 'Michezo', es: 'Deportes', fr: 'Sport', ar: 'رياضة', zh: '运动户外', hi: 'खेल', de: 'Sport', pt: 'Esportes', id: 'Olahraga' } },
  { slug: 'fitness', parent: 'sports', names: { en: 'Fitness', sw: 'Mazoezi', es: 'Fitness', fr: 'Fitness', ar: 'لياقة', zh: '健身', hi: 'फ़िटनेस', de: 'Fitness', pt: 'Fitness', id: 'Kebugaran' } },
  { slug: 'outdoor', parent: 'sports', names: { en: 'Outdoor', sw: 'Nje', es: 'Aire libre', fr: 'Plein air', ar: 'الهواء الطلق', zh: '户外', hi: 'आउटडोर', de: 'Outdoor', pt: 'Ar livre', id: 'Outdoor' } },
  { slug: 'kids', parent: null, names: { en: 'Kids & Baby', sw: 'Watoto', es: 'Niños y bebés', fr: 'Enfants et bébés', ar: 'الأطفال', zh: '母婴', hi: 'बच्चे', de: 'Kinder & Baby', pt: 'Infantil', id: 'Anak & bayi' } },
  { slug: 'toys', parent: 'kids', names: { en: 'Toys', sw: 'Vinyago', es: 'Juguetes', fr: 'Jouets', ar: 'ألعاب', zh: '玩具', hi: 'खिलौने', de: 'Spielzeug', pt: 'Brinquedos', id: 'Mainan' } },
  { slug: 'baby', parent: 'kids', names: { en: 'Baby', sw: 'Mtoto mchanga', es: 'Bebé', fr: 'Bébé', ar: 'رضع', zh: '婴儿', hi: 'शिशु', de: 'Baby', pt: 'Bebê', id: 'Bayi' } },
];

export const PRODUCTS: FixtureProduct[] = [
  // ---- Phones
  { n: 1, cat: 'phones', brand: 'Tecno', rating: 4.3, reviews: 2140, pop: 0.92, offers: [jumia(129.0, 'KE'), jumia(124.5, 'NG'), aeaff(118.9)],
    t: { en: ['Tecno Spark 20 Smartphone 128GB, 6.6" display, 5000mAh battery', 'Dual SIM Android smartphone with a 50MP camera, 128GB storage and all-day battery.', ['128GB storage, 8GB RAM', '50MP main camera', '5000mAh battery with 18W fast charge']],
         sw: ['Simu janja Tecno Spark 20, 128GB, skrini 6.6", betri 5000mAh', 'Simu ya Android yenye laini mbili, kamera 50MP, hifadhi 128GB na betri inayodumu siku nzima.'],
         fr: ['Smartphone Tecno Spark 20 128 Go, écran 6,6", batterie 5000 mAh', 'Smartphone Android double SIM avec appareil photo 50 MP.'] } },
  { n: 2, cat: 'phones', brand: 'Infinix', rating: 4.2, reviews: 1630, pop: 0.85, offers: [jumia(109.0, 'KE'), jumia(112.0, 'NG'), cj(119.99, [9, 16])],
    t: { en: ['Infinix Hot 40i Smartphone 128GB, 6.56" 90Hz display', 'Budget Android phone with 90Hz screen, 50MP camera and 5000mAh battery.'],
         sw: ['Simu janja Infinix Hot 40i 128GB, skrini 6.56" 90Hz', 'Simu ya bei nafuu yenye skrini ya 90Hz, kamera 50MP na betri 5000mAh.'] } },
  { n: 3, cat: 'phones', brand: 'Samsung', rating: 4.6, reviews: 8800, pop: 0.97, offers: [amazon(199.99, 'US'), amazon(209.0, 'AE'), noon(205.0, 'AE'), flipkart(185.0), jumia(215.0, 'KE')],
    t: { en: ['Samsung Galaxy A25 5G 128GB Smartphone', '5G Android smartphone with Super AMOLED display, 50MP OIS camera and 4 years of OS updates.'],
         ar: ['هاتف سامسونج جالاكسي A25 بتقنية 5G سعة 128 جيجابايت', 'هاتف أندرويد بشاشة سوبر أموليد وكاميرا 50 ميجابكسل.'],
         hi: ['सैमसंग गैलेक्सी A25 5G स्मार्टफोन 128GB', 'सुपर AMOLED डिस्प्ले और 50MP कैमरा वाला 5G फोन।'],
         es: ['Smartphone Samsung Galaxy A25 5G 128 GB', 'Teléfono Android 5G con pantalla Super AMOLED y cámara de 50 MP.'] } },
  { n: 4, cat: 'phones', brand: 'Xiaomi', rating: 4.5, reviews: 5400, pop: 0.9, offers: [flipkart(149.0), noon(165.0, 'AE'), aeaff(155.0), jumia(169.0, 'EG')],
    t: { en: ['Xiaomi Redmi Note 13 Smartphone 256GB', 'AMOLED 120Hz smartphone with 108MP camera and 33W fast charging.'],
         zh: ['小米 Redmi Note 13 智能手机 256GB', '120Hz AMOLED 屏幕，1亿像素相机，33W 快充。'],
         id: ['Xiaomi Redmi Note 13 Smartphone 256GB', 'Ponsel layar AMOLED 120Hz dengan kamera 108MP.'] } },
  { n: 5, cat: 'phones', brand: 'Nokia', rating: 4.0, reviews: 640, pop: 0.45, offers: [jumia(29.0, 'KE'), jumia(27.5, 'NG'), amazon(39.99, 'US')],
    t: { en: ['Nokia 105 Feature Phone with long battery life', 'Simple durable phone with FM radio, flashlight and weeks of standby.'],
         sw: ['Simu ya kawaida Nokia 105 yenye betri inayodumu', 'Simu imara yenye redio ya FM na tochi.'] } },
  // ---- Headphones / audio
  { n: 6, cat: 'headphones', brand: 'Oraimo', rating: 4.4, reviews: 3900, pop: 0.88, offers: [jumia(18.5, 'KE'), jumia(17.9, 'NG'), cj(16.99, [8, 14])],
    t: { en: ['Oraimo FreePods 4 Wireless Earbuds with ANC', 'True wireless earbuds with active noise cancellation, 35-hour battery and IPX5 sweat resistance for workouts.', ['Active noise cancellation', 'IPX5 sweat resistant', '35h total playtime']],
         sw: ['Vipokea sauti visivyo na waya Oraimo FreePods 4 vyenye ANC', 'Earbuds zisizo na waya zenye kuzuia kelele na betri ya saa 35.'],
         fr: ['Écouteurs sans fil Oraimo FreePods 4 avec ANC', 'Écouteurs true wireless à réduction de bruit, autonomie 35 h.'] } },
  { n: 7, cat: 'headphones', brand: 'Soundcore', rating: 4.5, reviews: 12500, pop: 0.95, offers: [amazon(29.99, 'US'), amazon(32.0, 'AE'), flipkart(27.5), noon(31.0, 'AE')],
    t: { en: ['Soundcore Sport X10 Wireless Earbuds for Running', 'Sport earbuds with rotating ear hooks that stay put while running, IPX7 waterproof, 32h battery.', ['Secure-fit ear hooks', 'IPX7 waterproof', 'Bluetooth 5.3']],
         es: ['Auriculares inalámbricos deportivos Soundcore Sport X10 para correr', 'Auriculares con ganchos giratorios, resistentes al agua IPX7.'],
         de: ['Soundcore Sport X10 kabellose Sport-Kopfhörer zum Laufen', 'Sport-Ohrhörer mit Ohrbügeln, IPX7 wasserdicht.'],
         ar: ['سماعات لاسلكية رياضية ساوندكور سبورت X10 للجري', 'سماعات رياضية مقاومة للماء IPX7.'] } },
  { n: 8, cat: 'headphones', brand: 'Generic', rating: 3.9, reviews: 410, pop: 0.4, offers: [aeds(6.49), temu(7.2), aeaff(5.99)],
    t: { en: ['Bluetooth 5.3 Wireless Earbuds with Charging Case', 'Budget wireless earbuds with touch control and LED battery display.'],
         zh: ['蓝牙5.3 无线耳机 带充电盒', '触控操作，LED 电量显示，性价比高。'],
         sw: ['Vipokea sauti vya Bluetooth 5.3 visivyo na waya', 'Earbuds za bei nafuu zenye kidhibiti cha kugusa.'] } },
  { n: 9, cat: 'headphones', brand: 'JBL', rating: 4.6, reviews: 7600, pop: 0.89, offers: [amazon(49.95, 'US'), noon(54.0, 'AE'), flipkart(45.0), jumia(59.0, 'KE')],
    t: { en: ['JBL Tune 520BT Wireless On-Ear Headphones', 'Lightweight foldable on-ear headphones with JBL Pure Bass and 57-hour battery.'],
         hi: ['JBL ट्यून 520BT वायरलेस ऑन-ईयर हेडफ़ोन', 'हल्के फोल्डेबल हेडफ़ोन, 57 घंटे की बैटरी।'] } },
  { n: 10, cat: 'headphones', brand: 'Shokz', rating: 4.7, reviews: 3100, pop: 0.7, offers: [amazon(79.95, 'US'), spocket(84.0, 'DE', [3, 6])],
    t: { en: ['Shokz OpenMove Bone Conduction Sport Headphones', 'Open-ear bone conduction headphones for running and cycling; stay aware of traffic.'],
         de: ['Shokz OpenMove Knochenschall-Sportkopfhörer', 'Open-Ear-Kopfhörer zum Laufen und Radfahren.'] } },
  { n: 11, cat: 'speakers', brand: 'Oraimo', rating: 4.3, reviews: 980, pop: 0.6, offers: [jumia(24.0, 'KE'), jumia(22.5, 'NG'), cj(21.99)],
    t: { en: ['Oraimo SoundGo 3 Portable Bluetooth Speaker', 'Waterproof IPX6 speaker with 12-hour battery and deep bass.'],
         sw: ['Spika ya Bluetooth Oraimo SoundGo 3 inayobebeka', 'Spika isiyopenya maji yenye betri ya saa 12.'] } },
  { n: 12, cat: 'speakers', brand: 'JBL', rating: 4.8, reviews: 15200, pop: 0.93, offers: [amazon(99.95, 'US'), amazon(105.0, 'AE'), flipkart(92.0)],
    t: { en: ['JBL Flip 6 Portable Waterproof Speaker', 'Bold sound, IP67 waterproof and dustproof, 12 hours of playtime.'],
         ar: ['مكبر صوت JBL فليب 6 محمول ومقاوم للماء', 'صوت قوي، مقاوم للماء والغبار IP67.'] } },
  // ---- Computers
  { n: 13, cat: 'computers', brand: 'Lenovo', rating: 4.4, reviews: 2300, pop: 0.78, offers: [amazon(429.0, 'US'), flipkart(399.0), noon(449.0, 'AE')],
    t: { en: ['Lenovo IdeaPad Slim 3 Laptop, 15.6" FHD, Ryzen 5, 16GB RAM, 512GB SSD', 'Thin and light laptop for work and study with a full HD display.'],
         sw: ['Kompyuta mpakato Lenovo IdeaPad Slim 3, 15.6", RAM 16GB', 'Laptop nyepesi kwa kazi na masomo.'],
         es: ['Portátil Lenovo IdeaPad Slim 3, 15,6" FHD, Ryzen 5, 16 GB', 'Portátil ligero para trabajo y estudio.'] } },
  { n: 14, cat: 'computers', brand: 'HP', rating: 4.2, reviews: 870, pop: 0.6, offers: [jumia(389.0, 'KE'), jumia(379.0, 'NG'), amazon(349.0, 'US')],
    t: { en: ['HP 250 G9 Laptop, 15.6", Intel Core i3, 8GB RAM, 256GB SSD', 'Reliable everyday business laptop.'] } },
  { n: 15, cat: 'computers', brand: 'Logitech', rating: 4.6, reviews: 21000, pop: 0.86, offers: [amazon(24.99, 'US'), noon(27.0, 'AE'), flipkart(22.0), jumia(29.0, 'KE')],
    t: { en: ['Logitech MK270 Wireless Keyboard and Mouse Combo', 'Full-size wireless keyboard and mouse with long battery life.'],
         pt: ['Kit teclado e mouse sem fio Logitech MK270', 'Teclado completo e mouse sem fio com bateria de longa duração.'] } },
  // ---- Wearables
  { n: 16, cat: 'wearables', brand: 'Xiaomi', rating: 4.6, reviews: 9300, pop: 0.9, offers: [amazon(39.99, 'US'), flipkart(34.0), noon(41.0, 'AE'), aeaff(33.5), jumia(45.0, 'KE')],
    t: { en: ['Xiaomi Smart Band 8 Fitness Tracker', 'Fitness tracker with heart-rate, SpO2, sleep tracking and 16-day battery; great for running.'],
         zh: ['小米手环8 智能运动手环', '心率、血氧、睡眠监测，续航16天。'],
         sw: ['Saa ya mazoezi Xiaomi Smart Band 8', 'Hupima mapigo ya moyo, usingizi, betri siku 16.'] } },
  { n: 17, cat: 'wearables', brand: 'Generic', rating: 4.0, reviews: 520, pop: 0.42, offers: [cj(15.99), aeds(13.49), temu(14.5)],
    t: { en: ['Smart Watch 1.85" with Bluetooth Calling and Heart Rate', 'Budget smartwatch with calls, notifications and 100+ sport modes.'],
         es: ['Reloj inteligente 1,85" con llamadas Bluetooth', 'Smartwatch económico con más de 100 modos deportivos.'] } },
  { n: 18, cat: 'wearables', brand: 'Garmin', rating: 4.7, reviews: 4200, pop: 0.74, offers: [amazon(199.99, 'US'), amazon(215.0, 'AE')],
    t: { en: ['Garmin Forerunner 55 GPS Running Watch', 'GPS running smartwatch with daily suggested workouts and race predictor.'] } },
  // ---- Accessories
  { n: 19, cat: 'accessories', brand: 'Anker', rating: 4.7, reviews: 18400, pop: 0.94, offers: [amazon(21.99, 'US'), amazon(24.0, 'AE'), flipkart(19.5), noon(23.0, 'AE')],
    t: { en: ['Anker 20W USB-C Fast Charger', 'Compact USB-C power adapter that fast-charges phones.'],
         ar: ['شاحن أنكر سريع USB-C بقوة 20 واط', 'محول طاقة صغير للشحن السريع.'] } },
  { n: 20, cat: 'accessories', brand: 'Oraimo', rating: 4.5, reviews: 6100, pop: 0.87, offers: [jumia(14.0, 'KE'), jumia(13.2, 'NG'), cj(12.49)],
    t: { en: ['Oraimo Traveler 4 Power Bank 20000mAh, 22.5W fast charge', 'High-capacity power bank with USB-C PD and dual USB outputs.'],
         sw: ['Power bank Oraimo Traveler 4, 20000mAh, chaji ya haraka 22.5W', 'Benki ya nguvu yenye uwezo mkubwa.'] } },
  { n: 21, cat: 'accessories', brand: 'Generic', rating: 4.1, reviews: 1300, pop: 0.5, offers: [aeds(3.29), temu(3.9), cj(4.49)],
    t: { en: ['Braided USB-C to USB-C Cable 2m, 60W', 'Durable nylon braided fast-charging cable.'],
         id: ['Kabel USB-C ke USB-C 2m 60W', 'Kabel pengisian cepat berbahan nilon.'] } },
  { n: 22, cat: 'accessories', brand: 'Spigen', rating: 4.6, reviews: 9800, pop: 0.7, offers: [amazon(14.99, 'US'), noon(16.0, 'AE')],
    t: { en: ['Spigen Ultra Hybrid Clear Phone Case', 'Slim clear case with shock-absorbing bumpers.'] } },
  // ---- Kitchen
  { n: 23, cat: 'kitchen', brand: 'Ninja', rating: 4.8, reviews: 31000, pop: 0.96, offers: [amazon(89.99, 'US'), noon(99.0, 'AE')],
    t: { en: ['Ninja Air Fryer 4-Quart', 'Air fryer that crisps with up to 75% less fat; dishwasher-safe basket.'],
         ar: ['قلاية هوائية نينجا 4 كوارت', 'تقلي بدهون أقل بنسبة 75%.'] } },
  { n: 24, cat: 'kitchen', brand: 'Generic', rating: 4.2, reviews: 2700, pop: 0.66, offers: [cj(22.99, [8, 14]), aeds(19.99), jumia(28.0, 'KE'), jumia(26.0, 'NG')],
    t: { en: ['Portable Blender 600ml USB Rechargeable', 'Personal blender for smoothies and shakes, rechargeable via USB.'],
         sw: ['Blenda inayobebeka 600ml inayochajiwa kwa USB', 'Blenda ndogo ya juisi na smoothie.'],
         fr: ['Blender portable 600 ml rechargeable USB', 'Mini blender pour smoothies.'] } },
  { n: 25, cat: 'kitchen', brand: 'Ramtons', rating: 4.1, reviews: 430, pop: 0.48, offers: [jumia(39.0, 'KE')],
    t: { en: ['Ramtons Electric Kettle 1.7L Stainless Steel', 'Cordless kettle with auto shut-off.'],
         sw: ['Birika la umeme Ramtons lita 1.7', 'Birika la chuma cha pua linalojizima lenyewe.'] } },
  { n: 26, cat: 'kitchen', brand: 'Prestige', rating: 4.3, reviews: 5600, pop: 0.72, offers: [flipkart(28.0), amazon(30.5, 'IN')],
    t: { en: ['Prestige Svachh Pressure Cooker 5L', 'Aluminium pressure cooker with spillage-control lid.'],
         hi: ['प्रेस्टीज स्वच्छ प्रेशर कुकर 5 लीटर', 'स्पिलेज कंट्रोल ढक्कन वाला कुकर।'] } },
  { n: 27, cat: 'kitchen', brand: 'Generic', rating: 4.4, reviews: 880, pop: 0.52, offers: [spocket(34.0, 'US', [3, 6]), spocket(36.0, 'DE', [3, 7])],
    t: { en: ['Bamboo Cutting Board Set of 3', 'Eco-friendly bamboo boards with juice grooves.'],
         de: ['Bambus-Schneidebrett-Set, 3-teilig', 'Umweltfreundliche Schneidebretter mit Saftrille.'] } },
  // ---- Decor
  { n: 28, cat: 'decor', brand: 'Generic', rating: 4.3, reviews: 1500, pop: 0.58, offers: [cj(11.99), temu(10.5), aeds(9.99)],
    t: { en: ['LED Fairy Curtain Lights 3m x 3m, USB powered', 'Warm white curtain lights with 8 modes and remote.'],
         ar: ['ستارة إضاءة LED بطول 3 أمتار تعمل بمنفذ USB', 'إضاءة دافئة مع 8 أوضاع وجهاز تحكم.'] } },
  { n: 29, cat: 'decor', brand: 'Printful', rating: 4.6, reviews: 240, pop: 0.35, offers: [printful(24.0, 'US'), printful(26.0, 'LV', [3, 6])],
    t: { en: ['Custom Framed Poster 30x40cm', 'Museum-quality matte poster in a wooden frame, printed on demand.'] } },
  { n: 30, cat: 'decor', brand: 'Generic', rating: 4.0, reviews: 300, pop: 0.3, offers: [cj(17.5, [9, 16])],
    t: { en: ['Woven Seagrass Storage Basket Set', 'Handwoven baskets for laundry and toys.'] } },
  // ---- Clothing
  { n: 31, cat: 'clothing', brand: 'Printful', rating: 4.7, reviews: 520, pop: 0.5, offers: [printful(19.99, 'US'), printful(21.5, 'LV', [3, 6])],
    t: { en: ['Unisex Organic Cotton T-Shirt', 'Soft heavyweight organic cotton tee, printed on demand.'],
         es: ['Camiseta unisex de algodón orgánico', 'Camiseta suave de algodón orgánico.'],
         pt: ['Camiseta unissex de algodão orgânico', 'Camiseta macia de algodão orgânico.'] } },
  { n: 32, cat: 'clothing', brand: 'SHEIN', rating: 4.4, reviews: 4300, pop: 0.8, offers: [shein(14.0)],
    t: { en: ['Floral Print Wrap Midi Dress', 'Lightweight wrap dress with flutter sleeves.'],
         ar: ['فستان ميدي ملفوف بطبعة زهور', 'فستان خفيف بأكمام واسعة.'],
         fr: ['Robe midi portefeuille à imprimé floral', 'Robe légère à manches volantées.'] } },
  { n: 33, cat: 'clothing', brand: 'Generic', rating: 4.2, reviews: 1100, pop: 0.55, offers: [cj(12.99), temu(11.5), aeds(10.99)],
    t: { en: ['Quick-Dry Running T-Shirt for Men', 'Breathable moisture-wicking sports tee.'],
         sw: ['Fulana ya kukimbia inayokauka haraka kwa wanaume', 'Fulana ya michezo inayopitisha hewa.'] } },
  { n: 34, cat: 'clothing', brand: 'Generic', rating: 4.5, reviews: 690, pop: 0.47, offers: [jumia(16.0, 'KE'), jumia(15.0, 'NG'), cj(19.99)],
    t: { en: ['Ankara Print Shirt, African wax cotton', 'Short-sleeve cotton shirt in vibrant Ankara print.'],
         sw: ['Shati la kitenge Ankara, pamba', 'Shati la mikono mifupi la kitenge.'] } },
  { n: 35, cat: 'clothing', brand: 'Uniqlo', rating: 4.6, reviews: 2800, pop: 0.64, offers: [amazon(49.9, 'US')],
    t: { en: ['Ultra Light Down Jacket', 'Packable warm down jacket.'] } },
  // ---- Shoes
  { n: 36, cat: 'shoes', brand: 'Adidas', rating: 4.5, reviews: 6400, pop: 0.83, offers: [amazon(64.99, 'US'), noon(72.0, 'AE'), jumia(79.0, 'NG')],
    t: { en: ['Adidas Duramo SL Running Shoes', 'Lightweight running shoes with cushioned midsole.'],
         es: ['Zapatillas para correr Adidas Duramo SL', 'Zapatillas ligeras con amortiguación.'],
         de: ['Adidas Duramo SL Laufschuhe', 'Leichte Laufschuhe mit gedämpfter Zwischensohle.'] } },
  { n: 37, cat: 'shoes', brand: 'Generic', rating: 4.1, reviews: 2200, pop: 0.62, offers: [cj(18.99), aeds(16.5), temu(17.0)],
    t: { en: ['Breathable Mesh Running Sneakers', 'Lightweight mesh sneakers for running and gym.'],
         sw: ['Viatu vya kukimbia vyenye matundu ya hewa', 'Raba nyepesi za kukimbia na mazoezi.'],
         id: ['Sepatu lari mesh yang breathable', 'Sneakers ringan untuk lari dan gym.'] } },
  { n: 38, cat: 'shoes', brand: 'Bata', rating: 4.2, reviews: 980, pop: 0.57, offers: [jumia(32.0, 'KE'), flipkart(22.0)],
    t: { en: ['Bata Leather Formal Shoes for Men', 'Classic lace-up leather office shoes.'],
         sw: ['Viatu rasmi vya ngozi vya Bata kwa wanaume', 'Viatu vya ngozi vya ofisini.'] } },
  { n: 39, cat: 'shoes', brand: 'Crocs', rating: 4.8, reviews: 42000, pop: 0.9, offers: [amazon(44.99, 'US'), noon(49.0, 'AE'), flipkart(41.0)],
    t: { en: ['Crocs Classic Clog', 'Iconic lightweight comfortable clogs.'] } },
  // ---- Bags
  { n: 40, cat: 'bags', brand: 'Generic', rating: 4.4, reviews: 3400, pop: 0.68, offers: [cj(24.99), aeds(22.0), temu(23.5)],
    t: { en: ['Anti-Theft Laptop Backpack with USB Charging Port', 'Water-resistant 15.6" laptop backpack with hidden pockets.'],
         sw: ['Begi la mgongoni la laptop lenye mlango wa USB', 'Begi lisilopenya maji lenye mifuko ya siri.'],
         ar: ['حقيبة ظهر للابتوب مضادة للسرقة مع منفذ USB', 'حقيبة مقاومة للماء بجيوب مخفية.'] } },
  { n: 41, cat: 'bags', brand: 'SHEIN', rating: 4.3, reviews: 1900, pop: 0.6, offers: [shein(9.5)],
    t: { en: ['Minimalist Crossbody Bag', 'Small PU leather crossbody bag with adjustable strap.'] } },
  { n: 42, cat: 'bags', brand: 'Printful', rating: 4.5, reviews: 180, pop: 0.3, offers: [printful(17.0, 'US'), printful(18.5, 'LV', [3, 6])],
    t: { en: ['Custom Canvas Tote Bag', 'Heavy cotton canvas tote, printed on demand.'] } },
  // ---- Skincare / hair
  { n: 43, cat: 'skincare', brand: 'CeraVe', rating: 4.8, reviews: 52000, pop: 0.97, offers: [amazon(16.99, 'US'), noon(21.0, 'AE'), jumia(24.0, 'KE'), flipkart(18.0)],
    t: { en: ['CeraVe Moisturizing Cream 16oz', 'Daily face and body moisturizer with ceramides and hyaluronic acid.'],
         ar: ['كريم سيرافي المرطب 453 غرام', 'مرطب يومي للوجه والجسم بالسيراميد.'],
         fr: ['CeraVe Crème hydratante 454 g', 'Crème hydratante visage et corps aux céramides.'] } },
  { n: 44, cat: 'skincare', brand: 'The Ordinary', rating: 4.5, reviews: 23000, pop: 0.88, offers: [amazon(11.9, 'US'), noon(14.0, 'AE'), spocket(13.5, 'DE', [3, 6])],
    t: { en: ['The Ordinary Niacinamide 10% + Zinc 1% Serum 30ml', 'Serum for blemishes and visible pores.'],
         es: ['Sérum The Ordinary Niacinamida 10% + Zinc 1% 30 ml', 'Sérum para imperfecciones y poros.'] } },
  { n: 45, cat: 'skincare', brand: 'Nivea', rating: 4.6, reviews: 7600, pop: 0.75, offers: [jumia(6.5, 'KE'), jumia(5.9, 'NG'), jumia(6.2, 'EG'), flipkart(4.8)],
    t: { en: ['Nivea Body Lotion Cocoa Butter 400ml', 'Deep moisture lotion for dry skin.'],
         sw: ['Losheni ya mwili Nivea Cocoa Butter 400ml', 'Losheni ya kulainisha ngozi kavu.'],
         hi: ['निविया बॉडी लोशन कोको बटर 400ml', 'रूखी त्वचा के लिए लोशन।'] } },
  { n: 46, cat: 'skincare', brand: 'Generic', rating: 4.0, reviews: 610, pop: 0.38, offers: [cj(9.99), aeds(8.5)],
    t: { en: ['Vitamin C Brightening Face Serum 30ml', 'Brightening serum with vitamin C and hyaluronic acid.'],
         zh: ['维生素C 亮肤精华液 30ml', '含维C与玻尿酸，提亮肤色。'] } },
  { n: 47, cat: 'hair', brand: 'Generic', rating: 4.3, reviews: 2600, pop: 0.63, offers: [cj(29.99, [8, 14]), aeds(26.0), temu(27.5)],
    t: { en: ['Hair Dryer Brush 3-in-1 Hot Air Styler', 'One-step volumizer and dryer with ionic technology.'],
         pt: ['Escova secadora 3 em 1', 'Secador e modelador com tecnologia iônica.'] } },
  { n: 48, cat: 'hair', brand: 'Cantu', rating: 4.6, reviews: 11000, pop: 0.7, offers: [amazon(6.99, 'US'), jumia(9.5, 'NG'), jumia(10.0, 'KE')],
    t: { en: ['Cantu Shea Butter Leave-In Conditioning Cream', 'Leave-in conditioner for natural curly hair.'],
         sw: ['Krimu ya nywele Cantu Shea Butter', 'Krimu ya kulainisha nywele za asili.'] } },
  // ---- Fitness / outdoor
  { n: 49, cat: 'fitness', brand: 'Generic', rating: 4.4, reviews: 5300, pop: 0.76, offers: [cj(13.99), aeds(11.99), temu(12.5), jumia(17.0, 'KE')],
    t: { en: ['Non-Slip Yoga Mat 6mm with Carry Strap', 'Thick TPE yoga mat for home workouts.'],
         sw: ['Mkeka wa yoga usioteleza 6mm', 'Mkeka mnene wa mazoezi ya nyumbani.'],
         es: ['Esterilla de yoga antideslizante 6 mm', 'Esterilla gruesa para entrenar en casa.'] } },
  { n: 50, cat: 'fitness', brand: 'Generic', rating: 4.5, reviews: 3700, pop: 0.71, offers: [spocket(59.0, 'US', [3, 6]), cj(49.99, [10, 18])],
    t: { en: ['Adjustable Dumbbells Pair 2x10kg', 'Space-saving adjustable dumbbell set for home gym.'],
         de: ['Verstellbare Kurzhanteln, 2 x 10 kg', 'Platzsparendes Hantelset für das Home-Gym.'] } },
  { n: 51, cat: 'fitness', brand: 'Generic', rating: 4.3, reviews: 1500, pop: 0.54, offers: [aeds(7.99), temu(6.9), cj(8.5)],
    t: { en: ['Resistance Bands Set of 5', 'Latex resistance loop bands for strength training.'],
         id: ['Set resistance band isi 5', 'Karet latihan kekuatan.'] } },
  { n: 52, cat: 'outdoor', brand: 'Coleman', rating: 4.6, reviews: 8900, pop: 0.73, offers: [amazon(69.99, 'US'), noon(82.0, 'AE')],
    t: { en: ['Coleman Sundome 4-Person Camping Tent', 'Easy setup dome tent with weather-resistant WeatherTec system.'] } },
  { n: 53, cat: 'outdoor', brand: 'Generic', rating: 4.4, reviews: 4100, pop: 0.69, offers: [cj(15.99), aeds(13.99), jumia(19.0, 'KE')],
    t: { en: ['Insulated Stainless Steel Water Bottle 1L', 'Keeps drinks cold 24h, hot 12h. Leak-proof lid.'],
         sw: ['Chupa ya maji ya chuma cha pua lita 1', 'Huhifadhi baridi saa 24.'],
         zh: ['不锈钢保温水杯 1L', '保冷24小时，保温12小时，防漏。'] } },
  { n: 54, cat: 'outdoor', brand: 'Generic', rating: 4.2, reviews: 760, pop: 0.44, offers: [cj(21.99), temu(19.5)],
    t: { en: ['Solar Powered LED Camping Lantern', 'Rechargeable lantern with solar panel and power-bank function.'],
         sw: ['Taa ya kambi ya LED inayotumia jua', 'Taa inayochajiwa kwa jua, pia ni power bank.'] } },
  // ---- Toys / baby
  { n: 55, cat: 'toys', brand: 'LEGO', rating: 4.8, reviews: 14000, pop: 0.85, offers: [amazon(29.99, 'US'), noon(36.0, 'AE'), flipkart(33.0)],
    t: { en: ['LEGO Classic Medium Creative Brick Box', '484-piece building set for creative play, ages 4+.'],
         fr: ['LEGO Classic La boîte de briques créatives', 'Coffret de 484 pièces pour enfants dès 4 ans.'] } },
  { n: 56, cat: 'toys', brand: 'Generic', rating: 4.1, reviews: 1200, pop: 0.5, offers: [cj(19.99), aeds(17.5), temu(18.0)],
    t: { en: ['Remote Control Car 1:18 Off-Road 4WD', 'High-speed RC truck with rechargeable battery.'],
         ar: ['سيارة تحكم عن بعد للطرق الوعرة 1:18', 'شاحنة سريعة ببطارية قابلة للشحن.'] } },
  { n: 57, cat: 'toys', brand: 'Generic', rating: 4.5, reviews: 640, pop: 0.4, offers: [spocket(22.0, 'US', [3, 6]), spocket(23.5, 'DE', [4, 7])],
    t: { en: ['Wooden Montessori Stacking Toy', 'Natural wood rainbow stacker for toddlers.'] } },
  { n: 58, cat: 'baby', brand: 'Pampers', rating: 4.7, reviews: 19000, pop: 0.88, offers: [amazon(27.99, 'US'), jumia(21.0, 'KE'), jumia(19.5, 'NG'), noon(26.0, 'AE')],
    t: { en: ['Pampers Baby-Dry Diapers Size 4, 64 count', 'Up to 12 hours of overnight dryness.'],
         sw: ['Nepi za Pampers Baby-Dry saizi 4, vipande 64', 'Ukavu hadi saa 12 usiku.'],
         ar: ['حفاضات بامبرز بيبي دراي مقاس 4، 64 حفاضة', 'جفاف حتى 12 ساعة.'] } },
  { n: 59, cat: 'baby', brand: 'Generic', rating: 4.3, reviews: 870, pop: 0.46, offers: [cj(32.0, [9, 16]), aeds(29.5)],
    t: { en: ['Baby Carrier Ergonomic Hip Seat', 'Breathable ergonomic carrier for 0-36 months.'],
         id: ['Gendongan bayi ergonomis hip seat', 'Gendongan yang nyaman untuk 0-36 bulan.'] } },
  { n: 60, cat: 'baby', brand: 'Philips Avent', rating: 4.6, reviews: 5200, pop: 0.65, offers: [amazon(24.99, 'US'), flipkart(19.0), noon(27.0, 'AE')],
    t: { en: ['Philips Avent Natural Baby Bottle Set', 'Anti-colic baby bottles, 4-pack.'],
         hi: ['फिलिप्स एवेंट नेचुरल बेबी बोतल सेट', 'एंटी-कोलिक बेबी बोतलें, 4 का पैक।'] } },
];
