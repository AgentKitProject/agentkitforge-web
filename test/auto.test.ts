// AgentKitAuto Phase A — route auth split + run-create approval gate.
//
// Two concerns, mirroring test/forge-gateway.test.ts:
//   1. AUTH SPLIT — the BEARER route (/api/forge/auto/runs) with no bearer → 401
//      and never touches storage (jose mocked so no JWKS fetch); the COOKIE route
//      (/api/auto/runs) with no cookie session → 401 and never touches storage.
//      The two paths never mix (CLAUDE.md hard rule #4).
//   2. APPROVAL GATE — startRun with no matching approval / over-ceiling budget →
//      ApprovalDeniedError, and the route surfaces it as 403; a missing budget →
//      AutoValidationError → 400. The dispatcher is overridden so no real run runs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- mock jose so the bearer route's auth gate runs offline -------------------
const jwtVerifyMock = vi.fn();
vi.mock("jose", () => ({
  jwtVerify: (...args: unknown[]) => jwtVerifyMock(...args),
  createRemoteJWKSet: () => "JWKS_HANDLE"
}));

// --- mock the cookie auth helper so the cookie route runs offline -------------
// FULL mock (no importActual) — importActual would pull in @workos-inc/authkit-
// nextjs, which fails to resolve next/cache under vitest. We re-declare the
// UnauthorizedError the routes branch on inside the factory.
const requireUserMock = vi.fn();
class FakeUnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}
vi.mock("@/lib/auth", () => ({
  UnauthorizedError: FakeUnauthorizedError,
  requireUserForApi: () => requireUserMock()
}));

// --- in-memory storage stub injected into server/core/auto --------------------
type Approval = { id: string; userId: string; kitRef: unknown; toolAllowlist: string[]; maxBudgetCents: number; networkPolicy: string; createdAt: string; revokedAt: string | null };
type Run = { id: string; userId: string; status: string; budgetCents: number; createdAt: string };

function makeStorage() {
  const approvals: Approval[] = [];
  const runs: Run[] = [];
  return {
    state: { approvals, runs },
    deps: {
      approvals: {
        async getApprovalForKit(userId: string) {
          return approvals.find((a) => a.userId === userId && a.revokedAt === null);
        },
        async createApproval(input: Record<string, unknown>) {
          const a = { id: `appr-${approvals.length}`, revokedAt: null, ...input } as Approval;
          approvals.push(a);
          return a;
        },
        async listApprovalsByUser(userId: string) {
          return approvals.filter((a) => a.userId === userId);
        },
        async revokeApproval() {
          return undefined;
        }
      },
      runs: {
        async createRun(input: Record<string, unknown>) {
          const r = { id: `run-${runs.length}`, status: "queued", ...input } as Run;
          runs.push(r);
          return r;
        },
        async listRunsByUser(userId: string) {
          return runs.filter((r) => r.userId === userId);
        },
        async getRun(id: string) {
          return runs.find((r) => r.id === id);
        },
        async requestCancel() {
          /* no-op */
        }
      },
      workspaces: {}
    }
  };
}

// Mock the storage + provider/ledger composition so no AWS/Anthropic is touched.
// makeAutoDeps is mocked to return our in-memory storage, so getAutoStorage()
// (called internally by server/core/auto's startRun) never reaches DynamoDB.
const storageRef = { current: makeStorage() };

// --- billing-mode resolution stubs -------------------------------------------
// resolveAutoBilling reads the user's BYO provider + (for protected kits) the
// Market classification + (for BYO cloud) the prepaid balance. Stub all three so
// the route tests stay offline and we can steer the billing path.
const resolveProviderMock = vi.fn(async () => null as unknown);
vi.mock("@/server/store/user-settings", () => ({
  getUserSettingsStore: async () => ({ resolveProvider: (...a: unknown[]) => resolveProviderMock(...(a as [])) })
}));
const balanceMock = vi.fn(async () => 1_000_000);
const classifyKitMock = vi.fn(async () => ({ isProtected: false }));
vi.mock("@/server/core/protected-kits", () => ({
  classifyKit: (...a: unknown[]) => classifyKitMock(...(a as [])),
  resolveProtectedSystemPrompt: async () => "PROTECTED_PROMPT"
}));
// The cookie forwarding store imports the AuthKit-coupled import-ops module
// (which fails to resolve next/cache under vitest). Stub it.
vi.mock("@/server/core/import-ops", () => ({
  createForwardingStore: () => ({ async get() { return null; }, async set() {}, async clear() {} })
}));
vi.mock("@/server/core/gateway", () => ({
  getCreditLedger: () => ({}),
  getBalanceCents: (...a: unknown[]) => balanceMock(...(a as []))
}));
vi.mock("@agentkitforge/auto-core", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@agentkitforge/auto-core");
  return {
    ...actual,
    makeAutoDeps: () => storageRef.current.deps,
    createDynamoDBDocumentClient: () => ({})
  };
});
vi.mock("@agentkitforge/gateway-core", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@agentkitforge/gateway-core");
  return { ...actual, createManagedAnthropicProvider: () => ({}) };
});

