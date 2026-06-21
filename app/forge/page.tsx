// /forge — the web Forge UI entry. Server component: enforces an AuthKit
// session (Web Forge is logged-in by design), then mounts the client ForgeApp
// which talks to /api/* through the WebForgeClient (the ForgeClient seam).
//
// The full app chrome (sidebar nav + topbar + sections) lives in ForgeApp,
// styled with the desktop design system (app/forge.css ported from the
// desktop's src/styles.css).
import { getCurrentUser, requireUser } from "@/lib/auth";
import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import ForgeApp from "./ForgeApp";

export const dynamic = "force-dynamic";

// Web Forge (and the Auto section it hosts) is logged-in by design. This page
// is the only route that mounts ForgeApp/AutoSection, so gating it here gates
// the entire UI. Use the canonical AuthKit `requireUser()`
// (`withAuth({ ensureSignedIn: true })`) so unauthenticated users are sent to
// the WorkOS sign-in flow; fall back to a manual redirect if enforcement is
// unavailable (e.g. WorkOS env not configured).
export default async function ForgePage() {
  let user;
  try {
    user = await requireUser();
  } catch {
    user = await getCurrentUser();
    if (!user) {
      const url = await getSignInUrl().catch(() => "/auth/sign-in");
      redirect(url);
    }
  }
  return <ForgeApp user={{ id: user.id, email: user.email }} />;
}
