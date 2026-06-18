"use client";

import { useState } from "react";
import { FileIcon, PackageIcon, PlugIcon } from "../icons";
import type { Forge, MyKitEntry, Notify } from "./shared";
import { errMsg } from "./shared";

export function PackageExportSection({
  forge,
  kits,
  notify
}: {
  forge: Forge;
  kits: MyKitEntry[];
  notify: Notify;
}) {
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
