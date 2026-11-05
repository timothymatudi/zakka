import Anthropic from '@anthropic-ai/sdk';
import { log } from '../log';
import type { Locale } from '../shared';

export interface OrderSummary { ref: string; status: string; total: string; created_at: string; items: string[]; tracking_url: string | null }
export interface ProductSummary { title: string; price: string; delivery: string; source: string; affiliate: boolean }

export interface SupportContext {
  question: string;
  locale: Locale;
  country: string | null;
  /** This customer's orders only (most recent first). */
  orders: OrderSummary[];
  /** Products recently shown to this customer. */
  products: ProductSummary[];
  /** Live catalogue search for the customer's country (grounding for product questions). */
  searchProducts?: (query: string) => Promise<ProductSummary[]>;
}
export interface SupportAnswer { reply: string; handoff: boolean; reason?: string }

export interface SupportAI { readonly mock: boolean; answer(ctx: SupportContext): Promise<SupportAnswer> }

const LANG_NAMES: Record<Locale, string> = { en: 'English', es: 'Spanish', fr: 'French', pt: 'Portuguese', ar: 'Arabic', zh: 'Chinese (Simplified)', hi: 'Hindi', sw: 'Swahili', de: 'German', id: 'Indonesian' };

// Frozen system prompt (no per-request data) so it caches across customers.
const SYSTEM = `You are Zakka's WhatsApp shopping concierge, answering customer support questions.
Ground every statement in tool results. Look up orders with get_orders / get_order and products with search_products before answering questions about them.
Never invent order details, prices, delivery dates, refund outcomes or store policies that the tools did not return.
Hand off to a human (handoff: true) for refunds, returns, damaged or missing items, payment disputes, complaints, legal or safety issues, or whenever the data does not answer the question; the reply then tells the customer a team member will follow up here.
Write short WhatsApp replies (at most 3 sentences, plain text, no markdown headings) in the language the request names.
Finish every turn by calling reply_to_customer exactly once with the final reply.`;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'get_orders',
    description: "List this customer's most recent orders (reference, status, total, items, tracking link).",
    strict: true,
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'get_order',
    description: "Get one of this customer's orders by its reference, e.g. ZK-1A2B3C4D.",
    strict: true,
    input_schema: { type: 'object', properties: { order_ref: { type: 'string' } }, required: ['order_ref'], additionalProperties: false },
  },
  {
    name: 'search_products',
    description: "Search Zakka's catalogue for products that ship to the customer's country. Returns title, local price, delivery estimate, source, and whether it is an affiliate offer.",
    strict: true,
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
  },
  {
    name: 'reply_to_customer',
    description: 'Send the final reply to the customer. Call exactly once, last.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        reply: { type: 'string', description: 'The WhatsApp message to send, in the requested language.' },
        handoff: { type: 'boolean', description: 'True when a human agent must take over.' },
        reason: { type: 'string', description: 'Short internal reason (for hand-offs), or empty.' },
      },
      required: ['reply', 'handoff', 'reason'],
      additionalProperties: false,
    },
  },
];
// Cache the (static) tools + system prefix.
const SYSTEM_BLOCKS: Anthropic.Beta.BetaTextBlockParam[] = [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }];

