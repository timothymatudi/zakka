import { describe, expect, it } from 'vitest';
import { parseAmount, parseQueryRules } from '../src/understanding/rules';

const p = (q: string, country = 'US') => parseQueryRules(q, { country });

describe('rule-based query understanding', () => {
  it('Swahili with KES price cap', () => {
    expect(p('simu nzuri chini ya 20,000 KES', 'KE')).toMatchObject({
      keywords: 'simu', category_hint: 'phones', max_price: 20000, currency: 'KES', max_days: null, source: 'rules',
    });
  });

  it('English without price keeps product words, drops filler', () => {
    expect(p('cheap wireless earbuds for running')).toMatchObject({
      keywords: 'wireless earbuds running', category_hint: 'headphones', max_price: null, max_days: null,
    });
  });

  it('dollar sign and fast delivery', () => {
    expect(p('running shoes under $50 fast delivery')).toMatchObject({
      keywords: 'running shoes', category_hint: 'shoes', max_price: 50, currency: 'USD', max_days: 5,
    });
  });

  it('explicit day counts in several languages', () => {
    expect(p('zapatillas para correr menos de 60 euros en 3 días', 'ES')).toMatchObject({ max_price: 60, currency: 'EUR', max_days: 3, keywords: 'zapatillas correr' });
    expect(p('blender ndani ya siku 3', 'KE').max_days).toBe(3);
    expect(p('diapers delivered tomorrow', 'NG').max_days).toBe(2);
  });

  it('Chinese, Arabic and Hindi price phrases', () => {
    expect(p('200元以下的蓝牙耳机', 'CN')).toMatchObject({ keywords: '蓝牙耳机', max_price: 200, currency: 'CNY', category_hint: 'headphones' });
    expect(p('سماعات بأقل من 100 درهم', 'AE')).toMatchObject({ keywords: 'سماعات', max_price: 100, currency: 'AED' });
    expect(p('500 रुपये से कम में ईयरबड्स', 'IN')).toMatchObject({ keywords: 'ईयरबड्स', max_price: 500, currency: 'INR' });
  });

  it('bare amount after "under" uses the country currency', () => {
    expect(p('earbuds under 5000', 'NG')).toMatchObject({ max_price: 5000, currency: 'NGN' });
    expect(p('blender chini ya elfu 3', 'KE')).toMatchObject({ max_price: 3000, currency: 'KES', keywords: 'blender' });
    expect(p('phone under 20k', 'KE')).toMatchObject({ max_price: 20000, currency: 'KES' });
  });

  it('does not treat product specs as prices', () => {
    expect(p('Samsung 128gb phone')).toMatchObject({ keywords: 'samsung 128gb phone', max_price: null });
    expect(p('5000mah power bank')).toMatchObject({ max_price: null });
  });

  it('parseAmount handles separators', () => {
    expect(parseAmount('20,000')).toBe(20000);
    expect(parseAmount('20.000')).toBe(20000);
    expect(parseAmount('19.99')).toBe(19.99);
    expect(parseAmount('1.299,50')).toBe(1299.5);
    expect(parseAmount('1 500')).toBe(1500);
  });
});
