/**
 * Content security policy for pages. Scripts run only when they carry this request's nonce (Next.js
 * adds it to its own scripts) or are loaded by a script that does ('strict-dynamic'), so an injected
 * inline script cannot run. Styles keep 'unsafe-inline' because React and Tailwind use inline style
 * attributes, which cannot carry a nonce. Product images come from many partner hosts, so any https
 * image is allowed.
 */
export function pageCsp(nonce: string, isProd = process.env.NODE_ENV === 'production'): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProd ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self'${isProd ? '' : ' ws: wss:'}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

/** A fresh random nonce for one request. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
