// GET    /api/favorites -> listFavorites
// POST   /api/favorites -> addFavorite     body: FavoriteRecord-ish
// DELETE /api/favorites -> removeFavorite   body: { marketSlug }
//
// Favorites are REFERENCES to Market kits (slug + base URL + cached display
// metadata) — never copies of kit content.
import { withUser } from "@/lib/api";
import { getKitStore } from "@/server/store/local-disk";

export const dynamic = "force-dynamic";

export async function GET() {
  return withUser(async (user) => {
    const favorites = await getKitStore().listFavorites(user.id);
    return { favorites };
  });
}

export async function POST(request: Request) {
  return withUser(async (user) => {
    const body = (await request.json()) as {
      marketSlug?: string;
      marketKitId?: string;
      marketBaseUrl?: string;
      displayName?: string;
      publisher?: string;
      version?: string;
    };
    if (!body.marketSlug) throw new Error("marketSlug is required.");
    const favorite = await getKitStore().addFavorite(user.id, {
      marketSlug: body.marketSlug,
      marketKitId: body.marketKitId,
      marketBaseUrl: body.marketBaseUrl ?? process.env.AGENTKITMARKET_BASE_URL ?? "",
      displayName: body.displayName,
      publisher: body.publisher,
      version: body.version,
      addedAt: new Date().toISOString()
    });
    return { favorite };
  });
}

export async function DELETE(request: Request) {
  return withUser(async (user) => {
    const body = (await request.json()) as { marketSlug?: string };
    if (!body.marketSlug) throw new Error("marketSlug is required.");
    await getKitStore().removeFavorite(user.id, body.marketSlug);
    return { ok: true };
  });
}
