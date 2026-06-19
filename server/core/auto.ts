// AgentKitAuto composition root for Web Forge — Phase A.
//
// Wires the NEW @agentkitforge/auto-core package (hosted, on-demand,
// run-to-completion autonomous Agent Kit runs) into this app's runtime,
// mirroring the gateway composition roots (server/core/gateway.ts,
// gateway-sessions.ts, forge-gateway-sessions.ts):
//
//   - STORAGE      — makeAutoDeps({ backend }) keyed off KITSTORE_BACKEND, using
//                    the SAME FORGE_AWS_* region/credentials as the KitStore +
//                    credit ledger, and the new AUTO_RUNS_TABLE/AUTO_APPROVALS_TABLE
//                    DynamoDB tables (defaults AutoRuns/AutoApprovals).
//   - BILLING      — the PLATFORM Anthropic provider + the gateway credit ledger,
//                    reused verbatim from the gateway (createManagedAnthropicProvider
//                    + getCreditLedger()). Auto NEVER invents billing — every model
//                    turn runs through gateway-core's managed-turn pricing.
//   - KIT CONTEXT  — resolveKitContext resolves a kit (KitStore id OR Market ref) to
//                    { systemPrompt, tools, model } SERVER-SIDE, reusing the
//                    gateway's resolution + classifyKit / protected-kit path. For a
//                    protected/paid kit the prompt is fetched server-side and is
//                    NEVER returned to the browser.
//   - DISPATCH     — an injectable dispatcher. Phase A ships an IN-PROCESS async
//                    dispatcher (processAutoRun invoked fire-and-forget after the
//                    route responds). This is DEV / SELF-HOST ONLY — see the big
//                    note on inProcessDispatcher below. Hosted long-running
//                    execution requires the DEFERRED Fargate / k8s-Job worker
//                    (Amplify SSR functions cannot host a long autonomous run).
//
// AUTH NOTE: this module is auth-agnostic. The cookie route (/api/auto/*) and the
// bearer route (/api/forge/auto/*) each resolve `userId` with their OWN auth
// helper and call the SAME functions here. The two auth paths never mix (CLAUDE.md
// hard rule #4); they only converge on this shared, userId-keyed core logic.

import {
  ApprovalDeniedError,
  makeAutoDeps,
  processAutoRun,
  type AutoApproval,
  type AutoBackend,
  type AutoRun,
  type AutoStorageDeps,
  type CreateApprovalInput,
  type CreateRunInput,
  type KitRef,
  type ProcessAutoRunDeps,
  type ResolveKitContext,
  type ResolvedKitContext
} from "@agentkitforge/auto-core";
import {
  AnthropicChatProvider,
  createManagedAnthropicProvider,
  type ChatProvider,
  type ToolDefinition
} from "@agentkitforge/gateway-core";
import { awsClientEnv } from "@/server/aws-client";
import { fargateDispatcher } from "@/server/core/auto-fargate-dispatcher";
import { getBalanceCents, getCreditLedger } from "@/server/core/gateway";
import { getUserSettingsStore } from "@/server/store/user-settings";
import { getKitStore } from "@/server/store/index";
import { withEphemeralTree } from "@/server/core/runner";
import { MANAGED_DEFAULT_MODEL, isManagedModel } from "@/server/core/managed-models";
import {
  classifyKit,
  resolveProtectedSystemPrompt,
  resolveProtectedSystemPromptViaService,
  ProtectedKitServiceError,
  type ProtectedKitRef
} from "@/server/core/protected-kits";
import type { StoredSession, TokenStore } from "@agentkitforge/core/market";

export { ApprovalDeniedError };
export type { AutoApproval, AutoRun, KitRef };

// ---------------------------------------------------------------------------
// Storage deps (singleton)
// ---------------------------------------------------------------------------

let storageSingleton: AutoStorageDeps | null = null;

/** Maps KITSTORE_BACKEND → an auto-core storage backend. local → "aws" deps are
 *  not built; instead local/dev uses the aws adapter pointed at whatever DynamoDB
 *  the FORGE_AWS_* creds resolve (local DynamoDB or a real table). selfhost →
 *  Postgres. We follow the KitStore's backend selector so Auto storage always
 *  lives next to the rest of the app's persistence. */
function autoBackend(): AutoBackend {
  const raw = (process.env.KITSTORE_BACKEND || "local").toLowerCase();
  // selfhost → Postgres adapter; aws + local(dev) → DynamoDB adapter.
  return raw === "selfhost" ? "selfhost" : "aws";
}

