// Bulk indexing pipeline for 1M+ products:
//   pass 1  stream products -> reference (median) prices per category/country
//   pass 2  stream products -> documents -> JSONL batches of 5,000 -> import (with retries)
// Pages are streamed, so memory stays bounded by the page and batch size.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IndexedDocument, RawProduct } from './types';
import { buildDocument, ReferencePriceBuilder, type BuildContext, type ReferencePrices } from './documents';
import type { ImportLineResult } from './engines/typesense';

export type ImportFn = (jsonl: string) => Promise<ImportLineResult[]>;

export interface IndexStats {
  products: number;
  indexed: number;
  failed: number;
  skipped: number;
  batches: number;
  retries: number;
  ms: number;
}

export interface BatchOptions {
  batchSize?: number;
  maxRetries?: number;
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

export const DEFAULT_BATCH_SIZE = 5000;

/** Buffers documents and imports them as JSONL batches, retrying failed requests with backoff. */
export class BatchImporter {
  readonly stats: IndexStats = { products: 0, indexed: 0, failed: 0, skipped: 0, batches: 0, retries: 0, ms: 0 };
  private buf: string[] = [];
  private batchSize: number;
  private maxRetries: number;
  private backoffMs: number;
  private sleep: (ms: number) => Promise<void>;
  private log: (msg: string) => void;

  constructor(private importFn: ImportFn, opts: BatchOptions = {}) {
    this.batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
    this.maxRetries = opts.maxRetries ?? 3;
    this.backoffMs = opts.backoffMs ?? 500;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.log = opts.log ?? ((m) => console.warn(m));
  }

  async add(doc: IndexedDocument): Promise<void> {
    this.buf.push(JSON.stringify(doc));
    if (this.buf.length >= this.batchSize) await this.flush();
  }

  async flush(): Promise<void> {
    if (!this.buf.length) return;
    const lines = this.buf;
    this.buf = [];
    this.stats.batches++;
    const jsonl = lines.join('\n');
    for (let attempt = 0; ; attempt++) {
      try {
        const results = await this.importFn(jsonl);
        const failed = results.filter((r) => !r.success);
        this.stats.indexed += lines.length - failed.length;
        this.stats.failed += failed.length;
        for (const f of failed.slice(0, 3)) this.log(`[indexer] document rejected: ${f.error}`);
        return;
      } catch (err) {
        if (attempt >= this.maxRetries) {
          this.stats.failed += lines.length;
          this.log(`[indexer] batch of ${lines.length} failed after ${attempt + 1} attempts: ${(err as Error).message}`);
          return;
        }
        this.stats.retries++;
        await this.sleep(this.backoffMs * 2 ** attempt);
      }
    }
  }
}

export async function* pagesOf<T>(items: Iterable<T>, size: number): AsyncGenerator<T[]> {
  let page: T[] = [];
  for (const it of items) {
    page.push(it);
    if (page.length >= size) {
      yield page;
      page = [];
    }
  }
  if (page.length) yield page;
}

/** Pass 1: reference prices from a stream of product pages. */
export async function referencePricesFromStream(pages: AsyncIterable<RawProduct[]>, active: Set<string>): Promise<ReferencePrices> {
  const b = new ReferencePriceBuilder(active);
  for await (const page of pages) for (const raw of page) b.addProduct(raw);
  return b.result();
}

/** Pass 2: build documents and import them in batches. */
export async function indexStream(
  pages: AsyncIterable<RawProduct[]>,
  ctx: BuildContext,
  importFn: ImportFn,
  opts: BatchOptions & { onDoc?: (doc: IndexedDocument) => void } = {},
): Promise<IndexStats> {
  const started = Date.now();
  const importer = new BatchImporter(importFn, opts);
  for await (const page of pages) {
    for (const raw of page) {
      importer.stats.products++;
      const doc = buildDocument(raw, ctx);
      if (!doc) {
        importer.stats.skipped++;
        continue;
      }
      opts.onDoc?.(doc);
      await importer.add(doc);
    }
  }
  await importer.flush();
  importer.stats.ms = Date.now() - started;
  return importer.stats;
}

/** Import sink that appends JSONL batches to a file (offline runs and benchmarks). */
export function fileSink(path: string, opts: { truncate?: boolean } = {}): ImportFn {
  mkdirSync(dirname(path), { recursive: true });
  if (opts.truncate !== false) writeFileSync(path, '');
  return async (jsonl) => {
    appendFileSync(path, jsonl + '\n');
    let n = 1;
    for (let i = 0; i < jsonl.length; i++) if (jsonl.charCodeAt(i) === 10) n++;
    return Array.from({ length: n }, () => ({ success: true }));
  };
}

// Reference prices from the last full index, reused by incremental reindexes.
export function saveReferencePrices(path: string, refs: ReferencePrices): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ saved_at: new Date().toISOString(), refs }, null, 1));
}

export function loadReferencePrices(path: string): ReferencePrices | null {
  if (!existsSync(path)) return null;
  try {
    return (JSON.parse(readFileSync(path, 'utf8')) as { refs: ReferencePrices }).refs ?? null;
  } catch {
    return null;
  }
}
