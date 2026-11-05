import { log } from '../log';
import { MemoryStore } from './memory';
import { PostgresStore } from './postgres';
import type { Store } from './types';

export async function createStore(databaseUrl: string): Promise<Store> {
  if (!databaseUrl) {
    log.warn('DATABASE_URL empty: using in-memory store (data is lost on restart)');
    return new MemoryStore();
  }
  try {
    const s = await PostgresStore.connect(databaseUrl);
    log.info('connected to Postgres');
    return s;
  } catch (e) {
    log.warn('Postgres unavailable: using in-memory store', { error: (e as Error).message });
    return new MemoryStore();
  }
}

export { MemoryStore, PostgresStore };
export type * from './types';
