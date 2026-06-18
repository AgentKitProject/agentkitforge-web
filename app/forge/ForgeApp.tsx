"use client";

// Web Forge UI — shell + section router.
//
// ForgeApp is now a thin shell: it owns the sidebar nav, topbar, deep-link
// routing, global state (kits, favorites, usage, toast, theme) and delegates
// each section to a dedicated component under ./sections/. The WebForgeClient
// seam is unchanged — all HTTP calls still go through forge-client/web-client.ts.

import { useCallback, useEffect, useMemo, useState } from "react";
import { getForgeClient } from "@/forge-client";
import type { MyKitEntry } from "@/forge-client";
import {
  ExportIcon,
  HammerIcon,
  ImportIcon,
  InfoIcon,
  PackageIcon,
  PlayIcon,
  SettingsIcon,
  SparklesIcon,
  UploadIcon,
  UserIcon
} from "./icons";
import type { Favorite, SessionUser, UsageInfo } from "./sections/shared";
import { errMsg, fmtBytes } from "./sections/shared";
import { MyKits } from "./sections/MyKits";
import { BuildSection } from "./sections/BuildSection";
import { UseSection } from "./sections/UseSection";
import { ImportSection } from "./sections/ImportSection";
import { PackageExportSection } from "./sections/PackageExportSection";
import { MarketSubmitSection, SubmitModal } from "./sections/MarketSubmitSection";
import { KitEditor } from "./sections/KitEditor";
import { SettingsSection } from "./sections/SettingsSection";
import { AccountSection } from "./sections/AccountSection";
import { AboutSection } from "./sections/AboutSection";

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

function initials(email?: string): string {
  if (!email) return "";
  const name = email.split("@")[0];
  const parts = name.split(/[._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? name[0] ?? "").concat(parts[1]?.[0] ?? "").toUpperCase();
}

// Persisted theme: reads/writes localStorage "akf-theme"
function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState<string>(() => {
    if (typeof window === "undefined") return "light";
    return localStorage.getItem("akf-theme") ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("akf-theme", theme);
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);
  return [theme, toggle];
}

export default function ForgeApp({ user }: { user: SessionUser }) {
  const forge: Forge = useMemo(() => getForgeClient(), []);
  const [section, setSection] = useState<SectionId>("my-kits");
  const [kits, setKits] = useState<MyKitEntry[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [openKitId, setOpenKitId] = useState<string | null>(null);
  const [submitKitId, setSubmitKitId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [usage, setUsage] = useState<UsageInfo>(null);
  const [theme, toggleTheme] = useTheme();

  const notify = useCallback((msg: string, err = false) => {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 4200);
  }, []);

  const refreshUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/me/usage", { credentials: "include" });
      if (res.ok) setUsage((await res.json()) as UsageInfo);
    } catch {
      // non-critical
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [k, favRes] = await Promise.all([
        forge.listMyKits(),
        fetch("/api/favorites", { credentials: "include" }).then((r) => r.json())
      ]);
      setKits(k);
      setFavorites(((favRes as { favorites?: Favorite[] }).favorites ?? []) as Favorite[]);
    } catch (e) {
      notify(errMsg(e), true);
    }
    await refreshUsage();
  }, [forge, notify, refreshUsage]);

  useEffect(() => {
    void refresh();
    // Deep-link: ?import=<slug> jumps to Import section
    void forge.getInitialDeepLinks().then((links) => {
      const url = links[0];
      if (url && new URL(url).searchParams.get("import")) setSection("import");
    });
    // Apply persisted theme immediately on mount
    const saved = typeof window !== "undefined" ? localStorage.getItem("akf-theme") : null;
    if (saved) document.documentElement.setAttribute("data-theme", saved);
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

        {/* Theme toggle */}
        <button
          type="button"
          className="nav-item"
          style={{ marginTop: "auto", fontSize: "0.82em", opacity: 0.75 }}
          onClick={toggleTheme}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? (
            <SunIcon size={16} />
          ) : (
            <MoonIcon size={16} />
          )}
          <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
        </button>

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
          {/* Usage in topbar when present */}
          {usage && !openKitId && (
            <div style={{ fontSize: "0.8em", color: "var(--color-text-secondary)", textAlign: "right" }}>
              {usage.kitCount}/{usage.kitLimit} kits · {fmtBytes(usage.bytes)}/{fmtBytes(usage.byteLimit)}
              {usage.kitCount >= usage.kitLimit && <span style={{ color: "var(--color-error)", marginLeft: 6 }}>Limit reached</span>}
            </div>
          )}
        </header>

        <section className="content">
          {openKitId ? (
            <KitEditor forge={forge} kitId={openKitId} notify={notify} onClose={() => { setOpenKitId(null); void refresh(); }} />
          ) : section === "my-kits" ? (
            <MyKits
              forge={forge}
              kits={kits}
              favorites={favorites}
              usage={usage}
              notify={notify}
              onOpen={(id) => setOpenKitId(id)}
              onSubmit={(id) => setSubmitKitId(id)}
              onBuild={() => setSection("build")}
              onImport={() => setSection("import")}
              onRefresh={refresh}
            />
          ) : section === "build" ? (
            <BuildSection forge={forge} notify={notify} kits={kits} onOpen={(id) => { void refresh(); setOpenKitId(id); }} />
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

// Minimal inline theme icons to avoid adding a dep
function SunIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="10" cy="10" r="3.5" />
      <line x1="10" y1="2" x2="10" y2="4" />
      <line x1="10" y1="16" x2="10" y2="18" />
      <line x1="2" y1="10" x2="4" y2="10" />
      <line x1="16" y1="10" x2="18" y2="10" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="14.36" y1="14.36" x2="15.78" y2="15.78" />
      <line x1="4.22" y1="15.78" x2="5.64" y2="14.36" />
      <line x1="14.36" y1="5.64" x2="15.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M17 11.5A7 7 0 1 1 8.5 3a5.5 5.5 0 1 0 8.5 8.5z" />
    </svg>
  );
}
