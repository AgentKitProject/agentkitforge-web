import { authkitMiddleware } from "@workos-inc/authkit-nextjs";
import { getWorkOSRedirectUri } from "@/lib/url-config";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

const authkit = authkitMiddleware({
  redirectUri: getWorkOSRedirectUri()
});

export default async function middleware(request: NextRequest, event: NextFetchEvent) {
  // Degrade gracefully when WorkOS env is not configured (e.g. local dev,
  // `next build` data collection) so the app/build does not hard-crash.
  if (!hasWorkOSEnv()) {
    return NextResponse.next();
  }
  return (await authkit(request, event)) ?? NextResponse.next();
}

function hasWorkOSEnv() {
  return Boolean(
    process.env.WORKOS_API_KEY && process.env.WORKOS_CLIENT_ID && process.env.WORKOS_COOKIE_PASSWORD
  );
}

export const config = {
  // Health check + Next internals stay public.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|health).*)"]
};
