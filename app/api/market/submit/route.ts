// POST /api/market/submit -> submit a packaged kit to hosted AgentKitMarket for
// review. Body: { kitId, marketBaseUrl?, listingDraft?, fileName? }.
//
// AUTH: the web user has an AuthKit COOKIE session; Market's /api/forge/* routes
// expect a WorkOS BEARER access token. The submit pipeline obtains the user's
// WorkOS access token from the cookie session (server/core/market-auth.ts) and
// forwards it as the bearer token via the core market client's TokenStore.
//
// No automatic publishing — admin review is always required (CLAUDE.md #6).
import { withUser } from "@/lib/api";
import { submitKitToMarket } from "@/server/core/market-submit";
import type { ListingDraft } from "@agentkitforge/core/market";

export const dynamic = "force-dynamic";

type Body = { kitId?: string; marketBaseUrl?: string; listingDraft?: Partial<ListingDraft>; fileName?: string };

export async function POST(request: Request) {
  return withUser(async (user) => {
    const body = (await request.json()) as Body;
    if (!body.kitId) throw new Error("kitId is required.");
    return submitKitToMarket(user.id, {
      kitId: body.kitId,
      marketBaseUrl: body.marketBaseUrl,
      listingDraft: body.listingDraft,
      fileName: body.fileName
    });
  });
}