function autoTableNames(): { runs: string; approvals: string } {
  return {
    runs: process.env.AUTO_RUNS_TABLE || "AutoRuns",
    approvals: process.env.AUTO_APPROVALS_TABLE || "AutoApprovals"
  };
}

/**
 * The shared auto-core storage deps (runs + approvals repos + ephemeral
 * workspace). Built lazily so deployments that never use Auto don't require the
 * tables. For the aws backend it composes against the SAME region/credentials as
 * the KitStore + credit ledger (awsClientEnv / FORGE_AWS_*).
 */
export async function getAutoStorage(): Promise<AutoStorageDeps> {
  if (storageSingleton) return storageSingleton;
  const backend = autoBackend();
  if (backend === "selfhost") {
    // Reuse the KitStore's Postgres pool so Auto rows live in the same database.
    const { getSelfHostPgPool } = await import("@/server/store/selfhost-user-settings");
    const pool = await getSelfHostPgPool();
    storageSingleton = makeAutoDeps({ backend: "selfhost", pool });
  } else {
    const env = awsClientEnv();
    const { createDynamoDBDocumentClient } = await import("@agentkitforge/auto-core");
    const db = createDynamoDBDocumentClient({
      region: env.region,
      ...(env.credentials ? { credentials: env.credentials } : {})
    });
    storageSingleton = makeAutoDeps({ backend: "aws", db, tables: autoTableNames() });
  }
  return storageSingleton;
}

/** ISO-8601 clock. */
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
 * The Auto MANAGED markup, in basis points. Separate from the interactive
 * gateway's GATEWAY_MARKUP_BPS (1500/15%) — Auto managed inference is marked up
 * at AUTO_MARKUP_BPS (default 2500 = 25%). Server-chosen; never client-supplied.
 */
export function autoMarkupBps(): number {
  const raw = process.env.AUTO_MARKUP_BPS;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 2500; // 25%
}

/**
 * Per-minute cloud-run compute fee, in US cents. This fee is charged ONLY on
 * BYO + cloud (Fargate/hosted) Auto runs — we run their job on our compute but
 * collect no inference markup. The default (1¢/min) is a documented placeholder
 * and TUNABLE via AUTO_CLOUD_RUN_CENTS_PER_MIN. It never affects managed runs
 * (compute is bundled into the 25% markup), local/desktop, or self-host runs.
 */
function cloudRunCentsPerMin(): number {
  const raw = process.env.AUTO_CLOUD_RUN_CENTS_PER_MIN;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return 1; // placeholder default — tunable
}

// ---------------------------------------------------------------------------
// Kit-context resolution (server-side — reuses the gateway's resolution)
// ---------------------------------------------------------------------------

const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant running an Agent Kit.";

/** A read-only TokenStore seeded with a WorkOS bearer (forge path) — mirrors
 *  protected-kits.createBearerTokenStore, re-declared here so the cookie path can
 *  also pass a forwarded token when it has one. */
function bearerTokenStore(accessToken: string): TokenStore {
  const session: StoredSession = { accessToken, connectedAt: new Date().toISOString() };
  return {
    async get() {
      return session;
    },
    async set() {
      /* device-auth / forwarding client owns the lifecycle */
    },
    async clear() {
      /* no-op */
    }
  };
}

/** Lazily loads the cookie-session forwarding store (DYNAMIC import so the
 *  AuthKit-coupled module is never pulled into the forge bearer route's import
 *  graph — same discipline as gateway-sessions.ts). */
async function forwardingStore(): Promise<TokenStore> {
  const { createForwardingStore } = await import("@/server/core/import-ops");
  return createForwardingStore();
}

/** How a run's kit context is sourced for Auto — supplied per request by the
 *  route so the cookie path can use the cookie forwarding store and the forge
 *  path can use its already-verified bearer (never mixing the two). */
export interface KitContextOptions {
  /** A forwarded WorkOS bearer (forge path). When absent the cookie forwarding
   *  store is used for protected/Market lookups. */
  bearerToken?: string;
  /**
   * SERVICE MODE (hosted worker path, NO user session). When set, protected
   * Market kits are resolved server-to-service against the Market service
   * licensed-package endpoint using MARKET_SERVICE_KEY + this asserted userId,
   * instead of the user's live session. Entitlement is STILL enforced Market-side
   * (a non-entitled user is refused). Mutually exclusive with the interactive
   * (bearer / cookie) paths — never set alongside a real user session. */
  serviceUserId?: string;
}

