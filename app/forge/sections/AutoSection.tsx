"use client";

// AgentKitAuto — on-demand, fire-and-forget autonomous runs (Phase A).
//
// Three things, minimal but functional:
//   1. Create a STANDING APPROVAL for one of your kits (tool allowlist + max
//      budget). The allowlist is your consent — Auto runs the kit with no per-step
//      confirm. The Phase-A sandbox supports ONLY file tools (read_file / list_dir
//      / write_file); there is NO autonomous shell, so run_command is intentionally
//      not offered here (auto-core hard-rejects it anyway).
//   2. START A RUN: pick a kit you have an approval for, enter the task input, and
//      set THIS run's budget (required; must be <= the approval ceiling — the
//      server enforces it and returns 403 if exceeded).
//   3. RUN HISTORY + detail: status, final output, produced-file manifest, audit
//      log, and a kill-switch cancel button. Polls the detail while a run is active.
//
// All HTTP is the cookie path (/api/auto/*) via fetch with credentials — this is
// the browser UI; the bearer path (/api/forge/auto/*) is for desktop/CLI clients.
import { useCallback, useEffect, useState } from "react";
import type { MyKitEntry, Notify } from "./shared";
import { errMsg } from "./shared";

// Phase-A sandbox tools the user can authorize. NO run_command (no autonomous shell).
const SANDBOX_TOOLS = ["read_file", "list_dir", "write_file"] as const;

type KitRef = { source: "local"; localKitId: string };

type Approval = {
  id: string;
  kitRef: { source: string; localKitId?: string; marketKitId?: string; slug?: string };
  toolAllowlist: string[];
  maxBudgetCents: number;
  networkPolicy: string;
  createdAt: string;
  revokedAt: string | null;
};

type AuditEntry = { tool: string; argsSummary: string; outcome: string; ts: string; detail?: string };
type RunFile = { path: string; sizeBytes: number };
type Run = {
  id: string;
  kitRef: { source: string; localKitId?: string; marketKitId?: string; slug?: string };
  status: string;
  input: { prompt: string };
  budgetCents: number;
  spentCents: number;
  model: string;
  createdAt: string;
  finishedAt?: string;
  error?: string;
  result?: { output: string; files: RunFile[] };
  auditLog?: AuditEntry[];
};

type Schedule = {
  id: string;
  kitRef: { source: string; localKitId?: string; marketKitId?: string; slug?: string };
  cron: string;
  timezone: string;
  input: { prompt: string };
  budgetCents: number;
  model: string;
  approvalId: string;
  enabled: boolean;
  createdAt: string;
  lastRunAt: string | null;
  lastRunId: string | null;
  nextRunAt: string;
  lastError: string | null;
};

const ACTIVE = new Set(["queued", "running"]);

function centsToUsd(c: number): string {
  return `$${(c / 100).toFixed(2)}`;
}

function fmtTs(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/** The browser's IANA timezone, used as the schedule default. */
function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body as T;
}

