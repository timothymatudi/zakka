import 'server-only';
import { config } from './config';

/**
 * POST {CATALOG_API_URL}/orders/{id}/forward with the catalog bearer token.
 * Call only for orders that are really paid (from a payment webhook), never for mock settlements.
 */
export async function forwardPaidOrder(orderId: string): Promise<boolean> {
  if (!config.catalogApiUrl || !config.catalogApiToken) return false;
  try {
    const res = await fetch(`${config.catalogApiUrl}/orders/${encodeURIComponent(orderId)}/forward`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.catalogApiToken}` },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  }
}
