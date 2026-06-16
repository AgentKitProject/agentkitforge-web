// POST /api/drafts/revise -> reviseAgentKitDraftWithAi
// body: ReviseDraftInput. Provider config from server env, not the client.
import { withUser } from "@/lib/api";
import { reviseDraft, type ReviseDraftInput } from "@/server/core/ai-draft";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withUser(async () => {
    const body = (await request.json()) as ReviseDraftInput;
    if (!body.session || !body.changeRequest) throw new Error("session and changeRequest are required.");
    return reviseDraft(body);
  });
}
