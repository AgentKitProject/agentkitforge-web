"use client";

// Phase 2 web UI for AgentKitForge.
//
// APPROACH: Option 2 (focused web UI), NOT importing the desktop App.tsx.
// Rationale documented in the web README: the desktop App.tsx (~12k lines) is
// path-based (rootPath/outputPath native strings) while the web backend is
// kitId + file-tree based, with deep @tauri-apps coupling and Vite/CSS-isms.
// Threading kitId-as-path through it safely in one pass was not feasible, so we
// build a focused UI over the SAME ForgeClient seam (WebForgeClient), covering
// the primary flows. Both clients implement the identical ForgeClient interface.

import { useCallback, useEffect, useMemo, useState } from "react";
import { getForgeClient } from "@/forge-client";
import type { MyKitEntry, ValidationProfile, ValidationReport } from "@/forge-client";

type Tab = "kits" | "create" | "build" | "import" | "settings";
type Favorite = { marketSlug: string; displayName?: string; publisher?: string; marketBaseUrl?: string; version?: string };
type SessionUser = { id: string; email?: string } | null;

// --- shared types for AI provider settings ---------------------------------
type PublicProvider = {
  id: string;
  name: string;
  providerType: string;
  baseUrl?: string;
  defaultModel?: string;
  supportsStructuredJson?: boolean;
  hasApiKey: boolean;
};
type CatalogEntry = {
  providerType: string;
  apiKeyRequired: boolean;
  baseUrlRequired: boolean;
  supportsCustomModels: boolean;
  supportsStructuredJson: boolean;
  defaultModel?: string;
  models: { id: string; label: string; recommendedFor: string[] }[];
};

