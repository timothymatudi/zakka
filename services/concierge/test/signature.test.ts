import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyPaystackSignature } from '../src/payments/africa';
import { verifyStripeSignature } from '../src/payments/stripe';
import { inboundPayload } from '../src/whatsapp/payloads';
import { signPayload, verifySignature } from '../src/whatsapp/signature';
import { APP_SECRET, makeApp } from './helpers';

describe('X-Hub-Signature-256 verification', () => {
  const body = Buffer.from(JSON.stringify({ hello: 'world', emoji: 'ñ' }));

  it('accepts a correct signature', () => {
    expect(verifySignature(body, signPayload(body, 's3cret'), 's3cret')).toBe(true);
  });
  it('accepts uppercase hex', () => {
    expect(verifySignature(body, 'sha256=' + signPayload(body, 's3cret').slice(7).toUpperCase(), 's3cret')).toBe(true);
  });
  it('rejects a tampered body', () => {
    const sig = signPayload(body, 's3cret');
    expect(verifySignature(Buffer.from(body.toString().replace('world', 'w0rld')), sig, 's3cret')).toBe(false);
  });
  it('rejects the wrong secret', () => {
    expect(verifySignature(body, signPayload(body, 'other'), 's3cret')).toBe(false);
  });
  it('rejects missing, malformed and sha1 headers', () => {
    expect(verifySignature(body, undefined, 's3cret')).toBe(false);
    expect(verifySignature(body, '', 's3cret')).toBe(false);
    expect(verifySignature(body, 'sha256=abc', 's3cret')).toBe(false);
    expect(verifySignature(body, 'sha1=' + createHmac('sha1', 's3cret').update(body).digest('hex'), 's3cret')).toBe(false);
  });
  it('rejects when no app secret is configured', () => {
    expect(verifySignature(body, signPayload(body, ''), '')).toBe(false);
  });
});

describe('webhook routes', () => {
  let app: Awaited<ReturnType<typeof makeApp>> | undefined;
  afterEach(async () => { await app?.app.close(); });

  it('GET verification echoes the challenge only with the right token', async () => {
    app = await makeApp();
    const ok = await app.app.inject({ method: 'GET', url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42' });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('42');
    const bad = await app.app.inject({ method: 'GET', url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42' });
    expect(bad.statusCode).toBe(403);
  });

  it('POST rejects a forged signature and processes nothing', async () => {
    app = await makeApp();
    const body = JSON.stringify(inboundPayload('+254712345678', { text: 'earbuds' }));
    const res = await app.app.inject({
      method: 'POST', url: '/webhooks/whatsapp', payload: body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signPayload(body, 'attacker') },
    });
    expect(res.statusCode).toBe(401);
    await app.idle();
    expect(app.wa.outbox).toHaveLength(0);
  });

  it('POST accepts a valid signature and replies', async () => {
    app = await makeApp();
    const res = await app.send('+254712345678', { text: 'earbuds' });
    expect(res.statusCode).toBe(200);
    expect(app.wa.outbox).toHaveLength(1);
    expect(APP_SECRET).toBeTruthy();
  });

  it('is idempotent by wa_message_id (Meta retries)', async () => {
    app = await makeApp();
    await app.send('+254712345678', { text: 'earbuds' }, { id: 'wamid.SAME' });
    await app.send('+254712345678', { text: 'earbuds' }, { id: 'wamid.SAME' });
    expect(app.wa.outbox).toHaveLength(1);
    const { conv } = await app.conv('+254712345678');
    const inbound = (await app.store.listMessages(conv.id)).filter((m) => m.direction === 'in');
    expect(inbound).toHaveLength(1);
  });
});

describe('payment webhook signatures', () => {
  it('Stripe: valid within tolerance, invalid when stale or tampered', () => {
    const raw = '{"id":"evt_1"}';
    const t = 1_700_000_000;
    const sig = createHmac('sha256', 'whsec_test').update(`${t}.${raw}`).digest('hex');
    expect(verifyStripeSignature(raw, `t=${t},v1=${sig}`, 'whsec_test', 300, t + 10)).toBe(true);
    expect(verifyStripeSignature(raw, `t=${t},v1=${sig}`, 'whsec_test', 300, t + 1000)).toBe(false);
    expect(verifyStripeSignature(raw + ' ', `t=${t},v1=${sig}`, 'whsec_test', 300, t)).toBe(false);
  });
  it('Paystack: HMAC-SHA512 of the raw body', () => {
    const raw = '{"event":"charge.success"}';
    const sig = createHmac('sha512', 'sk_test').update(raw).digest('hex');
    expect(verifyPaystackSignature(raw, sig, 'sk_test')).toBe(true);
    expect(verifyPaystackSignature(raw, sig, 'sk_other')).toBe(false);
  });
});
