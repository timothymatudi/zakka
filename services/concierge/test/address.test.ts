import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpCatalogClient } from '../src/clients/services';
import { formatAddress, parseAddress } from '../src/flows/address';

describe('parseAddress', () => {
  it('parses name / street / city with optional line2, region and postal code', () => {
    expect(parseAddress('Amina Wanjiru\nKenyatta Ave 12\nApt 4B\nNairobi\nNairobi County\n00100', '+254712345678', 'KE')).toEqual({
      name: 'Amina Wanjiru', phone_e164: '+254712345678', line1: 'Kenyatta Ave 12', line2: 'Apt 4B',
      city: 'Nairobi', region: 'Nairobi County', postal_code: '00100', country_code: 'KE',
    });
    expect(parseAddress('Ana Ruiz\nCalle Mayor 5\nMadrid\n28013', '+34612345678', 'ES')).toMatchObject({ city: 'Madrid', postal_code: '28013', region: null, line2: null });
    expect(parseAddress('Jo Doe\n1 Main St\nAustin\nTX', '+12125551234', 'US')).toMatchObject({ city: 'Austin', region: 'TX', postal_code: null });
  });
  it('accepts a single comma-separated line', () => {
    expect(parseAddress('Ahmed Ali, 22 Nile St, Cairo', '+201001234567', 'EG')).toMatchObject({ name: 'Ahmed Ali', line1: '22 Nile St', city: 'Cairo' });
  });
  it('rejects incomplete or oversized input', () => {
    expect(parseAddress('Amina\nKenyatta Ave', '+254', 'KE')).toBeNull();
    expect(parseAddress('', '+254', 'KE')).toBeNull();
    expect(parseAddress(`A B\n${'x'.repeat(500)}\nNairobi`, '+254', 'KE')).toBeNull();
  });
  it('formats for confirmation', () => {
    const a = parseAddress('Ana Ruiz\nCalle Mayor 5\nMadrid\n28013', '+34612345678', 'ES')!;
    expect(formatAddress(a)).toBe('Ana Ruiz\nCalle Mayor 5\nMadrid, 28013\nES\n+34612345678');
  });
});

describe('catalog forward call', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('sends Authorization: Bearer CATALOG_API_TOKEN and the shipping address (fetch stubbed, no network)', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response('{"forwarded":1}', { status: 200 }); });
    const c = new HttpCatalogClient({ baseUrl: 'http://catalog.test', offline: false, fixtureFallback: false, token: 'cat-token' });
    const addr = parseAddress('Ana Ruiz\nCalle Mayor 5\nMadrid', '+34612345678', 'ES');
    const res = await c.forward('order-1', addr);
    expect(res).toMatchObject({ ok: true, mock: false, status: 200 });
    expect(calls[0]!.url).toBe('http://catalog.test/orders/order-1/forward');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer cat-token');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ shipping_address: addr });
    await c.forward('order-1', addr, { order: { id: 'order-1' } as never, items: [] });
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ shipping_address: addr, order: { id: 'order-1' }, items: [] });
  });
});
