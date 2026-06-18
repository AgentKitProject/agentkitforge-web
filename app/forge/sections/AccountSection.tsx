"use client";

import type { SessionUser } from "./shared";

const MARKET_BASE_URL =
  process.env.NEXT_PUBLIC_AGENTKITMARKET_BASE_URL ??
  "https://market.agentkitproject.com";

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

      {/* Market connection panel */}
      <div className="account-panel" style={{ marginTop: 20 }}>
        <h2>Market connection</h2>
        <div className="about-meta">
          <p className="form-copy">
            <strong>Hosted AgentKitMarket</strong> — connected via your AgentKitProject session.
          </p>
          <div className="provider-card" style={{ marginTop: 8 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: "0.82em", color: "var(--color-text-secondary)", minWidth: 100 }}>Base URL</span>
                <span className="inline-code" style={{ fontSize: "0.82em" }}>{MARKET_BASE_URL}</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: "0.82em", color: "var(--color-text-secondary)", minWidth: 100 }}>Auth mode</span>
                <span style={{ fontSize: "0.82em" }}>AgentKitProject (WorkOS cookie session)</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: "0.82em", color: "var(--color-text-secondary)", minWidth: 100 }}>Submit</span>
                <span className="source-badge" style={{ fontSize: "0.78em" }}>Available — requires sign-in</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: "0.82em", color: "var(--color-text-secondary)", minWidth: 100 }}>Import</span>
                <span className="source-badge" style={{ fontSize: "0.78em" }}>Available — requires sign-in</span>
              </div>
            </div>
          </div>

          <p className="form-copy" style={{ marginTop: 12 }}>
            <strong>Private Market</strong> — not yet available on this instance. Self-hosted Market support is part of Market Phase 2.
          </p>
          <div className="provider-card" style={{ opacity: 0.6 }}>
            <p className="form-copy" style={{ margin: 0, fontSize: "0.85em" }}>
              Private / self-hosted Market: coming in Phase 2. When available, you will be able to configure a custom base URL and credentials here.
            </p>
          </div>
        </div>
        <div className="button-row" style={{ marginTop: 12 }}>
          <a className="secondary-button" href="https://market.agentkitproject.com" target="_blank" rel="noreferrer">Open AgentKitMarket</a>
        </div>
      </div>

      {/* AgentKitAuto placeholder */}
      <div className="account-panel" style={{ marginTop: 20 }}>
        <h2>AgentKitAuto <span className="source-badge" style={{ marginLeft: 6, fontSize: "0.75em" }}>Coming soon</span></h2>
        <p className="form-copy">
          AgentKitAuto enables automated kit workflows. It requires explicit opt-in and will never run background operations without your permission. Full build-out is planned after Market Phase 2.
        </p>
      </div>
    </div>
  );
}
