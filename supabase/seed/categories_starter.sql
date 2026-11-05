-- Seed: hand-written starter category tree (20 top-level, ~5 children each)
-- with names in all 10 Phase 1 locales.
--
-- TRANSLATIONS NEED NATIVE REVIEW before launch (see supabase/README.md).
-- shopify_taxonomy_id on top-level rows is the closest Shopify Standard
-- Product Taxonomy *vertical* (e.g. 'el' = Electronics); child rows are left
-- null until mapped by scripts/build_categories.py or by hand.
-- icon = a lucide.dev icon name (UI hint only).
--
-- Idempotent: upserts by slug. Requires 00_reference.sql (locales).

create temp table zakka_category_seed (
  slug     text primary key,
  parent   text,
  sort     integer not null,
  icon     text,
  shopify  text,
  en text not null, es text not null, fr text not null, pt text not null, ar text not null,
  zh text not null, hi text not null, sw text not null, de text not null, id text not null
);

insert into zakka_category_seed
  (slug, parent, sort, icon, shopify, en, es, fr, pt, ar, zh, hi, sw, de, id)
values
-- 1 Electronics ---------------------------------------------------------------
('electronics', null, 10, 'cpu', 'el',
  'Electronics', 'Electrónica', 'Électronique', 'Eletrônicos', 'الإلكترونيات', '电子产品', 'इलेक्ट्रॉनिक्स', 'Vifaa vya Kielektroniki', 'Elektronik', 'Elektronik'),
('mobile-phones', 'electronics', 1, null, null,
  'Mobile Phones', 'Teléfonos móviles', 'Téléphones mobiles', 'Celulares', 'الهواتف المحمولة', '手机', 'मोबाइल फ़ोन', 'Simu za Mkononi', 'Handys', 'Ponsel'),
('computers-laptops', 'electronics', 2, null, null,
  'Computers & Laptops', 'Computadoras y portátiles', 'Ordinateurs et portables', 'Computadores e notebooks', 'أجهزة الكمبيوتر واللابتوب', '电脑与笔记本', 'कंप्यूटर और लैपटॉप', 'Kompyuta na Laptopu', 'Computer & Laptops', 'Komputer & Laptop'),
('audio-headphones', 'electronics', 3, null, null,
  'Audio & Headphones', 'Audio y auriculares', 'Audio et casques', 'Áudio e fones de ouvido', 'الصوتيات وسماعات الرأس', '音频与耳机', 'ऑडियो और हेडफ़ोन', 'Sauti na Vipokea Sauti', 'Audio & Kopfhörer', 'Audio & Headphone'),
('tv-video', 'electronics', 4, null, null,
  'TV & Video', 'Televisores y video', 'TV et vidéo', 'TV e vídeo', 'التلفزيون والفيديو', '电视与影音', 'टीवी और वीडियो', 'TV na Video', 'TV & Video', 'TV & Video'),
('video-games-consoles', 'electronics', 5, null, null,
  'Video Games & Consoles', 'Videojuegos y consolas', 'Jeux vidéo et consoles', 'Videogames e consoles', 'ألعاب الفيديو وأجهزة الألعاب', '电子游戏与游戏机', 'वीडियो गेम और कंसोल', 'Michezo ya Video na Konsoli', 'Videospiele & Konsolen', 'Video Game & Konsol'),
('cameras-photo', 'electronics', 6, null, null,
  'Cameras & Photo', 'Cámaras y fotografía', 'Appareils photo', 'Câmeras e fotografia', 'الكاميرات والتصوير', '相机与摄影', 'कैमरा और फ़ोटोग्राफ़ी', 'Kamera na Upigaji Picha', 'Kameras & Foto', 'Kamera & Fotografi'),

-- 2 Women's fashion -----------------------------------------------------------
('womens-fashion', null, 20, 'shirt', 'aa',
  'Women''s Fashion', 'Moda de mujer', 'Mode femme', 'Moda feminina', 'أزياء نسائية', '女装', 'महिलाओं का फ़ैशन', 'Mitindo ya Wanawake', 'Damenmode', 'Fashion Wanita'),
('dresses', 'womens-fashion', 1, null, null,
  'Dresses', 'Vestidos', 'Robes', 'Vestidos', 'فساتين', '连衣裙', 'ड्रेस', 'Magauni', 'Kleider', 'Gaun'),
('womens-tops', 'womens-fashion', 2, null, null,
  'Tops & Blouses', 'Tops y blusas', 'Hauts et chemisiers', 'Blusas e camisetas', 'بلوزات وقمصان', '上衣与衬衫', 'टॉप और ब्लाउज़', 'Blauzi na Fulana', 'Oberteile & Blusen', 'Atasan & Blus'),
('womens-bottoms', 'womens-fashion', 3, null, null,
  'Pants & Skirts', 'Pantalones y faldas', 'Pantalons et jupes', 'Calças e saias', 'سراويل وتنانير', '裤装与半身裙', 'पैंट और स्कर्ट', 'Suruali na Sketi', 'Hosen & Röcke', 'Celana & Rok'),
('womens-outerwear', 'womens-fashion', 4, null, null,
  'Coats & Jackets', 'Abrigos y chaquetas', 'Manteaux et vestes', 'Casacos e jaquetas', 'معاطف وجاكيتات', '外套与夹克', 'कोट और जैकेट', 'Makoti na Jaketi', 'Mäntel & Jacken', 'Mantel & Jaket'),
('lingerie-sleepwear', 'womens-fashion', 5, null, null,
  'Lingerie & Sleepwear', 'Lencería y ropa de dormir', 'Lingerie et vêtements de nuit', 'Lingerie e pijamas', 'ملابس داخلية وملابس نوم', '内衣与睡衣', 'लॉन्जरी और नाइटवियर', 'Nguo za Ndani na za Kulalia', 'Dessous & Nachtwäsche', 'Pakaian Dalam & Baju Tidur'),
