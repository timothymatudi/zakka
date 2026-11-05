import type { ConvState } from '../store/types';

/**
 * Conversation state machine (persisted in whatsapp_conversations.state).
 *
 *   idle --results--> browsing --pick_dropship--> confirming --buy--> collecting_address
 *        --address_confirmed--> awaiting_payment --paid--> idle
 *              \          |  \--pick_affiliate--> browsing (link sent)     |back-> browsing
 *               no_results|cancel -> idle                                  |cancel -> idle
 *   any --handoff--> human_handoff --resume--> idle        any --stop--> idle (opted out)
 */
export type FlowEvent =
  | 'results' | 'no_results' | 'pick_dropship' | 'pick_affiliate' | 'buy' | 'address_received' | 'address_confirmed' | 'back' | 'cancel'
  | 'paid' | 'payment_failed' | 'handoff' | 'resume' | 'stop' | 'start' | 'greeting' | 'tracking' | 'support';

const T: Record<ConvState, Partial<Record<FlowEvent, ConvState>>> = {
  idle: { results: 'browsing', no_results: 'idle', greeting: 'idle', tracking: 'idle', support: 'idle', paid: 'idle', payment_failed: 'idle', cancel: 'idle' },
  browsing: { results: 'browsing', no_results: 'idle', pick_dropship: 'confirming', pick_affiliate: 'browsing', back: 'browsing', cancel: 'idle', greeting: 'idle', tracking: 'browsing', support: 'browsing', paid: 'idle', payment_failed: 'browsing' },
  confirming: { buy: 'collecting_address', back: 'browsing', cancel: 'idle', results: 'browsing', no_results: 'idle', pick_dropship: 'confirming', pick_affiliate: 'browsing', greeting: 'idle', tracking: 'confirming', support: 'confirming', paid: 'idle', payment_failed: 'confirming' },
  collecting_address: { address_received: 'collecting_address', address_confirmed: 'awaiting_payment', back: 'browsing', cancel: 'idle', results: 'browsing', no_results: 'collecting_address', greeting: 'collecting_address', tracking: 'collecting_address', support: 'collecting_address', paid: 'idle', payment_failed: 'collecting_address' },
  awaiting_payment: { paid: 'idle', payment_failed: 'confirming', cancel: 'idle', results: 'browsing', no_results: 'awaiting_payment', back: 'browsing', pick_dropship: 'confirming', pick_affiliate: 'awaiting_payment', greeting: 'awaiting_payment', tracking: 'awaiting_payment', support: 'awaiting_payment' },
  human_handoff: { resume: 'idle', paid: 'human_handoff', payment_failed: 'human_handoff', tracking: 'human_handoff' },
};

/** Returns the next state, or null when the event is not valid in the current state. */
export function transition(state: ConvState, event: FlowEvent): ConvState | null {
  if (event === 'stop' || event === 'start') return state === 'human_handoff' ? 'human_handoff' : 'idle';
  if (event === 'handoff') return 'human_handoff';
  return T[state]?.[event] ?? null;
}
