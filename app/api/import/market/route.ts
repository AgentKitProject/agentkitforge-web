// POST /api/import/market -> importHostedMarketKit
// body: { slug, kitId?, marketBaseUrl? }
import { withUser } from "@/lib/api";
import { importFromMarket } from "@/server/core/import-ops";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withUser(async (user) => {
    const body = (await request.json()) as { slug?: string; kitId?: string; marketBaseUrl?: string };
    if (!body.slug) throw new Error("slug is required.");
    return importFromMarket(user.id, {
      slug: body.slug,
      kitId: body.kitId,
      marketBaseUrl: body.marketBaseUrl ?? process.env.AGENTKITMARKET_BASE_URL
    });
  });
}