('modest-wear', 'womens-fashion', 6, null, null,
  'Modest Wear', 'Moda modesta', 'Mode modeste', 'Moda modesta', 'أزياء محتشمة', '端庄服饰', 'मॉडेस्ट वियर', 'Mavazi ya Staha', 'Modest Fashion', 'Busana Muslim'),

-- 3 Men's fashion -------------------------------------------------------------
('mens-fashion', null, 30, 'shirt', 'aa',
  'Men''s Fashion', 'Moda de hombre', 'Mode homme', 'Moda masculina', 'أزياء رجالية', '男装', 'पुरुषों का फ़ैशन', 'Mitindo ya Wanaume', 'Herrenmode', 'Fashion Pria'),
('mens-tshirts-polos', 'mens-fashion', 1, null, null,
  'T-Shirts & Polos', 'Camisetas y polos', 'T-shirts et polos', 'Camisetas e polos', 'تيشيرتات وبولو', 'T恤与Polo衫', 'टी-शर्ट और पोलो', 'Fulana na Polo', 'T-Shirts & Poloshirts', 'Kaos & Polo'),
('mens-shirts', 'mens-fashion', 2, null, null,
  'Shirts', 'Camisas', 'Chemises', 'Camisas', 'قمصان', '衬衫', 'शर्ट', 'Mashati', 'Hemden', 'Kemeja'),
('mens-pants-jeans', 'mens-fashion', 3, null, null,
  'Pants & Jeans', 'Pantalones y jeans', 'Pantalons et jeans', 'Calças e jeans', 'سراويل وجينز', '裤子与牛仔裤', 'पैंट और जींस', 'Suruali na Jinzi', 'Hosen & Jeans', 'Celana & Jeans'),
('mens-outerwear', 'mens-fashion', 4, null, null,
  'Jackets & Coats', 'Chaquetas y abrigos', 'Vestes et manteaux', 'Jaquetas e casacos', 'جاكيتات ومعاطف', '夹克与外套', 'जैकेट और कोट', 'Jaketi na Makoti', 'Jacken & Mäntel', 'Jaket & Mantel'),
('mens-underwear-socks', 'mens-fashion', 5, null, null,
  'Underwear & Socks', 'Ropa interior y calcetines', 'Sous-vêtements et chaussettes', 'Cuecas e meias', 'ملابس داخلية وجوارب', '内衣与袜子', 'अंडरवियर और मोज़े', 'Nguo za Ndani na Soksi', 'Unterwäsche & Socken', 'Pakaian Dalam & Kaus Kaki'),

-- 4 Shoes ---------------------------------------------------------------------
('shoes', null, 40, 'footprints', 'aa',
  'Shoes', 'Zapatos', 'Chaussures', 'Calçados', 'أحذية', '鞋靴', 'जूते', 'Viatu', 'Schuhe', 'Sepatu'),
('womens-shoes', 'shoes', 1, null, null,
  'Women''s Shoes', 'Zapatos de mujer', 'Chaussures femme', 'Calçados femininos', 'أحذية نسائية', '女鞋', 'महिलाओं के जूते', 'Viatu vya Wanawake', 'Damenschuhe', 'Sepatu Wanita'),
('mens-shoes', 'shoes', 2, null, null,
  'Men''s Shoes', 'Zapatos de hombre', 'Chaussures homme', 'Calçados masculinos', 'أحذية رجالية', '男鞋', 'पुरुषों के जूते', 'Viatu vya Wanaume', 'Herrenschuhe', 'Sepatu Pria'),
('kids-shoes', 'shoes', 3, null, null,
  'Kids'' Shoes', 'Zapatos infantiles', 'Chaussures enfant', 'Calçados infantis', 'أحذية أطفال', '童鞋', 'बच्चों के जूते', 'Viatu vya Watoto', 'Kinderschuhe', 'Sepatu Anak'),
('sneakers', 'shoes', 4, null, null,
  'Sneakers', 'Zapatillas', 'Baskets', 'Tênis', 'أحذية رياضية', '运动鞋', 'स्नीकर्स', 'Raba', 'Sneaker', 'Sneakers'),
('sandals-slippers', 'shoes', 5, null, null,
  'Sandals & Slippers', 'Sandalias y pantuflas', 'Sandales et chaussons', 'Sandálias e chinelos', 'صنادل وشباشب', '凉鞋与拖鞋', 'सैंडल और चप्पल', 'Sandali na Malapa', 'Sandalen & Hausschuhe', 'Sandal & Selop'),

-- 5 Jewelry & watches ---------------------------------------------------------
('jewelry-watches', null, 50, 'gem', 'aa',
  'Jewelry & Watches', 'Joyería y relojes', 'Bijoux et montres', 'Joias e relógios', 'المجوهرات والساعات', '珠宝与手表', 'आभूषण और घड़ियाँ', 'Vito na Saa', 'Schmuck & Uhren', 'Perhiasan & Jam Tangan'),
('necklaces', 'jewelry-watches', 1, null, null,
  'Necklaces', 'Collares', 'Colliers', 'Colares', 'قلادات', '项链', 'हार', 'Mikufu', 'Halsketten', 'Kalung'),
('rings', 'jewelry-watches', 2, null, null,
  'Rings', 'Anillos', 'Bagues', 'Anéis', 'خواتم', '戒指', 'अंगूठियाँ', 'Pete', 'Ringe', 'Cincin'),
('earrings', 'jewelry-watches', 3, null, null,
  'Earrings', 'Aretes', 'Boucles d''oreilles', 'Brincos', 'أقراط', '耳环', 'झुमके और बालियाँ', 'Hereni', 'Ohrringe', 'Anting'),
('bracelets', 'jewelry-watches', 4, null, null,
  'Bracelets', 'Pulseras', 'Bracelets', 'Pulseiras', 'أساور', '手链', 'कंगन और ब्रेसलेट', 'Bangili', 'Armbänder', 'Gelang'),