/** Models that accept server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1']);
const MAX_TURNS = 5;

/** Anthropic Messages API via the official SDK: a small manual tool loop over this customer's data. */
export class AnthropicSupport implements SupportAI {
  readonly mock = false;
  private client: Anthropic;
  constructor(apiKey: string, private model: string, client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey, timeout: 30_000, maxRetries: 2 });
  }

  private async runTool(name: string, input: Record<string, unknown>, ctx: SupportContext): Promise<unknown> {
    switch (name) {
      case 'get_orders': return ctx.orders;
      case 'get_order': {
        const ref = String(input.order_ref ?? '').toUpperCase().trim();
        return ctx.orders.find((o) => o.ref === ref) ?? { error: `No order ${ref} for this customer.` };
      }
      case 'search_products': {
        if (!ctx.searchProducts) return ctx.products;
        return ctx.searchProducts(String(input.query ?? ''));
      }
      default: return { error: `Unknown tool ${name}` };
    }
  }

  async answer(ctx: SupportContext): Promise<SupportAnswer> {
    const messages: Anthropic.Beta.BetaMessageParam[] = [{
      role: 'user',
      content: `Reply language: ${LANG_NAMES[ctx.locale]}\nCustomer country: ${ctx.country ?? 'unknown'}\n` +
        `Products recently shown: ${JSON.stringify(ctx.products)}\n\nCustomer message:\n${ctx.question.slice(0, 2000)}`,
    }];
    const fallback = FALLBACK_MODELS.has(this.model)
      ? { betas: ['server-side-fallback-2026-07-01' as const], fallbacks: 'default' as const }
      : {};
    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const res = await this.client.beta.messages.create({
          model: this.model,
          max_tokens: 4000,
          system: SYSTEM_BLOCKS,
          tools: TOOLS,
          output_config: { effort: 'low' }, // chat-style support: low effort keeps latency down
          messages,
          ...fallback,
        });
        if (res.stop_reason === 'refusal') {
          return { reply: '', handoff: true, reason: `refusal:${res.stop_details?.category ?? 'unknown'}` };
        }
        const toolUses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
        const final = toolUses.find((b) => b.name === 'reply_to_customer');
        if (final) {
          const a = final.input as { reply?: unknown; handoff?: unknown; reason?: unknown };
          if (typeof a.reply !== 'string' || typeof a.handoff !== 'boolean') return { reply: '', handoff: true, reason: 'invalid_reply' };
          return { reply: a.reply.trim(), handoff: a.handoff, reason: typeof a.reason === 'string' && a.reason ? a.reason : undefined };
        }
        if (!toolUses.length) {
          // Ended without the reply tool: use plain text if any, otherwise escalate.
          const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
          return text ? { reply: text, handoff: false } : { reply: '', handoff: true, reason: `no_reply:${res.stop_reason}` };
        }
        messages.push({ role: 'assistant', content: res.content });
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const tu of toolUses) {
          try {
            const out = await this.runTool(tu.name, tu.input as Record<string, unknown>, ctx);
            results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out) });
          } catch (e) {
            results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Tool failed: ${(e as Error).message}`, is_error: true });
          }
        }
        messages.push({ role: 'user', content: results });
      }
      return { reply: '', handoff: true, reason: 'too_many_turns' };
    } catch (e) {
      const reason = e instanceof Anthropic.RateLimitError ? 'ai_rate_limited'
        : e instanceof Anthropic.AuthenticationError ? 'ai_auth_error'
          : e instanceof Anthropic.APIError ? `ai_api_error_${e.status ?? 'network'}` : 'ai_error';
      log.error('AI support failed, handing off to a human', { reason, error: (e as Error).message });
      return { reply: '', handoff: true, reason };
    }
  }
}

const ESCALATE = /refund|return|broken|damaged|missing|wrong item|complain|fraud|scam|chargeback|reembols|devoluci|rembours|cassé|reembolso|devolu|erstatt|kaputt|rückgabe|pengembalian|rusak|rudisha|imeharibika|استرداد|إرجاع|تالف|退款|退货|损坏|रिफ़ंड|वापसी|टूटा/i;

/** Offline stand-in: deterministic, grounded only in the provided data. */
export class MockSupport implements SupportAI {
  readonly mock = true;
  async answer(ctx: SupportContext): Promise<SupportAnswer> {
    if (ESCALATE.test(ctx.question)) return { reply: '', handoff: true, reason: 'escalation_keyword' };
    const o = ctx.orders[0];
    if (o) {
      return { reply: `[mock AI] Your latest order ${o.ref} is ${o.status} (${o.total}).${o.tracking_url ? ` Tracking: ${o.tracking_url}` : ''}`, handoff: false };
    }
    return { reply: '', handoff: true, reason: 'no_grounding_data' };
  }
}

export function createSupportAI(cfg: { apiKey: string; model: string }): SupportAI {
  if (cfg.apiKey) return new AnthropicSupport(cfg.apiKey, cfg.model);
  log.warn('ANTHROPIC_API_KEY empty: support replies use the offline mock');
  return new MockSupport();
}
