"use client";

import { useState } from "react";
import type { Forge, MyKitEntry, Notify } from "./shared";
import { errMsg } from "./shared";

export function MarketSubmitSection({
  kits,
  onPick
}: {
  kits: MyKitEntry[];
  onPick: (id: string) => void;
}) {
  return (
    <div className="install-targets-screen">
      <div className="form-panel" style={{ maxWidth: 640 }}>
        <h2>Submit a kit for review</h2>
        <p className="form-copy">Validates (publishable) and packages your kit, then submits it to the AgentKitMarket review queue using your signed-in account. No automatic publishing — admin review is always required.</p>
        {kits.length === 0 ? (
          <p className="inline-warning">You have no kits yet. Build or import one first.</p>
        ) : (
          <div className="kit-list">
            {kits.map((k) => (
              <article className="provider-card" key={k.kitId}>
                <h3>{k.name ?? k.kitId}</h3>
                <p className="inline-code">{k.kitId}</p>
                <div className="button-row">
                  <button className="primary-button" onClick={() => onPick(k.kitId)}>Submit this kit</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function SubmitModal({
  forge,
  kitId,
  notify,
  onClose
}: {
  forge: Forge;
  kitId: string;
  notify: Notify;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [categories, setCategories] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ submissionId?: string; status?: string; marketLink?: string } | null>(null);

  const submit = async () => {
    setBusy(true);
    try {
      const listingDraft = {
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(summary.trim() ? { summary: summary.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(categories.trim() ? { categories: categories.split(",").map((s) => s.trim()).filter(Boolean) } : {}),
        ...(tags.trim() ? { tags: tags.split(",").map((s) => s.trim()).filter(Boolean) } : {})
      };
      const res = (await forge.submitHostedMarketKit({ rootPath: kitId, marketBaseUrl: "", validationProfile: "publishable", listingDraft } as never)) as {
        submissionId?: string;
        status?: string;
        marketLink?: string;
      };
      setResult(res);
      notify("Submitted to Market for review.");
    } catch (e) {
      notify(errMsg(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card">
        <div className="modal-head">
          <h2>Submit to AgentKitMarket</h2>
          <button className="secondary-button" onClick={onClose}>Close</button>
        </div>
        <p className="form-copy">Listing fields are an optional draft — the server resolves the publisher from your AgentKitProfile and owns slug/version.</p>
        <div className="field"><label>Listing name (optional)</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label>Summary (optional)</label><input value={summary} onChange={(e) => setSummary(e.target.value)} /></div>
        <div className="field"><label>Description (optional)</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="field"><label>Categories (comma-separated)</label><input value={categories} onChange={(e) => setCategories(e.target.value)} /></div>
        <div className="field"><label>Tags (comma-separated)</label><input value={tags} onChange={(e) => setTags(e.target.value)} /></div>
        <button className="primary-button" disabled={busy} onClick={() => void submit()}>{busy ? "Submitting…" : "Submit for review"}</button>
        {result && (
          <p className="form-copy" style={{ marginTop: 4 }}>
            Status: <strong>{result.status}</strong> · Submission {result.submissionId}
            {result.marketLink && (<> · <a href={result.marketLink} target="_blank" rel="noreferrer">view</a></>)}
          </p>
        )}
      </div>
    </div>
  );
}