/**
 * Builds the ResolveKitContext hook auto-core's worker calls once per run. It
 * resolves the kit referenced by the run SERVER-SIDE:
 *
 *   - source "local": load the kit tree from the KitStore (scoped to the run's
 *     userId) and assemble the system prompt via core's buildAgentKitContext —
 *     EXACTLY like the gateway's resolveSystemPrompt.
 *   - source "market": classify the kit; if PROTECTED (paid / online-only) fetch
 *     the kit content server-side (entitlement-gated, in-memory) via
 *     resolveProtectedSystemPrompt — the prompt is NEVER returned to the client.
 *     A free Market kit falls back to the default prompt (Phase A does not yet
 *     download free Market kits into the workspace executor — that is fine: the
 *     allowlisted file tools operate on the per-run workspace, not the kit).
 *
 * Tools: the kit's declared tools are intersected by auto-core against the
 * approval allowlist AND the Phase-A sandbox tool set (read_file/list_dir/
 * write_file). We surface the approval's allowlist as the kit tool declarations
 * so the executor has tool schemas to hand the model; auto-core hard-rejects
 * run_command and any non-sandbox tool regardless of what we pass.
 */
export function makeResolveKitContext(opts: KitContextOptions): ResolveKitContext {
  return async (run: AutoRun, approval: AutoApproval): Promise<ResolvedKitContext> => {
    const toolNames = approval.toolAllowlist;
    const tools: ToolDefinition[] = toolNames.map((name) => ({
      name,
      description: "",
      inputSchema: { type: "object" }
    }));

    const ref = run.kitRef;
    if (ref.source === "market") {
      const protectedRef: ProtectedKitRef = {
        slug: ref.slug ?? "",
        ...(ref.marketKitId ? { kitId: ref.marketKitId } : {})
      };
      // Without a slug we can't talk to Market — default-prompt fall back.
      if (!protectedRef.slug) {
        return { systemPrompt: DEFAULT_SYSTEM_PROMPT, tools, toolNames };
      }

      // SERVICE MODE (hosted worker, no user session): resolve protected kits
      // server-to-service with MARKET_SERVICE_KEY + the asserted userId. Market
      // enforces entitlement (a non-entitled user is refused). A free Market kit
      // keeps the Phase-A default-prompt behavior.
      if (opts.serviceUserId) {
        const resolved = await resolveProtectedSystemPromptViaService(opts.serviceUserId, protectedRef);
        const isProtected = resolved.pricing === "paid" || resolved.onlineOnly === true;
        return {
          systemPrompt: isProtected ? resolved.systemPrompt : DEFAULT_SYSTEM_PROMPT,
          tools,
          toolNames
        };
      }

      const store = opts.bearerToken ? bearerTokenStore(opts.bearerToken) : await forwardingStore();
      const classification = await classifyKit(store, protectedRef);
      if (classification.isProtected) {
        // Server-side fetch; the prompt is held in memory and never returned to
        // the browser (the run record stores no prompt — only the kitRef).
        const systemPrompt = await resolveProtectedSystemPrompt(store, protectedRef);
        return { systemPrompt, tools, toolNames };
      }
      // Free Market kit — default prompt for Phase A.
      return { systemPrompt: DEFAULT_SYSTEM_PROMPT, tools, toolNames };
    }

    // Local kit: load from the KitStore (scoped to the run owner).
    const localKitId = ref.localKitId;
    if (!localKitId) {
      return { systemPrompt: DEFAULT_SYSTEM_PROMPT, tools, toolNames };
    }
    const kitStore = await getKitStore();
    const tree = await kitStore.getKitTree(run.userId, localKitId);
    const { systemContext } = await withEphemeralTree(tree, async ({ kitRoot, core }) =>
      core.buildAgentKitContext({
        kitPath: kitRoot,
        mode: "all",
        target: "claude",
        includePolicies: true,
        includeTemplates: true,
        includeWorkflows: true,
        includePrompts: false
      })
    );
    const trimmed = systemContext.trim();
    return {
      systemPrompt: trimmed.length > 0 ? trimmed : DEFAULT_SYSTEM_PROMPT,
      tools,
      toolNames
    };
  };
}

// ---------------------------------------------------------------------------
// Billing-mode resolution (server-chosen; never client-supplied)
// ---------------------------------------------------------------------------

