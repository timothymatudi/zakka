/** Keyword intents. STOP/START are exact (whole-message) matches so "stop light" is still a search. */
const norm = (s: string) => s.toLowerCase().normalize('NFC').replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();

export const STOP_WORDS = new Set([
  // en
  'stop', 'stop all', 'unsubscribe', 'opt out', 'optout', 'cancel subscription', 'end', 'quit', 'stop messages',
  // es
  'baja', 'darme de baja', 'parar', 'detener', 'cancelar suscripción', 'no más mensajes',
  // fr
  'arrêt', 'arret', 'arrêter', 'arreter', 'stopper', 'désabonner', 'desabonner', 'se désabonner', 'désinscription',
  // pt
  'sair', 'cancelar inscrição', 'descadastrar', 'pare',
  // ar
  'توقف', 'إيقاف', 'ايقاف', 'إلغاء الاشتراك', 'الغاء الاشتراك',
  // zh
  '退订', '停止', '取消订阅', 'td',
  // hi
  'रोकें', 'रोको', 'बंद करो', 'बंद करें', 'अनसब्सक्राइब', 'सदस्यता रद्द करें',
  // sw
  'acha', 'simamisha', 'jiondoe', 'ondoa', 'sitaki ujumbe',
  // de
  'stopp', 'abmelden', 'abbestellen', 'austragen',
  // id
  'berhenti', 'berhenti langganan', 'stop langganan',
]);

export const START_WORDS = new Set([
  'start', 'subscribe', 'opt in', 'optin', 'unstop', 'yes deals',
  'alta', 'suscribir', 'suscribirme', 'empezar', "s'abonner", 'abonner', 'inscrever', 'assinar', 'começar',
  'اشتراك', 'ابدأ', '订阅', '开始', 'शुरू', 'सदस्यता लें', 'anza', 'jiunge', 'anmelden', 'abonnieren', 'mulai', 'langganan',
]);

export const isStop = (text: string) => STOP_WORDS.has(norm(text));
export const isStart = (text: string) => START_WORDS.has(norm(text));

const CANCEL = new Set(['cancel', 'cancelar', 'annuler', 'abbrechen', 'stornieren', 'batal', 'batalkan', 'ghairi', 'إلغاء', 'الغاء', '取消', 'रद्द', 'रद्द करें', 'never mind', 'nevermind']);
export const isCancel = (text: string) => CANCEL.has(norm(text));

const GREETING = new Set(['hi', 'hello', 'hey', 'hola', 'bonjour', 'salut', 'olá', 'ola', 'oi', 'hallo', 'halo', 'habari', 'jambo', 'mambo', 'salaam', 'مرحبا', 'السلام عليكم', '你好', 'नमस्ते', 'menu', 'help', 'start over']);
export const isGreeting = (text: string) => GREETING.has(norm(text));

const TRACKING = /where.{0,12}(my )?(order|package|parcel)|track(ing)?\b|order status|dónde está mi (pedido|paquete)|estado de mi pedido|où (est|en est) ma commande|suivi de (ma )?commande|onde está (o )?meu pedido|rastrear|wo ist meine (bestellung|lieferung|sendung)|sendungsverfolgung|di ?mana pesanan|lacak|status pesanan|oda yangu iko wapi|iko wapi oda|fuatilia|agizo langu|أين طلبي|تتبع|طلبي|我的订单|订单.{0,4}(在哪|状态)|物流|मेरा ऑर्डर|ऑर्डर कहाँ|ट्रैक/i;
export const isTracking = (text: string) => TRACKING.test(text);

const HUMAN = /\b(human|agent|real person|operator|representative)\b|hablar con (una )?persona|agente|conseiller|parler à quelqu|atendente|mitarbeiter|menschen|manusia|petugas|mtu halisi|wakala|موظف|إنسان|人工|客服|इंसान|एजेंट/i;
export const isHumanRequest = (text: string) => HUMAN.test(text);

const SUPPORT = /refund|return|broken|damaged|missing|wrong item|complain|problem|issue|payment failed|charged twice|reembols|devoluci|problema|rembours|cassé|retour|reembolso|devolu|erstatt|kaputt|rückgabe|problem|pengembalian|rusak|masalah|rudisha|imeharibika|tatizo|استرداد|إرجاع|تالف|مشكلة|退款|退货|损坏|问题|रिफ़ंड|वापसी|टूटा|समस्या/i;
export const isSupport = (text: string) => SUPPORT.test(text);

const RESUME_BOT = new Set(['bot', 'menu', 'zakka', 'restart']);
export const isResumeBot = (text: string) => RESUME_BOT.has(norm(text));

/** "1", "2", "3" typed instead of tapping a list row. */
export function pickIndex(text: string): number | null {
  const m = /^\s*#?([1-9])\s*$/.exec(text);
  return m ? Number(m[1]) - 1 : null;
}
