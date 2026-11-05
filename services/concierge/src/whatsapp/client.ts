import { randomUUID } from 'node:crypto';
import { log } from '../log';

export type Outbound =
  | { kind: 'text'; body: string; previewUrl?: boolean }
  | { kind: 'list'; header?: string; body: string; footer?: string; button: string; rows: { id: string; title: string; description?: string }[] }
  | { kind: 'buttons'; body: string; footer?: string; buttons: { id: string; title: string }[] }
  | { kind: 'cta_url'; body: string; footer?: string; displayText: string; url: string }
  | { kind: 'template'; name: string; language: string; bodyParams: string[]; buttonUrlParam?: string };

export interface SentMessage { to: string; message: Outbound; waMessageId: string; mock: boolean }

export interface WhatsAppClient {
  readonly mock: boolean;
  send(to: string, message: Outbound): Promise<SentMessage>;
}

const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1) + '…');

/** Builds the Cloud API request body for POST /{phone-number-id}/messages, enforcing Meta's field limits. */
export function toCloudApiPayload(to: string, m: Outbound): Record<string, unknown> {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to };
  switch (m.kind) {
    case 'text':
      return { ...base, type: 'text', text: { body: clip(m.body, 4096), preview_url: m.previewUrl ?? false } };
    case 'list':
      return {
        ...base, type: 'interactive',
        interactive: {
          type: 'list',
          ...(m.header ? { header: { type: 'text', text: clip(m.header, 60) } } : {}),
          body: { text: clip(m.body, 4096) },
          ...(m.footer ? { footer: { text: clip(m.footer, 60) } } : {}),
          action: {
            button: clip(m.button, 20),
            sections: [{ title: clip(m.header ?? 'Results', 24), rows: m.rows.slice(0, 10).map((r) => ({
              id: clip(r.id, 200), title: clip(r.title, 24), ...(r.description ? { description: clip(r.description, 72) } : {}),
            })) }],
          },
        },
      };
    case 'buttons':
      return {
        ...base, type: 'interactive',
        interactive: {
          type: 'button', body: { text: clip(m.body, 1024) },
          ...(m.footer ? { footer: { text: clip(m.footer, 60) } } : {}),
          action: { buttons: m.buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: clip(b.id, 256), title: clip(b.title, 20) } })) },
        },
      };
    case 'cta_url':
      return {
        ...base, type: 'interactive',
        interactive: {
          type: 'cta_url', body: { text: clip(m.body, 1024) },
          ...(m.footer ? { footer: { text: clip(m.footer, 60) } } : {}),
          action: { name: 'cta_url', parameters: { display_text: clip(m.displayText, 20), url: m.url } },
        },
      };
    case 'template': {
      const components: Record<string, unknown>[] = [];
      if (m.bodyParams.length) components.push({ type: 'body', parameters: m.bodyParams.map((t) => ({ type: 'text', text: t })) });
      if (m.buttonUrlParam !== undefined) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: m.buttonUrlParam }] });
      return { ...base, type: 'template', template: { name: m.name, language: { code: m.language }, components } };
    }
  }
}

/** Plain-text rendering of an outbound message, used for logs, the DB `body` column and the simulator. */
export function renderText(m: Outbound): string {
  switch (m.kind) {
    case 'text': return m.body;
    case 'list': return [m.header && `*${m.header}*`, m.body, ...m.rows.map((r) => `  [${r.id}] ${r.title}${r.description ? ` | ${r.description}` : ''}`), `  (button: ${m.button})`, m.footer && `_${m.footer}_`].filter(Boolean).join('\n');
    case 'buttons': return [m.body, ...m.buttons.map((b) => `  [${b.id}] ${b.title}`), m.footer && `_${m.footer}_`].filter(Boolean).join('\n');
    case 'cta_url': return [m.body, `  [${m.displayText}] ${m.url}`, m.footer && `_${m.footer}_`].filter(Boolean).join('\n');
    case 'template': return `template ${m.name} (${m.language}) params=${JSON.stringify(m.bodyParams)}${m.buttonUrlParam !== undefined ? ` url=${m.buttonUrlParam}` : ''}`;
  }
}

/** Mock client: logs instead of sending. `outbox` and `onSend` let the simulator and tests observe traffic. */
export class MockWhatsAppClient implements WhatsAppClient {
  readonly mock = true;
  outbox: SentMessage[] = [];
  onSend?: (s: SentMessage) => void;
  async send(to: string, message: Outbound) {
    const s: SentMessage = { to, message, waMessageId: `wamid.mock.${randomUUID()}`, mock: true };
    this.outbox.push(s);
    log.info('whatsapp.mock.outbound', { to, kind: message.kind, text: renderText(message) });
    this.onSend?.(s);
    return s;
  }
}

/** Real Meta WhatsApp Cloud API client. */
export class CloudApiClient implements WhatsAppClient {
  readonly mock = false;
  constructor(private phoneNumberId: string, private token: string, private graphVersion = 'v23.0') {}
  async send(to: string, message: Outbound) {
    const res = await fetch(`https://graph.facebook.com/${this.graphVersion}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(toCloudApiPayload(to, message)),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message: string; code: number } };
    if (!res.ok || !json.messages?.[0]) {
      throw new Error(`WhatsApp send failed (${res.status}): ${json.error?.message ?? 'unknown error'}`);
    }
    return { to, message, waMessageId: json.messages[0].id, mock: false };
  }
}

export function createWhatsAppClient(cfg: { phoneNumberId: string; accessToken: string; graphVersion: string }): WhatsAppClient {
  if (cfg.phoneNumberId && cfg.accessToken) return new CloudApiClient(cfg.phoneNumberId, cfg.accessToken, cfg.graphVersion);
  log.warn('WhatsApp keys empty: outbound messages are logged, not sent (mock mode)');
  return new MockWhatsAppClient();
}
