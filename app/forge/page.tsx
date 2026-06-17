// /forge — the web Forge UI entry. Server component: enforces an AuthKit
// session (Web Forge is logged-in by design), then mounts the client ForgeApp
// which talks to /api/* through the WebForgeClient (the ForgeClient seam).
//
// The full app chrome (sidebar nav + topbar + sections) lives in ForgeApp,
// styled with the desktop design system (app/forge.css ported from the
// desktop's src/styles.css).
import { getCurrentUser } from "@/lib/auth";
import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import ForgeApp from "./ForgeApp";

export const dynamic = "force-dynamic";

export default async function ForgePage() {
  const user = await getCurrentUser();
  if (!user) {
    const url = await getSignInUrl().catch(() => "/auth/sign-in");
    redirect(url);
  }
  return <ForgeApp user={{ id: user.id, email: user.email }} />;
}
