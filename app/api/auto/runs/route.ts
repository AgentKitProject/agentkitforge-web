// /api/auto/runs — AgentKitAuto runs (BROWSER / cookie auth).
//
// Auth: AuthKit cookie session (requireUserForApi). The bearer sibling lives at
// /api/forge/auto/runs (CLAUDE.md hard rule #4 — never mix the two paths).
//
//   POST → start a run { kitRef, input, budgetCents (REQUIRED), model? }. Enforces
//          a matching non-revoked approval + budget <= ceiling (auto-core's
//          ApprovalDeniedError → 403), creates the run, DISPATCHES it
//          (in-process dev/self-host; hosted needs the deferred Fargate worker),
//          and returns the run id.
//   GET  → list the user's runs.
import { requireUserForApi, UnauthorizedError } from "@/lib/auth";
import {
  ApprovalDeniedError,
  AutoValidationError,
  InsufficientComputeBalanceError,
  listRuns,
  parseInputFiles,
  parseKitRef,
  startRun
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
    input?: { prompt?: unknown; files?: unknown };
    prompt?: unknown;
    budgetCents?: unknown;
    model?: unknown;
    inputFiles?: unknown;
  };

  try {
    const kitRef = parseKitRef(body.kitRef);
    const prompt =
      typeof body.input?.prompt === "string"
        ? body.input.prompt
        : typeof body.prompt === "string"
          ? body.prompt
          : "";
    const files = Array.isArray(body.input?.files)
      ? (body.input.files as unknown[]).flatMap((f) =>
          f && typeof f === "object" && typeof (f as Record<string, unknown>).path === "string"
            ? [{ path: String((f as Record<string, unknown>).path), content: String((f as Record<string, unknown>).content ?? "") }]
            : []
        )
      : undefined;
    const budgetCents = typeof body.budgetCents === "number" ? body.budgetCents : NaN;
    const model = typeof body.model === "string" ? body.model : undefined;
    // Phase C: out-of-band staged input files (presigned-uploaded then referenced).
    const inputFiles = parseInputFiles(body.inputFiles);

    const run = await startRun({
      userId,
      kitRef,
      prompt,
      budgetCents,
      ...(model ? { model } : {}),
      ...(files ? { files } : {}),
      ...(inputFiles.length > 0 ? { inputFiles } : {}),
      // Cookie path: kit-context resolution uses the cookie forwarding store for
      // protected/Market kits (no forwarded bearer here).
      kitContext: {}
    });
    return Response.json({ id: run.id, status: run.status, createdAt: run.createdAt }, { status: 201 });
  } catch (error) {
    if (error instanceof ApprovalDeniedError) {
      return Response.json({ error: "approval_denied", message: error.message }, { status: 403 });
    }
    if (error instanceof AutoValidationError) {
      return Response.json({ error: "invalid_request", message: error.message }, { status: 400 });
    }
    if (error instanceof InsufficientComputeBalanceError) {
      return Response.json(
        { error: "insufficient_balance", message: error.message, requiredCents: error.requiredCents },
        { status: 402 }
      );
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
  const runs = await listRuns(userId);
  return Response.json({ runs }, { status: 200 });
}