('watches', 'jewelry-watches', 5, null, null,
  'Watches', 'Relojes', 'Montres', 'Relógios', 'ساعات', '手表', 'घड़ियाँ', 'Saa za Mkononi', 'Uhren', 'Jam Tangan'),

-- 6 Bags & luggage ------------------------------------------------------------
('bags-luggage', null, 60, 'luggage', 'lb',
  'Bags & Luggage', 'Bolsos y equipaje', 'Sacs et bagages', 'Bolsas e malas', 'الحقائب والأمتعة', '箱包', 'बैग और सामान', 'Mikoba na Mizigo', 'Taschen & Gepäck', 'Tas & Koper'),
('handbags', 'bags-luggage', 1, null, null,
  'Handbags', 'Bolsos de mano', 'Sacs à main', 'Bolsas femininas', 'حقائب يد', '手提包', 'हैंडबैग', 'Mikoba ya Mkono', 'Handtaschen', 'Tas Tangan'),
('backpacks', 'bags-luggage', 2, null, null,
  'Backpacks', 'Mochilas', 'Sacs à dos', 'Mochilas', 'حقائب ظهر', '双肩包', 'बैकपैक', 'Mabegi ya Mgongoni', 'Rucksäcke', 'Ransel'),
('suitcases', 'bags-luggage', 3, null, null,
  'Suitcases', 'Maletas', 'Valises', 'Malas de viagem', 'حقائب سفر', '行李箱', 'सूटकेस', 'Masanduku ya Safari', 'Koffer', 'Koper'),
('wallets', 'bags-luggage', 4, null, null,
  'Wallets', 'Carteras', 'Portefeuilles', 'Carteiras', 'محافظ', '钱包', 'बटुए', 'Pochi', 'Geldbörsen', 'Dompet'),
('travel-accessories', 'bags-luggage', 5, null, null,
  'Travel Accessories', 'Accesorios de viaje', 'Accessoires de voyage', 'Acessórios de viagem', 'إكسسوارات السفر', '旅行配件', 'यात्रा सहायक सामान', 'Vifaa vya Safari', 'Reisezubehör', 'Aksesori Perjalanan'),

-- 7 Beauty --------------------------------------------------------------------
('beauty', null, 70, 'sparkles', 'hb',
  'Beauty', 'Belleza', 'Beauté', 'Beleza', 'التجميل', '美妆', 'सौंदर्य', 'Urembo', 'Beauty & Kosmetik', 'Kecantikan'),
('makeup', 'beauty', 1, null, null,
  'Makeup', 'Maquillaje', 'Maquillage', 'Maquiagem', 'مكياج', '彩妆', 'मेकअप', 'Vipodozi', 'Make-up', 'Makeup'),
('skincare', 'beauty', 2, null, null,
  'Skincare', 'Cuidado de la piel', 'Soins de la peau', 'Cuidados com a pele', 'العناية بالبشرة', '护肤', 'त्वचा की देखभाल', 'Utunzaji wa Ngozi', 'Hautpflege', 'Perawatan Kulit'),
('haircare', 'beauty', 3, null, null,
  'Hair Care', 'Cuidado del cabello', 'Soins des cheveux', 'Cuidados com o cabelo', 'العناية بالشعر', '护发', 'बालों की देखभाल', 'Utunzaji wa Nywele', 'Haarpflege', 'Perawatan Rambut'),
('fragrances', 'beauty', 4, null, null,
  'Fragrances', 'Fragancias', 'Parfums', 'Perfumes', 'العطور', '香水', 'सुगंध और परफ़्यूम', 'Manukato', 'Düfte', 'Parfum'),
('nail-care', 'beauty', 5, null, null,
  'Nail Care', 'Cuidado de uñas', 'Soins des ongles', 'Cuidados com as unhas', 'العناية بالأظافر', '美甲', 'नाखूनों की देखभाल', 'Utunzaji wa Kucha', 'Nagelpflege', 'Perawatan Kuku'),

-- 8 Health & personal care ----------------------------------------------------
('health-personal-care', null, 80, 'heart-pulse', 'hb',
  'Health & Personal Care', 'Salud y cuidado personal', 'Santé et soins personnels', 'Saúde e cuidados pessoais', 'الصحة والعناية الشخصية', '健康与个人护理', 'स्वास्थ्य और व्यक्तिगत देखभाल', 'Afya na Usafi Binafsi', 'Gesundheit & Körperpflege', 'Kesehatan & Perawatan Diri'),
('vitamins-supplements', 'health-personal-care', 1, null, null,
  'Vitamins & Supplements', 'Vitaminas y suplementos', 'Vitamines et compléments', 'Vitaminas e suplementos', 'فيتامينات ومكملات غذائية', '维生素与膳食补充剂', 'विटामिन और सप्लीमेंट', 'Vitamini na Virutubisho', 'Vitamine & Nahrungsergänzung', 'Vitamin & Suplemen'),
('oral-care', 'health-personal-care', 2, null, null,
  'Oral Care', 'Cuidado bucal', 'Hygiène bucco-dentaire', 'Higiene bucal', 'العناية بالفم والأسنان', '口腔护理', 'मुँह की देखभाल', 'Utunzaji wa Kinywa', 'Mundpflege', 'Perawatan Mulut'),
('shaving-grooming', 'health-personal-care', 3, null, null,
  'Shaving & Grooming', 'Afeitado y aseo', 'Rasage et soins', 'Barbear e depilação', 'الحلاقة والعناية', '剃须与理容', 'शेविंग और ग्रूमिंग', 'Kunyoa na Kujipamba', 'Rasur & Pflege', 'Cukur & Perawatan'),
