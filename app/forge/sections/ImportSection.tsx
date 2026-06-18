"use client";

import { useEffect, useState } from "react";
import { StarIcon } from "../icons";
import type { Forge, Notify } from "./shared";
import { errMsg } from "./shared";

type ImportTab = "zip" | "git" | "market" | "browse";

type MarketKitEntry = {
  slug: string;
  name?: string;
  summary?: string;
  publisher?: string;
  version?: number | string;
  categories?: string[];
  tags?: string[];
  downloadCount?: number;
};

export function ImportSection({
  forge,
  notify,
  onDone
}: {
  forge: Forge;
  notify: Notify;
  onDone: (kitId?: string) => void;
}) {
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
          ["market", "From Market (slug)"],
          ["browse", "Browse Market"]
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
                    if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error ?? "Failed");
                  }, "Favorited.")
                }
              >
                <StarIcon size={14} /> Favorite
              </button>
            </div>
          </div>
        )}
        {tab === "browse" && (
          <MarketBrowsePanel forge={forge} notify={notify} onDone={onDone} busy={busy} setBusy={setBusy} />
        )}
      </div>
    </div>
  );
}

function MarketBrowsePanel({
  forge,
  notify,
  onDone,
  busy,
  setBusy
}: {
  forge: Forge;
  notify: Notify;
  onDone: (kitId?: string) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
}) {
  const [kits, setKits] = useState<MarketKitEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);

  const fetchPage = async (cursor?: string, q?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      if (q?.trim()) params.set("q", q.trim());
      params.set("limit", "24");
      const res = await fetch(`/api/market/catalog?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json() as { error?: string }).error ?? "Failed to load catalog");
      const data = await res.json() as { kits?: MarketKitEntry[]; nextCursor?: string };
      const incoming = data.kits ?? [];
      setKits(cursor ? (prev) => [...prev, ...incoming] : incoming);
      setNextCursor(data.nextCursor);
      setHasMore(!!data.nextCursor);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  // setKits needs to be callable as function — adjust the load
  const loadPage = async (cursor?: string, q?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      if (q?.trim()) params.set("q", q.trim());
      params.set("limit", "24");
      const res = await fetch(`/api/market/catalog?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Failed to load catalog");
      const data = (await res.json()) as { kits?: MarketKitEntry[]; nextCursor?: string };
      const incoming = data.kits ?? [];
      if (!cursor) {
        setKits(incoming);
      } else {
        setKits((prev) => [...prev, ...incoming]);
      }
      setNextCursor(data.nextCursor);
      setHasMore(!!data.nextCursor);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void loadPage(undefined, search);
  };

  const importKit = async (slug: string) => {
    setBusy(true);
    try {
      const result = await forge.importHostedMarketKit({ slug, marketBaseUrl: "", validationProfile: "local-valid" });
      notify(`Imported "${slug}".`);
      const kitId = (result && typeof result === "object" && "kitId" in result) ? String((result as { kitId: string }).kitId) : undefined;
      onDone(kitId);
    } catch (e) {
      notify(errMsg(e), true);
    } finally {
      setBusy(false);
    }
  };

  const favoriteKit = async (slug: string) => {
    try {
      const r = await fetch("/api/favorites", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ marketSlug: slug })
      });
      if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error ?? "Failed");
      notify(`Favorited "${slug}".`);
    } catch (e) {
      notify(errMsg(e), true);
    }
  };

  // Eliminate unused fetchPage warning
  void fetchPage;

  return (
    <div style={{ width: "100%" }}>
      <h2>Browse AgentKitMarket</h2>
      <p className="form-copy">Browse the public kit catalog. Import to add to your library, or Favorite to track updates.</p>
      <form onSubmit={(e) => void handleSearch(e)} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search kits…"
          style={{ flex: 1 }}
        />
        <button type="submit" className="secondary-button" disabled={loading}>Search</button>
        {search && <button type="button" className="secondary-button" onClick={() => { setSearch(""); void loadPage(); }}>Clear</button>}
      </form>

      {error && <p className="inline-warning">{error}</p>}
      {loading && kits.length === 0 && <p className="form-copy">Loading catalog…</p>}

      {kits.length > 0 && (
        <div className="kit-list">
          {kits.map((k) => (
            <article className="kit-library-card" key={k.slug}>
              <div className="kit-library-main">
                <div>
                  <h2>{k.name ?? k.slug}</h2>
                  {k.summary && <p>{k.summary}</p>}
                  <p className="form-copy" style={{ margin: "2px 0" }}>
                    {k.publisher && <span>{k.publisher} · </span>}
                    <span className="inline-code">{k.slug}</span>
                    {k.version != null && <span> · v{k.version}</span>}
                    {k.downloadCount != null && <span> · {k.downloadCount} downloads</span>}
                  </p>
                  {k.categories && k.categories.length > 0 && (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                      {k.categories.map((c) => <span key={c} className="source-badge">{c}</span>)}
                    </div>
                  )}
                </div>
              </div>
              <div className="button-row">
                <button className="primary-button" disabled={busy} onClick={() => void importKit(k.slug)}>Import</button>
                <button className="secondary-button" disabled={busy} onClick={() => void favoriteKit(k.slug)}>
                  <StarIcon size={13} /> Favorite
                </button>
                <a
                  className="secondary-button"
                  href={`https://market.agentkitproject.com/kits/${k.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ textDecoration: "none" }}
                >
                  View on Market
                </a>
              </div>
            </article>
          ))}
        </div>
      )}

      {!loading && kits.length === 0 && !error && (
        <div className="empty-state">
          <p>No kits found{search ? ` for "${search}"` : ""}.</p>
        </div>
      )}

      {hasMore && (
        <div style={{ marginTop: 16, textAlign: "center" }}>
          <button className="secondary-button" disabled={loading} onClick={() => void loadPage(nextCursor, search || undefined)}>
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
