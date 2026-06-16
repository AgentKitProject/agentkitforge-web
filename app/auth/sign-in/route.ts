import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { getWorkOSRedirectUri } from "@/lib/url-config";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export async function GET() {
  const signInUrl = await getSignInUrl({
    redirectUri: getWorkOSRedirectUri()
  });
  redirect(signInUrl);
}
