import type { ReactNode } from "react";

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
