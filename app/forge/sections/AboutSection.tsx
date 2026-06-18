"use client";

import { useEffect, useState } from "react";
import type { Forge } from "./shared";

export function AboutSection({ forge }: { forge: Forge }) {
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
          <a href="https://forge.agentkitproject.com" target="_blank" rel="noreferrer">Forge</a>
        </div>
      </div>
      <div className="about-panel">
        <h2>Desktop-only features</h2>
        <p className="form-copy">Some desktop capabilities are not available on the web by design: opening a local folder in your OS file manager, the native app updater, and picking local filesystem paths. On the web, packaging and exports download files, and imports use uploads.</p>
      </div>
    </div>
  );
}
