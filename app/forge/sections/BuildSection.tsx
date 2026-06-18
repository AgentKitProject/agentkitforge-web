"use client";

import { useRef, useState } from "react";
import type { Forge, MyKitEntry, Notify } from "./shared";
import { errMsg } from "./shared";

type BuildTab = "ai" | "template" | "draft" | "guided" | "edit-ai";

export function BuildSection({
  forge,
  notify,
  kits,
  onOpen
}: {
  forge: Forge;
  notify: Notify;
  kits: MyKitEntry[];
  onOpen: (id: string) => void;
}) {
  const [tab, setTab] = useState<BuildTab>("ai");
  return (
    <div className="build-screen">
      <div className="segmented-control" role="tablist">
        {([
          ["ai", "Build with AI"],
          ["guided", "Guided"],
          ["template", "From template"],
          ["draft", "From draft JSON"],
          ["edit-ai", "Edit with AI"]
        ] as [BuildTab, string][]).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`segment-button ${tab === id ? "active" : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "ai" && <BuildWithAi forge={forge} notify={notify} onOpen={onOpen} />}
      {tab === "guided" && <GuidedBuilder forge={forge} notify={notify} onOpen={onOpen} />}
      {tab === "template" && <BuildFromTemplate forge={forge} notify={notify} onOpen={onOpen} />}
      {tab === "draft" && <RenderDraftJson forge={forge} notify={notify} onOpen={onOpen} />}
      {tab === "edit-ai" && <EditWithAi forge={forge} notify={notify} kits={kits} onOpen={onOpen} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Example document upload + summarize
// ---------------------------------------------------------------------------
type ExDocSummary = {
  id: string;
  name: string;
  filename: string;
  kind: string;
  notes?: string;
};

function ExampleDocsPanel({
  summaries,
  onAdd,
  onRemove
}: {
  summaries: ExDocSummary[];
  onAdd: (s: ExDocSummary) => void;
  onRemove: (id: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setErr(null);
    try {
      const form = new FormData();
      for (const f of Array.from(files)) form.append("file", f);
      const res = await fetch("/api/drafts/summarize-examples", {
        method: "POST",
        credentials: "include",
        body: form
      });
      const data = (await res.json()) as { summaries?: ExDocSummary[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);
      for (const s of data.summaries ?? []) onAdd(s);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="field" style={{ marginTop: 12 }}>
      <label>Example input documents <span style={{ fontWeight: 400, color: "var(--color-text-secondary)", fontSize: "0.88em" }}>(optional)</span></label>
      <p className="form-copy" style={{ marginBottom: 6 }}>
        Upload sample .txt / .md / .csv files so the AI can match your expected formatting and terminology.
        Max 256 KB per file.
      </p>
      {summaries.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {summaries.map((s) => (
            <div key={s.id} className="provider-card" style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", marginBottom: 4 }}>
              <span className="source-badge">{s.kind}</span>
              <span style={{ flex: 1, fontSize: "0.9em" }}>{s.filename}</span>
              <button
                className="danger-button"
                style={{ fontSize: "0.78em", padding: "2px 8px" }}
                onClick={() => onRemove(s.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="button-row">
        <button
          className="secondary-button"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? "Uploading…" : "+ Attach document"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md,.csv"
          multiple
          style={{ display: "none" }}
          onChange={(e) => void upload(e.target.files)}
        />
      </div>
      {err && <p className="inline-warning" style={{ marginTop: 6 }}>{err}</p>}
    </div>
  );
}

// --- Build with AI -----------------------------------------------------------
function BuildWithAi({ forge, notify, onOpen }: { forge: Forge; notify: Notify; onOpen: (id: string) => void }) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<unknown>(null);
  const [draftJson, setDraftJson] = useState<unknown>(null);
  const [changeRequest, setChangeRequest] = useState("");
  const [exDocs, setExDocs] = useState<ExDocSummary[]>([]);

  const run = async (fn: () => Promise<{ draftJson?: unknown; session?: unknown }>, ok: string) => {
    setBusy(true);
    try {
      const r = await fn();
      setDraftJson(r.draftJson ?? null);
      setSession(r.session ?? null);
      notify(ok);
    } catch (e) {
      notify(errMsg(e), true);
    } finally {
      setBusy(false);
    }
  };

  const generate = () => {
    const input: Record<string, unknown> = { userRequest: prompt };
    if (exDocs.length > 0) input.exampleDocuments = exDocs;
    return run(
      () => forge.generateAgentKitDraftWithAi(input as never) as never,
      "Draft generated."
    );
  };

  return (
    <div className="form-layout">
      <div className="form-panel">
        <h2>Generate with AI</h2>
        <p className="form-copy">Uses your default AI provider (configure under Settings). Generate a draft, optionally revise, then render into a kit.</p>
        <div className="field">
          <label>Describe the kit you want</label>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. A kit that reviews quarterly financial reports and flags anomalies." />
        </div>

        <ExampleDocsPanel
          summaries={exDocs}
          onAdd={(s) => setExDocs((prev) => [...prev, s])}
          onRemove={(id) => setExDocs((prev) => prev.filter((d) => d.id !== id))}
        />

        <button className="primary-button" style={{ marginTop: 12 }} disabled={!prompt.trim() || busy} onClick={() => void generate()}>
          {busy ? "Working…" : "Generate draft"}
        </button>
        {draftJson != null && (
          <>
            <div className="field" style={{ marginTop: 12 }}>
              <label>Revision request (optional)</label>
              <input value={changeRequest} onChange={(e) => setChangeRequest(e.target.value)} placeholder="e.g. add a skill for variance analysis" />
            </div>
            <div className="button-row">
              <button className="secondary-button" disabled={!changeRequest.trim() || busy} onClick={() => void run(() => forge.reviseAgentKitDraftWithAi({ session, changeRequest } as never) as never, "Draft revised.").then(() => setChangeRequest(""))}>
                Revise
              </button>
              <button
                className="primary-button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const res = await forge.renderGeneratedAgentKitDraft({ draftJson, outputFolder: "", force: true });
                    notify("Kit created from draft.");
                    if (res.kitId) onOpen(res.kitId);
                  } catch (e) {
                    notify(errMsg(e), true);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Render into a kit
              </button>
            </div>
          </>
        )}
      </div>
      <div className="results-panel">
        <h2>Draft preview</h2>
        {draftJson == null ? (
          <p>Your generated draft will appear here. Review it before rendering into a kit.</p>
        ) : (
          <pre className="json-panel">{JSON.stringify(draftJson, null, 2)}</pre>
        )}
      </div>
    </div>
  );
}

// --- Guided Builder ----------------------------------------------------------
type GuidedStep = "basics" | "skills" | "policies" | "prompts" | "review";

type GuidedSkill = {
  id: string;
  name: string;
  description: string;
  triggers?: string;
  useWhen?: string;
  doNotUseWhen?: string;
};

type GuidedPolicy = {
  id: string;
  text: string;
};

type GuidedPromptDef = {
  id: string;
  name: string;
  description: string;
  template: string;
};

type GuidedForm = {
  kitId: string;
  name: string;
  description: string;
  domain: string;
  targetUsers: string;
  skills: GuidedSkill[];
  policies: GuidedPolicy[];
  prompts: GuidedPromptDef[];
};

const STEPS: { id: GuidedStep; label: string; badge?: string }[] = [
  { id: "basics", label: "Basics", badge: "Required" },
  { id: "skills", label: "Skills", badge: "Recommended" },
  { id: "policies", label: "Policies", badge: "Optional" },
  { id: "prompts", label: "Prompts", badge: "Optional" },
  { id: "review", label: "Review & Create" }
];

function GuidedBuilder({ forge, notify, onOpen }: { forge: Forge; notify: Notify; onOpen: (id: string) => void }) {
  const [step, setStep] = useState<GuidedStep>("basics");
  const [form, setForm] = useState<GuidedForm>({
    kitId: "",
    name: "",
    description: "",
    domain: "",
    targetUsers: "",
    skills: [],
    policies: [],
    prompts: []
  });
  const [busy, setBusy] = useState(false);
  const [newSkill, setNewSkill] = useState<GuidedSkill>({ id: "", name: "", description: "" });
  const [newPolicy, setNewPolicy] = useState<GuidedPolicy>({ id: "", text: "" });
  const [newPrompt, setNewPrompt] = useState<GuidedPromptDef>({ id: "", name: "", description: "", template: "" });

  const stepIdx = STEPS.findIndex((s) => s.id === step);

  const canCreate = form.kitId.trim() && form.name.trim() && form.description.trim();

  const addSkill = () => {
    if (!newSkill.id.trim() || !newSkill.name.trim()) return;
    setForm((f) => ({ ...f, skills: [...f.skills, { ...newSkill }] }));
    setNewSkill({ id: "", name: "", description: "" });
  };

  const addPolicy = () => {
    if (!newPolicy.text.trim()) return;
    const id = newPolicy.id.trim() || `policy-${Date.now()}`;
    setForm((f) => ({ ...f, policies: [...f.policies, { id, text: newPolicy.text }] }));
    setNewPolicy({ id: "", text: "" });
  };

  const addPrompt = () => {
    if (!newPrompt.id.trim() || !newPrompt.name.trim()) return;
    setForm((f) => ({ ...f, prompts: [...f.prompts, { ...newPrompt }] }));
    setNewPrompt({ id: "", name: "", description: "", template: "" });
  };

  const buildDraft = () => {
    const skills = form.skills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      triggers: s.triggers ? [s.triggers] : undefined,
      useWhen: s.useWhen || undefined,
      doNotUseWhen: s.doNotUseWhen || undefined
    }));
    const preparedPrompts = form.prompts.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      template: p.template || `# ${p.name}\n\n{{context}}`
    }));
    const policies =
      form.policies.length > 0
        ? form.policies.map((p) => ({ id: p.id, text: p.text }))
        : undefined;
    return {
      manifest: {
        id: form.kitId.trim(),
        name: form.name.trim(),
        version: "1",
        schemaVersion: "0.1",
        description: form.description.trim(),
        domain: form.domain.trim() || undefined,
        targetUsers: form.targetUsers.trim() || undefined
      },
      skills,
      policies,
      preparedPrompts: preparedPrompts.length ? preparedPrompts : undefined,
      files: {}
    };
  };

  const create = async () => {
    if (!canCreate) return;
    setBusy(true);
    try {
      const draft = buildDraft();
      const res = await forge.renderGeneratedAgentKitDraft({ draftJson: draft, outputFolder: "", force: true });
      notify("Kit created from guided builder.");
      if (res.kitId) onOpen(res.kitId);
    } catch (e) {
      notify(errMsg(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form-layout">
      <div className="form-panel">
        {/* Step indicator */}
        <div className="step-indicator" style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`segment-button ${s.id === step ? "active" : ""}`}
              onClick={() => setStep(s.id)}
              style={{ fontSize: "0.82em" }}
            >
              {i + 1}. {s.label}
              {s.badge && <span className="source-badge" style={{ marginLeft: 4, fontSize: "0.75em" }}>{s.badge}</span>}
            </button>
          ))}
        </div>

        {step === "basics" && (
          <>
            <h2>Basic information</h2>
            <p className="form-copy">Define the core identity of your Agent Kit.</p>
            <div className="field"><label>Kit ID (slug) <span style={{ color: "var(--color-error)" }}>*</span></label><input value={form.kitId} onChange={(e) => setForm((f) => ({ ...f, kitId: e.target.value }))} placeholder="my-kit" /></div>
            <div className="field"><label>Name <span style={{ color: "var(--color-error)" }}>*</span></label><input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="My Kit" /></div>
            <div className="field"><label>Description <span style={{ color: "var(--color-error)" }}>*</span></label><textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
            <div className="field"><label>Domain (optional)</label><input value={form.domain} onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))} placeholder="e.g. finance, legal, healthcare" /></div>
            <div className="field"><label>Target users (optional)</label><input value={form.targetUsers} onChange={(e) => setForm((f) => ({ ...f, targetUsers: e.target.value }))} placeholder="e.g. financial analysts, legal teams" /></div>
            <div className="button-row" style={{ marginTop: 12 }}>
              <button className="primary-button" disabled={!form.kitId.trim() || !form.name.trim() || !form.description.trim()} onClick={() => setStep("skills")}>Next: Skills →</button>
            </div>
          </>
        )}

        {step === "skills" && (
          <>
            <h2>Skills ({form.skills.length} defined)</h2>
            <p className="form-copy">Skills are discrete capabilities your kit provides. Each skill has a name, description, and optional triggers. At least one skill is recommended.</p>
            {form.skills.map((s, i) => (
              <div key={s.id} className="provider-card" style={{ marginBottom: 8 }}>
                <strong>{s.name}</strong> <span className="inline-code">{s.id}</span>
                <p className="form-copy" style={{ margin: "2px 0" }}>{s.description}</p>
                {s.triggers && <p className="form-copy" style={{ margin: "2px 0", fontSize: "0.85em" }}>Triggers: {s.triggers}</p>}
                {s.useWhen && <p className="form-copy" style={{ margin: "2px 0", fontSize: "0.85em" }}>Use when: {s.useWhen}</p>}
                {s.doNotUseWhen && <p className="form-copy" style={{ margin: "2px 0", fontSize: "0.85em" }}>Do not use when: {s.doNotUseWhen}</p>}
                <button className="danger-button" style={{ fontSize: "0.8em", padding: "2px 10px" }} onClick={() => setForm((f) => ({ ...f, skills: f.skills.filter((_, j) => j !== i) }))}>Remove</button>
              </div>
            ))}
            <div className="field"><label>Skill ID</label><input value={newSkill.id} onChange={(e) => setNewSkill((s) => ({ ...s, id: e.target.value }))} placeholder="analyze-report" /></div>
            <div className="field"><label>Skill name</label><input value={newSkill.name} onChange={(e) => setNewSkill((s) => ({ ...s, name: e.target.value }))} placeholder="Analyze Report" /></div>
            <div className="field"><label>Description</label><textarea value={newSkill.description} onChange={(e) => setNewSkill((s) => ({ ...s, description: e.target.value }))} style={{ minHeight: 64 }} /></div>
            <div className="field"><label>Triggers (optional) — natural-language phrases that invoke this skill</label><input value={newSkill.triggers ?? ""} onChange={(e) => setNewSkill((s) => ({ ...s, triggers: e.target.value }))} placeholder="when user asks to analyze…" /></div>
            <div className="field"><label>Use when (optional)</label><input value={newSkill.useWhen ?? ""} onChange={(e) => setNewSkill((s) => ({ ...s, useWhen: e.target.value }))} placeholder="user provides a report document" /></div>
            <div className="field"><label>Do not use when (optional)</label><input value={newSkill.doNotUseWhen ?? ""} onChange={(e) => setNewSkill((s) => ({ ...s, doNotUseWhen: e.target.value }))} placeholder="no document is provided" /></div>
            <div className="button-row">
              <button className="secondary-button" disabled={!newSkill.id.trim() || !newSkill.name.trim()} onClick={addSkill}>+ Add skill</button>
              <button className="primary-button" onClick={() => setStep("policies")}>Next: Policies →</button>
            </div>
          </>
        )}

        {step === "policies" && (
          <>
            <h2>Policies ({form.policies.length} defined)</h2>
            <p className="form-copy">Policies are guardrails and rules the kit enforces — what it should always or never do. Each policy is a plain-text statement.</p>
            {form.policies.map((p, i) => (
              <div key={p.id} className="provider-card" style={{ marginBottom: 8 }}>
                <p className="form-copy" style={{ margin: "2px 0" }}>{p.text}</p>
                <button className="danger-button" style={{ fontSize: "0.8em", padding: "2px 10px" }} onClick={() => setForm((f) => ({ ...f, policies: f.policies.filter((_, j) => j !== i) }))}>Remove</button>
              </div>
            ))}
            <div className="field"><label>Policy text</label><textarea value={newPolicy.text} onChange={(e) => setNewPolicy((p) => ({ ...p, text: e.target.value }))} style={{ minHeight: 64 }} placeholder="Always cite sources when summarizing documents." /></div>
            <div className="button-row">
              <button className="secondary-button" disabled={!newPolicy.text.trim()} onClick={addPolicy}>+ Add policy</button>
              <button className="primary-button" onClick={() => setStep("prompts")}>Next: Prompts →</button>
            </div>
          </>
        )}

        {step === "prompts" && (
          <>
            <h2>Prepared prompts ({form.prompts.length} defined)</h2>
            <p className="form-copy">Prepared prompts are templated workflows users can run from the Use section. Use {"{{variable}}"} syntax for inputs. Optional but recommended.</p>
            {form.prompts.map((p, i) => (
              <div key={p.id} className="provider-card" style={{ marginBottom: 8 }}>
                <strong>{p.name}</strong> <span className="inline-code">{p.id}</span>
                <p className="form-copy" style={{ margin: "2px 0" }}>{p.description}</p>
                <button className="danger-button" style={{ fontSize: "0.8em", padding: "2px 10px" }} onClick={() => setForm((f) => ({ ...f, prompts: f.prompts.filter((_, j) => j !== i) }))}>Remove</button>
              </div>
            ))}
            <div className="field"><label>Prompt ID</label><input value={newPrompt.id} onChange={(e) => setNewPrompt((p) => ({ ...p, id: e.target.value }))} placeholder="run-analysis" /></div>
            <div className="field"><label>Prompt name</label><input value={newPrompt.name} onChange={(e) => setNewPrompt((p) => ({ ...p, name: e.target.value }))} placeholder="Run Analysis" /></div>
            <div className="field"><label>Description</label><input value={newPrompt.description} onChange={(e) => setNewPrompt((p) => ({ ...p, description: e.target.value }))} /></div>
            <div className="field"><label>Template (use {"{{variable}}"} for inputs)</label><textarea value={newPrompt.template} onChange={(e) => setNewPrompt((p) => ({ ...p, template: e.target.value }))} style={{ minHeight: 80, fontFamily: "var(--mono, monospace)" }} placeholder={"Analyze the following report:\n\n{{report}}\n\nFocus on: {{focus_area}}"} /></div>
            <div className="button-row">
              <button className="secondary-button" disabled={!newPrompt.id.trim() || !newPrompt.name.trim()} onClick={addPrompt}>+ Add prompt</button>
              <button className="primary-button" onClick={() => setStep("review")}>Next: Review →</button>
            </div>
          </>
        )}

        {step === "review" && (
          <>
            <h2>Review &amp; create</h2>
            <div className="results-panel" style={{ padding: "12px 16px", marginBottom: 12 }}>
              <p><strong>ID:</strong> <span className="inline-code">{form.kitId}</span></p>
              <p><strong>Name:</strong> {form.name}</p>
              <p><strong>Description:</strong> {form.description}</p>
              {form.domain && <p><strong>Domain:</strong> {form.domain}</p>}
              <p><strong>Skills:</strong> {form.skills.length} defined</p>
              <p><strong>Policies:</strong> {form.policies.length} defined</p>
              <p><strong>Prompts:</strong> {form.prompts.length} defined</p>
            </div>
            {!canCreate && <p className="inline-warning">Fill in Kit ID, Name, and Description to create.</p>}
            <div className="button-row">
              <button className="secondary-button" onClick={() => setStep("basics")}>← Back</button>
              <button className="primary-button" disabled={!canCreate || busy} onClick={() => void create()}>
                {busy ? "Creating…" : "Create kit"}
              </button>
            </div>
          </>
        )}

        {stepIdx < STEPS.length - 1 && step !== "basics" && step !== "skills" && step !== "policies" && step !== "prompts" && step !== "review" && (
          <div className="button-row" style={{ marginTop: 12 }}>
            <button className="secondary-button" onClick={() => setStep(STEPS[Math.max(0, stepIdx - 1)].id)}>← Back</button>
          </div>
        )}
      </div>

      <div className="results-panel">
        <h2>Preview</h2>
        <pre className="json-panel" style={{ fontSize: "0.78em" }}>{JSON.stringify(buildDraft(), null, 2)}</pre>
      </div>
    </div>
  );
}

