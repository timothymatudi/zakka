// Drives a full WhatsApp conversation locally, in mock mode, through the real HTTP routes:
//   npm run simulate -- "+254712345678" "cheap earbuds"
// search -> pick a dropship item -> buy -> mock pay -> forward attempt -> confirmation -> tracking -> STOP
// Flags: --db (use DATABASE_URL instead of the in-memory store), --no-stop
export {};
process.env.CONCIERGE_SILENT ??= '1'; // keep JSON logs out of the transcript (set CONCIERGE_SILENT=0 to see them)

const { mockConfig, loadConfig } = await import('./config');
const { buildApp } = await import('./server');
const { MemoryStore } = await import('./store/memory');
const { MockWhatsAppClient, renderText } = await import('./whatsapp/client');
const { inboundPayload } = await import('./whatsapp/payloads');
const { signPayload } = await import('./whatsapp/signature');

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const [phone = '+254712345678', query = 'cheap earbuds'] = args.filter((a) => !a.startsWith('--'));
const APP_SECRET = 'simulator-app-secret';

const config = mockConfig({
  databaseUrl: flags.has('--db') ? loadConfig().databaseUrl : '',
  whatsapp: { ...loadConfig().whatsapp, phoneNumberId: '', accessToken: '', appSecret: APP_SECRET, verifyToken: 'simulator-verify' },
});
const wa = new MockWhatsAppClient();
const { app, idle, store } = await buildApp(config, { whatsapp: wa, ...(flags.has('--db') ? {} : { store: new MemoryStore() }) });

const line = (s = '') => process.stdout.write(s + '\n');
const indent = (s: string, p: string) => s.split('\n').map((l) => p + l).join('\n');
wa.onSend = (s) => line(indent(renderText(s.message), s.message.kind === 'template' ? 'ZAKKA[template] | ' : `ZAKKA[${s.message.kind}] | `) + '\n');

async function send(msg: Parameters<typeof inboundPayload>[1], label: string) {
  line(`USER     | ${label}\n`);
  const body = JSON.stringify(inboundPayload(phone, msg));
  const res = await app.inject({
    method: 'POST', url: '/webhooks/whatsapp', payload: body,
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signPayload(body, APP_SECRET) },
  });
  if (res.statusCode !== 200) throw new Error(`webhook rejected: ${res.statusCode} ${res.body}`);
  await idle();
}
const last = () => wa.outbox[wa.outbox.length - 1]?.message;

line(`=== Zakka concierge simulator (mock mode) ===`);
line(`phone=${phone}  query="${query}"  store=${store.kind}  search=${config.searchApiUrl}  catalog=${config.catalogApiUrl}`);
const health = (await app.inject({ method: 'GET', url: '/health' })).json();
line(`health: ${JSON.stringify(health)}`);
const verify = await app.inject({ method: 'GET', url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=simulator-verify&hub.challenge=1234' });
line(`webhook verification GET -> ${verify.statusCode} "${verify.body}"`);
const bad = await app.inject({ method: 'POST', url: '/webhooks/whatsapp', payload: JSON.stringify(inboundPayload(phone, { text: 'x' })), headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) } });
line(`unsigned/forged webhook POST -> ${bad.statusCode} (rejected)\n`);

// 1. Search
await send({ text: query }, query);
const list = last();
if (list?.kind !== 'list') { line('No results list was sent; stopping.'); process.exit(1); }

// 2. Pick the first dropship option (affiliate options are shown with an "Affiliate" label)
const conv = await store.getOrCreateConversation(phone.replace(/\D/g, ''), (await store.getOrCreateCustomer(phone, { country_code: null, locale: null })).id);
const results = conv.context.results ?? [];
const idx = results.findIndex((r) => r.kind === 'dropship');
if (idx < 0) { line('No dropship option to buy; stopping.'); process.exit(1); }
const row = list.rows[idx]!;
await send({ listReply: { id: row.id, title: row.title } }, `(taps list row) ${row.title}`);

// 3. Buy
await send({ buttonReply: { id: 'buy', title: 'Buy now' } }, '(taps button) Buy now');
// 3b. Shipping address (orders.shipping_address), confirmed before the payment link is created
const address = 'Amina Wanjiru\nKenyatta Ave 12, Apt 4B\nNairobi\nNairobi County\n00100';
await send({ text: address }, address.replace(/\n/g, ' | '));
await send({ buttonReply: { id: 'addr_ok', title: 'Yes, continue' } }, '(taps button) Yes, continue');
const pay = last();
if (pay?.kind !== 'cta_url') { line('No payment link was sent; stopping.'); process.exit(1); }

// 4. Open the mock checkout and pay
const url = new URL(pay.url);
const page = await app.inject({ method: 'GET', url: url.pathname + url.search });
line(`BROWSER  | GET ${url.pathname}${url.search} -> ${page.statusCode} (mock checkout page)`);
line('BROWSER  | POST "Pay (mock)" -> mock provider webhook -> mark paid -> forward to catalog -> confirm\n');
const paid = await app.inject({ method: 'POST', url: url.pathname + url.search, headers: { accept: 'application/json' } });
line(`WEBHOOK  | /payments/webhook/${url.pathname.split('/')[2]} -> ${paid.statusCode} ${paid.body}\n`);
await idle();
const replay = await app.inject({ method: 'POST', url: url.pathname + url.search, headers: { accept: 'application/json' } });
line(`WEBHOOK  | duplicate paid event replayed -> ${replay.statusCode} ${replay.body}\n`);

// 5. Tracking
await send({ text: 'where is my order?' }, 'where is my order?');

// 6. Opt out
if (!flags.has('--no-stop')) await send({ text: 'STOP' }, 'STOP');

const customer = await store.getOrCreateCustomer(phone, { country_code: null, locale: null });
const orders = await store.listOrders(customer.id);
const finalConv = await store.getConversationByCustomer(customer.id);
line('=== Final state ===');
line(`customer: country=${customer.country_code} locale=${customer.locale} whatsapp_opt_in=${customer.whatsapp_opt_in}`);
for (const o of orders) line(`order ${o.id}: status=${o.status} total=${o.currency} ${o.total} (USD ${o.total_usd}) provider=${o.payment_provider} ref=${o.payment_ref} channel=${o.channel}
  shipping_address=${JSON.stringify(o.shipping_address)}`);
line(`conversation: state=${finalConv?.state} messages=${(await store.listMessages(finalConv!.id)).length}`);
await app.close();
