"use client";

// Web Forge UI.
//
// APPROACH: design-port + faithful rebuild (the documented fallback).
// We do NOT import the desktop App.tsx (~12k lines): it is hard-coupled to
// Tauri plugins (@tauri-apps/plugin-updater, native dialogs/deep-links),
// lucide-react, @agentkitforge/core/dist provider catalog (Node-only), and Vite
// SVG asset imports, and it threads native filesystem PATHS where the web
// backend is kitId + file-tree based. Wiring all of that through SSR in one
// pass is not feasible. Instead we PORT the desktop design system
// (app/forge.css <- src/styles.css) and REBUILD the UI over the SAME
// ForgeClient seam (WebForgeClient) using the desktop's sidebar-nav layout and
// section structure, so the web app matches the desktop look and covers the
// same feature areas. Both clients implement the identical ForgeClient.

import { useCallback, useEffect, useMemo, useState } from "react";
import { getForgeClient } from "@/forge-client";
import type { MyKitEntry, ValidationProfile, ValidationReport } from "@/forge-client";
import {
  ExportIcon,
  FileIcon,
  GitIcon,
  HammerIcon,
  ImportIcon,
  InfoIcon,
  PackageIcon,
  PlayIcon,
  PlugIcon,
  SettingsIcon,
  SparklesIcon,
  StarIcon,
  StoreIcon,
  UploadIcon,
  UserIcon
} from "./icons";

type Forge = ReturnType<typeof getForgeClient>;
type SectionId =
  | "my-kits"
  | "build"
  | "use"
  | "import"
  | "package-export"
  | "market-submit"
  | "settings"
  | "account"
  | "about";
type Favorite = {
  marketSlug: string;
  displayName?: string;
  publisher?: string;
  marketBaseUrl?: string;
  version?: string;
};
type SessionUser = { id: string; email?: string } | null;
type Notify = (msg: string, err?: boolean) => void;

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

const NAV: { id: SectionId; label: string; Icon: typeof PackageIcon }[] = [
  { id: "my-kits", label: "My Kits", Icon: PackageIcon },
  { id: "build", label: "Build", Icon: HammerIcon },
  { id: "use", label: "Use", Icon: PlayIcon },
  { id: "import", label: "Import", Icon: ImportIcon },
  { id: "package-export", label: "Package / Export", Icon: ExportIcon },
  { id: "market-submit", label: "Submit to Market", Icon: UploadIcon },
  { id: "settings", label: "Settings", Icon: SettingsIcon },
  { id: "about", label: "About", Icon: InfoIcon }
];

