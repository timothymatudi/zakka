import { buildApp, type AppOptions } from '../src/app';
import { fixturesRuntime } from '../src/bootstrap';
import { SearchService } from '../src/search';
import type { LiveAffiliates } from '../src/live';

/** Memory-engine service + Fastify app over this service's own fixtures. No network. */
export function makeApp(opts: { live?: LiveAffiliates | null; app?: AppOptions } = {}) {
  const { memory, categories } = fixturesRuntime();
  const service = new SearchService(memory, { ai: { apiKey: '', model: 'test' }, categories, live: opts.live ?? null });
  const app = buildApp(service, { engine: () => 'memory', documents: () => memory.count(), aiMode: 'rules' }, opts.app);
  const get = async (url: string) => {
    const res = await app.inject({ method: 'GET', url });
    return { status: res.statusCode, body: res.json() };
  };
  return { app, service, memory, categories, get };
}