('first-aid', 'health-personal-care', 4, null, null,
  'First Aid', 'Primeros auxilios', 'Premiers secours', 'Primeiros socorros', 'الإسعافات الأولية', '急救用品', 'प्राथमिक चिकित्सा', 'Huduma ya Kwanza', 'Erste Hilfe', 'Pertolongan Pertama'),
('massage-relaxation', 'health-personal-care', 5, null, null,
  'Massage & Relaxation', 'Masajes y relajación', 'Massage et relaxation', 'Massagem e relaxamento', 'التدليك والاسترخاء', '按摩与放松', 'मसाज और आराम', 'Masaji na Mapumziko', 'Massage & Entspannung', 'Pijat & Relaksasi'),

-- 9 Home & kitchen ------------------------------------------------------------
('home-kitchen', null, 90, 'cooking-pot', 'hg',
  'Home & Kitchen', 'Hogar y cocina', 'Maison et cuisine', 'Casa e cozinha', 'المنزل والمطبخ', '家居与厨房', 'घर और रसोई', 'Nyumbani na Jikoni', 'Haus & Küche', 'Rumah & Dapur'),
('cookware', 'home-kitchen', 1, null, null,
  'Cookware', 'Ollas y sartenes', 'Ustensiles de cuisson', 'Panelas e frigideiras', 'أواني الطهي', '锅具', 'खाना पकाने के बर्तन', 'Vyombo vya Kupikia', 'Kochgeschirr', 'Peralatan Masak'),
('kitchen-appliances', 'home-kitchen', 2, null, null,
  'Kitchen Appliances', 'Electrodomésticos de cocina', 'Appareils de cuisine', 'Eletrodomésticos de cozinha', 'أجهزة المطبخ', '厨房电器', 'रसोई उपकरण', 'Vifaa vya Umeme vya Jikoni', 'Küchengeräte', 'Alat Elektronik Dapur'),
('tableware', 'home-kitchen', 3, null, null,
  'Tableware', 'Vajilla', 'Arts de la table', 'Utensílios de mesa', 'أدوات المائدة', '餐具', 'टेबलवेयर', 'Vyombo vya Mezani', 'Geschirr & Besteck', 'Peralatan Makan'),
('food-storage', 'home-kitchen', 4, null, null,
  'Food Storage', 'Almacenamiento de alimentos', 'Conservation des aliments', 'Armazenamento de alimentos', 'حفظ الطعام', '食品收纳', 'खाद्य भंडारण', 'Hifadhi ya Chakula', 'Lebensmittelaufbewahrung', 'Wadah Penyimpanan Makanan'),
('coffee-tea', 'home-kitchen', 5, null, null,
  'Coffee & Tea', 'Café y té', 'Café et thé', 'Café e chá', 'القهوة والشاي', '咖啡与茶具', 'कॉफ़ी और चाय', 'Kahawa na Chai', 'Kaffee & Tee', 'Kopi & Teh'),

-- 10 Home decor ---------------------------------------------------------------
('home-decor', null, 100, 'lamp', 'hg',
  'Home Decor', 'Decoración del hogar', 'Décoration intérieure', 'Decoração', 'ديكور المنزل', '家居装饰', 'घर की सजावट', 'Mapambo ya Nyumbani', 'Wohndeko', 'Dekorasi Rumah'),
('wall-art', 'home-decor', 1, null, null,
  'Wall Art', 'Cuadros y arte mural', 'Décoration murale', 'Quadros e arte de parede', 'لوحات جدارية', '墙面装饰', 'दीवार सजावट', 'Mapambo ya Ukutani', 'Wandbilder', 'Hiasan Dinding'),
('lighting', 'home-decor', 2, null, null,
  'Lighting', 'Iluminación', 'Luminaires', 'Iluminação', 'الإضاءة', '灯具照明', 'लाइटिंग', 'Taa', 'Beleuchtung', 'Lampu & Pencahayaan'),
('rugs-carpets', 'home-decor', 3, null, null,
  'Rugs & Carpets', 'Alfombras', 'Tapis', 'Tapetes', 'سجاد وموكيت', '地毯', 'दरी और कालीन', 'Mazulia', 'Teppiche', 'Karpet'),
('curtains-blinds', 'home-decor', 4, null, null,
  'Curtains & Blinds', 'Cortinas y persianas', 'Rideaux et stores', 'Cortinas e persianas', 'ستائر', '窗帘与百叶窗', 'पर्दे और ब्लाइंड्स', 'Mapazia', 'Vorhänge & Jalousien', 'Gorden & Kerai'),
('candles-home-fragrance', 'home-decor', 5, null, null,
  'Candles & Home Fragrance', 'Velas y aromas para el hogar', 'Bougies et parfums d''intérieur', 'Velas e aromatizadores', 'شموع ومعطرات منزلية', '蜡烛与家居香氛', 'मोमबत्तियाँ और होम फ़्रेगरेंस', 'Mishumaa na Manukato ya Nyumbani', 'Kerzen & Raumdüfte', 'Lilin & Pengharum Ruangan'),

-- 11 Furniture ----------------------------------------------------------------
('furniture', null, 110, 'sofa', 'fr',
  'Furniture', 'Muebles', 'Meubles', 'Móveis', 'الأثاث', '家具', 'फ़र्नीचर', 'Samani', 'Möbel', 'Furnitur'),
('living-room-furniture', 'furniture', 1, null, null,
  'Living Room', 'Sala de estar', 'Salon', 'Sala de estar', 'غرفة المعيشة', '客厅家具', 'लिविंग रूम', 'Sebule', 'Wohnzimmer', 'Ruang Tamu'),
('bedroom-furniture', 'furniture', 2, null, null,
  'Bedroom', 'Dormitorio', 'Chambre', 'Quarto', 'غرفة النوم', '卧室家具', 'बेडरूम', 'Chumba cha Kulala', 'Schlafzimmer', 'Kamar Tidur'),
