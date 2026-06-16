// Phase 1 is a backend only. This placeholder page confirms the server is up;
// the Phase 2 web UI (a FetchForgeClient against /api/*) replaces it.
//
// NOTE: this is a server component. @agentkitforge/core is Node-only and must
// NEVER be imported into a client component.
export default function HomePage() {
  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem" }}>
      <h1>AgentKitForge Web</h1>
      <p>Phase 1 backend. The HTTP API lives under <code>/api/*</code>. See <code>/health</code>.</p>
    </main>
  );
}
