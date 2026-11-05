import { createHmac, timingSafeEqual } from 'node:crypto';

/** Computes the value Meta puts in X-Hub-Signature-256 for a raw request body. */
export function signPayload(rawBody: Buffer | string, appSecret: string): string {
  return 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
}

/**
 * Verifies Meta's X-Hub-Signature-256 header (HMAC-SHA256 of the exact raw body with the app secret).
 * Constant-time comparison; any malformed header is rejected.
 */
export function verifySignature(rawBody: Buffer | string, header: string | undefined | null, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return false;
  const expected = Buffer.from(signPayload(rawBody, appSecret).slice(7), 'hex');
  const given = Buffer.from(m[1]!.toLowerCase(), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
