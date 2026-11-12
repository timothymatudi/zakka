/** The policy pages under /legal. `affiliates` has its own page. */
export const POLICIES = ['privacy', 'terms', 'shipping-returns', 'contact'] as const;
export type Policy = (typeof POLICIES)[number];

export const isPolicy = (value: string): value is Policy => (POLICIES as readonly string[]).includes(value);

/**
 * True until the owner has had the wording reviewed and filled in the company details
 * (`policies.company` in messages/en.json). While true, each page shows a draft notice and is
 * kept out of search engines.
 */
export const POLICY_DRAFT = true;

/** Date the policy text last changed (ISO). Update it with every change to the wording. */
export const POLICY_UPDATED = '2026-11-12';