('office-furniture', 'furniture', 3, null, null,
  'Office Furniture', 'Muebles de oficina', 'Mobilier de bureau', 'Móveis de escritório', 'أثاث مكتبي', '办公家具', 'ऑफ़िस फ़र्नीचर', 'Samani za Ofisi', 'Büromöbel', 'Furnitur Kantor'),
('outdoor-furniture', 'furniture', 4, null, null,
  'Outdoor Furniture', 'Muebles de exterior', 'Mobilier d''extérieur', 'Móveis para área externa', 'أثاث خارجي', '户外家具', 'आउटडोर फ़र्नीचर', 'Samani za Nje', 'Gartenmöbel', 'Furnitur Luar Ruangan'),
('storage-organization', 'furniture', 5, null, null,
  'Storage & Organization', 'Almacenaje y organización', 'Rangement et organisation', 'Organização e armazenamento', 'التخزين والتنظيم', '收纳整理', 'भंडारण और व्यवस्था', 'Uhifadhi na Mpangilio', 'Aufbewahrung & Ordnung', 'Penyimpanan & Organizer'),

-- 12 Home appliances ----------------------------------------------------------
('home-appliances', null, 120, 'washing-machine', 'hg',
  'Home Appliances', 'Electrodomésticos', 'Électroménager', 'Eletrodomésticos', 'الأجهزة المنزلية', '家用电器', 'घरेलू उपकरण', 'Vifaa vya Nyumbani', 'Haushaltsgeräte', 'Peralatan Rumah Tangga'),
('vacuum-cleaners', 'home-appliances', 1, null, null,
  'Vacuum Cleaners', 'Aspiradoras', 'Aspirateurs', 'Aspiradores de pó', 'مكانس كهربائية', '吸尘器', 'वैक्यूम क्लीनर', 'Visafishaji vya Vumbi', 'Staubsauger', 'Penyedot Debu'),
('fans-air-conditioners', 'home-appliances', 2, null, null,
  'Fans & Air Conditioners', 'Ventiladores y aires acondicionados', 'Ventilateurs et climatiseurs', 'Ventiladores e ar-condicionado', 'مراوح ومكيفات', '风扇与空调', 'पंखे और एयर कंडीशनर', 'Feni na Viyoyozi', 'Ventilatoren & Klimageräte', 'Kipas Angin & AC'),
('air-purifiers-humidifiers', 'home-appliances', 3, null, null,
  'Air Purifiers & Humidifiers', 'Purificadores y humidificadores', 'Purificateurs et humidificateurs', 'Purificadores e umidificadores', 'منقيات الهواء وأجهزة الترطيب', '空气净化器与加湿器', 'एयर प्यूरीफ़ायर और ह्यूमिडिफ़ायर', 'Visafisha Hewa na Vinyevushaji', 'Luftreiniger & Luftbefeuchter', 'Pemurni Udara & Humidifier'),
('laundry-appliances', 'home-appliances', 4, null, null,
  'Washing & Drying', 'Lavado y secado', 'Lavage et séchage', 'Lavar e secar', 'أجهزة الغسيل والتجفيف', '洗衣设备', 'कपड़े धोने के उपकरण', 'Vifaa vya Kufulia', 'Waschen & Trocknen', 'Mesin Cuci & Pengering'),
('irons-steamers', 'home-appliances', 5, null, null,
  'Irons & Steamers', 'Planchas y vaporizadores', 'Fers et défroisseurs', 'Ferros e vaporizadores', 'مكاوي وأجهزة البخار', '熨斗与挂烫机', 'इस्त्री और स्टीमर', 'Pasi za Nguo', 'Bügeleisen & Dampfglätter', 'Setrika & Steamer'),

-- 13 Baby & kids --------------------------------------------------------------
('baby-kids', null, 130, 'baby', 'bt',
  'Baby & Kids', 'Bebés y niños', 'Bébé et enfant', 'Bebês e crianças', 'الرضع والأطفال', '母婴用品', 'शिशु और बच्चे', 'Watoto Wachanga na Watoto', 'Baby & Kind', 'Bayi & Anak'),
('baby-clothing', 'baby-kids', 1, null, null,
  'Baby Clothing', 'Ropa de bebé', 'Vêtements bébé', 'Roupas de bebê', 'ملابس الرضع', '婴儿服装', 'शिशु के कपड़े', 'Nguo za Watoto Wachanga', 'Babykleidung', 'Pakaian Bayi'),
('kids-clothing', 'baby-kids', 2, null, null,
  'Kids'' Clothing', 'Ropa infantil', 'Vêtements enfant', 'Roupas infantis', 'ملابس الأطفال', '童装', 'बच्चों के कपड़े', 'Nguo za Watoto', 'Kinderkleidung', 'Pakaian Anak'),
('diapering', 'baby-kids', 3, null, null,
  'Diapers & Changing', 'Pañales y cambiadores', 'Couches et change', 'Fraldas e trocadores', 'الحفاضات ومستلزمات التغيير', '尿布与护理', 'डायपर', 'Nepi', 'Windeln & Wickeln', 'Popok & Perlengkapan Ganti'),
('baby-feeding', 'baby-kids', 4, null, null,
  'Feeding', 'Alimentación', 'Repas et allaitement', 'Alimentação', 'التغذية والرضاعة', '喂养用品', 'दूध पिलाना और आहार', 'Ulishaji', 'Füttern & Stillen', 'Perlengkapan Makan Bayi'),
('strollers-car-seats', 'baby-kids', 5, null, null,
  'Strollers & Car Seats', 'Cochecitos y sillas de auto', 'Poussettes et sièges auto', 'Carrinhos e cadeirinhas', 'عربات الأطفال ومقاعد السيارة', '婴儿车与安全座椅', 'स्ट्रॉलर और कार सीट', 'Vigari vya Watoto na Viti vya Gari', 'Kinderwagen & Autositze', 'Stroller & Kursi Mobil'),

