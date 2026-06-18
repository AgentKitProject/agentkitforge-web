"use client";

import { useEffect, useState } from "react";
import type { Forge, MyKitEntry, Notify } from "./shared";
import { errMsg } from "./shared";

type PreparedPromptInput = {
  id: string;
  label?: string;
  type?: "short-text" | "long-text" | "choice" | "multi-choice" | "date" | "number" | "boolean";
  required?: boolean;
  placeholder?: string;
  defaultValue?: unknown;
  choices?: string[];
};

type PreparedPromptFull = {
  id: string;
  name?: string;
  description?: string;
  inputs?: PreparedPromptInput[];
  template?: string;
  outputMode?: string;
};

export function UseSection({ forge, kits, notify }: { forge: Forge; kits: MyKitEntry[]; notify: Notify }) {
  const [kitId, setKitId] = useState<string>("");
  const [prompts, setPrompts] = useState<PreparedPromptFull[]>([]);
  const [promptId, setPromptId] = useState<string>("");
  const [inputValues, setInputValues] = useState<Record<string, unknown>>({});
  const [rendered, setRendered] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string>("");

  // Load prompts when kit changes
  useEffect(() => {
    if (!kitId) {
      setPrompts([]);
      setHint("");
      return;
    }
    void forge.listPreparedPrompts(kitId).then(
      (p) => setPrompts(p as PreparedPromptFull[]),
      (e) => notify(errMsg(e), true)
    );
    // Load starter hint from START_HERE.md
    void fetch(`/api/kits/${encodeURIComponent(kitId)}/tree`, { credentials: "include" })
      .then((r) => r.json())
      .then((res: { tree?: { files?: { path: string; content: string }[] } }) => {
        const startHere = res.tree?.files?.find((f) => f.path === "START_HERE.md");
        if (startHere) setHint(startHere.content.slice(0, 600));
      })
      .catch(() => {/* non-critical */});
  }, [kitId, forge, notify]);

  // Reset input values when prompt changes
  useEffect(() => {
    const prompt = prompts.find((p) => p.id === promptId);
    if (!prompt) {
      setInputValues({});
      return;
    }
    const defaults: Record<string, unknown> = {};
    for (const inp of prompt.inputs ?? []) {
      if (inp.defaultValue !== undefined) defaults[inp.id] = inp.defaultValue;
    }
    setInputValues(defaults);
  }, [promptId, prompts]);

  const selectedPrompt = prompts.find((p) => p.id === promptId);

  const render = async () => {
    if (!kitId || !promptId) return;
    setBusy(true);
    try {
      const res = await forge.renderPreparedPrompt({ rootPath: kitId, promptId, inputValues });
      const r = res as { text?: string; prompt?: string; result?: { rendered?: string; text?: string } };
      setRendered(r.text ?? r.prompt ?? (r.result as { rendered?: string; text?: string } | undefined)?.rendered ?? (r.result as { text?: string } | undefined)?.text ?? JSON.stringify(res, null, 2));
      notify("Prompt rendered.");
    } catch (e) {
      notify(errMsg(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="use-screen">
      <div className="form-layout">
        <div className="form-panel">
          <h2>Run a prepared prompt</h2>
          <p className="form-copy">Pick a kit and one of its prepared prompts, fill in the inputs, and render the final prompt text.</p>
          <div className="field">
            <label>Kit</label>
            <select value={kitId} onChange={(e) => { setKitId(e.target.value); setPromptId(""); setRendered(""); }}>
              <option value="">Select a kit…</option>
              {kits.map((k) => (
                <option key={k.kitId} value={k.kitId}>{k.name ?? k.kitId}</option>
              ))}
            </select>
          </div>

          {hint && (
            <div className="results-panel" style={{ marginBottom: 12, padding: "10px 14px" }}>
              <p style={{ fontWeight: 600, marginBottom: 4, fontSize: "0.88em" }}>Starter hint</p>
              <pre style={{ fontSize: "0.8em", whiteSpace: "pre-wrap", margin: 0 }}>{hint}</pre>
            </div>
          )}

          <div className="field">
            <label>Prepared prompt</label>
            <select value={promptId} onChange={(e) => setPromptId(e.target.value)} disabled={!prompts.length}>
              <option value="">{prompts.length ? "Select a prompt…" : "No prepared prompts"}</option>
              {prompts.map((p) => (
                <option key={p.id} value={p.id}>{p.name ?? p.id}</option>
              ))}
            </select>
          </div>

          {selectedPrompt?.description && (
            <p className="form-copy" style={{ fontStyle: "italic" }}>{selectedPrompt.description}</p>
          )}

          {/* Render schema-based inputs if available, else fallback to raw JSON */}
          {selectedPrompt?.inputs && selectedPrompt.inputs.length > 0 ? (
            <PreparedPromptInputFields
              inputs={selectedPrompt.inputs}
              values={inputValues}
              onChange={(id, val) => setInputValues((v) => ({ ...v, [id]: val }))}
            />
          ) : promptId ? (
            <div className="field">
              <label>Input values (JSON)</label>
              <textarea
                value={typeof inputValues === "object" ? JSON.stringify(inputValues, null, 2) : "{}"}
                onChange={(e) => {
                  try { setInputValues(JSON.parse(e.target.value) as Record<string, unknown>); } catch { /* invalid JSON while typing */ }
                }}
                style={{ minHeight: 120, fontFamily: "var(--mono, monospace)" }}
              />
            </div>
          ) : null}

          <button
            className="primary-button"
            disabled={!kitId || !promptId || busy}
            onClick={() => void render()}
          >
            {busy ? "Rendering…" : "Render prompt"}
          </button>
        </div>
        <div className="results-panel">
          <h2>Rendered prompt</h2>
          {rendered ? <pre className="json-panel" style={{ whiteSpace: "pre-wrap" }}>{rendered}</pre> : <p>Select a kit and a prepared prompt to render its final text.</p>}
        </div>
      </div>
    </div>
  );
}

function PreparedPromptInputFields({
  inputs,
  values,
  onChange
}: {
  inputs: PreparedPromptInput[];
  values: Record<string, unknown>;
  onChange: (id: string, value: unknown) => void;
}) {
  return (
    <>
      {inputs.map((inp) => (
        <PreparedPromptInputField key={inp.id} input={inp} value={values[inp.id]} onChange={(v) => onChange(inp.id, v)} />
      ))}
    </>
  );
}

function PreparedPromptInputField({
  input,
  value,
  onChange
}: {
  input: PreparedPromptInput;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const label = (
    <label>
      {input.label ?? input.id}
      {input.required && <span style={{ color: "var(--color-error)", marginLeft: 3 }}>*</span>}
    </label>
  );

  const type = input.type ?? "short-text";
  const strVal = typeof value === "string" ? value : (value != null ? String(value) : "");

  if (type === "long-text") {
    return (
      <div className="field">
        {label}
        <textarea value={strVal} onChange={(e) => onChange(e.target.value)} placeholder={input.placeholder} style={{ minHeight: 100 }} />
      </div>
    );
  }

  if (type === "choice" && input.choices?.length) {
    return (
      <div className="field">
        {label}
        <select value={strVal} onChange={(e) => onChange(e.target.value)}>
          {!input.required && <option value="">—</option>}
          {input.choices.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
    );
  }

  if (type === "multi-choice" && input.choices?.length) {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    const toggle = (c: string) => {
      const next = selected.includes(c) ? selected.filter((x) => x !== c) : [...selected, c];
      onChange(next);
    };
    return (
      <div className="field">
        {label}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {input.choices.map((c) => (
            <label key={c} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
              <input type="checkbox" checked={selected.includes(c)} onChange={() => toggle(c)} /> {c}
            </label>
          ))}
        </div>
      </div>
    );
  }

  if (type === "boolean") {
    return (
      <div className="field">
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          {input.label ?? input.id}
          {input.required && <span style={{ color: "var(--color-error)" }}>*</span>}
        </label>
      </div>
    );
  }

  if (type === "number") {
    return (
      <div className="field">
        {label}
        <input type="number" value={strVal} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} placeholder={input.placeholder} />
      </div>
    );
  }

  if (type === "date") {
    return (
      <div className="field">
        {label}
        <input type="date" value={strVal} onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  }

  // default: short-text
  return (
    <div className="field">
      {label}
      <input value={strVal} onChange={(e) => onChange(e.target.value)} placeholder={input.placeholder} />
    </div>
  );
}