// --- Edit with AI ------------------------------------------------------------
function EditWithAi({
  forge,
  notify,
  kits,
  onOpen
}: {
  forge: Forge;
  notify: Notify;
  kits: MyKitEntry[];
  onOpen: (id: string) => void;
}) {
  const [kitId, setKitId] = useState("");
  const [draft, setDraft] = useState<unknown>(null);
  const [session, setSession] = useState<unknown>(null);
  const [changeRequest, setChangeRequest] = useState("");
  const [busy, setBusy] = useState(false);

  const loadDraft = async (id: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/kits/${encodeURIComponent(id)}/draft`, { credentials: "include" }).then((r) => r.json());
      setDraft(res.draft ?? null);
      setSession(null);
      notify("Kit loaded as draft.");
    } catch (e) {
      notify(errMsg(e), true);
    } finally {
      setBusy(false);
    }
  };

  const revise = async () => {
    if (!changeRequest.trim() || !draft) return;
    setBusy(true);
    try {
      const r = await forge.reviseAgentKitDraftWithAi({ session, changeRequest } as never) as { draftJson?: unknown; session?: unknown };
      setDraft(r.draftJson ?? draft);
      setSession(r.session ?? session);
      setChangeRequest("");
      notify("Draft revised.");
    } catch (e) {
      notify(errMsg(e), true);
    } finally {
      setBusy(false);
    }
  };

  const render = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const res = await forge.renderGeneratedAgentKitDraft({ draftJson: draft, outputFolder: "", force: true });
      notify("Kit updated from revised draft.");
      if (res.kitId) onOpen(res.kitId);
    } catch (e) {
      notify(errMsg(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form-layout">
      <div className="form-panel">
        <h2>Edit existing kit with AI</h2>
        <p className="form-copy">Load an owned kit as a draft, request AI revisions, then render the updated kit. The original kit is not modified until you render.</p>
        <div className="field">
          <label>Kit to edit</label>
          <select value={kitId} onChange={(e) => setKitId(e.target.value)}>
            <option value="">Select a kit…</option>
            {kits.map((k) => (
              <option key={k.kitId} value={k.kitId}>{k.name ?? k.kitId}</option>
            ))}
          </select>
        </div>
        <button className="secondary-button" disabled={!kitId || busy} onClick={() => void loadDraft(kitId)}>
          {busy && !draft ? "Loading…" : "Load as draft"}
        </button>
        {draft != null && (
          <>
            <div className="field" style={{ marginTop: 12 }}>
              <label>What should change?</label>
              <textarea value={changeRequest} onChange={(e) => setChangeRequest(e.target.value)} placeholder="e.g. add a skill for executive summary generation, improve the description" />
            </div>
            <div className="button-row">
              <button className="secondary-button" disabled={!changeRequest.trim() || busy} onClick={() => void revise()}>
                {busy ? "Revising…" : "Revise with AI"}
              </button>
              <button className="primary-button" disabled={busy} onClick={() => void render()}>
                Render updated kit
              </button>
            </div>
          </>
        )}
      </div>
      <div className="results-panel">
        <h2>Draft</h2>
        {draft == null ? (
          <p>Select a kit and load it as a draft. The draft JSON will appear here for review before rendering.</p>
        ) : (
          <pre className="json-panel" style={{ fontSize: "0.78em" }}>{JSON.stringify(draft, null, 2)}</pre>
        )}
      </div>
    </div>
  );
}

// --- Build From Template -----------------------------------------------------
function BuildFromTemplate({ forge, notify, onOpen }: { forge: Forge; notify: Notify; onOpen: (id: string) => void }) {
  const [template, setTemplate] = useState("blank");
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = id.trim() && name.trim() && description.trim();

  return (
    <div className="form-layout">
      <div className="form-panel">
        <h2>Create from template</h2>
        <p className="form-copy">Scaffold a new Agent Kit from a starter template, then open it in the editor.</p>
        <div className="field">
          <label>Template</label>
          <select value={template} onChange={(e) => setTemplate(e.target.value)}>
            <option value="blank">blank</option>
            <option value="financial-review">financial-review</option>
          </select>
        </div>
        <div className="field">
          <label>Kit id (slug)</label>
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="my-kit" />
        </div>
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Kit" />
        </div>
        <div className="field">
          <label>Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <button
          className="primary-button"
          disabled={!valid || busy}
          onClick={async () => {
            setBusy(true);
            try {
              const res = await forge.createAgentKitFromTemplate({ template, id: id.trim(), name: name.trim(), description: description.trim() } as never);
              notify("Kit created.");
              if (res.kitId) onOpen(res.kitId);
            } catch (e) {
              notify(errMsg(e), true);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Creating…" : "Create kit"}
        </button>
      </div>
      <div className="results-panel">
        <h2>What you get</h2>
        <p>A valid Agent Kit scaffold with <span className="inline-code">agentkit.yaml</span>, <span className="inline-code">AGENTKIT.md</span>, <span className="inline-code">START_HERE.md</span>, and a starter skill. Edit the files, validate against a profile, then package or export.</p>
      </div>
    </div>
  );
}

// --- Render Draft JSON -------------------------------------------------------
function RenderDraftJson({ forge, notify, onOpen }: { forge: Forge; notify: Notify; onOpen: (id: string) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="form-layout">
      <div className="form-panel">
        <h2>Render a draft JSON</h2>
        <p className="form-copy">Paste an Agent Kit draft (the JSON the AI builder produces) to render it into a new kit in your library.</p>
        <div className="field">
          <label>Draft JSON</label>
          <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 220, fontFamily: "var(--mono, monospace)" }} placeholder='{ "manifest": { ... }, "files": { ... } }' />
        </div>
        <button
          className="primary-button"
          disabled={!text.trim() || busy}
          onClick={async () => {
            setBusy(true);
            try {
              const draftJson = JSON.parse(text);
              const res = await forge.renderGeneratedAgentKitDraft({ draftJson, outputFolder: "", force: true });
              notify("Kit created from draft.");
              if (res.kitId) onOpen(res.kitId);
            } catch (e) {
              notify(errMsg(e), true);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Rendering…" : "Render into a kit"}
        </button>
      </div>
      <div className="results-panel">
        <h2>Draft format</h2>
        <p>The draft is the structured JSON describing the kit manifest and files. Use the AI builder to generate one, or paste a draft you exported earlier.</p>
      </div>
    </div>
  );
}