/** The per-run billing facts the run-create + worker paths need. */
export interface AutoBilling {
  /** "byo" → user's own key (no inference debit); "managed" → platform key + 25%. */
  inferenceMode: "managed" | "byo";
  /** Built only in BYO mode (user's Anthropic key); else undefined. */
  byoChatProvider?: ChatProvider;
  /** True when the active dispatcher runs on OUR hosted compute (Fargate). */
  isCloudRun: boolean;
  /** Per-minute cloud-run fee (cents). Only billed on BYO + cloud runs. */
  cloudRunCentsPerMin: number;
}

/**
 * Decides the billing mode for a run BEFORE it is created/dispatched.
 *
 * inferenceMode is "byo" ONLY when the user has a configured BYO provider AND
 * the kit is NOT protected/paid. PROTECTED/paid kits FORCE "managed" — a
 * protected kit must NEVER run on a BYO key (its prompt is fetched server-side
 * and never exposed; BYO is coerced to managed here, not rejected, so the run
 * can still proceed under prepaid credits).
 *
 * Phase A restricts BYO Auto to Anthropic-type providers (the gateway
 * ChatProvider is Anthropic-shaped); a non-Anthropic BYO provider falls back to
 * managed rather than failing the run.
 *
 * @param isCloudRun whether the active dispatcher runs on our hosted compute.
 */
export async function resolveAutoBilling(args: {
  userId: string;
  kitRef: KitRef;
  isCloudRun: boolean;
  kitContext: KitContextOptions;
}): Promise<AutoBilling> {
  const managed = (): AutoBilling => ({
    inferenceMode: "managed",
    isCloudRun: args.isCloudRun,
    cloudRunCentsPerMin: cloudRunCentsPerMin()
  });

  // PROTECTED/paid kit → FORCE managed (never run a protected kit on a BYO key).
  if (await isProtectedKit(args.kitRef, args.kitContext)) {
    return managed();
  }

  // Resolve the user's default BYO provider. Anthropic-type only in Phase A.
  const stored = await (await getUserSettingsStore()).resolveProvider(args.userId);
  if (stored && stored.providerType === "anthropic" && stored.apiKey) {
    const byoChatProvider = new AnthropicChatProvider({
      apiKey: stored.apiKey,
      ...(stored.baseUrl ? { baseUrl: stored.baseUrl } : {})
    });
    return {
      inferenceMode: "byo",
      byoChatProvider,
      isCloudRun: args.isCloudRun,
      cloudRunCentsPerMin: cloudRunCentsPerMin()
    };
  }
  return managed();
}

/** True when the kit is a protected/paid (or online-only) Market kit. Local
 *  kits and free Market kits are never protected.
 *
 *  In SERVICE MODE (worker, no session) protectedness is resolved via the Market
 *  service endpoint (MARKET_SERVICE_KEY) — entitlement is enforced there. We
 *  treat a refusal/error as "protected" so billing fails CLOSED to managed (a
 *  protected kit must never run on a BYO key); the context-resolution path then
 *  surfaces the not_entitled refusal authoritatively. */
async function isProtectedKit(kitRef: KitRef, opts: KitContextOptions): Promise<boolean> {
  if (kitRef.source !== "market" || !kitRef.slug) return false;
  const protectedRef: ProtectedKitRef = {
    slug: kitRef.slug,
    ...(kitRef.marketKitId ? { kitId: kitRef.marketKitId } : {})
  };
  if (opts.serviceUserId) {
    try {
      const resolved = await resolveProtectedSystemPromptViaService(opts.serviceUserId, protectedRef);
      return resolved.pricing === "paid" || resolved.onlineOnly === true;
    } catch {
      // Fail closed: treat an unresolved Market kit as protected so billing stays
      // managed; the authoritative refusal comes from context resolution.
      return true;
    }
  }
  const store = opts.bearerToken ? bearerTokenStore(opts.bearerToken) : await forwardingStore();
  const classification = await classifyKit(store, protectedRef);
  return classification.isProtected;
}

// ---------------------------------------------------------------------------
// processAutoRun deps (billing reuse)
// ---------------------------------------------------------------------------

