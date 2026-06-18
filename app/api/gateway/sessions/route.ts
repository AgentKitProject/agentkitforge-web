// POST /api/gateway/sessions — create a managed gateway streaming session.
//
// Body: { kitId, billing: "managed", model? }. Auth is the AuthKit cookie
// session (requireUserForApi); the session is scoped to the signed-in user.
// Returns the opaque session handle (NEVER the injected system prompt).
//
// The selected managed model is validated and threaded into the turn deps so
// subsequent /turn calls use it. Unknown models fall back to the default.
import { requireUserForApi, UnauthorizedError } from "@/lib/auth";
import { handleGatewayRequest } from "@/server/core/gateway-sessions";
import { streamGatewayResponse } from "@/server/core/gateway-sse";
import { MANAGED_DEFAULT_MODEL, isManagedModel } from "@/server/core/managed-models";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let userId: string;
  try {
    userId = (await requireUserForApi()).id;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return Response.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }

  const body = (await request.json().catch(() => ({}))) as {
    kitId?: string;
    billing?: string;
    model?: string;
  };
  const model = isManagedModel(body.model) ? body.model! : MANAGED_DEFAULT_MODEL;

  return streamGatewayResponse((createEmitter) =>
    handleGatewayRequest(
      {
        method: "POST",
        path: "/gateway/sessions",
        // Web is managed-only this pass; the router validates the billing field.
        body: { kitId: body.kitId, billing: body.billing ?? "managed" },
        userId
      },
      createEmitter,
      model
    )
  );
}
