import { handleAuth, saveSession } from "@workos-inc/authkit-nextjs";
import { getAppUrl, getWorkOSRedirectUri } from "@/lib/url-config";
import type { NextRequest } from "next/server";

// Resolve URLs at request time, not build time. Keeps the image runtime-config.
export const dynamic = "force-dynamic";

function buildAuthCallback() {
  return handleAuth({
    baseURL: getAppUrl(),
    returnPathname: "/",
    onSuccess: async ({ accessToken, refreshToken, user, impersonator, authenticationMethod }) => {
      await saveSession(
        { accessToken, refreshToken, user, impersonator, authenticationMethod },
        getWorkOSRedirectUri()
      );
    },
    onError: () => new Response("Authentication failed.", { status: 500 })
  });
}

export function GET(request: NextRequest) {
  return buildAuthCallback()(request);
}