function buildProcessDeps(
  storage: AutoStorageDeps,
  opts: KitContextOptions,
  billing: AutoBilling
): ProcessAutoRunDeps {
  return {
    storage,
    // PLATFORM Anthropic key — same managed provider the gateway uses. Inert
    // (throws) when ANTHROPIC_API_KEY is unset; a run then fails with a clear
    // error rather than billing the user.
    chatProvider: createManagedAnthropicProvider(),
    // BYO provider (user's own key) when this run is BYO; auto-core uses it
    // instead of the managed provider and does NOT debit inference.
    ...(billing.byoChatProvider ? { byoChatProvider: billing.byoChatProvider } : {}),
    inferenceMode: billing.inferenceMode,
    // SAME prepaid credit ledger as the rest of the app — managed inference goes
    // through the two-phase managed-turn flow; the BYO cloud-run compute fee
    // also debits this ledger.
    ledger: getCreditLedger(),
    resolveKitContext: makeResolveKitContext(opts),
    now,
    // Auto MANAGED inference is marked up at AUTO_MARKUP_BPS (25%), NOT the
    // interactive gateway's 15%.
    markupBps: autoMarkupBps()
  };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/** Dispatches a queued run for execution. Injectable so the hosted Fargate/k8s
 *  worker (deferred) can replace the in-process dev path without touching the
 *  routes. Carries the resolved billing (mode + BYO provider) so the worker
 *  bills correctly without re-resolving. */
export type AutoDispatcher = (
  runId: string,
  opts: KitContextOptions,
  billing: AutoBilling
) => Promise<void>;

/**
 * Whether the ACTIVE dispatcher runs the job on OUR hosted compute (Fargate /
 * hosted worker). The in-process dev/self-host dispatcher runs on the caller's
 * own machine, so it is NOT a cloud run — hence false. The deferred Fargate
 * dispatcher would set this true (so BYO runs incur the per-minute compute fee).
 */
let dispatcherIsCloudRun = false;

/** True if the active dispatcher executes on our hosted compute. */
export function isCloudRunDispatcher(): boolean {
  return dispatcherIsCloudRun;
}

/**
 * IN-PROCESS dispatcher — DEV / SELF-HOST ONLY.
 *
 * Invokes processAutoRun fire-and-forget AFTER the route has responded. This is
 * suitable for `next dev`, a self-hosted long-lived Node server (k8s Deployment),
 * and tests. It is NOT suitable for hosted Amplify SSR: an SSR/Lambda function is
 * killed shortly after the response is returned, so a long autonomous run started
 * in-process would be terminated mid-flight. Hosted long-running execution
 * requires the DEFERRED Fargate task / k8s Job worker (a separate ops slice),
 * which calls the SAME @agentkitforge/auto-core `processAutoRun(runId, deps)`
 * entrypoint with these exact deps. Do NOT rely on this path for hosted runs.
 */
export const inProcessDispatcher: AutoDispatcher = async (runId, opts, billing) => {
  const storage = await getAutoStorage();
  const deps = buildProcessDeps(storage, opts, billing);
  // Fire-and-forget: kick off the run and return immediately. Errors are already
  // recorded onto the run record by the worker (status "failed"); we swallow here
  // so an unhandled rejection can't crash the process.
  void processAutoRun(runId, deps).catch(() => {
    /* failure is persisted on the run record by processAutoRun */
  });
};

/** The active dispatcher. Defaults to in-process (dev/self-host); the hosted
 *  worker slice would swap this for a queue-enqueue implementation. */
let dispatcher: AutoDispatcher = inProcessDispatcher;

/** Test/ops seam: override the dispatcher (e.g. to assert dispatch in a test or
 *  to plug in the Fargate enqueue). `isCloudRun` declares whether the new
 *  dispatcher runs on our hosted compute (drives the BYO per-minute fee). */
export function setAutoDispatcher(next: AutoDispatcher, isCloudRun = false): void {
  dispatcher = next;
  dispatcherIsCloudRun = isCloudRun;
}

/**
 * One-time dispatcher selection at module import. HOSTED deploys opt into the
 * Fargate worker via AUTO_DISPATCH=fargate AND an AWS KitStore backend; every
 * other configuration (dev, self-host, local, unset) keeps the in-process
 * dispatcher. This MUST no-op to in-process when the envs are unset so tests that
 * call setAutoDispatcher() directly stay in control (test/auto.test.ts). The
 * @aws-sdk/client-ecs import only happens when fargate is actually selected.
 */
let dispatcherInitialized = false;
export function initAutoDispatcher(): void {
  if (dispatcherInitialized) return;
  dispatcherInitialized = true;
  const wantFargate = process.env.AUTO_DISPATCH === "fargate";
  const awsBackend = (process.env.KITSTORE_BACKEND || "local").toLowerCase() === "aws";
  if (wantFargate && awsBackend) {
    // Static import (top of module) — @aws-sdk/client-ecs is a normal dep, so
    // importing it is safe; we only ENGAGE the Fargate dispatcher when selected.
    setAutoDispatcher(fargateDispatcher, /* isCloudRun */ true);
  }
  // else: leave the default inProcessDispatcher (isCloudRun false).
}
// Run selection once at import. Guarded above so it never throws when envs are
// unset (it no-ops to in-process). Selection deliberately does NOT touch storage
// or AWS unless fargate is selected.
initAutoDispatcher();

// ---------------------------------------------------------------------------
// Public operations (shared by both auth paths)
// ---------------------------------------------------------------------------

export class AutoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutoValidationError";
  }
}

