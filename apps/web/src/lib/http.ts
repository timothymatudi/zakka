import 'server-only';

/** Remembers when a service was unreachable so a down service costs one timeout, not one per call. */
const downUntil = new Map<string, number>();
const DOWN_MS = 30_000;

export async function fetchJson<T>(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<T | null> {
  const origin = new URL(url).origin;
  if ((downUntil.get(origin) ?? 0) > Date.now()) return null;
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(init?.timeoutMs ?? 2500),
      cache: 'no-store',
    });
    if (!res.ok) {
      if (res.status >= 500) downUntil.set(origin, Date.now() + DOWN_MS);
      return null;
    }
    return (await res.json()) as T;
  } catch {
    downUntil.set(origin, Date.now() + DOWN_MS);
    return null;
  }
}
