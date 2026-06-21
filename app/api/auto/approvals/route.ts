// /api/auto/approvals — AgentKitAuto standing approvals (BROWSER / cookie auth).
//
// Auth: AuthKit cookie session (requireUserForApi) — NEVER the forge bearer
// (CLAUDE.md hard rule #4). The bearer sibling lives at /api/forge/auto/approvals.
//
//   POST → create a standing approval { kitRef, toolAllowlist, maxBudgetCents }
//          (scope=workspace_read_write, networkPolicy=deny_all are forced server-side).
//   GET  → list the user's approvals.
import { requireUserForApi, UnauthorizedError } from "@/lib/auth";
import {
  AutoValidationError,
  createApproval,
  listApprovals,
  parseKitRef,
  parseNetworkPolicy
} from "@/server/core/auto";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let userId: string;
  try {
    userId = (await requireUserForApi()).id;
  } catch (error) {
    if (error instanceof UnauthorizedError) return Response.json({ error: error.message }, { status: 401 });
    throw error;
  }

  const body = (await request.json().catch(() => ({}))) as {
    kitRef?: unknown;
    toolAllowlist?: unknown;
    maxBudgetCents?: unknown;
    networkPolicy?: unknown;
  };

  try {
    const kitRef = parseKitRef(body.kitRef);
    const toolAllowlist = Array.isArray(body.toolAllowlist)
      ? body.toolAllowlist.filter((t): t is string => typeof t === "string")
      : [];
    const maxBudgetCents = typeof body.maxBudgetCents === "number" ? body.maxBudgetCents : NaN;
    // Phase C: deny_all (default) or an allowlist of egress hosts. http_fetch in
    // the toolAllowlist is honored only with an allowlist policy (createApproval enforces).
    const networkPolicy = parseNetworkPolicy(body.networkPolicy);
    const approval = await createApproval({ userId, kitRef, toolAllowlist, maxBudgetCents, networkPolicy });
    return Response.json(approval, { status: 201 });
  } catch (error) {
    if (error instanceof AutoValidationError) {
      return Response.json({ error: "invalid_request", message: error.message }, { status: 400 });
    }
    throw error;
  }
}

export async function GET() {
  let userId: string;
  try {
    userId = (await requireUserForApi()).id;
  } catch (error) {
    if (error instanceof UnauthorizedError) return Response.json({ error: error.message }, { status: 401 });
    throw error;
  }
  const approvals = await listApprovals(userId);
  return Response.json({ approvals }, { status: 200 });
}