/**
 * Thrown when a BYO + cloud Auto run cannot be started because the user lacks
 * the small prepaid balance needed to cover the per-minute cloud-run fee's
 * up-front hold. Routes map this to a 402 (Payment Required).
 */
export class InsufficientComputeBalanceError extends Error {
  readonly requiredCents: number;
  readonly balanceCents: number;
  constructor(message: string, requiredCents: number, balanceCents: number) {
    super(message);
    this.name = "InsufficientComputeBalanceError";
    this.requiredCents = requiredCents;
    this.balanceCents = balanceCents;
  }
}

/** Create a standing approval. */
export async function createApproval(input: {
  userId: string;
  kitRef: KitRef;
  toolAllowlist: string[];
  maxBudgetCents: number;
}): Promise<AutoApproval> {
  if (!Number.isInteger(input.maxBudgetCents) || input.maxBudgetCents <= 0) {
    throw new AutoValidationError("maxBudgetCents must be a positive integer (US cents).");
  }
  const storage = await getAutoStorage();
  const createInput: CreateApprovalInput = {
    userId: input.userId,
    kitRef: input.kitRef,
    toolAllowlist: input.toolAllowlist,
    maxBudgetCents: input.maxBudgetCents,
    scope: "workspace_read_write",
    networkPolicy: "deny_all",
    createdAt: now()
  };
  return storage.approvals.createApproval(createInput);
}

/** List a user's standing approvals. */
export async function listApprovals(userId: string): Promise<AutoApproval[]> {
  const storage = await getAutoStorage();
  return storage.approvals.listApprovalsByUser(userId);
}

/** Revoke a standing approval (ownership-checked). Returns null if the approval
 *  does not exist or belongs to another user (treated as 404 by the route). */
export async function revokeApproval(userId: string, approvalId: string): Promise<AutoApproval | null> {
  const storage = await getAutoStorage();
  const owned = (await storage.approvals.listApprovalsByUser(userId)).find((a) => a.id === approvalId);
  if (!owned) return null;
  const updated = await storage.approvals.revokeApproval(approvalId, now());
  return updated ?? null;
}

/**
 * Start a run: enforce the standing-approval gate (a matching, non-revoked
 * approval must exist AND budgetCents <= approval.maxBudgetCents), persist the
 * queued run, then DISPATCH it. The approval gate is checked HERE (so we can
 * reject with a 403 before creating the run) and is ALSO re-checked inside
 * auto-core's processAutoRun (defense in depth).
 *
 * @throws AutoValidationError       on a bad budget / missing input (→ 400).
 * @throws ApprovalDeniedError       when no approval matches or budget > ceiling
 *                                   (→ 403). Re-uses auto-core's error type.
 */
