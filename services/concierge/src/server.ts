import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { createSupportAI, type SupportAI } from './ai/support';
import { HttpCatalogClient, HttpSearchClient, type CatalogClient, type SearchClient } from './clients/services';
import type { Config } from './config';
import { Concierge, SHIPMENT_STATUSES, type ShipmentStatus } from './flows/concierge';
import { log } from './log';
import { createProviders, type Providers, type ProviderName } from './payments';
import { WebhookSignatureError } from './payments/types';
import { createStore } from './store';
import type { Store } from './store/types';
import { createWhatsAppClient, type WhatsAppClient } from './whatsapp/client';
import { Messenger } from './whatsapp/messenger';
import { parseWebhook } from './whatsapp/parse';
import { verifySignature } from './whatsapp/signature';

declare module 'fastify' {
  interface FastifyRequest { rawBody?: Buffer }
}

export interface AppDeps {
  store?: Store;
  whatsapp?: WhatsAppClient;
  search?: SearchClient;
  catalog?: CatalogClient;
  providers?: Providers;
  ai?: SupportAI;
  now?: () => Date;
}

export interface App {
  app: FastifyInstance;
  concierge: Concierge;
  store: Store;
  whatsapp: WhatsAppClient;
  /** Resolves when all queued inbound messages have been processed. */
  idle(): Promise<void>;
}

