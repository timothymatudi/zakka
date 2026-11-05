import { loadConfig } from './config';
import { log } from './log';
import { buildApp } from './server';

const config = loadConfig();
const { app } = await buildApp(config);
await app.listen({ port: config.port, host: '0.0.0.0' });
log.info('concierge listening', { port: config.port, webhook: `${config.publicUrl}/webhooks/whatsapp` });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => { void app.close().then(() => process.exit(0)); });
}