-- 14 Toys & games -------------------------------------------------------------
('toys-games', null, 140, 'puzzle', 'tg',
  'Toys & Games', 'Juguetes y juegos', 'Jouets et jeux', 'Brinquedos e jogos', 'الألعاب', '玩具与游戏', 'खिलौने और खेल', 'Vitu vya Kuchezea na Michezo', 'Spielzeug & Spiele', 'Mainan & Permainan'),
('building-toys', 'toys-games', 1, null, null,
  'Building Toys', 'Juguetes de construcción', 'Jeux de construction', 'Brinquedos de montar', 'ألعاب التركيب والبناء', '积木拼搭', 'बिल्डिंग खिलौने', 'Michezo ya Kujenga', 'Bauspielzeug', 'Mainan Konstruksi'),
('dolls-action-figures', 'toys-games', 2, null, null,
  'Dolls & Action Figures', 'Muñecas y figuras de acción', 'Poupées et figurines', 'Bonecas e bonecos de ação', 'دمى وشخصيات حركية', '娃娃与人偶', 'गुड़िया और एक्शन फ़िगर', 'Wanasesere na Vinyago', 'Puppen & Actionfiguren', 'Boneka & Figur Aksi'),
('board-games-puzzles', 'toys-games', 3, null, null,
  'Board Games & Puzzles', 'Juegos de mesa y rompecabezas', 'Jeux de société et puzzles', 'Jogos de tabuleiro e quebra-cabeças', 'ألعاب الطاولة والألغاز', '桌游与拼图', 'बोर्ड गेम और पहेलियाँ', 'Michezo ya Bao na Mafumbo', 'Brettspiele & Puzzles', 'Board Game & Puzzle'),
('outdoor-play', 'toys-games', 4, null, null,
  'Outdoor Play', 'Juegos al aire libre', 'Jeux d''extérieur', 'Brinquedos ao ar livre', 'ألعاب خارجية', '户外玩具', 'आउटडोर खेल', 'Michezo ya Nje', 'Spielzeug für draußen', 'Mainan Luar Ruangan'),
('educational-toys', 'toys-games', 5, null, null,
  'Educational Toys', 'Juguetes educativos', 'Jouets éducatifs', 'Brinquedos educativos', 'ألعاب تعليمية', '益智玩具', 'शैक्षिक खिलौने', 'Vitu vya Kuchezea vya Kielimu', 'Lernspielzeug', 'Mainan Edukasi'),

-- 15 Sports & outdoors --------------------------------------------------------
('sports-outdoors', null, 150, 'dumbbell', 'sg',
  'Sports & Outdoors', 'Deportes y aire libre', 'Sports et plein air', 'Esportes e atividades ao ar livre', 'الرياضة والأنشطة الخارجية', '运动户外', 'खेल और आउटडोर', 'Michezo na Shughuli za Nje', 'Sport & Outdoor', 'Olahraga & Outdoor'),
('fitness-equipment', 'sports-outdoors', 1, null, null,
  'Fitness Equipment', 'Equipos de fitness', 'Équipement de fitness', 'Equipamentos fitness', 'معدات اللياقة البدنية', '健身器材', 'फ़िटनेस उपकरण', 'Vifaa vya Mazoezi', 'Fitnessgeräte', 'Alat Kebugaran'),
('cycling', 'sports-outdoors', 2, null, null,
  'Cycling', 'Ciclismo', 'Cyclisme', 'Ciclismo', 'ركوب الدراجات', '骑行', 'साइकिलिंग', 'Baiskeli', 'Radsport', 'Bersepeda'),
('camping-hiking', 'sports-outdoors', 3, null, null,
  'Camping & Hiking', 'Camping y senderismo', 'Camping et randonnée', 'Camping e trilhas', 'التخييم والرحلات', '露营与徒步', 'कैंपिंग और हाइकिंग', 'Kambi na Matembezi', 'Camping & Wandern', 'Berkemah & Mendaki'),
('team-sports', 'sports-outdoors', 4, null, null,
  'Team Sports', 'Deportes de equipo', 'Sports collectifs', 'Esportes coletivos', 'الرياضات الجماعية', '团队运动', 'टीम खेल', 'Michezo ya Timu', 'Mannschaftssport', 'Olahraga Tim'),
('sportswear', 'sports-outdoors', 5, null, null,
  'Sportswear', 'Ropa deportiva', 'Vêtements de sport', 'Roupas esportivas', 'ملابس رياضية', '运动服饰', 'स्पोर्ट्सवियर', 'Mavazi ya Michezo', 'Sportbekleidung', 'Pakaian Olahraga'),

-- 16 Automotive ---------------------------------------------------------------
('automotive', null, 160, 'car', 'vp',
  'Automotive', 'Automotriz', 'Auto et moto', 'Automotivo', 'السيارات', '汽车用品', 'ऑटोमोटिव', 'Magari', 'Auto & Motorrad', 'Otomotif'),
('car-electronics', 'automotive', 1, null, null,
  'Car Electronics', 'Electrónica para auto', 'Électronique auto', 'Eletrônicos automotivos', 'إلكترونيات السيارات', '车载电子', 'कार इलेक्ट्रॉनिक्स', 'Vifaa vya Kielektroniki vya Gari', 'Autoelektronik', 'Elektronik Mobil'),
('car-care', 'automotive', 2, null, null,
  'Car Care', 'Cuidado del auto', 'Entretien auto', 'Cuidados automotivos', 'العناية بالسيارة', '汽车护理', 'कार की देखभाल', 'Utunzaji wa Gari', 'Autopflege', 'Perawatan Mobil'),