export function AutoSection({ kits, notify }: { kits: MyKitEntry[]; notify: Notify }) {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<Run | null>(null);

  // Approval form state.
  const [apprKitId, setApprKitId] = useState("");
  const [apprTools, setApprTools] = useState<string[]>(["read_file", "list_dir"]);
  const [apprBudgetUsd, setApprBudgetUsd] = useState("1.00");
  const [apprBusy, setApprBusy] = useState(false);

  // Run form state.
  const [runKitId, setRunKitId] = useState("");
  const [runPrompt, setRunPrompt] = useState("");
  const [runBudgetUsd, setRunBudgetUsd] = useState("0.50");
  const [runBusy, setRunBusy] = useState(false);

  // Schedule state (Phase B).
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [schedKitId, setSchedKitId] = useState("");
  const [schedCron, setSchedCron] = useState("0 9 * * *");
  const [schedTz, setSchedTz] = useState(localTimezone());
  const [schedPrompt, setSchedPrompt] = useState("");
  const [schedBudgetUsd, setSchedBudgetUsd] = useState("0.50");
  const [schedBusy, setSchedBusy] = useState(false);

  const loadApprovals = useCallback(async () => {
    try {
      const { approvals } = await jsonFetch<{ approvals: Approval[] }>("/api/auto/approvals");
      setApprovals(approvals.filter((a) => a.revokedAt === null));
    } catch (e) {
      notify(errMsg(e), true);
    }
  }, [notify]);

  const loadRuns = useCallback(async () => {
    try {
      const { runs } = await jsonFetch<{ runs: Run[] }>("/api/auto/runs");
      setRuns(runs);
    } catch (e) {
      notify(errMsg(e), true);
    }
  }, [notify]);

  const loadSchedules = useCallback(async () => {
    try {
      const { schedules } = await jsonFetch<{ schedules: Schedule[] }>("/api/auto/schedules");
      setSchedules(schedules);
    } catch (e) {
      notify(errMsg(e), true);
    }
  }, [notify]);

  useEffect(() => {
    void loadApprovals();
    void loadRuns();
    void loadSchedules();
  }, [loadApprovals, loadRuns, loadSchedules]);

  // Poll the open run + the list while a run is active.
  useEffect(() => {
    if (!openRunId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const run = await jsonFetch<Run>(`/api/auto/runs/${openRunId}`);
        if (!cancelled) setOpenRun(run);
      } catch {
        /* transient */
      }
    };
    void tick();
    const iv = setInterval(() => {
      if (!cancelled) {
        void tick();
        void loadRuns();
      }
    }, 2500);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [openRunId, loadRuns]);

  const kitsWithApproval = approvals
    .map((a) => a.kitRef.localKitId)
    .filter((id): id is string => typeof id === "string");

  const submitApproval = async () => {
    if (!apprKitId) return notify("Pick a kit to authorize.", true);
    const cents = Math.round(parseFloat(apprBudgetUsd) * 100);
    if (!Number.isInteger(cents) || cents <= 0) return notify("Max budget must be a positive amount.", true);
    setApprBusy(true);
    try {
      const kitRef: KitRef = { source: "local", localKitId: apprKitId };
      await jsonFetch<Approval>("/api/auto/approvals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kitRef, toolAllowlist: apprTools, maxBudgetCents: cents })
      });
      notify("Standing approval created.");
      await loadApprovals();
    } catch (e) {
      notify(errMsg(e), true);
    } finally {
      setApprBusy(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await jsonFetch(`/api/auto/approvals/${id}/revoke`, { method: "POST" });
      notify("Approval revoked.");
      await loadApprovals();
    } catch (e) {
      notify(errMsg(e), true);
    }
  };

  const startRun = async () => {
    if (!runKitId) return notify("Pick a kit (one with a standing approval).", true);
    if (!runPrompt.trim()) return notify("Enter a task for the run.", true);
    const cents = Math.round(parseFloat(runBudgetUsd) * 100);
    if (!Number.isInteger(cents) || cents <= 0) return notify("Run budget is required (positive amount).", true);
    setRunBusy(true);
    try {
      const kitRef: KitRef = { source: "local", localKitId: runKitId };
      const { id } = await jsonFetch<{ id: string }>("/api/auto/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kitRef, input: { prompt: runPrompt }, budgetCents: cents })
      });
      notify("Run started.");
      setRunPrompt("");
      setOpenRunId(id);
      await loadRuns();
    } catch (e) {
      notify(errMsg(e), true);
    } finally {
      setRunBusy(false);
    }
  };

  const cancelRun = async (id: string) => {
    try {
      await jsonFetch(`/api/auto/runs/${id}/cancel`, { method: "POST" });
      notify("Cancellation requested.");
      await loadRuns();
    } catch (e) {
      notify(errMsg(e), true);
    }
  };

  // The standing approval for a local kit id (schedules must reference one).
  const approvalForKit = (kitId: string): Approval | undefined =>
    approvals.find((a) => a.kitRef.localKitId === kitId && a.revokedAt === null);

  const createSchedule = async () => {
    if (!schedKitId) return notify("Pick a kit (one with a standing approval).", true);
    const approval = approvalForKit(schedKitId);
    if (!approval) return notify("That kit has no standing approval.", true);
    if (!schedCron.trim()) return notify("Enter a cron expression.", true);
    if (!schedPrompt.trim()) return notify("Enter a task for the schedule.", true);
    const cents = Math.round(parseFloat(schedBudgetUsd) * 100);
    if (!Number.isInteger(cents) || cents <= 0) return notify("Per-run budget is required (positive amount).", true);
    setSchedBusy(true);
    try {
      const kitRef: KitRef = { source: "local", localKitId: schedKitId };
      await jsonFetch<Schedule>("/api/auto/schedules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kitRef,
          cron: schedCron.trim(),
          timezone: schedTz.trim() || "UTC",
          input: { prompt: schedPrompt },
          budgetCents: cents,
          approvalId: approval.id
        })
      });
      notify("Schedule created.");
      setSchedPrompt("");
      await loadSchedules();
    } catch (e) {
      notify(errMsg(e), true);
    } finally {
      setSchedBusy(false);
    }
  };

  const toggleSchedule = async (s: Schedule) => {
    try {
      await jsonFetch<Schedule>(`/api/auto/schedules/${s.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !s.enabled })
      });
      await loadSchedules();
    } catch (e) {
      notify(errMsg(e), true);
    }
  };

  const removeSchedule = async (id: string) => {
    try {
      await jsonFetch(`/api/auto/schedules/${id}`, { method: "DELETE" });
      notify("Schedule deleted.");
      await loadSchedules();
    } catch (e) {
      notify(errMsg(e), true);
    }
  };

  const kitLabel = (id?: string) => kits.find((k) => k.kitId === id)?.name ?? id ?? "(unknown kit)";

  return (
    <div className="form-layout">
      <div className="form-panel">
        {/* ---- Standing approval ---- */}
        <h3>Authorize a kit</h3>
        <p className="form-copy">
          A standing approval lets Auto run a kit autonomously (no per-step confirm). The tool allowlist is your
          consent; Auto can only use file tools confined to a per-run workspace. There is no autonomous shell.
        </p>
        <div className="field">
          <label>Kit</label>
          <select value={apprKitId} onChange={(e) => setApprKitId(e.target.value)}>
            <option value="">Select a kit…</option>
            {kits.map((k) => (
              <option key={k.kitId} value={k.kitId}>
                {k.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Allowed tools</label>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {SANDBOX_TOOLS.map((t) => (
              <label key={t} style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
                <input
                  type="checkbox"
                  checked={apprTools.includes(t)}
                  onChange={(e) =>
                    setApprTools((prev) => (e.target.checked ? [...prev, t] : prev.filter((x) => x !== t)))
                  }
                />
                <code>{t}</code>
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Max budget per run (USD)</label>
          <input type="number" min="0.01" step="0.01" value={apprBudgetUsd} onChange={(e) => setApprBudgetUsd(e.target.value)} />
        </div>
        <button className="primary-button" disabled={apprBusy} onClick={() => void submitApproval()}>
          {apprBusy ? "Creating…" : "Create approval"}
        </button>

        <div className="results-panel" style={{ marginTop: 16 }}>
          <h4 style={{ marginTop: 0 }}>Active approvals</h4>
          {approvals.length === 0 ? (
            <p className="form-copy">No standing approvals yet.</p>
          ) : (
            approvals.map((a) => (
              <div key={a.id} className="provider-card" style={{ marginBottom: 8, padding: "8px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: "0.85em" }}>
                    <strong>{kitLabel(a.kitRef.localKitId)}</strong>
                    <div style={{ color: "var(--color-text-secondary)" }}>
                      {a.toolAllowlist.join(", ") || "no tools"} · ceiling {centsToUsd(a.maxBudgetCents)}
                    </div>
                  </div>
                  <button className="secondary-button" style={{ fontSize: "0.8em", padding: "3px 10px" }} onClick={() => void revoke(a.id)}>
                    Revoke
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* ---- Start a run ---- */}
        <h3 style={{ marginTop: 24 }}>Start a run</h3>
        <div className="field">
          <label>Kit (must have an approval)</label>
          <select value={runKitId} onChange={(e) => setRunKitId(e.target.value)}>
            <option value="">Select a kit…</option>
            {kits
              .filter((k) => kitsWithApproval.includes(k.kitId))
              .map((k) => (
                <option key={k.kitId} value={k.kitId}>
                  {k.name}
                </option>
              ))}
          </select>
        </div>
        <div className="field">
          <label>Task</label>
          <textarea rows={4} value={runPrompt} onChange={(e) => setRunPrompt(e.target.value)} placeholder="What should the kit do, end to end?" />
        </div>
        <div className="field">
          <label>This run&apos;s budget (USD, required)</label>
          <input type="number" min="0.01" step="0.01" value={runBudgetUsd} onChange={(e) => setRunBudgetUsd(e.target.value)} />
        </div>
        <button className="primary-button" disabled={runBusy} onClick={() => void startRun()}>
          {runBusy ? "Starting…" : "Start run"}
        </button>

        {/* ---- Schedules (Phase B) ---- */}
        <h3 style={{ marginTop: 24 }}>Schedules</h3>
        <p className="form-copy">
          A schedule fires a run automatically on a cron cadence, under the kit&apos;s standing approval and a
          per-run budget. Each fire is still gated by the approval — a schedule never widens consent.
        </p>
        <div className="field">
          <label>Kit (must have an approval)</label>
          <select value={schedKitId} onChange={(e) => setSchedKitId(e.target.value)}>
            <option value="">Select a kit…</option>
            {kits
              .filter((k) => kitsWithApproval.includes(k.kitId))
              .map((k) => (
                <option key={k.kitId} value={k.kitId}>
                  {k.name}
                </option>
              ))}
          </select>
        </div>
        <div className="field">
          <label>Cron (minute hour dom month dow)</label>
          <input type="text" value={schedCron} onChange={(e) => setSchedCron(e.target.value)} placeholder="0 9 * * *" />
        </div>
        <div className="field">
          <label>Timezone (IANA)</label>
          <input type="text" value={schedTz} onChange={(e) => setSchedTz(e.target.value)} placeholder="UTC" />
        </div>
        <div className="field">
          <label>Task</label>
          <textarea rows={3} value={schedPrompt} onChange={(e) => setSchedPrompt(e.target.value)} placeholder="What should the kit do on each run?" />
        </div>
        <div className="field">
          <label>Per-run budget (USD, required)</label>
          <input type="number" min="0.01" step="0.01" value={schedBudgetUsd} onChange={(e) => setSchedBudgetUsd(e.target.value)} />
        </div>
        <button className="primary-button" disabled={schedBusy} onClick={() => void createSchedule()}>
          {schedBusy ? "Creating…" : "Create schedule"}
        </button>

        <div className="results-panel" style={{ marginTop: 16 }}>
          <h4 style={{ marginTop: 0 }}>Active schedules</h4>
          {schedules.length === 0 ? (
            <p className="form-copy">No schedules yet.</p>
          ) : (
            schedules.map((s) => (
              <div key={s.id} className="provider-card" style={{ marginBottom: 8, padding: "8px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: "0.85em" }}>
                    <strong>{kitLabel(s.kitRef.localKitId)}</strong>{" "}
                    <code style={{ fontSize: "0.9em" }}>{s.cron}</code>{" "}
                    <span style={{ color: "var(--color-text-secondary)" }}>({s.timezone})</span>
                    <div style={{ color: "var(--color-text-secondary)" }}>
                      {centsToUsd(s.budgetCents)}/run · next {fmtTs(s.nextRunAt)} · last {fmtTs(s.lastRunAt)}
                    </div>
                    {s.lastError && (
                      <div style={{ color: "var(--color-error)" }}>last error: {s.lastError}</div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontWeight: 400, fontSize: "0.8em" }}>
                      <input type="checkbox" checked={s.enabled} onChange={() => void toggleSchedule(s)} />
                      {s.enabled ? "on" : "off"}
                    </label>
                    <button className="secondary-button" style={{ fontSize: "0.8em", padding: "3px 10px" }} onClick={() => void removeSchedule(s.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ---- Run history + detail ---- */}
      <div className="results-panel">
        <h3 style={{ marginTop: 0 }}>Runs</h3>
        {runs.length === 0 ? (
          <p className="form-copy">No runs yet.</p>
        ) : (
          runs.map((r) => (
            <div
              key={r.id}
              className="provider-card"
              style={{ marginBottom: 8, padding: "8px 12px", cursor: "pointer", outline: openRunId === r.id ? "1px solid var(--color-accent)" : "none" }}
              onClick={() => setOpenRunId(r.id)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: "0.85em" }}>
                <strong>{kitLabel(r.kitRef.localKitId)}</strong>
                <span style={{ color: ACTIVE.has(r.status) ? "var(--color-accent)" : "var(--color-text-secondary)" }}>{r.status}</span>
              </div>
              <div style={{ fontSize: "0.78em", color: "var(--color-text-secondary)" }}>
                {centsToUsd(r.spentCents)} / {centsToUsd(r.budgetCents)} · {new Date(r.createdAt).toLocaleString()}
              </div>
            </div>
          ))
        )}

        {openRun && (
          <div className="provider-card" style={{ marginTop: 12, padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h4 style={{ margin: 0 }}>Run detail</h4>
              {ACTIVE.has(openRun.status) && (
                <button className="secondary-button" style={{ fontSize: "0.8em", padding: "3px 10px" }} onClick={() => void cancelRun(openRun.id)}>
                  Cancel
                </button>
              )}
            </div>
            <p style={{ fontSize: "0.82em", color: "var(--color-text-secondary)", margin: "6px 0" }}>
              <strong>{openRun.status}</strong> · {centsToUsd(openRun.spentCents)} / {centsToUsd(openRun.budgetCents)} · {openRun.model}
            </p>
            {openRun.error && <p style={{ color: "var(--color-error)", fontSize: "0.82em" }}>{openRun.error}</p>}

            {openRun.result?.output && (
              <>
                <h5 style={{ margin: "8px 0 4px" }}>Output</h5>
                <pre className="json-panel" style={{ whiteSpace: "pre-wrap", maxHeight: 220 }}>{openRun.result.output}</pre>
              </>
            )}

            {openRun.result?.files && openRun.result.files.length > 0 && (
              <>
                <h5 style={{ margin: "8px 0 4px" }}>Produced files</h5>
                <ul style={{ fontSize: "0.8em", margin: 0, paddingLeft: 18 }}>
                  {openRun.result.files.map((f) => (
                    <li key={f.path}>
                      <code>{f.path}</code> ({f.sizeBytes} bytes)
                    </li>
                  ))}
                </ul>
              </>
            )}

            {openRun.auditLog && openRun.auditLog.length > 0 && (
              <>
                <h5 style={{ margin: "10px 0 4px" }}>Audit log</h5>
                <div style={{ fontSize: "0.76em", fontFamily: "var(--font-mono, monospace)" }}>
                  {openRun.auditLog.map((e, i) => (
                    <div key={i} style={{ color: e.outcome === "ok" ? "inherit" : "var(--color-error)" }}>
                      {e.tool}({e.argsSummary}) → {e.outcome}
                      {e.detail ? ` — ${e.detail}` : ""}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
