/** WhatsApp customer service window: free-form messages only within 24h of the user's last message. */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWithinServiceWindow(lastInboundAt: string | Date | null | undefined, now: Date = new Date()): boolean {
  if (!lastInboundAt) return false;
  const t = typeof lastInboundAt === 'string' ? Date.parse(lastInboundAt) : lastInboundAt.getTime();
  if (Number.isNaN(t)) return false;
  const age = now.getTime() - t;
  return age >= 0 ? age < SERVICE_WINDOW_MS : true; // small clock skew (future timestamp) counts as inside
}

/** Milliseconds left in the window (0 when closed). */
export function windowRemainingMs(lastInboundAt: string | null | undefined, now: Date = new Date()): number {
  if (!isWithinServiceWindow(lastInboundAt, now)) return 0;
  return Math.max(0, Date.parse(lastInboundAt!) + SERVICE_WINDOW_MS - now.getTime());
}
