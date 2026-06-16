import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAppUrl } from "@/lib/url-config";

const DEFAULT_WORKOS_SESSION_COOKIE = "wos-session";
const WORKOS_PKCE_COOKIE_PREFIX = "wos-auth-verifier";

export const dynamic = "force-dynamic";

export async function GET() {
  await clearAuthKitCookies();
  return NextResponse.redirect(getAppUrl());
}

async function clearAuthKitCookies() {
  const cookieStore = await cookies();
  const sessionCookieName = process.env.WORKOS_COOKIE_NAME || DEFAULT_WORKOS_SESSION_COOKIE;
  for (const { name } of cookieStore.getAll()) {
    if (
      name === sessionCookieName ||
      name === WORKOS_PKCE_COOKIE_PREFIX ||
      name.startsWith(`${WORKOS_PKCE_COOKIE_PREFIX}-`)
    ) {
      cookieStore.delete(name);
    }
  }
}
