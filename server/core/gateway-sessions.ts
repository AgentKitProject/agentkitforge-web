// Gateway streaming-session composition root for Web Forge (Gateway Phase 2b).
//
// This is the wiring that turns @agentkitforge/gateway-core's transport-agnostic
// router (POST /gateway/sessions, /turn, /tool-result, DELETE) into something
// this app can run against its own runtime:
//
//   - SessionStore     — DynamoSessionStore over GATEWAY_SESSIONS_TABLE, using
//                        the SAME region/credentials as the KitStore + credit
//                        ledger (awsClientEnv() / FORGE_AWS_*).
//   - ChatProvider     — the managed Anthropic provider (platform ANTHROPIC_API_KEY),
//                        reused from server/core/gateway.ts's pattern. Inert when
//                        ANTHROPIC_API_KEY is unset (provider factory throws; the
//                        turn surfaces a clear error event — BYO is unaffected).
//   - CreditLedger     — reused from getCreditLedger() so holds/settles bill the
//                        SAME prepaid-credit balance the rest of the app uses.
//   - resolveSystemPrompt — loads the kit's tree from the caller's KitStore by the
//                        session's kitId and builds the kit system prompt SERVER-
//                        SIDE via @agentkitforge/core's buildAgentKitContext. The
//                        prompt is injected into the ChatRequest and NEVER emitted
//                        to the client (Tier-3 invariant enforced by core).
//
// Sessions are scoped to the authenticated user: createGatewaySession stores
// `userId` on the session; the route adapter (app/api/gateway/*) verifies the
// session's userId matches the caller before /turn, /tool-result, or DELETE.
//
// CONVERSATIONAL-ONLY this pass: no tools are resolved (resolveTools omitted →
// defaults to none), so the model never emits tool_use in normal operation.
// Local-hands tool execution (desktop 2c) + a future restricted browser tool
// executor will inject `resolveTools` + drive the tool-result round-trips.
import {
  DynamoSessionStore,
  createDynamoDBDocumentClient,
  createManagedAnthropicProvider,
  loadDynamoTableNames,
  routeGatewayRequest,
  type GatewayRequest,
  type GatewayResponse,
  type GatewayRouterDeps,
  type GatewaySession,
  type SseEmitter,
  type SessionStore
} from "@agentkitforge/gateway-core";
import { awsClientEnv } from "@/server/aws-client";
import { getCreditLedger } from "@/server/core/gateway";
import { getKitStore } from "@/server/store/index";
import { withEphemeralTree } from "@/server/core/runner";
import { MANAGED_DEFAULT_MODEL } from "@/server/core/managed-models";

/** Default output-token ceiling per provider round-trip for a chat turn. */
const TURN_MAX_TOKENS = 4096;

let sessionStoreSingleton: SessionStore | null = null;

/**
 * The shared DynamoDB session store. Built lazily so deployments that never run
 * managed inference don't require GATEWAY_SESSIONS_TABLE. Throws if the env var
 * is missing (fail-fast misconfig) — same contract as getCreditLedger().
 */
export function getSessionStore(): SessionStore {
  if (!sessionStoreSingleton) {
    const tables = loadDynamoTableNames(process.env);
    const env = awsClientEnv();
    const db = createDynamoDBDocumentClient({
      region: env.region,
      ...(env.credentials ? { credentials: env.credentials } : {})
    });
    sessionStoreSingleton = new DynamoSessionStore(db, tables.sessions);
  }
  return sessionStoreSingleton;
}

/** ISO-8601 clock injected into the session + streaming-turn services. */
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
 * Resolves the kit's injected system prompt SERVER-SIDE for a session.
 *
 * Loads the session owner's kit tree from the KitStore (by kitId), materializes
 * it into an ephemeral temp dir, and runs @agentkitforge/core's
 * buildAgentKitContext to assemble AGENTKIT.md / START_HERE.md / skills +
 * instructions into a single `systemContext` string. This text is placed in the
 * ChatRequest by gateway-core and is NEVER emitted to the client.
 *
 * The kit is loaded under the session's `userId` so a buyer can only run kits
 * they own in their own store (Tier-3 entitlement for Market-licensed kits is a
 * later phase — default allow for owned/free kits this pass).
 */
async function resolveSystemPrompt(session: GatewaySession): Promise<string> {
  if (!session.kitId) {
    // Raw / promptless session — no kit content to inject.
    return "You are a helpful assistant running an Agent Kit.";
  }
  const store = await getKitStore();
  const tree = await store.getKitTree(session.userId, session.kitId);
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
  return trimmed.length > 0
    ? trimmed
    : "You are a helpful assistant running an Agent Kit.";
}

/**
 * Builds the GatewayRouterDeps for one request. `createEmitter` is supplied by
 * the route adapter (it knows how to write SSE chunks to its ReadableStream).
 *
 * @param model  The managed model id selected by the caller (validated by the
 *               route); falls back to MANAGED_DEFAULT_MODEL.
 */
function buildRouterDeps(createEmitter: () => SseEmitter, model: string): GatewayRouterDeps {
  const sessions = getSessionStore();
  const ledger = getCreditLedger();
  // The managed provider reads the PLATFORM ANTHROPIC_API_KEY. When unset, the
  // factory throws inertly; runStreamingTurn surfaces it as an `error` event.
  const chatProvider = createManagedAnthropicProvider();
  return {
    session: {
      sessions,
      now
      // entitlementCheck omitted → default allow (owned/free kits).
    },
    turn: {
      chatProvider,
      sessions,
      ledger,
      resolveSystemPrompt,
      // resolveTools omitted → no tools this pass (conversational-only).
      now,
      model,
      maxTokens: TURN_MAX_TOKENS,
      ...(markupBps() !== undefined ? { markupBps: markupBps() } : {})
    },
    createEmitter
  };
}

/**
 * Adapts a normalized gateway request to gateway-core's router with this app's
 * deps. The route layer resolves `userId` from the AuthKit session and verifies
 * session ownership BEFORE calling this for /turn, /tool-result, and DELETE.
 */
export async function handleGatewayRequest(
  req: GatewayRequest,
  createEmitter: () => SseEmitter,
  model: string = MANAGED_DEFAULT_MODEL
): Promise<GatewayResponse> {
  return routeGatewayRequest(buildRouterDeps(createEmitter, model), req);
}

/**
 * Loads a session and asserts it belongs to `userId`. Returns the session, or
 * null if it does not exist OR belongs to another user (callers treat both as
 * 404 so cross-user probing can't distinguish them). Sessions are user-scoped:
 * the router itself does not re-check ownership on /turn|/tool-result|DELETE, so
 * the route layer MUST gate with this before forwarding those requests.
 */
export async function loadOwnedSession(
  userId: string,
  sessionId: string
): Promise<GatewaySession | null> {
  const session = await getSessionStore().getSession(sessionId);
  if (!session || session.userId !== userId) return null;
  return session;
}
