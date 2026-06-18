"use client";

import type { SessionUser } from "./shared";

export function AccountSection({ user }: { user: SessionUser }) {
  return (
    <div className="account-screen">
      <div className="account-panel">
        <h2>Signed in</h2>
        <div className="about-meta">
          <p className="form-copy"><strong>{user?.email ?? "Unknown"}</strong></p>
          <p className="form-copy">On the web, your AgentKitProject account is the AuthKit cookie session — there is no separate device login. Market submit and licensed previews use this session.</p>
        </div>
        <div className="button-row">
          <a className="secondary-button" href="/auth/sign-out">Sign out</a>
          <a className="secondary-button" href="https://profile.agentkitproject.com" target="_blank" rel="noreferrer">Manage profile</a>
        </div>
      </div>
    </div>
  );
}