('car-interior-accessories', 'automotive', 3, null, null,
  'Interior Accessories', 'Accesorios interiores', 'Accessoires intérieur', 'Acessórios internos', 'إكسسوارات داخلية للسيارة', '汽车内饰', 'इंटीरियर एक्सेसरीज़', 'Vifaa vya Ndani ya Gari', 'Innenraumzubehör', 'Aksesori Interior'),
('car-tools-equipment', 'automotive', 4, null, null,
  'Tools & Equipment', 'Herramientas y equipos', 'Outils et équipement', 'Ferramentas e equipamentos', 'أدوات ومعدات', '汽车工具与设备', 'औज़ार और उपकरण', 'Zana na Vifaa', 'Werkzeug & Ausrüstung', 'Peralatan & Perkakas'),
('motorcycle-accessories', 'automotive', 5, null, null,
  'Motorcycle Accessories', 'Accesorios para moto', 'Accessoires moto', 'Acessórios para moto', 'إكسسوارات الدراجات النارية', '摩托车配件', 'मोटरसाइकिल एक्सेसरीज़', 'Vifaa vya Pikipiki', 'Motorradzubehör', 'Aksesori Motor'),

-- 17 Tools & home improvement -------------------------------------------------
('tools-home-improvement', null, 170, 'wrench', 'ha',
  'Tools & Home Improvement', 'Herramientas y bricolaje', 'Bricolage et outillage', 'Ferramentas e construção', 'الأدوات وتحسين المنزل', '工具与家装', 'औज़ार और घर सुधार', 'Zana na Ukarabati wa Nyumba', 'Werkzeug & Heimwerken', 'Perkakas & Renovasi Rumah'),
('power-tools', 'tools-home-improvement', 1, null, null,
  'Power Tools', 'Herramientas eléctricas', 'Outils électriques', 'Ferramentas elétricas', 'أدوات كهربائية', '电动工具', 'पावर टूल्स', 'Zana za Umeme', 'Elektrowerkzeuge', 'Perkakas Listrik'),
('hand-tools', 'tools-home-improvement', 2, null, null,
  'Hand Tools', 'Herramientas manuales', 'Outils à main', 'Ferramentas manuais', 'أدوات يدوية', '手动工具', 'हाथ के औज़ार', 'Zana za Mkono', 'Handwerkzeuge', 'Perkakas Tangan'),
('electrical', 'tools-home-improvement', 3, null, null,
  'Electrical', 'Material eléctrico', 'Électricité', 'Material elétrico', 'مستلزمات كهربائية', '电工电料', 'बिजली का सामान', 'Vifaa vya Umeme', 'Elektroinstallation', 'Kelistrikan'),
('plumbing', 'tools-home-improvement', 4, null, null,
  'Plumbing', 'Plomería', 'Plomberie', 'Material hidráulico', 'السباكة', '水暖管件', 'प्लंबिंग', 'Mabomba', 'Sanitär', 'Perpipaan'),
('smart-home-security', 'tools-home-improvement', 5, null, null,
  'Smart Home & Security', 'Hogar inteligente y seguridad', 'Maison connectée et sécurité', 'Casa inteligente e segurança', 'المنزل الذكي والأمان', '智能家居与安防', 'स्मार्ट होम और सुरक्षा', 'Nyumba Janja na Usalama', 'Smart Home & Sicherheit', 'Rumah Pintar & Keamanan'),

-- 18 Garden & outdoor ---------------------------------------------------------
('garden-outdoor', null, 180, 'sprout', 'hg',
  'Garden & Outdoor', 'Jardín y exterior', 'Jardin et extérieur', 'Jardim e área externa', 'الحديقة والمساحات الخارجية', '园艺与户外', 'बगीचा और आउटडोर', 'Bustani na Nje', 'Garten & Outdoor', 'Taman & Luar Ruangan'),
('gardening-tools', 'garden-outdoor', 1, null, null,
  'Gardening Tools', 'Herramientas de jardinería', 'Outils de jardinage', 'Ferramentas de jardinagem', 'أدوات البستنة', '园艺工具', 'बागवानी औज़ार', 'Zana za Bustani', 'Gartenwerkzeuge', 'Alat Berkebun'),
('plants-seeds', 'garden-outdoor', 2, null, null,
  'Plants & Seeds', 'Plantas y semillas', 'Plantes et graines', 'Plantas e sementes', 'نباتات وبذور', '植物与种子', 'पौधे और बीज', 'Mimea na Mbegu', 'Pflanzen & Samen', 'Tanaman & Benih'),
('outdoor-lighting', 'garden-outdoor', 3, null, null,
  'Outdoor Lighting', 'Iluminación exterior', 'Éclairage extérieur', 'Iluminação externa', 'إضاءة خارجية', '户外照明', 'आउटडोर लाइटिंग', 'Taa za Nje', 'Außenbeleuchtung', 'Lampu Luar Ruangan'),
('bbq-grilling', 'garden-outdoor', 4, null, null,
  'BBQ & Grilling', 'Barbacoa y parrillas', 'Barbecue et grillades', 'Churrasco e grelhados', 'الشواء', '烧烤', 'बारबेक्यू और ग्रिलिंग', 'Vifaa vya Kuchoma Nyama', 'Grillen', 'BBQ & Panggangan'),
('pools-water-play', 'garden-outdoor', 5, null, null,
  'Pools & Water Play', 'Piscinas y juegos de agua', 'Piscines et jeux d''eau', 'Piscinas e diversão aquática', 'المسابح وألعاب الماء', '泳池与戏水', 'पूल और पानी के खेल', 'Mabwawa na Michezo ya Maji', 'Pools & Wasserspaß', 'Kolam & Mainan Air'),

-- 19 Pet supplies -------------------------------------------------------------
('pet-supplies', null, 190, 'paw-print', 'ap',
  'Pet Supplies', 'Mascotas', 'Animalerie', 'Produtos para pets', 'مستلزمات الحيوانات الأليفة', '宠物用品', 'पालतू जानवरों का सामान', 'Mahitaji ya Wanyama Vipenzi', 'Heimtierbedarf', 'Perlengkapan Hewan Peliharaan'),
