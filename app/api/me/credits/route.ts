// GET /api/me/credits -> the signed-in user's prepaid credit balance.
// { balanceCents, currency }. balanceCents is 0 when the user has no account
// yet (read-only; does not create the ledger row).
import { withUser } from "@/lib/api";
import { getBalanceCents, CREDITS_CURRENCY } from "@/server/core/gateway";

export const dynamic = "force-dynamic";

export async function GET() {
  return withUser(async (user) => {
    const balanceCents = await getBalanceCents(user.id);
    return { balanceCents, currency: CREDITS_CURRENCY };
  });
}