export async function startRun(input: {
  userId: string;
  kitRef: KitRef;
  prompt: string;
  budgetCents: number;
  model?: string;
  files?: { path: string; content: string }[];
  kitContext: KitContextOptions;
}): Promise<AutoRun> {
  if (typeof input.prompt !== "string" || input.prompt.trim().length === 0) {
    throw new AutoValidationError("A run input prompt is required.");
  }
  // Budget is REQUIRED per run (no default — CLAUDE.md / auto-core safety rule).
  if (!Number.isInteger(input.budgetCents) || input.budgetCents <= 0) {
    throw new AutoValidationError("budgetCents is required and must be a positive integer (US cents).");
  }
  const model = isManagedModel(input.model) ? input.model! : MANAGED_DEFAULT_MODEL;

  const storage = await getAutoStorage();

  // ---- Approval gate (pre-create) ----------------------------------------
  const approval = await storage.approvals.getApprovalForKit(input.userId, input.kitRef);
  if (!approval) {
    throw new ApprovalDeniedError("No standing approval exists for this kit. Create one first.");
  }
  if (approval.revokedAt !== null) {
    throw new ApprovalDeniedError("The standing approval for this kit has been revoked.");
  }
  if (input.budgetCents > approval.maxBudgetCents) {
    throw new ApprovalDeniedError(
      `Run budget (${input.budgetCents}¢) exceeds the approval ceiling (${approval.maxBudgetCents}¢).`
    );
  }

  // ---- Resolve billing mode (server-chosen) ------------------------------
  // protected/paid kit → forced managed; configured BYO Anthropic provider →
  // BYO (no inference debit). isCloudRun is the active dispatcher's nature.
  const billing = await resolveAutoBilling({
    userId: input.userId,
    kitRef: input.kitRef,
    isCloudRun: isCloudRunDispatcher(),
    kitContext: input.kitContext
  });

  // ---- BYO cloud-run compute-fee balance pre-check -----------------------
  // A BYO + cloud run incurs a per-minute compute fee debited from prepaid
  // credits. Require enough balance to cover at least the first metered minute's
  // up-front hold; reject cleanly BEFORE starting so the user isn't left with a
  // run that fails on reserveHold.
  if (
    billing.inferenceMode === "byo" &&
    billing.isCloudRun &&
    billing.cloudRunCentsPerMin > 0
  ) {
    const balance = await getBalanceCents(input.userId);
    if (balance < billing.cloudRunCentsPerMin) {
      throw new InsufficientComputeBalanceError(
        "Web Auto requires a small prepaid balance for the per-minute cloud-run fee. Top up to continue.",
        billing.cloudRunCentsPerMin,
        balance
      );
    }
  }

  // ---- Create the queued run ---------------------------------------------
  const createInput: CreateRunInput = {
    userId: input.userId,
    kitRef: input.kitRef,
    input: {
      prompt: input.prompt,
      ...(input.files && input.files.length > 0 ? { files: input.files } : {})
    },
    budgetCents: input.budgetCents,
    model,
    createdAt: now(),
    inferenceMode: billing.inferenceMode,
    isCloudRun: billing.isCloudRun,
    cloudRunCentsPerMin: billing.cloudRunCentsPerMin
  };
  const run = await storage.runs.createRun(createInput);

  // ---- Dispatch (fire-and-forget) ----------------------------------------
  await dispatcher(run.id, input.kitContext, billing);

  return run;
}

/** List a user's runs. */
export async function listRuns(userId: string, limit = 50): Promise<AutoRun[]> {
  const storage = await getAutoStorage();
  return storage.runs.listRunsByUser(userId, limit);
}

/** Get a single run, ownership-checked. Returns null for missing OR cross-user
 *  runs (the route treats both as 404). */
export async function getRun(userId: string, runId: string): Promise<AutoRun | null> {
  const storage = await getAutoStorage();
  const run = await storage.runs.getRun(runId);
  if (!run || run.userId !== userId) return null;
  return run;
}

// ---------------------------------------------------------------------------
// Worker (internal service-key) path — NO ownership check
// ---------------------------------------------------------------------------

/**
 * Get a run by id WITHOUT an ownership check. This is the INTERNAL worker path:
 * the hosted Fargate worker loads the run it was handed by id alone (it has no
 * userId), and the SERVICE KEY on the internal endpoint IS the authorization. Do
 * NOT call this from any user-facing (cookie/bearer) route — use getRun(userId,
 * runId) there, which enforces ownership.
 */
export async function getRunForWorker(runId: string): Promise<AutoRun | null> {
  const storage = await getAutoStorage();
  return (await storage.runs.getRun(runId)) ?? null;
}

/** The JSON-serializable kit context + billing the hosted worker needs to run a
 *  job. Contains NO ChatProvider instances — only the raw BYO provider config so
 *  the worker can construct its own provider. The systemPrompt/kitContext are
 *  returned ONLY to the service-key caller and are never persisted on the run or
 *  exposed to the browser. */
export interface WorkerContext {
  model: string;
  systemPrompt?: string;
  kitContext?: string;
  tools: ToolDefinition[];
  toolNames: string[];
  inferenceMode: "managed" | "byo";
  /** Raw BYO provider config (NOT a ChatProvider) when this run is BYO. The
   *  worker constructs its own provider from this; the apiKey is sensitive and
   *  must never be logged. */
  byoProvider?: { apiKey: string; baseUrl?: string };
}

