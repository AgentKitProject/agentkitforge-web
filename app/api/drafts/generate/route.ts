// POST /api/drafts/generate -> generateAgentKitDraftWithAi
// body: GenerateDraftInput. Provider config from server env, not the client.
import { withUser } from "@/lib/api";
import { generateDraft, type GenerateDraftInput } from "@/server/core/ai-draft";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withUser(async (user) => {
    const body = (await request.json()) as GenerateDraftInput;
    if (!body.userRequest) throw new Error("userRequest is required.");
    return generateDraft(user.id, body);
  });
}