const PROVIDERS: ProviderName[] = ['stripe', 'paypal', 'flutterwave', 'paystack'];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function buildApp(config: Config, deps: AppDeps = {}): Promise<App> {
  const store = deps.store ?? (await createStore(config.databaseUrl));
  const whatsapp = deps.whatsapp ?? createWhatsAppClient(config.whatsapp);
  const svc = { offline: config.offline, fixtureFallback: config.fixtureFallback };
  const providers = deps.providers ?? createProviders(config);
  const ai = deps.ai ?? createSupportAI(config.anthropic);
  const concierge = new Concierge({
    config, store, providers,
    messenger: new Messenger(whatsapp, store, deps.now),
    search: deps.search ?? new HttpSearchClient({ ...svc, baseUrl: config.searchApiUrl }),
    catalog: deps.catalog ?? new HttpCatalogClient({ ...svc, baseUrl: config.catalogApiUrl, token: config.catalogApiToken }),
    ai,
  });

  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });

  // Keep the exact raw bytes: signatures (Meta, Stripe, Paystack) are computed over them.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    (req as FastifyRequest).rawBody = body as Buffer;
    if (!(body as Buffer).length) return done(null, {});
    try { done(null, JSON.parse((body as Buffer).toString('utf8'))); } catch { done(Object.assign(new Error('invalid JSON'), { statusCode: 400 }), undefined); }
  });
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  // Per-user serial queue: Meta needs a fast 200; ordering per wa_id is preserved.
  const queues = new Map<string, Promise<void>>();
  const enqueue = (key: string, job: () => Promise<unknown>) => {
    const prev = queues.get(key) ?? Promise.resolve();
    const next = prev.then(job).then(() => undefined, (e) => log.error('inbound job failed', { error: (e as Error).message }));
    queues.set(key, next);
    void next.then(() => { if (queues.get(key) === next) queues.delete(key); });
  };
  const idle = async () => { while (queues.size) await Promise.all([...queues.values()]); };

  app.get('/health', async () => ({
    ok: true, store: store.kind, whatsapp: whatsapp.mock ? 'mock' : 'live', ai: ai.mock ? 'mock' : 'live',
    payments: Object.fromEntries(PROVIDERS.map((p) => [p, providers[p].mock ? 'mock' : 'live'])),
  }));

  // ---- WhatsApp webhook -----------------------------------------------------
  app.get('/webhooks/whatsapp', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    if (q['hub.mode'] === 'subscribe' && config.whatsapp.verifyToken && q['hub.verify_token'] === config.whatsapp.verifyToken) {
      return reply.type('text/plain').send(q['hub.challenge'] ?? '');
    }
    return reply.code(403).send({ error: 'verification failed' });
  });

  app.post('/webhooks/whatsapp', async (req, reply) => {
    const raw = req.rawBody ?? Buffer.from('');
    if (config.whatsapp.appSecret) {
      if (!verifySignature(raw, req.headers['x-hub-signature-256'] as string | undefined, config.whatsapp.appSecret)) {
        log.warn('rejected WhatsApp webhook: bad X-Hub-Signature-256');
        return reply.code(401).send({ error: 'invalid signature' });
      }
    } else {
      log.warn('WHATSAPP_APP_SECRET empty: accepting unsigned webhook (mock mode only)');
    }
    const messages = parseWebhook(req.body);
    for (const m of messages) enqueue(m.from, () => concierge.handleInbound(m));
    return reply.send({ received: messages.length });
  });

  // ---- Payments -------------------------------------------------------------
  app.post('/payments/webhook/:provider', async (req, reply) => {
    const name = (req.params as { provider: string }).provider as ProviderName;
    const provider = providers[name];
    if (!provider) return reply.code(404).send({ error: 'unknown provider' });
    try {
      const evt = await provider.parseWebhook(req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {})), req.headers);
      if (!evt) return reply.send({ ignored: true });
      const result = await concierge.handlePaymentEvent(evt);
      return reply.send({ ...result, order: result.order ? { id: result.order.id, status: result.order.status } : undefined });
    } catch (e) {
      if (e instanceof WebhookSignatureError) return reply.code(400).send({ error: e.message });
      log.error('payment webhook error', { provider: name, error: (e as Error).message });
      return reply.code(500).send({ error: 'processing failed' });
    }
  });

  // ---- Mock checkout (only for providers running in mock mode) ---------------
  app.get('/mock-pay/:provider/:ref', async (req, reply) => {
    const { provider, ref } = req.params as { provider: ProviderName; ref: string };
    if (!providers[provider]?.mock) return reply.code(404).send({ error: 'not found' });
    const q = req.query as Record<string, string>;
    return reply.type('text/html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Zakka mock checkout</title><style>body{font-family:'Plus Jakarta Sans',system-ui,sans-serif;background:#FBF8F3;color:#1F2937;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
.card{background:#fff;border-radius:16px;padding:24px;max-width:360px;width:100%;box-shadow:0 4px 24px #0001}button{background:#0F766E;color:#fff;border:0;border-radius:12px;padding:14px;width:100%;font-size:16px;cursor:pointer}
.muted{color:#6b7280;font-size:13px}</style></head><body><form class="card" method="post">
<p class="muted">MOCK ${esc(provider)} checkout. No real money moves.</p><h2>${esc(q.currency ?? '')} ${esc(q.amount ?? '')}</h2>
<p class="muted">Order ${esc(q.order ?? '')}<br>Ref ${esc(ref)}</p>
<input type="hidden" name="order" value="${esc(q.order ?? '')}"><input type="hidden" name="amount" value="${esc(q.amount ?? '')}"><input type="hidden" name="currency" value="${esc(q.currency ?? '')}">
<button type="submit">Pay (mock)</button></form></body></html>`);
  });

  app.post('/mock-pay/:provider/:ref', async (req, reply) => {
    const { provider, ref } = req.params as { provider: ProviderName; ref: string };
    if (!providers[provider]?.mock) return reply.code(404).send({ error: 'not found' });
    const b = { ...(req.query as Record<string, string>), ...((req.body as Record<string, string>) ?? {}) };
    const res = await app.inject({
      method: 'POST', url: `/payments/webhook/${provider}`, headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        type: b.fail ? 'mock.payment_failed' : 'mock.payment_succeeded', ref, order_id: b.order || undefined,
        amount: b.amount ? Number(b.amount) : undefined, currency: b.currency || undefined,
      }),
    });
    const result = res.json();
    if ((req.headers.accept ?? '').includes('text/html')) {
      return reply.type('text/html').send(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;background:#FBF8F3;padding:24px">
<h2 style="color:#0F766E">${result.ok ? 'Payment received (mock)' : 'Payment not applied'}</h2><pre>${esc(JSON.stringify(result, null, 2))}</pre><p>You can return to WhatsApp.</p></body>`);
    }
    return reply.code(res.statusCode).send(result);
  });

  // ---- Internal API (catalog/fulfilment, human agents, marketing jobs) -------
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/internal/')) return;
    const token = req.headers['x-internal-token'];
    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip);
    if (config.internalToken ? token !== config.internalToken : !loopback) return reply.code(401).send({ error: 'unauthorized' });
  });

  app.post('/internal/orders/:id/notify', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (b.status !== undefined && !(SHIPMENT_STATUSES as readonly unknown[]).includes(b.status)) {
      return reply.code(400).send({ error: `status must be one of ${SHIPMENT_STATUSES.join(', ')}` });
    }
    const str = (k: string) => (typeof b[k] === 'string' && (b[k] as string).trim() ? (b[k] as string).trim() : null);
    const result = await concierge.notifyOrderUpdate((req.params as { id: string }).id, {
      status: b.status as ShipmentStatus | undefined,
      carrier: str('carrier'), tracking_number: str('tracking_number'), tracking_url: str('tracking_url'), last_event: str('last_event'),
    });
    return reply.code(result.reason === 'order_not_found' ? 404 : 200).send(result);
  });

  app.post('/internal/conversations/:waId/reply', async (req) => {
    const b = (req.body ?? {}) as { text?: string; resume?: boolean };
    return concierge.agentReply((req.params as { waId: string }).waId.replace(/\D/g, ''), b.text ?? '', !!b.resume);
  });

  app.post('/internal/customers/:id/marketing', async (req, reply) => {
    const b = (req.body ?? {}) as { template?: string; params?: string[]; url_param?: string };
    if (b.template !== 'price_drop_alert' && b.template !== 'weekly_deals') return reply.code(400).send({ error: 'marketing template required' });
    return concierge.sendMarketing((req.params as { id: string }).id, b.template, b.params ?? [], b.url_param ?? '');
  });

  app.addHook('onClose', async () => { await idle(); await store.close(); });

  return { app, concierge, store, whatsapp, idle };
}