const SECTION_TITLES: Record<SectionId, { eyebrow: string; title: string }> = {
  "my-kits": { eyebrow: "Library", title: "My Kits" },
  build: { eyebrow: "Create", title: "Build an Agent Kit" },
  use: { eyebrow: "Run", title: "Use a Kit" },
  import: { eyebrow: "Bring in", title: "Import a Kit" },
  "package-export": { eyebrow: "Distribute", title: "Package / Export" },
  "market-submit": { eyebrow: "Publish", title: "Submit to Market" },
  settings: { eyebrow: "Configure", title: "Settings" },
  account: { eyebrow: "Account", title: "Your AgentKitProject account" },
  about: { eyebrow: "About", title: "About AgentKitForge" }
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function initials(email?: string): string {
  if (!email) return "";
  const name = email.split("@")[0];
  const parts = name.split(/[._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? name[0] ?? "").concat(parts[1]?.[0] ?? "").toUpperCase();
}

export default function ForgeApp({ user }: { user: SessionUser }) {
  const forge = useMemo(() => getForgeClient(), []);
  const [section, setSection] = useState<SectionId>("my-kits");
  const [kits, setKits] = useState<MyKitEntry[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [openKitId, setOpenKitId] = useState<string | null>(null);
  const [submitKitId, setSubmitKitId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);

  const notify = useCallback<Notify>((msg, err = false) => {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 4200);
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
    // Deep-link seam: ?import=<slug> jumps to the Import section.
    void forge.getInitialDeepLinks().then((links) => {
      const url = links[0];
      if (url && new URL(url).searchParams.get("import")) setSection("import");
    });
  }, [forge, refresh]);

  const heading = openKitId
    ? { eyebrow: "Edit", title: "Kit editor" }
    : SECTION_TITLES[section];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <SparklesIcon size={22} />
          </span>
          <span className="brand-name">
            AgentKit<span>Forge</span>
          </span>
        </div>
        <nav className="nav-list">
          {NAV.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className={`nav-item ${section === id && !openKitId ? "active" : ""}`}
              onClick={() => {
                setOpenKitId(null);
                setSection(id);
              }}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <button
          type="button"
          className={`sidebar-account-block ${section === "account" && !openKitId ? "active" : ""}`}
          onClick={() => {
            setOpenKitId(null);
            setSection("account");
          }}
        >
          <span className="sidebar-account-avatar">{initials(user?.email) || <UserIcon size={18} />}</span>
          <span className="sidebar-account-copy">
            <span className="sidebar-account-name">{user?.email ?? "Signed in"}</span>
            <span className="sidebar-account-status">AgentKitProject account</span>
          </span>
        </button>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">{heading.eyebrow}</p>
            <h1>{heading.title}</h1>
          </div>
        </header>

        <section className="content">
          {openKitId ? (
            <KitEditor forge={forge} kitId={openKitId} notify={notify} onClose={() => { setOpenKitId(null); void refresh(); }} />
          ) : section === "my-kits" ? (
            <MyKits
              forge={forge}
              kits={kits}
              favorites={favorites}
              notify={notify}
              onOpen={(id) => setOpenKitId(id)}
              onSubmit={(id) => setSubmitKitId(id)}
              onBuild={() => setSection("build")}
              onImport={() => setSection("import")}
              onRefresh={refresh}
            />
          ) : section === "build" ? (
            <BuildSection forge={forge} notify={notify} onOpen={(id) => { void refresh(); setOpenKitId(id); }} />
          ) : section === "use" ? (
            <UseSection forge={forge} kits={kits} notify={notify} />
          ) : section === "import" ? (
            <ImportSection forge={forge} notify={notify} onDone={(kitId) => { void refresh().then(() => { setSection("my-kits"); if (kitId) setOpenKitId(kitId); }); }} />
          ) : section === "package-export" ? (
            <PackageExportSection forge={forge} kits={kits} notify={notify} />
          ) : section === "market-submit" ? (
            <MarketSubmitSection kits={kits} onPick={(id) => setSubmitKitId(id)} />
          ) : section === "settings" ? (
            <SettingsSection forge={forge} notify={notify} />
          ) : section === "account" ? (
            <AccountSection user={user} />
          ) : (
            <AboutSection forge={forge} />
          )}
        </section>
      </div>

      {submitKitId && (
        <SubmitModal forge={forge} kitId={submitKitId} notify={notify} onClose={() => setSubmitKitId(null)} />
      )}
      {toast && <div className={`akf-toast${toast.err ? " err" : ""}`}>{toast.msg}</div>}
    </div>
  );
}

// --- My Kits -----------------------------------------------------------------
function MyKits({
  forge,
  kits,
  favorites,
  notify,
  onOpen,
  onSubmit,
  onBuild,
  onImport,
  onRefresh
}: {
  forge: Forge;
  kits: MyKitEntry[];
  favorites: Favorite[];
  notify: Notify;
  onOpen: (id: string) => void;
  onSubmit: (id: string) => void;
  onBuild: () => void;
  onImport: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<{ files: string[]; texts: Record<string, string> } | null>(null);
  const [updates, setUpdates] = useState<Record<string, string>>({});

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

  const remove = async (id: string) => {
    try {
      await forge.removeKitFromLibrary(id);
      notify("Kit removed.");
      await onRefresh();
    } catch (e) {
      notify(errMsg(e), true);
    }
  };

  const unfavorite = async (slug: string) => {
    await fetch("/api/favorites", {
      method: "DELETE",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ marketSlug: slug })
    });
    notify("Favorite removed.");
    await onRefresh();
  };

  return (
    <div className="my-kits-screen">
      <div className="screen-toolbar">
        <strong>{kits.length} owned (built &amp; imported) · {favorites.length} favorited</strong>
        <div className="button-row">
          <button className="secondary-button" onClick={onImport}>Import a kit</button>
          <button className="primary-button" onClick={onBuild}>Build a kit</button>
        </div>
      </div>

      <h2 style={{ marginTop: 8 }}>Your Kits (built &amp; imported)</h2>
      {kits.length === 0 ? (
        <div className="empty-state">
          <span className="card-icon"><PackageIcon size={20} /></span>
          <h2>No kits yet</h2>
          <p>Create one with the AI builder or a template, or import an existing .agentkit.zip / Git repo / Market kit. Imported kits are saved here and persist across sessions.</p>
        </div>
      ) : (
        <div className="kit-list">
          {kits.map((k) => (
            <article className="kit-library-card" key={k.kitId}>
              <div className="kit-library-main">
                <div>
                  <h2>{k.name ?? k.kitId}</h2>
                  <p>Kit in your library. Open to edit files, validate, package, or export.</p>
                </div>
                <span className="source-badge">{k.source ?? "kit"}</span>
              </div>
              <dl className="kit-meta-grid">
                <div>
                  <dt>Kit ID</dt>
                  <dd className="inline-code">{k.kitId}</dd>
                </div>
              </dl>
              <div className="button-row">
                <button className="primary-button" onClick={() => onOpen(k.kitId)}>Open</button>
                <button
                  className="secondary-button"
                  onClick={() =>
                    forge.packageAgentKit({ rootPath: k.kitId, outputFolder: "" }).then(
                      () => notify("Package downloaded."),
                      (e) => notify(errMsg(e), true)
                    )
                  }
                >
                  Package
                </button>
                <button className="secondary-button" onClick={() => onSubmit(k.kitId)}>Submit to Market</button>
                <button className="danger-button" onClick={() => void remove(k.kitId)}>Remove</button>
              </div>
            </article>
          ))}
        </div>
      )}

      <h2 style={{ marginTop: 24 }}>Favorites (Market references — read-only)</h2>
      {favorites.length === 0 ? (
        <p className="form-copy">No favorites yet. Use the Import tab → From Market → Favorite to track a Market kit&apos;s updates without copying it to your library.</p>
      ) : (
        <div className="kit-list">
          {favorites.map((f) => (
            <article className="kit-library-card" key={f.marketSlug}>
              <div className="kit-library-main">
                <div>
                  <h2>{f.displayName ?? f.marketSlug}</h2>
                  <p>{f.publisher ?? "Market"} · {f.marketSlug}</p>
                  {updates[f.marketSlug] && <p style={{ color: "var(--color-warning)" }}>↑ {updates[f.marketSlug]}</p>}
                </div>
                <span className="source-badge"><StarIcon size={13} filled /> favorite</span>
              </div>
              <div className="button-row">
                <button
                  className="secondary-button"
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
                <button className="danger-button" onClick={() => void unfavorite(f.marketSlug)}>Unfavorite</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {preview && (
        <div className="results-panel" style={{ marginTop: 8 }}>
          <div className="screen-toolbar">
            <strong>In-memory licensed preview ({preview.files.length} files)</strong>
            <button className="secondary-button" onClick={() => setPreview(null)}>Close</button>
          </div>
          <p className="form-copy">Online-only: never persisted to your library.</p>
          <ul className="preview-list">
            {preview.files.slice(0, 60).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          {Object.entries(preview.texts).map(([name, content]) => (
            <details key={name} style={{ marginTop: 8 }}>
              <summary className="inline-code">{name}</summary>
              <pre className="json-panel" style={{ whiteSpace: "pre-wrap" }}>{content}</pre>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Build -------------------------------------------------------------------
type BuildTab = "ai" | "template" | "draft";

function BuildSection({ forge, notify, onOpen }: { forge: Forge; notify: Notify; onOpen: (id: string) => void }) {
  const [tab, setTab] = useState<BuildTab>("ai");
  return (
    <div className="build-screen">
      <div className="segmented-control" role="tablist">
        {([
          ["ai", "Build with AI"],
          ["template", "From template"],
          ["draft", "From draft JSON"]
        ] as [BuildTab, string][]).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`segment-button ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "ai" && <BuildWithAi forge={forge} notify={notify} onOpen={onOpen} />}
      {tab === "template" && <BuildFromTemplate forge={forge} notify={notify} onOpen={onOpen} />}
      {tab === "draft" && <RenderDraftJson forge={forge} notify={notify} onOpen={onOpen} />}
    </div>
  );
}

function BuildWithAi({ forge, notify, onOpen }: { forge: Forge; notify: Notify; onOpen: (id: string) => void }) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<unknown>(null);
  const [draftJson, setDraftJson] = useState<unknown>(null);
  const [changeRequest, setChangeRequest] = useState("");

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

  return (
    <div className="form-layout">
      <div className="form-panel">
        <h2>Generate with AI</h2>
        <p className="form-copy">Uses your default AI provider (configure under Settings). Generate a draft, optionally revise, then render into a kit.</p>
        <div className="field">
          <label>Describe the kit you want</label>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. A kit that reviews quarterly financial reports and flags anomalies." />
        </div>
        <button className="primary-button" disabled={!prompt.trim() || busy} onClick={() => void run(() => forge.generateAgentKitDraftWithAi({ userRequest: prompt } as never) as never, "Draft generated.")}>
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

// --- Use (prepared prompts) --------------------------------------------------
function UseSection({ forge, kits, notify }: { forge: Forge; kits: MyKitEntry[]; notify: Notify }) {
  const [kitId, setKitId] = useState<string>("");
  const [prompts, setPrompts] = useState<{ id: string; name?: string }[]>([]);
  const [promptId, setPromptId] = useState<string>("");
  const [inputs, setInputs] = useState<string>("{}");
  const [rendered, setRendered] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!kitId) {
      setPrompts([]);
      return;
    }
    void forge.listPreparedPrompts(kitId).then(
      (p) => setPrompts(p as { id: string; name?: string }[]),
      (e) => notify(errMsg(e), true)
    );
  }, [kitId, forge, notify]);

  return (
    <div className="use-screen">
      <div className="form-layout">
        <div className="form-panel">
          <h2>Run a prepared prompt</h2>
          <p className="form-copy">Pick a kit and one of its prepared prompts, supply inputs, and render the final prompt text.</p>
          <div className="field">
            <label>Kit</label>
            <select value={kitId} onChange={(e) => { setKitId(e.target.value); setPromptId(""); setRendered(""); }}>
              <option value="">Select a kit…</option>
              {kits.map((k) => (
                <option key={k.kitId} value={k.kitId}>{k.name ?? k.kitId}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Prepared prompt</label>
            <select value={promptId} onChange={(e) => setPromptId(e.target.value)} disabled={!prompts.length}>
              <option value="">{prompts.length ? "Select a prompt…" : "No prepared prompts"}</option>
              {prompts.map((p) => (
                <option key={p.id} value={p.id}>{p.name ?? p.id}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Input values (JSON)</label>
            <textarea value={inputs} onChange={(e) => setInputs(e.target.value)} style={{ minHeight: 120 }} />
          </div>
          <button
            className="primary-button"
            disabled={!kitId || !promptId || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const inputValues = JSON.parse(inputs || "{}");
                const res = await forge.renderPreparedPrompt({ rootPath: kitId, promptId, inputValues });
                setRendered((res as { text?: string; prompt?: string }).text ?? (res as { prompt?: string }).prompt ?? JSON.stringify(res, null, 2));
                notify("Prompt rendered.");
              } catch (e) {
                notify(errMsg(e), true);
              } finally {
                setBusy(false);
              }
            }}
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

// --- Import ------------------------------------------------------------------
type ImportTab = "zip" | "git" | "market";

function ImportSection({ forge, notify, onDone }: { forge: Forge; notify: Notify; onDone: (kitId?: string) => void }) {
  const [tab, setTab] = useState<ImportTab>("zip");
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [repoUrl, setRepoUrl] = useState("");
  const [ref, setRef] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      const result = await fn();
      notify(ok);
      const kitId = (result && typeof result === "object" && "kitId" in result) ? String((result as { kitId: string }).kitId) : undefined;
      onDone(kitId);
    } catch (e) {
      notify(errMsg(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="import-screen">
      <div className="segmented-control" role="tablist">
        {([
          ["zip", "Upload .agentkit.zip"],
          ["git", "From Git"],
          ["market", "From Market"]
        ] as [ImportTab, string][]).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`segment-button ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      <div className="build-layout" style={{ marginTop: 18 }}>
        {tab === "zip" && (
          <div className="form-panel">
            <h2>Upload a package</h2>
            <p className="form-copy">Import an existing <span className="inline-code">.agentkit.zip</span> into <strong>My Kits</strong> (your library). The kit is saved to your account and will appear in My Kits after import.</p>
            <div className="field">
              <label>Package file</label>
              <input type="file" accept=".zip" onChange={(e) => setZipFile(e.target.files?.[0] ?? null)} />
            </div>
            <button className="primary-button" disabled={!zipFile || busy} onClick={() => run(() => forge.importAgentKitPackage({ file: zipFile } as never), "Imported from zip.")}>
              {busy ? "Importing…" : "Import zip"}
            </button>
          </div>
        )}
        {tab === "git" && (
          <div className="form-panel">
            <h2>Import from a Git repository</h2>
            <p className="form-copy">Clone a public repository that contains an Agent Kit and save it to <strong>My Kits</strong> (your library). The kit is persisted to your account.</p>
            <div className="field">
              <label>Repository URL</label>
              <input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/org/repo.git" />
            </div>
            <div className="field">
              <label>Ref (optional)</label>
              <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="main" />
            </div>
            <button
              className="primary-button"
              disabled={!repoUrl || busy}
              onClick={() => run(() => forge.importAgentKitFromGit({ repositoryUrl: repoUrl, reference: ref, destinationRootFolder: "", validationProfile: "local-valid" }), "Imported from Git.")}
            >
              {busy ? "Importing…" : "Import git"}
            </button>
          </div>
        )}
        {tab === "market" && (
          <div className="form-panel">
            <h2>Import from AgentKitMarket</h2>
            <p className="form-copy"><strong>Import</strong> downloads the kit into <strong>My Kits</strong> (your library) so you can edit, validate, and package it. <strong>Favorite</strong> saves a reference so you can track updates without downloading a copy.</p>
            <div className="field">
              <label>Market slug</label>
              <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="financial-review" />
            </div>
            <div className="button-row">
              <button className="primary-button" disabled={!slug || busy} onClick={() => run(() => forge.importHostedMarketKit({ slug, marketBaseUrl: "", validationProfile: "local-valid" }), "Imported from Market.")}>
                Import
              </button>
              <button
                className="secondary-button"
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
                <StarIcon size={14} /> Favorite
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Package / Export --------------------------------------------------------
function PackageExportSection({ forge, kits, notify }: { forge: Forge; kits: MyKitEntry[]; notify: Notify }) {
  const [kitId, setKitId] = useState("");
  const act = (label: string, fn: () => Promise<unknown>) => () => fn().then(() => notify(`${label} ✓`), (e) => notify(errMsg(e), true));
  return (
    <div className="install-targets-screen">
      <div className="form-panel" style={{ maxWidth: 560 }}>
        <h2>Choose a kit</h2>
        <p className="form-copy">Package a kit as a portable <span className="inline-code">.agentkit.zip</span>, or export it for a target agent runtime. Each action downloads a file.</p>
        <div className="field">
          <label>Kit</label>
          <select value={kitId} onChange={(e) => setKitId(e.target.value)}>
            <option value="">Select a kit…</option>
            {kits.map((k) => (
              <option key={k.kitId} value={k.kitId}>{k.name ?? k.kitId}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="screen-grid compact">
        <div className="placeholder-card">
          <span className="card-icon"><PackageIcon size={20} /></span>
          <h2>Package</h2>
          <p>Build a distributable <span className="inline-code">.agentkit.zip</span>.</p>
          <button className="primary-button" disabled={!kitId} onClick={act("Package downloaded", () => forge.packageAgentKit({ rootPath: kitId, outputFolder: "" }))}>Download package</button>
        </div>
        <div className="placeholder-card">
          <span className="card-icon"><FileIcon size={20} /></span>
          <h2>One-file export</h2>
          <p>Flatten the kit into a single Markdown file.</p>
          <button className="secondary-button" disabled={!kitId} onClick={act("One-file exported", () => forge.exportAgentKitOneFile({ rootPath: kitId, outputPath: "" }))}>Download one-file</button>
        </div>
        <div className="placeholder-card">
          <span className="card-icon"><PlugIcon size={20} /></span>
          <h2>Claude Code</h2>
          <p>Export to a Claude Code project layout.</p>
          <button className="secondary-button" disabled={!kitId} onClick={act("Claude Code export downloaded", () => forge.exportAgentKitToClaudeCode({ kitPath: kitId, destinationDir: "", force: true }))}>Export → Claude Code</button>
        </div>
        <div className="placeholder-card">
          <span className="card-icon"><PlugIcon size={20} /></span>
          <h2>Codex</h2>
          <p>Export skills for a Codex skills directory.</p>
          <button className="secondary-button" disabled={!kitId} onClick={act("Codex export downloaded", () => forge.exportAgentKitToCodex({ kitPath: kitId, destinationSkillsDir: "", force: true }))}>Export → Codex</button>
        </div>
      </div>
    </div>
  );
}

// --- Submit to Market (section + modal) --------------------------------------
function MarketSubmitSection({ kits, onPick }: { kits: MyKitEntry[]; onPick: (id: string) => void }) {
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

function SubmitModal({ forge, kitId, notify, onClose }: { forge: Forge; kitId: string; notify: Notify; onClose: () => void }) {
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

// --- Kit editor --------------------------------------------------------------
function KitEditor({ forge, kitId, notify, onClose }: { forge: Forge; kitId: string; notify: Notify; onClose: () => void }) {
  const [files, setFiles] = useState<{ path: string; content: string; encoding?: string }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [profile, setProfile] = useState<ValidationProfile>("local-valid");
  const [report, setReport] = useState<ValidationReport | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/kits/${encodeURIComponent(kitId)}/tree`, { credentials: "include" }).then((r) => r.json());
    const tree = (res.tree?.files ?? []) as { path: string; content: string; encoding?: string }[];
    setFiles(tree);
    setSelected((cur) => {
      if (cur) return cur;
      if (tree.length) setContent(tree[0].content);
      return tree[0]?.path ?? null;
    });
  }, [kitId]);

  useEffect(() => {
    void load().catch((e) => notify(errMsg(e), true));
  }, [load, notify]);

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
      await load();
    } catch (e) {
      notify(errMsg(e), true);
    }
  };

  const isText = useMemo(() => {
    const f = files.find((x) => x.path === selected);
    return !f || f.encoding !== "base64";
  }, [files, selected]);

  const act = (label: string, fn: () => Promise<unknown>) => () => fn().then(() => notify(`${label} ✓`), (e) => notify(errMsg(e), true));

  return (
    <div className="build-screen">
      <div className="screen-toolbar">
        <button className="secondary-button" onClick={onClose}>← My Kits</button>
        <div className="button-row">
          <select style={{ width: "auto", minWidth: 150 }} value={profile} onChange={(e) => setProfile(e.target.value as ValidationProfile)}>
            <option value="local-valid">local-valid</option>
            <option value="publishable">publishable</option>
            <option value="trusted">trusted</option>
            <option value="verified">verified</option>
          </select>
          <button className="secondary-button" onClick={() => forge.validateAgentKit({ rootPath: kitId, profile }).then(setReport, (e) => notify(errMsg(e), true))}>Validate</button>
          <button className="secondary-button" onClick={act("Package downloaded", () => forge.packageAgentKit({ rootPath: kitId, outputFolder: "" }))}>Package</button>
          <button className="secondary-button" onClick={act("One-file exported", () => forge.exportAgentKitOneFile({ rootPath: kitId, outputPath: "" }))}>One-file</button>
          <button className="secondary-button" onClick={act("Claude Code export", () => forge.exportAgentKitToClaudeCode({ kitPath: kitId, destinationDir: "", force: true }))}>→ Claude Code</button>
          <button className="secondary-button" onClick={act("Codex export", () => forge.exportAgentKitToCodex({ kitPath: kitId, destinationSkillsDir: "", force: true }))}>→ Codex</button>
        </div>
      </div>

      <div className="editor-layout">
        <div className="file-tree">
          {files.map((f) => (
            <button key={f.path} aria-selected={selected === f.path} onClick={() => open(f.path)}>{f.path}</button>
          ))}
        </div>
        <div>
          {selected ? (
            isText ? (
              <>
                <textarea className="code-area" value={content} onChange={(e) => { setContent(e.target.value); setDirty(true); }} />
                <div className="button-row" style={{ marginTop: 10 }}>
                  <button className="primary-button" disabled={!dirty} onClick={() => void save()}>Save file</button>
                </div>
              </>
            ) : (
              <div className="empty-state" style={{ margin: 0 }}><p>Binary file ({selected}) — not editable here.</p></div>
            )
          ) : (
            <div className="empty-state" style={{ margin: 0 }}><p>No file selected.</p></div>
          )}
        </div>
      </div>

      {report && (
        <div className="validation-report">
          <div className={`status-banner ${report.valid ?? report.ok ? "valid" : "invalid"}`}>
            <strong>Validation ({profile})</strong>
            <span>{report.valid ?? report.ok ? "valid" : "invalid"}</span>
          </div>
          <pre className="json-panel">{JSON.stringify(report, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

// --- Settings (AI providers) -------------------------------------------------
function SettingsSection({ forge, notify }: { forge: Forge; notify: Notify }) {
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

// --- Account -----------------------------------------------------------------
function AccountSection({ user }: { user: SessionUser }) {
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
        </div>
      </div>
    </div>
  );
}

// --- About -------------------------------------------------------------------
function AboutSection({ forge }: { forge: Forge }) {
  const [version, setVersion] = useState<string>("");
  useEffect(() => {
    void forge.getAppVersion().then(setVersion, () => setVersion("web"));
  }, [forge]);
  return (
    <div className="about-screen">
      <div className="about-panel">
        <h2>AgentKitForge (web)</h2>
        <p className="form-copy">Build, validate, package, import, export, and submit Agent Kits from your browser. This hosted web Forge shares the desktop app&apos;s design system and feature set, talking to the same backend through the ForgeClient seam.</p>
        <div className="about-meta">
          <p className="form-copy">Version: <span className="inline-code">{version || "…"}</span></p>
        </div>
        <div className="about-links">
          <a href="https://agentkitproject.com" target="_blank" rel="noreferrer">agentkitproject.com</a>
          <a href="https://market.agentkitproject.com" target="_blank" rel="noreferrer">Market</a>
        </div>
      </div>
      <div className="about-panel">
        <h2>Desktop-only features</h2>
        <p className="form-copy">Some desktop capabilities are not available on the web by design: opening a local folder in your OS file manager, the native app updater, and picking local filesystem paths. On the web, packaging and exports download files, and imports use uploads.</p>
      </div>
    </div>
  );
}
