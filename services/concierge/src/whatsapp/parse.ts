/** Normalised inbound WhatsApp message (from the Cloud API webhook payload). */
export interface Inbound {
  waMessageId: string;
  from: string; // wa_id, digits only (E.164 without '+')
  timestamp: Date;
  name?: string;
  type: string; // text | interactive | button | image | ...
  text: string; // user-visible text (body, or the title of the tapped option)
  replyId?: string; // id of the tapped list row / button (or template quick-reply payload)
}

interface WaMessage {
  id: string;
  from: string;
  timestamp?: string;
  type: string;
  text?: { body?: string };
  interactive?: { type: string; list_reply?: { id: string; title: string }; button_reply?: { id: string; title: string } };
  button?: { payload?: string; text?: string };
  image?: { caption?: string };
}

export function parseWebhook(payload: unknown): Inbound[] {
  const out: Inbound[] = [];
  const p = payload as { object?: string; entry?: { changes?: { field?: string; value?: { contacts?: { wa_id: string; profile?: { name?: string } }[]; messages?: WaMessage[] } }[] }[] };
  if (!p || p.object !== 'whatsapp_business_account' || !Array.isArray(p.entry)) return out;
  for (const entry of p.entry) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      if (!v?.messages) continue; // statuses (sent/delivered/read) are ignored
      for (const m of v.messages) {
        if (!m?.id || !m.from) continue;
        const name = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name;
        const reply = m.interactive?.list_reply ?? m.interactive?.button_reply;
        out.push({
          waMessageId: m.id,
          from: m.from.replace(/\D/g, ''),
          timestamp: m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date(),
          name,
          type: m.type,
          text: m.text?.body ?? reply?.title ?? m.button?.text ?? m.image?.caption ?? '',
          replyId: reply?.id ?? m.button?.payload,
        });
      }
    }
  }
  return out;
}
