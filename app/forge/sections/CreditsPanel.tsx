"use client";

// Managed prepaid-credit balance UI. Fetches /api/me/credits and renders
// "Credits: $X.XX". Used in Settings and the Build-with-AI tab.
//
// The dev-grant button calls POST /api/credits/dev-grant, which is gated to an
// admin allowlist server-side (ADMIN_EMAILS); for non-admins it simply returns
// 403 and we surface the message. It is a pre-Stripe testing affordance — the
// real "top up" (Stripe) is Gateway 1b-ii.
import { useCallback, useEffect, useState } from "react";
import type { Notify } from "./shared";
import { errMsg } from "./shared";

export type Credits = { balanceCents: number; currency: string };

export function formatCents(cents: number, currency = "USD"): string {
  const symbol = currency === "USD" ? "$" : `${currency} `;
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

/** Fetches the current credit balance. Exposed so other panels can reuse it. */
export async function fetchCredits(): Promise<Credits | null> {
  const res = await fetch("/api/me/credits", { credentials: "include" });
  if (!res.ok) return null;
  return (await res.json()) as Credits;
}

export function CreditsPanel({
  notify,
  showDevGrant = false
}: {
  notify: Notify;
  showDevGrant?: boolean;
}) {
  const [credits, setCredits] = useState<Credits | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCredits(await fetchCredits());
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const devGrant = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/credits/dev-grant", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountCents: 500 })
      });
      const data = (await res.json()) as { balanceCents?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? `Grant failed (${res.status})`);
      notify("Dev credit grant applied.");
      await load();
    } catch (e) {
      notify(errMsg(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="provider-card" style={{ padding: "10px 12px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <strong>
          Credits:{" "}
          {credits ? formatCents(credits.balanceCents, credits.currency) : error ? "—" : "…"}
        </strong>
        <span style={{ flex: 1, fontSize: "0.85em", color: "var(--color-text-secondary)" }}>
          Managed AI uses prepaid credits (used when you have no AI provider configured).
        </span>
        {showDevGrant && (
          <button className="secondary-button" disabled={busy} onClick={() => void devGrant()}>
            {busy ? "…" : "+ $5 (dev/admin)"}
          </button>
        )}
      </div>
      {error && <p className="inline-warning" style={{ marginTop: 6 }}>{error}</p>}
    </div>
  );
}

/**
 * Inline banner for a 402 insufficient-credits response from a draft route.
 * Renders the server message + a disabled "top up — coming soon" placeholder.
 */
export function InsufficientCreditsBanner({
  message,
  requiredCents,
  balanceCents,
  currency = "USD"
}: {
  message: string;
  requiredCents?: number;
  balanceCents?: number;
  currency?: string;
}) {
  return (
    <div className="inline-warning" style={{ marginTop: 10, padding: "8px 10px" }}>
      <strong>Out of credits.</strong> {message}
      {typeof balanceCents === "number" && (
        <div style={{ fontSize: "0.85em", marginTop: 4 }}>
          Balance: {formatCents(balanceCents, currency)}
          {typeof requiredCents === "number" && <> · Needed: ~{formatCents(requiredCents, currency)}</>}
        </div>
      )}
      <div style={{ marginTop: 6 }}>
        <button className="primary-button" disabled title="Stripe top-up is coming soon (Gateway 1b-ii).">
          Top up — coming soon
        </button>
      </div>
    </div>
  );
}
