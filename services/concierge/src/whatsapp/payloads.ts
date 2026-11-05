import { randomUUID } from 'node:crypto';

/** Builds a Cloud API webhook payload exactly like Meta sends it (used by the simulator and tests). */
export function inboundPayload(from: string, msg: { text?: string; listReply?: { id: string; title: string }; buttonReply?: { id: string; title: string } }, opts: { id?: string; timestamp?: Date; name?: string } = {}) {
  const waId = from.replace(/\D/g, '');
  const ts = Math.floor((opts.timestamp ?? new Date()).getTime() / 1000).toString();
  const base = { from: waId, id: opts.id ?? `wamid.sim.${randomUUID()}`, timestamp: ts };
  const message = msg.listReply
    ? { ...base, type: 'interactive', interactive: { type: 'list_reply', list_reply: msg.listReply } }
    : msg.buttonReply
      ? { ...base, type: 'interactive', interactive: { type: 'button_reply', button_reply: msg.buttonReply } }
      : { ...base, type: 'text', text: { body: msg.text ?? '' } };
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA_ID',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '15550000000', phone_number_id: 'PHONE_NUMBER_ID' },
          contacts: [{ profile: { name: opts.name ?? 'Simulated User' }, wa_id: waId }],
          messages: [message],
        },
      }],
    }],
  };
}
