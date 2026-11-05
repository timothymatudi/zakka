import { log } from '../log';
import type { Locale } from '../shared';
import type { Conversation, Customer, Store } from '../store/types';
import { META_LANGUAGE, renderTemplate, TEMPLATES, type TemplateName } from '../templates/registry';
import { renderText, type Outbound, type WhatsAppClient } from './client';
import { isWithinServiceWindow } from './window';

export class WindowClosedError extends Error {
  constructor() { super('24-hour customer service window is closed: only approved templates may be sent'); }
}
export class NotOptedInError extends Error {
  constructor(template: string) { super(`customer has not opted in to WhatsApp marketing; refusing template ${template}`); }
}

/**
 * The only path for outbound WhatsApp traffic. Enforces:
 *  - the 24h customer service window (free-form only inside it; templates outside it)
 *  - marketing templates only for whatsapp_opt_in = true
 * and records every outbound message in whatsapp_messages.
 */
export class Messenger {
  constructor(private client: WhatsAppClient, private store: Store, private now: () => Date = () => new Date()) {}

  canSendFreeform(conv: Pick<Conversation, 'last_inbound_at'>): boolean {
    return isWithinServiceWindow(conv.last_inbound_at, this.now());
  }

  async send(conv: Conversation, message: Exclude<Outbound, { kind: 'template' }>): Promise<string> {
    if (!this.canSendFreeform(conv)) throw new WindowClosedError();
    return this.deliver(conv, message, null);
  }

  async sendTemplate(conv: Conversation, customer: Customer, name: TemplateName, locale: Locale, bodyParams: string[], buttonUrlParam?: string): Promise<string> {
    const def = TEMPLATES[name];
    if (def.category === 'MARKETING' && !customer.whatsapp_opt_in) throw new NotOptedInError(name);
    if (bodyParams.length !== def.variables.length) throw new Error(`template ${name} expects ${def.variables.length} params`);
    const msg: Outbound = { kind: 'template', name, language: META_LANGUAGE[locale], bodyParams, buttonUrlParam };
    return this.deliver(conv, msg, name, renderTemplate(name, locale, bodyParams));
  }

  /** Free-form inside the window, otherwise the given template fallback (utility notifications). */
  async sendOrTemplate(conv: Conversation, customer: Customer, message: Exclude<Outbound, { kind: 'template' }>,
    fallback: { name: TemplateName; locale: Locale; params: string[]; buttonUrlParam?: string }): Promise<'freeform' | 'template'> {
    if (this.canSendFreeform(conv)) { await this.send(conv, message); return 'freeform'; }
    await this.sendTemplate(conv, customer, fallback.name, fallback.locale, fallback.params, fallback.buttonUrlParam);
    return 'template';
  }

  private async deliver(conv: Conversation, message: Outbound, templateName: string | null, preview?: string): Promise<string> {
    const sent = await this.client.send(conv.wa_id, message);
    const now = this.now().toISOString();
    try {
      await this.store.insertMessage(conv.id, {
        direction: 'out', type: message.kind === 'template' ? 'template' : message.kind === 'text' ? 'text' : 'interactive',
        body: preview ?? renderText(message), template_name: templateName, wa_message_id: sent.waMessageId,
      });
      await this.store.updateConversation(conv.id, { last_outbound_at: now });
    } catch (e) {
      log.error('failed to record outbound message', { error: (e as Error).message });
    }
    conv.last_outbound_at = now;
    return sent.waMessageId;
  }
}
