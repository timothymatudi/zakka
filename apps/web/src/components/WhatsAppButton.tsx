import { getTranslations } from 'next-intl/server';
import { whatsappLink } from '@/lib/format';
import { ChatIcon } from './icons';

/** Always-visible concierge button (contract: "WhatsApp button always visible"). */
export async function WhatsAppButton() {
  const t = await getTranslations('whatsapp');
  return (
    <a
      href={whatsappLink(t('prefill'))}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-4 end-4 z-40 inline-flex items-center gap-2 rounded-full bg-wa px-4 py-3 font-bold text-white shadow-lg shadow-black/15 hover:brightness-110"
    >
      <ChatIcon />
      <span className="text-sm">{t('chat')}</span>
    </a>
  );
}