('dog-supplies', 'pet-supplies', 1, null, null,
  'Dogs', 'Perros', 'Chiens', 'Cães', 'الكلاب', '狗狗用品', 'कुत्ते', 'Mbwa', 'Hunde', 'Anjing'),
('cat-supplies', 'pet-supplies', 2, null, null,
  'Cats', 'Gatos', 'Chats', 'Gatos', 'القطط', '猫咪用品', 'बिल्लियाँ', 'Paka', 'Katzen', 'Kucing'),
('pet-food-treats', 'pet-supplies', 3, null, null,
  'Pet Food & Treats', 'Comida y premios para mascotas', 'Nourriture et friandises', 'Ração e petiscos', 'طعام ومكافآت الحيوانات الأليفة', '宠物食品与零食', 'पालतू भोजन और ट्रीट', 'Chakula cha Wanyama Vipenzi', 'Tierfutter & Leckerlis', 'Makanan & Camilan Hewan'),
('aquarium-fish', 'pet-supplies', 4, null, null,
  'Fish & Aquariums', 'Peces y acuarios', 'Poissons et aquariums', 'Peixes e aquários', 'الأسماك وأحواض السمك', '水族用品', 'मछली और एक्वेरियम', 'Samaki na Akwaria', 'Aquaristik', 'Ikan & Akuarium'),
('birds-small-animals', 'pet-supplies', 5, null, null,
  'Birds & Small Animals', 'Aves y pequeños animales', 'Oiseaux et petits animaux', 'Aves e pequenos animais', 'الطيور والحيوانات الصغيرة', '鸟类与小宠', 'पक्षी और छोटे जानवर', 'Ndege na Wanyama Wadogo', 'Vögel & Kleintiere', 'Burung & Hewan Kecil'),

-- 20 Office & school ----------------------------------------------------------
('office-school', null, 200, 'pencil', 'os',
  'Office & School', 'Oficina y papelería', 'Bureau et école', 'Escritório e papelaria', 'المكتب والمدرسة', '办公与学习用品', 'ऑफ़िस और स्कूल', 'Ofisi na Shule', 'Büro & Schule', 'Kantor & Sekolah'),
('pens-writing', 'office-school', 1, null, null,
  'Pens & Writing', 'Bolígrafos y escritura', 'Stylos et écriture', 'Canetas e escrita', 'أقلام وأدوات كتابة', '笔与书写工具', 'पेन और लेखन सामग्री', 'Kalamu na Vifaa vya Kuandikia', 'Stifte & Schreibwaren', 'Pulpen & Alat Tulis'),
('notebooks-paper', 'office-school', 2, null, null,
  'Notebooks & Paper', 'Cuadernos y papel', 'Cahiers et papier', 'Cadernos e papel', 'دفاتر وورق', '笔记本与纸张', 'नोटबुक और कागज़', 'Madaftari na Karatasi', 'Hefte & Papier', 'Buku Tulis & Kertas'),
('desk-accessories', 'office-school', 3, null, null,
  'Desk Accessories', 'Accesorios de escritorio', 'Accessoires de bureau', 'Acessórios de mesa', 'إكسسوارات المكتب', '桌面用品', 'डेस्क एक्सेसरीज़', 'Vifaa vya Mezani', 'Schreibtischzubehör', 'Aksesori Meja'),
('art-craft-supplies', 'office-school', 4, null, null,
  'Art & Craft Supplies', 'Materiales de arte y manualidades', 'Beaux-arts et loisirs créatifs', 'Arte e artesanato', 'مستلزمات الفنون والحِرف', '美术与手工用品', 'कला और शिल्प सामग्री', 'Vifaa vya Sanaa na Ufundi', 'Künstler- & Bastelbedarf', 'Perlengkapan Seni & Kerajinan'),
('printers-ink', 'office-school', 5, null, null,
  'Printers & Ink', 'Impresoras y tinta', 'Imprimantes et encre', 'Impressoras e tinta', 'طابعات وأحبار', '打印机与墨盒', 'प्रिंटर और स्याही', 'Printa na Wino', 'Drucker & Tinte', 'Printer & Tinta');

-- Top-level rows first, so children can find their parent by slug.
insert into categories (slug, parent_id, sort, is_top_level, icon, shopify_taxonomy_id)
select s.slug, null, s.sort, true, s.icon, s.shopify
from zakka_category_seed s
where s.parent is null
on conflict (slug) do update
  set parent_id = null,
      sort = excluded.sort,
      is_top_level = true,
      icon = excluded.icon,
      shopify_taxonomy_id = coalesce(categories.shopify_taxonomy_id, excluded.shopify_taxonomy_id);

insert into categories (slug, parent_id, sort, is_top_level, icon, shopify_taxonomy_id)
select s.slug, p.id, s.sort, false, s.icon, s.shopify
from zakka_category_seed s
join categories p on p.slug = s.parent
where s.parent is not null
on conflict (slug) do update
  set parent_id = excluded.parent_id,
      sort = excluded.sort,
      is_top_level = false,
      icon = coalesce(excluded.icon, categories.icon),
      shopify_taxonomy_id = coalesce(categories.shopify_taxonomy_id, excluded.shopify_taxonomy_id);

insert into category_translations (category_id, locale, name)
select c.id, t.locale, t.name
from zakka_category_seed s
join categories c on c.slug = s.slug
cross join lateral (values
  ('en', s.en), ('es', s.es), ('fr', s.fr), ('pt', s.pt), ('ar', s.ar),
  ('zh', s.zh), ('hi', s.hi), ('sw', s.sw), ('de', s.de), ('id', s.id)
) as t(locale, name)
on conflict (category_id, locale) do update
  set name = excluded.name;

drop table zakka_category_seed;
