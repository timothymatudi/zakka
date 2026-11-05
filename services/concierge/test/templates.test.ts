import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../src/lang/messages';
import { LOCALES } from '../src/shared';
import { metaSubmissionPayload, TEMPLATES, type TemplateName } from '../src/templates/registry';
import { toCloudApiPayload } from '../src/whatsapp/client';

describe('template registry', () => {
  const names = Object.keys(TEMPLATES) as TemplateName[];
  it('has the five required templates', () => {
    expect(names.sort()).toEqual(['delivery_update', 'order_confirmation', 'price_drop_alert', 'shipping_update', 'weekly_deals']);
  });
  it.each(names)('%s has all 10 locales with matching variables', (name) => {
    const def = TEMPLATES[name];
    for (const l of LOCALES) {
      const body = def.translations[l].body;
      const vars = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      expect(new Set(vars).size, `${name}/${l}`).toBe(def.variables.length);
      expect(Math.max(...vars)).toBe(def.variables.length);
      expect(def.translations[l].button.length).toBeLessThanOrEqual(25);
      if (def.category === 'MARKETING') expect(body).toContain('STOP');
    }
  });
  it('builds Meta submission payloads', () => {
    const p = metaSubmissionPayload('order_confirmation', 'pt', 'https://zakka.example');
    expect(p).toMatchObject({ name: 'order_confirmation', language: 'pt_BR', category: 'UTILITY' });
  });
});

describe('message catalogue', () => {
  it('every locale has every key', () => {
    const keys = Object.keys(MESSAGES.en).sort();
    for (const l of LOCALES) expect(Object.keys(MESSAGES[l]).sort(), l).toEqual(keys);
  });
});

describe('Cloud API payloads respect Meta limits', () => {
  it('clips list rows and buttons', () => {
    const p = toCloudApiPayload('254700000001', {
      kind: 'list', body: 'b', button: 'A very long button label here', header: 'h',
      rows: [{ id: 'pick:0', title: 'A very long product title that exceeds', description: 'd'.repeat(100) }],
    }) as { interactive: { action: { button: string; sections: { rows: { title: string; description: string }[] }[] } } };
    expect(p.interactive.action.button.length).toBeLessThanOrEqual(20);
    expect(p.interactive.action.sections[0]!.rows[0]!.title.length).toBeLessThanOrEqual(24);
    expect(p.interactive.action.sections[0]!.rows[0]!.description.length).toBeLessThanOrEqual(72);
  });
});
