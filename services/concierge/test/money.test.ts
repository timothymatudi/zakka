import { describe, expect, it } from 'vitest';
import { formatMoney as fm } from '../src/geo';

// Intl puts a no-break space between code and amount; normalise for readable assertions.
const formatMoney = (a: number, c: string, l: string) => fm(a, c, l).replace(/\s/g, ' ');

describe('formatMoney', () => {
  it.each(['KES', 'IDR', 'TZS', 'UGX', 'NGN', 'JPY', 'KRW', 'VND', 'CLP', 'PKR'])('%s shows whole units, rounded up', (c) => {
    const s = formatMoney(2191.21, c, 'en');
    expect(s).toContain('2,192');
    expect(s).not.toMatch(/2,192\.\d/);
  });
  it('keeps two decimals for decimal currencies and drops them for whole amounts', () => {
    expect(formatMoney(23.99, 'USD', 'en')).toBe('USD 23.99');
    expect(formatMoney(24, 'EUR', 'en')).toBe('EUR 24');
  });
  it('does not round whole KES amounts up', () => {
    expect(formatMoney(2257, 'KES', 'en')).toBe('KES 2,257');
  });
});
