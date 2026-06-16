// /forge — the Phase 2 web UI entry. Server component: enforces an AuthKit
// session (Web Forge is logged-in by design), then mounts the client ForgeApp
// which talks to /api/* through the WebForgeClient (the ForgeClient seam).
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
  return (
    <>
      <header className="akf-header">
        <h1>AgentKitForge</h1>
        <span className="akf-user">{user.email}</span>
      </header>
      <ForgeApp user={{ id: user.id, email: user.email }} />
    </>
  );
}
