"use client";

import { useCallback, useEffect, useState } from "react";
import type { CatalogEntry, Forge, Notify, PublicProvider } from "./shared";
import { errMsg } from "./shared";

export function SettingsSection({ forge, notify }: { forge: Forge; notify: Notify }) {
  const [providers, setProviders] = useState<PublicProvider[]>([]);
  const [defaultId, setDefaultId] = useState<string | undefined>(undefined);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const [providerType, setProviderType] = useState("openai");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [apiKey, setApiKey] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/ai-providers", { credentials: "include" }).then((r) => r.json());
    setProviders((res as { providers?: PublicProvider[] }).providers ?? []);
    setDefaultId((res as { defaultProviderId?: string }).defaultProviderId);
    setCatalog((res as { catalog?: CatalogEntry[] }).catalog ?? []);
  }, []);

  useEffect(() => {
    void load().catch((e) => notify(errMsg(e), true));
  }, [load, notify]);

  const cat = catalog.find((c) => c.providerType === providerType);

  const add = async () => {
    setBusy(true);
    try {
      await forge.saveAiProvider({
        name: name.trim() || providerType,
        providerType,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        defaultModel: defaultModel.trim() || cat?.defaultModel || "",
        supportsStructuredJson: cat?.supportsStructuredJson ?? false
      } as never);
      notify("Provider saved.");
      setApiKey("");
      setName("");
      await load();
    } catch (e) {
      notify(errMsg(e), true);
    } finally {
      setBusy(false);
    }
  };

  const guard = (fn: () => Promise<unknown>, ok: string) => async () => {
    try {
      await fn();
      notify(ok);
      await load();
    } catch (e) {
      notify(errMsg(e), true);
    }
  };

  const test = async (id: string) => {
    try {
      const res = await forge.testAiProviderConnection({ providerId: id, model: "" });
      notify(res.ok ? `OK: ${res.message}` : `Failed: ${res.message}`, !res.ok);
    } catch (e) {
      notify(errMsg(e), true);
    }
  };

  return (
    <div className="settings-screen">
      <div className="settings-panel">
        <h2>AI providers</h2>
        <p className="form-copy">Configure per-user AI providers (used by Build with AI). API keys are stored server-side and never sent back to the browser.</p>
        {providers.length === 0 ? (
          <p className="form-copy">No providers configured yet.</p>
        ) : (
          <div className="provider-list">
            {providers.map((p) => (
              <article className="provider-card" key={p.id}>
                <h3>{p.name} {p.id === defaultId && <span className="source-badge">default</span>}</h3>
                <p>{p.providerType} · {p.defaultModel || "no model"} · <span className={`secret-status ${p.hasApiKey ? "saved" : ""}`}>{p.hasApiKey ? "key set" : "no key"}</span></p>
                <div className="button-row">
                  {p.id !== defaultId && <button className="secondary-button" onClick={guard(() => forge.setDefaultAiProvider(p.id), "Default provider set.")}>Make default</button>}
                  <button className="secondary-button" onClick={() => void test(p.id)}>Test</button>
                  <button className="danger-button" onClick={guard(() => forge.removeAiProvider(p.id), "Provider removed.")}>Remove</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="settings-panel">
        <h2>Add / update a provider</h2>
        <div className="field">
          <label>Provider type</label>
          <select value={providerType} onChange={(e) => setProviderType(e.target.value)}>
            {catalog.length === 0 && <option value="openai">openai</option>}
            {catalog.map((c) => (
              <option key={c.providerType} value={c.providerType}>{c.providerType}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Display name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={providerType} />
        </div>
        <div className="field">
          <label>Default model</label>
          {cat && cat.models.length > 0 ? (
            <select value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)}>
              <option value="">{cat.defaultModel ? `default (${cat.defaultModel})` : "select…"}</option>
              {cat.models.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          ) : (
            <input value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} />
          )}
        </div>
        {cat?.baseUrlRequired && (
          <div className="field">
            <label>Base URL</label>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…" />
          </div>
        )}
        {(cat?.apiKeyRequired ?? true) && (
          <div className="field">
            <label>API key (stored server-side, not echoed back)</label>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </div>
        )}
        <button className="primary-button" disabled={busy} onClick={() => void add()}>{busy ? "Saving…" : "Save provider"}</button>
      </div>
    </div>
  );
}
