// Gateway composition root for Web Forge (managed prepaid-credit inference).
//
// Wires @agentkitforge/gateway-core to this app's runtime:
//   - DynamoCreditLedgerRepository over the 4 GatewayCredit* / GatewaySessions
//     DynamoDB tables (names from GATEWAY_*_TABLE env via loadDynamoTableNames),
//     using the SAME AWS region/credentials as the KitStore aws adapter
//     (awsClientEnv() / FORGE_AWS_*).
//   - createManagedAnthropicProvider() — reads the PLATFORM ANTHROPIC_API_KEY.
//     If ANTHROPIC_API_KEY is unset, the provider factory throws inertly and
//     managed turns surface a clear "not configured" error; BYO is unaffected.
//
// Managed mode charges the buyer's prepaid credit balance for each turn via the
// two-phase hold flow in runManagedTurn (reserveHold → sendMessage →
// settleHold/release). BYO mode never touches the ledger (handled in ai-draft).
import {
  DynamoCreditLedgerRepository,
  createDynamoDBDocumentClient,
  createManagedAnthropicProvider,
  loadDynamoTableNames,
  runManagedTurn,
  InsufficientCreditsError,
  type ChatRequest,
  type ChatResponse,
  type CreditAccount,
  type CreditLedgerRepository,
  type ManagedTurnDeps
} from "@agentkitforge/gateway-core";
import { awsClientEnv } from "@/server/aws-client";

export { InsufficientCreditsError };

// US cents → USD currency. The ledger is single-currency (USD) by design.
export const CREDITS_CURRENCY = "USD";

let ledgerSingleton: CreditLedgerRepository | null = null;

/**
 * The shared DynamoDB credit ledger. Built lazily so apps that never touch
 * managed inference (e.g. self-host without credits) don't require the tables.
 * Throws if any GATEWAY_*_TABLE env var is missing (fail-fast misconfig).
 */
export function getCreditLedger(): CreditLedgerRepository {
  if (!ledgerSingleton) {
    const tables = loadDynamoTableNames(process.env);
    const env = awsClientEnv();
    const db = createDynamoDBDocumentClient({
      region: env.region,
      ...(env.credentials ? { credentials: env.credentials } : {})
    });
    ledgerSingleton = new DynamoCreditLedgerRepository(db, tables);
  }
  return ledgerSingleton;
}

/** ISO-8601 clock injected into the ledger + managed-turn service. */
function now(): string {
  return new Date().toISOString();
}

function markupBps(): number | undefined {
  const raw = process.env.GATEWAY_MARKUP_BPS;
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Returns the user's available balance in US cents (0 if the account does not
 * yet exist). Read-only — does not create the account row.
 */
export async function getBalanceCents(userId: string): Promise<number> {
  const account = await getCreditLedger().getAccount(userId);
  return account?.availableBalanceCents ?? 0;
}

/**
 * Dev/admin credit grant (pre-Stripe). Tops up the user's balance via the
 * ledger `topup` (idempotently ensures the account first). Returns the updated
 * account. Gating to an admin allowlist is the caller's responsibility (route).
 */
export async function devGrantCredits(
  userId: string,
  amountCents: number,
  sourceRef = "dev-grant"
): Promise<CreditAccount> {
  const ledger = getCreditLedger();
  const ts = now();
  await ledger.ensureAccount(userId, ts);
  return ledger.topup(userId, amountCents, ts, sourceRef);
}

export type ManagedChatResult = {
  response: ChatResponse;
  debitedCents: number;
  balanceCents: number;
};

/**
 * Runs one managed (credit-gated) inference turn against the PLATFORM Anthropic
 * key. Composes the managed provider + credit ledger and delegates the
 * reserve→call→settle/release flow to gateway-core's runManagedTurn.
 *
 * @throws InsufficientCreditsError  if the pre-call hold cannot be reserved.
 * @throws Error                     if ANTHROPIC_API_KEY is unset (inert) or
 *                                   the provider call fails (hold released).
 */
export async function runManagedChat(
  userId: string,
  request: ChatRequest,
  opts: { estimatedInputTokens?: number; sourceRef?: string } = {}
): Promise<ManagedChatResult> {
  const chatProvider = createManagedAnthropicProvider();
  const deps: ManagedTurnDeps = {
    chatProvider,
    ledger: getCreditLedger(),
    now,
    ...(markupBps() !== undefined ? { markupBps: markupBps() } : {})
  };
  const result = await runManagedTurn(deps, {
    userId,
    request,
    estimatedInputTokens: opts.estimatedInputTokens,
    sourceRef: opts.sourceRef
  });
  return {
    response: result.response,
    debitedCents: result.debitedCents,
    balanceCents: result.balanceCents
  };
}
