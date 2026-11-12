import { vi } from 'vitest';

/** Cookies the code under test sees through `next/headers`. Reset in each test. */
export const cookieJar = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => void cookieJar.set(name, value),
  }),
}));

/** Fresh module graph with the given env, so `config` (read at import time) picks it up. */
export function freshEnv(env: Record<string, string>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  cookieJar.clear();
}

/** The mock sign-in token for an email (see auth-core mock mode). */
export const mockToken = (email: string) => `mock.${btoa(email)}`;

let ipSeq = 0;
/** A unique caller address, so tests do not share a rate-limit bucket. */
export const nextIp = () => `10.0.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;

export function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: new URL(url).origin, 'x-forwarded-for': nextIp(), ...headers },
    body: JSON.stringify(body),
  });
}
