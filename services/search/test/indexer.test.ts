import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BatchImporter, fileSink, indexStream, referencePricesFromStream, type ImportFn } from '../src/indexer';
import { syntheticPages, syntheticProduct } from '../src/synthetic';
import { DEFAULT_ACTIVE_COUNTRIES } from '../src/config';
import type { IndexedDocument } from '../src/types';

const ACTIVE = new Set(DEFAULT_ACTIVE_COUNTRIES);
const noSleep = async () => {};

describe('bulk indexer on a 50k synthetic catalog (no Typesense)', () => {
  it('streams 50,000 products into JSONL batches of 5,000', async () => {
    const batches: number[] = [];
    const ids = new Set<string>();
    let sample: IndexedDocument | null = null;
    const importFn: ImportFn = async (jsonl) => {
      const lines = jsonl.split('\n');
      batches.push(lines.length);
      for (const l of lines) ids.add((JSON.parse(l) as IndexedDocument).id);
      if (!sample) sample = JSON.parse(lines[0]);
      return lines.map(() => ({ success: true }));
    };
    const refs = await referencePricesFromStream(syntheticPages(50_000), ACTIVE);
    expect(Object.keys(refs).length).toBeGreaterThan(50);
    const stats = await indexStream(syntheticPages(50_000), { active: ACTIVE, refs }, importFn);
    expect(stats).toMatchObject({ products: 50_000, indexed: 50_000, failed: 0, skipped: 0, batches: 10, retries: 0 });
    expect(batches).toEqual(Array(10).fill(5000));
    expect(ids.size).toBe(50_000);
    // compact docs: per-country fields only for active countries; others (SN, CI, ET, JP, TR) computed at query time
    const s = sample!;
    expect(Object.keys(s).some((k) => k === 'cprice_KE')).toBe(true);
    expect(Object.keys(s).some((k) => /^c(price|dmax|sell)_(SN|CI|ET|JP|TR)$/.test(k))).toBe(false);
    expect(s.ships_to).toEqual(expect.arrayContaining(['SN', 'JP']));
  }, 60_000);

  it('handles a final partial batch', async () => {
    const sizes: number[] = [];
    const stats = await indexStream(syntheticPages(12_345, 1000), { active: ACTIVE, refs: {} }, async (jsonl) => {
      const n = jsonl.split('\n').length;
      sizes.push(n);
      return Array.from({ length: n }, () => ({ success: true }));
    });
    expect(sizes).toEqual([5000, 5000, 2345]);
    expect(stats.indexed).toBe(12_345);
  });

  it('retries a failed batch request with backoff, then succeeds', async () => {
    let calls = 0;
    const waits: number[] = [];
    const flaky: ImportFn = async (jsonl) => {
      calls++;
      if (calls <= 2) throw new Error('503 Service Unavailable');
      return jsonl.split('\n').map(() => ({ success: true }));
    };
    const imp = new BatchImporter(flaky, { batchSize: 100, backoffMs: 100, sleep: async (ms) => void waits.push(ms) });
    for (let n = 0; n < 100; n++) await imp.add({ id: String(n) } as IndexedDocument);
    await imp.flush();
    expect(imp.stats).toMatchObject({ indexed: 100, failed: 0, batches: 1, retries: 2 });
    expect(waits).toEqual([100, 200]);
  });

  it('gives up after max retries and counts the batch as failed; per-document errors are counted', async () => {
    const down: ImportFn = async () => {
      throw new Error('ECONNRESET');
    };
    const imp = new BatchImporter(down, { batchSize: 10, maxRetries: 2, sleep: noSleep, log: () => {} });
    for (let n = 0; n < 10; n++) await imp.add({ id: String(n) } as IndexedDocument);
    expect(imp.stats).toMatchObject({ indexed: 0, failed: 10, retries: 2 });

    const partial: ImportFn = async (jsonl) => jsonl.split('\n').map((_, i) => (i === 0 ? { success: false, error: 'bad field' } : { success: true }));
    const imp2 = new BatchImporter(partial, { batchSize: 5, sleep: noSleep, log: () => {} });
    for (let n = 0; n < 5; n++) await imp2.add({ id: String(n) } as IndexedDocument);
    expect(imp2.stats).toMatchObject({ indexed: 4, failed: 1 });
  });

  it('file sink writes valid JSONL', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'zakka-idx-')), 'p.jsonl');
    const stats = await indexStream(syntheticPages(1200), { active: ACTIVE, refs: {} }, fileSink(out), { batchSize: 500 });
    const lines = readFileSync(out, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1200);
    expect(stats.batches).toBe(3);
    expect(JSON.parse(lines[0]).id).toBe(syntheticProduct(0).id);
  });
});
