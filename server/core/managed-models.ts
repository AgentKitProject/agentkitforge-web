// Managed (in-house, prepaid-credit) model catalog for Web Forge.
//
// These are the models the inference gateway can bill for. The ids MUST match a
// row in @agentkitforge/gateway-core's pricing table (src/core/pricing.ts) so
// the credit hold/debit is priced correctly; unknown ids fall back to the
// conservative Sonnet "_unknown" rate. The `tier` is a relative cost hint
// derived from that price table (cheaper / standard / premium).
//
// Shared by the server (default-model resolution, /api/managed/models) and the
// client (managed model selector). Pure data — safe to import on both sides.

export type ManagedModelTier = "cheaper" | "standard" | "premium";

export type ManagedModel = {
  /** Canonical model id — must exist in the gateway pricing table. */
  id: string;
  /** Human label for the selector. */
  label: string;
  /** Relative cost hint from the price table. */
  tier: ManagedModelTier;
};

// Ordered cheapest → most capable. Ids verified against the installed
// gateway-core pricing table (claude-haiku-3-5 / claude-sonnet-4-5 /
// claude-opus-4-5). Keep in sync if the price table gains newer rows.
export const MANAGED_MODELS: ManagedModel[] = [
  { id: "claude-haiku-3-5", label: "Claude Haiku 3.5 (fastest, cheapest)", tier: "cheaper" },
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5 (balanced)", tier: "standard" },
  { id: "claude-opus-4-5", label: "Claude Opus 4.5 (most capable)", tier: "premium" }
];

// Balanced default used when the caller does not request a model. Must equal
// MANAGED_DEFAULT_MODEL in server/core/ai-draft.ts.
export const MANAGED_DEFAULT_MODEL = "claude-sonnet-4-5";

/** True if `id` is one of the managed models we offer in the selector. */
export function isManagedModel(id: string | undefined): boolean {
  return !!id && MANAGED_MODELS.some((m) => m.id === id);
}
