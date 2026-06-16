import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (.next/standalone/server.js) for the
  // self-host Docker image (runs `node server.js`). Gated on BUILD_STANDALONE so
  // a hosted Amplify build is unchanged (Amplify manages its own SSR output).
  // Server env (WorkOS, data dir, AI keys, Market base URL) is read at runtime —
  // nothing is baked at build either way. Mirrors agentkitmarket-app.
  ...(process.env.BUILD_STANDALONE === "1" ? { output: "standalone" as const } : {}),

  // @agentkitforge/core is Node-only (fs, child_process). Keep it external to
  // the server bundle so its native/Node deps resolve at runtime, and ensure it
  // is NEVER pulled into a client bundle.
  serverExternalPackages: ["@agentkitforge/core", "jszip"]
};

export default nextConfig;