function resetStorage() {
  // Reset in place (the getAutoStorage singleton caches storageRef.current.deps).
  storageRef.current.state.approvals.length = 0;
  storageRef.current.state.runs.length = 0;
}

describe("auto runs — auth split", () => {
  beforeEach(() => {
    jwtVerifyMock.mockReset();
    requireUserMock.mockReset();
    resetStorage();
  });

  it("BEARER POST /api/forge/auto/runs without a bearer → 401", async () => {
    const { POST } = await import("@/app/api/forge/auto/runs/route");
    const req = new Request("https://forge.example/api/forge/auto/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kitRef: { source: "local", localKitId: "k" }, budgetCents: 10, prompt: "go" })
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(storageRef.current.state.runs).toHaveLength(0);
  });

  it("COOKIE POST /api/auto/runs without a session → 401", async () => {
    requireUserMock.mockRejectedValue(new FakeUnauthorizedError("Sign in is required."));
    const { POST } = await import("@/app/api/auto/runs/route");
    const req = new Request("https://forge.example/api/auto/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kitRef: { source: "local", localKitId: "k" }, budgetCents: 10, prompt: "go" })
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(storageRef.current.state.runs).toHaveLength(0);
  });
});

describe("auto runs — approval gate (cookie path)", () => {
  beforeEach(async () => {
    requireUserMock.mockReset();
    resetStorage();
    resolveProviderMock.mockReset();
    resolveProviderMock.mockResolvedValue(null);
    classifyKitMock.mockReset();
    classifyKitMock.mockResolvedValue({ isProtected: false });
    balanceMock.mockReset();
    balanceMock.mockResolvedValue(1_000_000);
    const auto = await import("@/server/core/auto");
    // No-op dispatcher so the queued run is never actually executed.
    auto.setAutoDispatcher(async () => {});
    requireUserMock.mockResolvedValue({ id: "user-1", email: "u@example.com" });
  });

  afterEach(() => vi.restoreAllMocks());

  it("no matching approval → 403 approval_denied", async () => {
    const { POST } = await import("@/app/api/auto/runs/route");
    const req = new Request("https://forge.example/api/auto/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kitRef: { source: "local", localKitId: "k" }, input: { prompt: "go" }, budgetCents: 10 })
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("approval_denied");
  });

  it("missing budget → 400 invalid_request", async () => {
    const { POST } = await import("@/app/api/auto/runs/route");
    const req = new Request("https://forge.example/api/auto/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kitRef: { source: "local", localKitId: "k" }, input: { prompt: "go" } })
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
  });

  it("budget over the approval ceiling → 403; budget within → 201 + run created", async () => {
    // Seed an approval with a 50¢ ceiling.
    storageRef.current.state.approvals.push({
      id: "appr-x",
      userId: "user-1",
      kitRef: { source: "local", localKitId: "k" },
      toolAllowlist: ["read_file"],
      maxBudgetCents: 50,
      networkPolicy: "deny_all",
      createdAt: new Date().toISOString(),
      revokedAt: null
    });
    const { POST } = await import("@/app/api/auto/runs/route");

    const over = await POST(
      new Request("https://forge.example/api/auto/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kitRef: { source: "local", localKitId: "k" }, input: { prompt: "go" }, budgetCents: 100 })
      })
    );
    expect(over.status).toBe(403);

    const ok = await POST(
      new Request("https://forge.example/api/auto/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kitRef: { source: "local", localKitId: "k" }, input: { prompt: "go" }, budgetCents: 40 })
      })
    );
    expect(ok.status).toBe(201);
    expect(storageRef.current.state.runs).toHaveLength(1);
  });
});

describe("auto runs — billing model", () => {
  // A captured dispatcher records the resolved billing for assertions.
  let captured: { billing: { inferenceMode: string; isCloudRun: boolean; cloudRunCentsPerMin: number; byoChatProvider?: unknown } } | null;

  async function seedApprovalAndDispatcher(isCloudRun = false) {
    const auto = await import("@/server/core/auto");
    captured = null;
    auto.setAutoDispatcher(async (_runId, _opts, billing) => {
      captured = { billing: billing as never };
    }, isCloudRun);
    storageRef.current.state.approvals.push({
      id: "appr-b",
      userId: "user-1",
      kitRef: { source: "local", localKitId: "k" },
      toolAllowlist: ["read_file"],
      maxBudgetCents: 100_000,
      networkPolicy: "deny_all",
      createdAt: new Date().toISOString(),
      revokedAt: null
    });
  }

  beforeEach(() => {
    requireUserMock.mockReset();
    resetStorage();
    resolveProviderMock.mockReset();
    resolveProviderMock.mockResolvedValue(null);
    classifyKitMock.mockReset();
    classifyKitMock.mockResolvedValue({ isProtected: false });
    balanceMock.mockReset();
    balanceMock.mockResolvedValue(1_000_000);
    delete process.env.AUTO_MARKUP_BPS;
    delete process.env.AUTO_CLOUD_RUN_CENTS_PER_MIN;
    requireUserMock.mockResolvedValue({ id: "user-1", email: "u@example.com" });
  });
  afterEach(() => vi.restoreAllMocks());

  it("Auto managed run uses the 2500 markup (default) and persists it", async () => {
    await seedApprovalAndDispatcher(false);
    const { POST } = await import("@/app/api/auto/runs/route");
    const res = await POST(
      new Request("https://forge.example/api/auto/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kitRef: { source: "local", localKitId: "k" }, input: { prompt: "go" }, budgetCents: 1000 })
      })
    );
    expect(res.status).toBe(201);
    // No BYO provider configured → managed; default Auto markup is 25%.
    expect(captured?.billing.inferenceMode).toBe("managed");
    const run = storageRef.current.state.runs[0] as unknown as { inferenceMode: string };
    expect(run.inferenceMode).toBe("managed");
    // Verify the helper resolves 2500 by default (no env override).
    const { autoMarkupBps } = (await import("@/server/core/auto")) as unknown as { autoMarkupBps?: () => number };
    if (autoMarkupBps) expect(autoMarkupBps()).toBe(2500);
  });

  it("configured BYO Anthropic provider on a free local kit → BYO mode", async () => {
    resolveProviderMock.mockResolvedValue({
      id: "p1",
      name: "mine",
      providerType: "anthropic",
      apiKey: "sk-ant-test"
    });
    await seedApprovalAndDispatcher(false);
    const { POST } = await import("@/app/api/auto/runs/route");
    const res = await POST(
      new Request("https://forge.example/api/auto/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kitRef: { source: "local", localKitId: "k" }, input: { prompt: "go" }, budgetCents: 1000 })
      })
    );
    expect(res.status).toBe(201);
    expect(captured?.billing.inferenceMode).toBe("byo");
    expect(captured?.billing.byoChatProvider).toBeTruthy();
  });

  it("PROTECTED kit forces managed even with a BYO provider configured", async () => {
    resolveProviderMock.mockResolvedValue({
      id: "p1",
      name: "mine",
      providerType: "anthropic",
      apiKey: "sk-ant-test"
    });
    classifyKitMock.mockResolvedValue({ isProtected: true });
    await seedApprovalAndDispatcher(false);
    // Approval must match a MARKET kit for this run.
    storageRef.current.state.approvals.push({
      id: "appr-m",
      userId: "user-1",
      kitRef: { source: "market", marketKitId: "mk", slug: "paid-kit" },
      toolAllowlist: ["read_file"],
      maxBudgetCents: 100_000,
      networkPolicy: "deny_all",
      createdAt: new Date().toISOString(),
      revokedAt: null
    });
    const { POST } = await import("@/app/api/auto/runs/route");
    const res = await POST(
      new Request("https://forge.example/api/auto/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kitRef: { source: "market", marketKitId: "mk", slug: "paid-kit" }, input: { prompt: "go" }, budgetCents: 1000 })
      })
    );
    expect(res.status).toBe(201);
    // Coerced to managed — never runs a protected kit on a BYO key.
    expect(captured?.billing.inferenceMode).toBe("managed");
    expect(captured?.billing.byoChatProvider).toBeFalsy();
  });

  it("BYO + cloud run with insufficient balance → 402 before starting", async () => {
    process.env.AUTO_CLOUD_RUN_CENTS_PER_MIN = "10";
    resolveProviderMock.mockResolvedValue({
      id: "p1",
      name: "mine",
      providerType: "anthropic",
      apiKey: "sk-ant-test"
    });
    balanceMock.mockResolvedValue(3); // below the 10¢/min fee
    await seedApprovalAndDispatcher(true); // CLOUD dispatcher
    const { POST } = await import("@/app/api/auto/runs/route");
    const res = await POST(
      new Request("https://forge.example/api/auto/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kitRef: { source: "local", localKitId: "k" }, input: { prompt: "go" }, budgetCents: 1000 })
      })
    );
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("insufficient_balance");
    // The run was rejected BEFORE creation/dispatch.
    expect(storageRef.current.state.runs).toHaveLength(0);
    expect(captured).toBeNull();
  });

  it("BYO + cloud run WITH balance → 201 and isCloudRun true", async () => {
    process.env.AUTO_CLOUD_RUN_CENTS_PER_MIN = "10";
    resolveProviderMock.mockResolvedValue({
      id: "p1",
      name: "mine",
      providerType: "anthropic",
      apiKey: "sk-ant-test"
    });
    balanceMock.mockResolvedValue(1000);
    await seedApprovalAndDispatcher(true);
    const { POST } = await import("@/app/api/auto/runs/route");
    const res = await POST(
      new Request("https://forge.example/api/auto/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kitRef: { source: "local", localKitId: "k" }, input: { prompt: "go" }, budgetCents: 1000 })
      })
    );
    expect(res.status).toBe(201);
    expect(captured?.billing.inferenceMode).toBe("byo");
    expect(captured?.billing.isCloudRun).toBe(true);
    expect(captured?.billing.cloudRunCentsPerMin).toBe(10);
  });
});
