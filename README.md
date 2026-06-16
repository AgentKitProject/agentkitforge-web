# agentkitforge-web

Phase 1 of the **AgentKitForge WebApp** port: a Next.js 15 (App Router) backend
that runs [`@agentkitforge/core`](https://www.npmjs.com/package/@agentkitforge/core)
**server-side** behind HTTP endpoints, so a future web UI (Phase 2) can do
everything the desktop Forge app does without a local filesystem.

`@agentkitforge/core` is **Node-only** — it runs server-side exclusively and is
**never** imported into a client component.

## How it works

- **Auth**: WorkOS AuthKit cookie sessions (mirrors `agentkitmarket-app`). Web
  Forge is logged-in by design; every `/api/*` route requires an authenticated
  user (`requireUserForApi`) and is scoped to that user's id.
- **KitStore** (`server/store/types.ts`): persists each user's kits as a *file
  tree* + metadata, since there is no local FS. Favorites are **references** to
  Market kits (slug + cached display metadata), never copies. One adapter ships
  today: **LocalDiskKitStore** (`server/store/local-disk.ts`), under
  `AGENTKITFORGE_WEB_DATA_DIR`. S3+DynamoDB (hosted) and Postgres+MinIO
  (self-host) adapters are stubbed with TODOs.
- **Core runner** (`server/core/runner.ts`): for each operation it materializes
  the kit tree into an ephemeral `os.tmpdir` dir, runs the relevant core
  function against it, persists any mutated tree back to the KitStore, and
  **always** cleans up (`try/finally`). Package/export return bytes/text for web
  download instead of writing to a user path.

## API routes (mapped to the desktop `ForgeClient`)

| Route | ForgeClient op |
|---|---|
| `GET /api/kits` | `listMyKits` |
| `POST /api/kits/from-template` | `createAgentKitFromTemplate` |
| `POST /api/kits/from-draft` | `renderGeneratedAgentKitDraft` |
| `GET/DELETE /api/kits/:id` | `getAgentKitMetadata` / `removeKitFromLibrary` |
| `GET /api/kits/:id/tree` | (read file tree for editor) |
| `PUT/DELETE /api/kits/:id/files` | write/delete kit file |
| `POST /api/kits/:id/validate` | `validateAgentKit` |
| `POST /api/kits/:id/package` | `packageAgentKit` (zip bytes) |
| `POST /api/kits/:id/export/onefile` | `exportAgentKitOneFile` (text) |
| `POST /api/kits/:id/export/codex` | `exportAgentKitToCodex` (zip) |
| `POST /api/kits/:id/export/claude-code` | `exportAgentKitToClaudeCode` (zip) |
| `GET /api/kits/:id/summary` | `getAgentKitSummary` |
| `GET /api/kits/:id/next-version` | `nextAgentKitVersion` |
| `GET /api/kits/:id/draft` | `loadAgentKitAsDraft` |
| `GET /api/kits/:id/prepared-prompts` | `listPreparedPrompts` |
| `POST /api/kits/:id/prepared-prompts/render` | `renderPreparedPrompt` |
| `POST /api/drafts/generate` | `generateAgentKitDraftWithAi` |
| `POST /api/drafts/revise` | `reviseAgentKitDraftWithAi` |
| `POST /api/import/zip` | `importAgentKitPackage` |
| `POST /api/import/git` | `importAgentKitFromGit` |
| `POST /api/import/market` | `importHostedMarketKit` |
| `GET/POST/DELETE /api/favorites` | favorites (Market refs) |
| `POST /api/market/licensed` | `fetchLicensedMarketKit` (in-memory preview) |
| `GET /health` | health check (public) |

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in WorkOS + AI provider values
npm run dev                  # http://localhost:3000  (/health is public)
```

## Verify

```bash
npm run typecheck
npm run build      # normal build (do NOT set BUILD_STANDALONE)
npm test           # vitest: KitStore adapter + core-runner round-trip
```

## Self-host (Docker)

```bash
docker build -t agentkitforge-web .   # builds with BUILD_STANDALONE=1
docker run -p 3000:3000 --env-file .env.local -v akf-data:/data agentkitforge-web
```

The image needs `git` (for `/api/import/git`) — already installed. Mount a
volume at `/data` so kit trees persist.

### Helm / ArgoCD (not built here)

The self-host k8s path follows the **same pattern as the Market self-host
backend** (see `market-phase2-plan`): Postgres + MinIO/S3 KitStore adapter,
runtime env via a `Secret`, the standalone image above behind an `Ingress`,
deployed via a Helm chart and ArgoCD. The chart is intentionally **not** built
in Phase 1.
