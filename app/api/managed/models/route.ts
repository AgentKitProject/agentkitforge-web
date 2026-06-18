// GET /api/managed/models -> the managed (in-house, prepaid-credit) model list.
// Returns { models: [{ id, label, tier }], defaultModel }. Used by the Build
// generate/revise + Edit-with-AI selectors when a user is on managed inference
// (no BYO provider configured). Static catalog — no auth or I/O required.
import { MANAGED_MODELS, MANAGED_DEFAULT_MODEL } from "@/server/core/managed-models";

export const dynamic = "force-static";

export function GET() {
  return Response.json({ models: MANAGED_MODELS, defaultModel: MANAGED_DEFAULT_MODEL });
}