/**
 * Resolve EVERYTHING the hosted worker needs for a run, server-side, returning a
 * plain JSON-serializable object (no provider instances). Reuses the in-app
 * private helpers (makeResolveKitContext, isProtectedKit) which live in this
 * module, so protected-kit resolution works exactly like the in-app path.
 *
 * PROTECTED-KIT RESOLUTION (no user session): the worker path has no cookie/
 * bearer, so protected Market kits are resolved SERVICE-TO-SERVICE — we pass the
 * run's userId as `serviceUserId`, and protected-kits.ts calls the Market service
 * licensed-package endpoint with MARKET_SERVICE_KEY. Entitlement is STILL enforced
 * Market-side (a non-entitled user's run is refused). Local + free Market kits
 * resolve without Market. The worker NEVER holds MARKET_SERVICE_KEY and never
 * calls Market directly — only web-forge does, over this internal path.
 *
 * @throws Error if the run does not exist.
 */
export async function resolveWorkerContext(runId: string): Promise<WorkerContext> {
  const storage = await getAutoStorage();
  const run = await storage.runs.getRun(runId);
  if (!run) {
    throw new AutoValidationError(`Run not found: ${runId}`);
  }
  const approval = await storage.approvals.getApprovalForKit(run.userId, run.kitRef);
  if (!approval) {
    throw new AutoValidationError(`No standing approval for run ${runId}.`);
  }

  // SERVICE MODE: assert the run's userId so protected Market kits resolve via the
  // Market service endpoint (MARKET_SERVICE_KEY) instead of a (nonexistent) user
  // session. Entitlement is enforced Market-side.
  const serviceOpts: KitContextOptions = { serviceUserId: run.userId };

  // Resolve kit context server-to-service.
  const resolved = await makeResolveKitContext(serviceOpts)(run, approval);

  // Resolve the BYO decision the SAME way resolveAutoBilling does, but surface the
  // raw provider config (apiKey/baseUrl) instead of a constructed ChatProvider so
  // the worker can build its own. PROTECTED/paid kits FORCE managed.
  let inferenceMode: "managed" | "byo" = "managed";
  let byoProvider: { apiKey: string; baseUrl?: string } | undefined;
  if (!(await isProtectedKit(run.kitRef, serviceOpts))) {
    const stored = await (await getUserSettingsStore()).resolveProvider(run.userId);
    if (stored && stored.providerType === "anthropic" && stored.apiKey) {
      inferenceMode = "byo";
      byoProvider = {
        apiKey: stored.apiKey,
        ...(stored.baseUrl ? { baseUrl: stored.baseUrl } : {})
      };
    }
  }

  return {
    model: run.model,
    ...(resolved.systemPrompt !== undefined ? { systemPrompt: resolved.systemPrompt } : {}),
    ...(resolved.kitContext !== undefined ? { kitContext: resolved.kitContext } : {}),
    tools: resolved.tools,
    toolNames: resolved.toolNames,
    inferenceMode,
    ...(byoProvider ? { byoProvider } : {})
  };
}

/** Kill-switch: request cancellation of a run, ownership-checked. Returns false
 *  if the run is missing / not owned (→ 404). Idempotent. */
export async function cancelRun(userId: string, runId: string): Promise<boolean> {
  const storage = await getAutoStorage();
  const run = await storage.runs.getRun(runId);
  if (!run || run.userId !== userId) return false;
  await storage.runs.requestCancel(runId);
  return true;
}

/** Normalizes a request body's kitRef shape into a typed KitRef, or throws
 *  AutoValidationError (→ 400). Shared by both auth paths. */
export function parseKitRef(raw: unknown): KitRef {
  if (!raw || typeof raw !== "object") {
    throw new AutoValidationError("kitRef is required.");
  }
  const r = raw as Record<string, unknown>;
  const source = r["source"];
  if (source === "market") {
    const marketKitId = typeof r["marketKitId"] === "string" ? r["marketKitId"] : undefined;
    const slug = typeof r["slug"] === "string" ? r["slug"] : undefined;
    if (!marketKitId) {
      throw new AutoValidationError('A market kitRef requires "marketKitId".');
    }
    return { source: "market", marketKitId, ...(slug ? { slug } : {}) };
  }
  if (source === "local") {
    const localKitId = typeof r["localKitId"] === "string" ? r["localKitId"] : undefined;
    if (!localKitId) {
      throw new AutoValidationError('A local kitRef requires "localKitId".');
    }
    return { source: "local", localKitId };
  }
  throw new AutoValidationError('kitRef.source must be "market" or "local".');
}
