import type { ReactNode } from "react";
// Shared UI framework stylesheet (tokens + AppShell/SiteShell + primitives).
// Imported first so app-specific rules in forge.css can layer on top and the
// token bridge (--color-* → --ak-*) resolves against the framework defaults.
import "@agentkitforge/ui/styles.css";
import "./forge.css";

export const metadata = {
  title: "AgentKitForge Web",
  description: "Web backend for the AgentKitForge ecosystem"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
