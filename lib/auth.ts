// WorkOS AuthKit cookie session helpers. Mirrors agentkitmarket-app/lib/auth.ts.
//
// Web Forge is logged-in by design (unlike the local-first desktop app): every
// API route requires an authenticated user, and all KitStore access is scoped
// to that user's id.
import { withAuth, type UserInfo } from "@workos-inc/authkit-nextjs";
import type { User } from "@workos-inc/node";

export type CurrentUser = {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
};

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    const auth = await withAuth();
    if (!auth.user) {
      return null;
    }
    return mapWorkOSUser(auth);
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<CurrentUser> {
  const auth = await withAuth({ ensureSignedIn: true });
  return mapWorkOSUser(auth);
}

// For API routes: throw (handled by withRoute) rather than redirect.
export async function requireUserForApi(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new UnauthorizedError("Sign in is required.");
  }
  return user;
}

function mapWorkOSUser(auth: UserInfo): CurrentUser {
  return {
    id: auth.user.id,
    email: getUserEmail(auth.user) ?? "",
    firstName: auth.user.firstName,
    lastName: auth.user.lastName
  };
}

export function getUserEmail(user?: Pick<User, "email"> | CurrentUser | null) {
  return user?.email ?? null;
}