export default function ForgeApp({ user }: { user: SessionUser }) {
  const forge = useMemo(() => getForgeClient(), []);
  const [tab, setTab] = useState<Tab>("kits");
  const [kits, setKits] = useState<MyKitEntry[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [openKitId, setOpenKitId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const notify = useCallback((msg: string, err = false) => {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [k, favRes] = await Promise.all([
        forge.listMyKits(),
        fetch("/api/favorites", { credentials: "include" }).then((r) => r.json())
      ]);
      setKits(k);
      setFavorites((favRes.favorites ?? []) as Favorite[]);
    } catch (e) {
      notify(errMsg(e), true);
    }
  }, [forge, notify]);

  useEffect(() => {
    void refresh();
    // Deep-link seam: ?import=<slug> opens the import tab pre-filled.
    void forge.getInitialDeepLinks().then((links) => {
      const url = links[0];
      if (url && new URL(url).searchParams.get("import")) setTab("import");
    });
  }, [forge, refresh]);

  if (openKitId) {
    return (
      <KitEditor
        kitId={openKitId}
        onClose={() => {
          setOpenKitId(null);
          void refresh();
        }}
        notify={notify}
      />
    );
  }

  return (
    <div className="akf-shell">
      <div className="akf-tabs" role="tablist">
        <button className="akf-tab" role="tab" aria-selected={tab === "kits"} onClick={() => setTab("kits")}>
          My Kits
        </button>
        <button className="akf-tab" role="tab" aria-selected={tab === "create"} onClick={() => setTab("create")}>
          Create
        </button>
        <button className="akf-tab" role="tab" aria-selected={tab === "build"} onClick={() => setTab("build")}>
          Build with AI
        </button>
        <button className="akf-tab" role="tab" aria-selected={tab === "import"} onClick={() => setTab("import")}>
          Import
        </button>
        <button className="akf-tab" role="tab" aria-selected={tab === "settings"} onClick={() => setTab("settings")}>
          Settings
        </button>
      </div>

      {tab === "kits" && (
        <MyKits
          kits={kits}
          favorites={favorites}
          onOpen={(id) => setOpenKitId(id)}
          onRemove={async (id) => {
            await forge.removeKitFromLibrary(id);
            notify("Kit removed.");
            void refresh();
          }}
          onUnfavorite={async (slug) => {
            await fetch("/api/favorites", {
              method: "DELETE",
              credentials: "include",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ marketSlug: slug })
            });
            notify("Favorite removed.");
            void refresh();
          }}
          notify={notify}
        />
      )}

      {tab === "create" && (
        <CreateKit
          busy={busy}
          onCreate={async (input) => {
            setBusy(true);
            try {
              const res = await forge.createAgentKitFromTemplate(input);
              notify("Kit created.");
              await refresh();
              if (res.kitId) setOpenKitId(res.kitId);
              setTab("kits");
            } catch (e) {
              notify(errMsg(e), true);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {tab === "build" && (
        <BuildWithAi
          forge={forge}
          notify={notify}
          onRendered={(kitId) => {
            void refresh();
            setOpenKitId(kitId);
          }}
        />
      )}

      {tab === "import" && <ImportPanel forge={forge} notify={notify} onDone={() => { void refresh(); setTab("kits"); }} />}

      {tab === "settings" && <SettingsPanel forge={forge} notify={notify} />}

      {toast && <div className={`akf-toast${toast.err ? " err" : ""}`}>{toast.msg}</div>}
    </div>
  );
}

// --- My Kits -----------------------------------------------------------------
function MyKits({
  kits,
  favorites,
  onOpen,
  onRemove,
  onUnfavorite,
  notify
}: {
  kits: MyKitEntry[];
  favorites: Favorite[];
  onOpen: (id: string) => void;
  onRemove: (id: string) => Promise<void>;
  onUnfavorite: (slug: string) => Promise<void>;
  notify: (m: string, e?: boolean) => void;
}) {
  const forge = useMemo(() => getForgeClient(), []);
  const [preview, setPreview] = useState<{ files: string[]; texts: Record<string, string> } | null>(null);
  const [submitKitId, setSubmitKitId] = useState<string | null>(null);
  const [updates, setUpdates] = useState<Record<string, string>>({});

  // Read-only update check for favorited Market kits.
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      favorites.map(async (f) => {
        try {
          const status = await forge.checkKitUpdate({
            slug: f.marketSlug,
            marketBaseUrl: f.marketBaseUrl,
            installedVersion: f.version ?? "1"
          });
          return [f.marketSlug, status.updateAvailable ? `Update available (v${status.latestVersion})` : ""] as const;
        } catch {
          return [f.marketSlug, ""] as const;
        }
      })
    ).then((pairs) => {
      if (!cancelled) setUpdates(Object.fromEntries(pairs.filter(([, v]) => v)));
    });
    return () => {
      cancelled = true;
    };
  }, [favorites, forge]);

  return (
    <>
      {submitKitId && (
        <SubmitToMarket
          forge={forge}
          kitId={submitKitId}
          notify={notify}
          onClose={() => setSubmitKitId(null)}
        />
      )}
      <h2>Owned kits</h2>
      {kits.length === 0 ? (
        <div className="akf-empty">No kits yet. Create one or import a package.</div>
      ) : (
        <div className="akf-grid">
          {kits.map((k) => (
            <div className="akf-card" key={k.kitId}>
              <h3>{k.name ?? k.kitId}</h3>
              <div className="akf-meta">
                {k.source ?? "kit"} · <span className="akf-mono">{k.kitId.slice(0, 12)}</span>
              </div>
              <div className="akf-row">
                <button className="akf-btn primary" onClick={() => onOpen(k.kitId)}>
                  Open
                </button>
                <button
                  className="akf-btn"
                  onClick={() => forge.packageAgentKit({ rootPath: k.kitId, outputFolder: "" }).then(() => notify("Package downloaded."), (e) => notify(errMsg(e), true))}
                >
                  Package
                </button>
                <button className="akf-btn" onClick={() => setSubmitKitId(k.kitId)}>
                  Submit to Market
                </button>
                <button className="akf-btn danger" onClick={() => void onRemove(k.kitId)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ marginTop: "1.5rem" }}>Favorites (Market references)</h2>
      {favorites.length === 0 ? (
        <div className="akf-empty">No favorites. Favorite a Market kit from the Import tab.</div>
      ) : (
        <div className="akf-grid">
          {favorites.map((f) => (
            <div className="akf-card" key={f.marketSlug}>
              <h3>{f.displayName ?? f.marketSlug}</h3>
              <div className="akf-meta">{f.publisher ?? "Market"} · {f.marketSlug}</div>
              {updates[f.marketSlug] && (
                <div className="akf-meta" style={{ color: "var(--akf-accent, #c47f00)" }}>↑ {updates[f.marketSlug]}</div>
              )}
              <div className="akf-row">
                <button
                  className="akf-btn"
                  onClick={async () => {
                    try {
                      const res = await forge.fetchLicensedMarketKit({
                        slug: f.marketSlug,
                        marketBaseUrl: f.marketBaseUrl ?? "",
                        validationProfile: "local-valid"
                      });
                      setPreview(res.preview ?? null);
                    } catch (e) {
                      notify(errMsg(e), true);
                    }
                  }}
                >
                  Preview (online)
                </button>
                <button className="akf-btn danger" onClick={() => void onUnfavorite(f.marketSlug)}>
                  Unfavorite
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <div className="akf-panel" style={{ marginTop: "1rem" }}>
          <div className="akf-row" style={{ justifyContent: "space-between" }}>
            <strong>In-memory licensed preview ({preview.files.length} files)</strong>
            <button className="akf-btn" onClick={() => setPreview(null)}>
              Close
            </button>
          </div>
          <p className="akf-meta">Online-only: never persisted to your library.</p>
          <ul className="akf-mono">
            {preview.files.slice(0, 50).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          {Object.entries(preview.texts).map(([name, content]) => (
            <details key={name}>
              <summary className="akf-mono">{name}</summary>
              <pre className="akf-code" style={{ whiteSpace: "pre-wrap" }}>{content}</pre>
            </details>
          ))}
        </div>
      )}
    </>
  );
}

// --- Create ------------------------------------------------------------------
function CreateKit({
  busy,
  onCreate
}: {
  busy: boolean;
  onCreate: (input: { template: string; id: string; name: string; description: string }) => Promise<void>;
}) {
  const [template, setTemplate] = useState("blank");
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const valid = id.trim() && name.trim() && description.trim();
  return (
    <div className="akf-panel" style={{ maxWidth: 560 }}>
      <h2>Create from template</h2>
      <div className="akf-field">
        <label>Template</label>
        <select className="akf-select" value={template} onChange={(e) => setTemplate(e.target.value)}>
          <option value="blank">blank</option>
          <option value="financial-review">financial-review</option>
        </select>
      </div>
      <div className="akf-field">
        <label>Kit id (slug)</label>
        <input className="akf-input" value={id} onChange={(e) => setId(e.target.value)} placeholder="my-kit" />
      </div>
      <div className="akf-field">
        <label>Name</label>
        <input className="akf-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Kit" />
      </div>
      <div className="akf-field">
        <label>Description</label>
        <textarea className="akf-textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <button
        className="akf-btn primary"
        disabled={!valid || busy}
        onClick={() => void onCreate({ template, id: id.trim(), name: name.trim(), description: description.trim() })}
      >
        {busy ? "Creating…" : "Create kit"}
      </button>
    </div>
  );
}

// --- Import ------------------------------------------------------------------
function ImportPanel({
  forge,
  notify,
  onDone
}: {
  forge: ReturnType<typeof getForgeClient>;
  notify: (m: string, e?: boolean) => void;
  onDone: () => void;
}) {
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [repoUrl, setRepoUrl] = useState("");
  const [ref, setRef] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      notify(ok);
      onDone();
    } catch (e) {
      notify(errMsg(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="akf-grid">
      <div className="akf-card">
        <h3>Upload .agentkit.zip</h3>
        <div className="akf-field">
          <input type="file" accept=".zip" onChange={(e) => setZipFile(e.target.files?.[0] ?? null)} />
        </div>
        <button
          className="akf-btn primary"
          disabled={!zipFile || busy}
          onClick={() => run(() => forge.importAgentKitPackage({ file: zipFile } as never), "Imported from zip.")}
        >
          Import zip
        </button>
      </div>

      <div className="akf-card">
        <h3>Import from Git</h3>
        <div className="akf-field">
          <label>Repository URL</label>
          <input className="akf-input" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} />
        </div>
        <div className="akf-field">
          <label>Ref (optional)</label>
          <input className="akf-input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="main" />
        </div>
        <button
          className="akf-btn primary"
          disabled={!repoUrl || busy}
          onClick={() =>
            run(
              () =>
                forge.importAgentKitFromGit({
                  repositoryUrl: repoUrl,
                  reference: ref,
                  destinationRootFolder: "",
                  validationProfile: "local-valid"
                }),
              "Imported from Git."
            )
          }
        >
          Import git
        </button>
      </div>

      <div className="akf-card">
        <h3>From Market</h3>
        <div className="akf-field">
          <label>Market slug</label>
          <input className="akf-input" value={slug} onChange={(e) => setSlug(e.target.value)} />
        </div>
        <div className="akf-row">
          <button
            className="akf-btn primary"
            disabled={!slug || busy}
            onClick={() =>
              run(
                () => forge.importHostedMarketKit({ slug, marketBaseUrl: "", validationProfile: "local-valid" }),
                "Imported from Market."
              )
            }
          >
            Import
          </button>
          <button
            className="akf-btn"
            disabled={!slug || busy}
            onClick={() =>
              run(async () => {
                const r = await fetch("/api/favorites", {
                  method: "POST",
                  credentials: "include",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ marketSlug: slug })
                });
                if (!r.ok) throw new Error((await r.json()).error ?? "Failed");
              }, "Favorited.")
            }
          >
            Favorite
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Editor ------------------------------------------------------------------
function KitEditor({
  kitId,
  onClose,
  notify
}: {
  kitId: string;
  onClose: () => void;
  notify: (m: string, e?: boolean) => void;
}) {
  const forge = useMemo(() => getForgeClient(), []);
  const [files, setFiles] = useState<{ path: string; content: string; encoding?: string }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [profile, setProfile] = useState<ValidationProfile>("local-valid");
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/kits/${encodeURIComponent(kitId)}/tree`, { credentials: "include" }).then((r) => r.json());
    const tree = (res.tree?.files ?? []) as { path: string; content: string; encoding?: string }[];
    setFiles(tree);
    if (!selected && tree.length) {
      setSelected(tree[0].path);
      setContent(tree[0].content);
    }
  }, [kitId, selected]);

  useEffect(() => {
    void load().catch((e) => notify(errMsg(e), true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kitId]);

  const open = (path: string) => {
    const f = files.find((x) => x.path === path);
    setSelected(path);
    setContent(f?.content ?? "");
    setDirty(false);
  };

  const save = async () => {
    if (!selected) return;
    try {
      await fetch(`/api/kits/${encodeURIComponent(kitId)}/files`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: selected, content })
      });
      setDirty(false);
      notify("Saved.");
      void load();
    } catch (e) {
      notify(errMsg(e), true);
    }
  };

  const isText = useMemo(() => {
    const f = files.find((x) => x.path === selected);
    return !f || f.encoding !== "base64";
  }, [files, selected]);

  return (
    <div className="akf-shell">
      <div className="akf-row" style={{ justifyContent: "space-between" }}>
        <button className="akf-btn" onClick={onClose}>
          ← My Kits
        </button>
        <div className="akf-row">
          <select className="akf-select" style={{ width: "auto" }} value={profile} onChange={(e) => setProfile(e.target.value as ValidationProfile)}>
            <option value="local-valid">local-valid</option>
            <option value="publishable">publishable</option>
            <option value="trusted">trusted</option>
            <option value="verified">verified</option>
          </select>
          <button
            className="akf-btn"
            onClick={() => forge.validateAgentKit({ rootPath: kitId, profile }).then(setReport, (e) => notify(errMsg(e), true))}
          >
            Validate
          </button>
          <button className="akf-btn" onClick={() => forge.packageAgentKit({ rootPath: kitId, outputFolder: "" }).then(() => notify("Packaged."), (e) => notify(errMsg(e), true))}>
            Package
          </button>
          <button className="akf-btn" onClick={() => forge.exportAgentKitOneFile({ rootPath: kitId, outputPath: "" }).then(() => notify("One-file exported."), (e) => notify(errMsg(e), true))}>
            Export onefile
          </button>
          <button className="akf-btn" onClick={() => forge.exportAgentKitToClaudeCode({ kitPath: kitId, destinationDir: "", force: true }).then(() => notify("Claude Code export."), (e) => notify(errMsg(e), true))}>
            → Claude Code
          </button>
          <button className="akf-btn" onClick={() => forge.exportAgentKitToCodex({ kitPath: kitId, destinationSkillsDir: "", force: true }).then(() => notify("Codex export."), (e) => notify(errMsg(e), true))}>
            → Codex
          </button>
        </div>
      </div>

      <div className="akf-editor" style={{ marginTop: "1rem" }}>
        <div className="akf-filelist">
          {files.map((f) => (
            <button key={f.path} aria-selected={selected === f.path} onClick={() => open(f.path)}>
              {f.path}
            </button>
          ))}
        </div>
        <div>
          {selected ? (
            isText ? (
              <>
                <textarea
                  className="akf-code"
                  value={content}
                  onChange={(e) => {
                    setContent(e.target.value);
                    setDirty(true);
                  }}
                />
                <div className="akf-row" style={{ marginTop: "0.5rem" }}>
                  <button className="akf-btn primary" disabled={!dirty} onClick={() => void save()}>
                    Save file
                  </button>
                </div>
              </>
            ) : (
              <div className="akf-empty">Binary file ({selected}) — not editable.</div>
            )
          ) : (
            <div className="akf-empty">No file selected.</div>
          )}
        </div>
      </div>

      {report && (
        <div className="akf-panel akf-report" style={{ marginTop: "1rem" }}>
          <strong>
            Validation ({profile}):{" "}
            <span className={`akf-badge ${report.valid ?? report.ok ? "ok" : "err"}`}>
              {report.valid ?? report.ok ? "valid" : "invalid"}
            </span>
          </strong>
          <pre>{JSON.stringify(report, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

// --- Submit to Market --------------------------------------------------------
function SubmitToMarket({
  forge,
  kitId,
  notify,
  onClose
}: {
  forge: ReturnType<typeof getForgeClient>;
  kitId: string;
  notify: (m: string, e?: boolean) => void;
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
      // The backend authoritatively resolves publisher/listing from the kit +
      // the user's AgentKitProfile; these fields are an optional listing draft.
      const listingDraft = {
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(summary.trim() ? { summary: summary.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(categories.trim() ? { categories: categories.split(",").map((s) => s.trim()).filter(Boolean) } : {}),
        ...(tags.trim() ? { tags: tags.split(",").map((s) => s.trim()).filter(Boolean) } : {})
      };
      const res = (await forge.submitHostedMarketKit({
        rootPath: kitId,
        marketBaseUrl: "",
        validationProfile: "publishable",
        // listingDraft is passed through to /api/market/submit (widened type).
        listingDraft
      } as never)) as { submissionId?: string; status?: string; marketLink?: string };
      setResult(res);
      notify("Submitted to Market for review.");
    } catch (e) {
      notify(errMsg(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="akf-panel" style={{ marginBottom: "1rem", maxWidth: 640 }}>
      <div className="akf-row" style={{ justifyContent: "space-between" }}>
        <strong>Submit to AgentKitMarket</strong>
        <button className="akf-btn" onClick={onClose}>Close</button>
      </div>
      <p className="akf-meta">
        Validates (publishable) and packages your kit, then submits it to the review queue using your
        signed-in AgentKitProject session. No automatic publishing — admin review is required.
      </p>
      <div className="akf-field"><label>Listing name (optional)</label>
        <input className="akf-input" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="akf-field"><label>Summary (optional)</label>
        <input className="akf-input" value={summary} onChange={(e) => setSummary(e.target.value)} /></div>
      <div className="akf-field"><label>Description (optional)</label>
        <textarea className="akf-textarea" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      <div className="akf-field"><label>Categories (comma-separated)</label>
        <input className="akf-input" value={categories} onChange={(e) => setCategories(e.target.value)} /></div>
      <div className="akf-field"><label>Tags (comma-separated)</label>
        <input className="akf-input" value={tags} onChange={(e) => setTags(e.target.value)} /></div>
      <button className="akf-btn primary" disabled={busy} onClick={() => void submit()}>
        {busy ? "Submitting…" : "Submit for review"}
      </button>
      {result && (
        <div className="akf-meta" style={{ marginTop: "0.75rem" }}>
          Status: <strong>{result.status}</strong> · Submission {result.submissionId}
          {result.marketLink && (
            <> · <a href={result.marketLink} target="_blank" rel="noreferrer">view</a></>
          )}
        </div>
      )}
    </div>
  );
}

// --- Build with AI -----------------------------------------------------------
function BuildWithAi({
  forge,
  notify,
  onRendered
}: {
  forge: ReturnType<typeof getForgeClient>;
  notify: (m: string, e?: boolean) => void;
  onRendered: (kitId: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<unknown>(null);
  const [draftJson, setDraftJson] = useState<unknown>(null);
  const [changeRequest, setChangeRequest] = useState("");

  const generate = async () => {
    setBusy(true);
    try {
      const res = await forge.generateAgentKitDraftWithAi({ userRequest: prompt } as never);
      const r = res as { draftJson?: unknown; session?: unknown };
      setDraftJson(r.draftJson ?? null);
      setSession(r.session ?? null);
      notify("Draft generated. Review or revise, then render into a kit.");
    } catch (e) {
      notify(errMsg(e), true);
    } finally {
      setBusy(false);
    }
  };

  const revise = async () => {
    setBusy(true);
    try {
      const res = await forge.reviseAgentKitDraftWithAi({ session, changeRequest } as never);
      const r = res as { draftJson?: unknown; session?: unknown };
      setDraftJson(r.draftJson ?? null);
      setSession(r.session ?? null);
      setChangeRequest("");
      notify("Draft revised.");
    } catch (e) {
      notify(errMsg(e), true);
    } finally {
      setBusy(false);
    }
  };

  const render = async () => {
    setBusy(true);
    try {
      const res = await forge.renderGeneratedAgentKitDraft({ draftJson, outputFolder: "", force: true });
      notify("Kit created from draft.");
      if (res.kitId) onRendered(res.kitId);
    } catch (e) {
      notify(errMsg(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="akf-panel" style={{ maxWidth: 720 }}>
      <h2>Build a kit with AI</h2>
      <p className="akf-meta">
        Uses your default AI provider (configure it under Settings). Generate a draft, optionally revise it,
        then render it into a new kit in your library.
      </p>
      <div className="akf-field">
        <label>Describe the kit you want</label>
        <textarea
          className="akf-textarea"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. A kit that reviews quarterly financial reports and flags anomalies."
        />
      </div>
      <button className="akf-btn primary" disabled={!prompt.trim() || busy} onClick={() => void generate()}>
        {busy ? "Working…" : "Generate draft"}
      </button>

      {draftJson != null && (
        <>
          <h3 style={{ marginTop: "1rem" }}>Draft preview</h3>
          <pre className="akf-code" style={{ whiteSpace: "pre-wrap", maxHeight: 320, overflow: "auto" }}>
            {JSON.stringify(draftJson, null, 2)}
          </pre>
          <div className="akf-field">
            <label>Revision request (optional)</label>
            <input className="akf-input" value={changeRequest} onChange={(e) => setChangeRequest(e.target.value)} />
          </div>
          <div className="akf-row">
            <button className="akf-btn" disabled={!changeRequest.trim() || busy} onClick={() => void revise()}>
              Revise
            </button>
            <button className="akf-btn primary" disabled={busy} onClick={() => void render()}>
              Render into a kit
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// --- Settings (AI providers) -------------------------------------------------
function SettingsPanel({
  forge,
  notify
}: {
  forge: ReturnType<typeof getForgeClient>;
  notify: (m: string, e?: boolean) => void;
}) {
  const [providers, setProviders] = useState<PublicProvider[]>([]);
  const [defaultId, setDefaultId] = useState<string | undefined>(undefined);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [busy, setBusy] = useState(false);

  // Add-provider form state.
  const [providerType, setProviderType] = useState("openai");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [apiKey, setApiKey] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/ai-providers", { credentials: "include" }).then((r) => r.json());
    setProviders((res.providers ?? []) as PublicProvider[]);
    setDefaultId(res.defaultProviderId);
    setCatalog((res.catalog ?? []) as CatalogEntry[]);
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

  const remove = async (id: string) => {
    try {
      await forge.removeAiProvider(id);
      notify("Provider removed.");
      await load();
    } catch (e) {
      notify(errMsg(e), true);
    }
  };

  const makeDefault = async (id: string) => {
    try {
      await forge.setDefaultAiProvider(id);
      notify("Default provider set.");
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
    <div style={{ maxWidth: 720 }}>
      <h2>AI providers</h2>
      <p className="akf-meta">
        Configure per-user AI providers (used by Build with AI). API keys are stored server-side and never
        sent back to the browser.
      </p>
      {providers.length === 0 ? (
        <div className="akf-empty">No providers configured yet.</div>
      ) : (
        <div className="akf-grid">
          {providers.map((p) => (
            <div className="akf-card" key={p.id}>
              <h3>
                {p.name} {p.id === defaultId && <span className="akf-badge ok">default</span>}
              </h3>
              <div className="akf-meta">
                {p.providerType} · {p.defaultModel || "no model"} · {p.hasApiKey ? "key set" : "no key"}
              </div>
              <div className="akf-row">
                {p.id !== defaultId && (
                  <button className="akf-btn" onClick={() => void makeDefault(p.id)}>Make default</button>
                )}
                <button className="akf-btn" onClick={() => void test(p.id)}>Test</button>
                <button className="akf-btn danger" onClick={() => void remove(p.id)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="akf-panel" style={{ marginTop: "1rem", maxWidth: 560 }}>
        <h3>Add / update a provider</h3>
        <div className="akf-field">
          <label>Provider type</label>
          <select className="akf-select" value={providerType} onChange={(e) => setProviderType(e.target.value)}>
            {catalog.map((c) => (
              <option key={c.providerType} value={c.providerType}>{c.providerType}</option>
            ))}
          </select>
        </div>
        <div className="akf-field">
          <label>Display name</label>
          <input className="akf-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={providerType} />
        </div>
        <div className="akf-field">
          <label>Default model</label>
          {cat && cat.models.length > 0 ? (
            <select className="akf-select" value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)}>
              <option value="">{cat.defaultModel ? `default (${cat.defaultModel})` : "select…"}</option>
              {cat.models.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          ) : (
            <input className="akf-input" value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} />
          )}
        </div>
        {cat?.baseUrlRequired && (
          <div className="akf-field">
            <label>Base URL</label>
            <input className="akf-input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…" />
          </div>
        )}
        {(cat?.apiKeyRequired ?? true) && (
          <div className="akf-field">
            <label>API key {`(stored server-side, not echoed back)`}</label>
            <input className="akf-input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </div>
        )}
        <button className="akf-btn primary" disabled={busy} onClick={() => void add()}>
          {busy ? "Saving…" : "Save provider"}
        </button>
      </div>
    </div>
  );
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
