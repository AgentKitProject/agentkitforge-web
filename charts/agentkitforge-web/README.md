# agentkitforge-web Helm chart

Self-hosts the **AgentKitForge WebApp** (Next.js 15 standalone server running
`@agentkitforge/core` server-side) with `KITSTORE_BACKEND=selfhost`:

- **`web`** Deployment + Service — the Next.js standalone server (`node server.js`),
  port 3000, `/health` readiness + liveness probes.
- **Bundled Postgres** (metadata + per-user settings) — persistent PVC.
- **Bundled MinIO** (kit trees, S3-compatible) — persistent PVC; the app
  auto-creates the bucket on startup.
- **Tailscale ingress** (`ingressClassName: tailscale`, empty host →
  `defaultBackend` pattern, served name from `tls.hosts`).

In-cluster service URLs **auto-default**, so the external secret only carries the
genuinely-secret values:

- `DATABASE_URL` is composed from `postgres.user/database` + the secret's
  `POSTGRES_PASSWORD`, pointing at the bundled Postgres Service.
- `S3_ENDPOINT` defaults to the bundled MinIO Service; `S3_BUCKET` defaults to
  `minio.bucket`; `S3_ACCESS_KEY_ID` defaults to `minio.rootUser`;
  `S3_SECRET_ACCESS_KEY` reads the secret's `MINIO_ROOT_PASSWORD`.

When `postgres.enabled`/`minio.enabled` are true, any `DATABASE_URL`/`S3_ENDPOINT`
keys in the external secret are **ignored** (the chart's composed values win). To
use an external Postgres/MinIO, set `postgres.enabled=false` / `minio.enabled=false`
and provide `DATABASE_URL` / `S3_ENDPOINT` (+ `S3_*`) in the secret.

## Auth model

The web Forge is **logged-in by design** — every `/api/*` route requires an
authenticated WorkOS AuthKit user. WorkOS config is therefore required for the app
to be usable (the `/health` probe works regardless).

## GitOps with an external (Infisical) secret

Set `web.secrets.existingSecret` to a Secret you manage externally (synced by
Infisical). The chart then does **not** render its own secret; the web container
`envFrom`s it, and the bundled Postgres/MinIO read their passwords from it.

### Required keys in the external secret

The homelab GitOps `InfisicalSecret` syncs `/k8s/agentkitforge-web` into a Secret
named **`agentkitforge-web-secrets`**. Populate these keys in Infisical:

| Key | Purpose |
|---|---|
| `WORKOS_API_KEY` | WorkOS AuthKit API key |
| `WORKOS_CLIENT_ID` | WorkOS client id |
| `WORKOS_COOKIE_PASSWORD` | Session cookie password (**≥ 32 chars**) |
| `AGENTKITFORGE_WEB_SECRET` | AES-256-GCM key for at-rest encryption of per-user AI provider keys |
| `APP_URL` | Public origin, e.g. `https://agentkitforge-web.tailf14b5e.ts.net` |
| `WORKOS_REDIRECT_URI` | e.g. `https://agentkitforge-web.tailf14b5e.ts.net/auth/callback` |
| `AGENTKITMARKET_BASE_URL` | Market base URL for import/favorites/licensed flows |
| `POSTGRES_PASSWORD` | Bundled Postgres password |
| `MINIO_ROOT_PASSWORD` | Bundled MinIO root password (= `S3_SECRET_ACCESS_KEY`) |

`S3_ACCESS_KEY_ID` is set from `minio.rootUser` (default `minioadmin`) — keep it
in sync with whatever you set, or override `minio.rootUser`.

Optional keys: `AGENTKITPROJECT_WORKOS_CLIENT_ID` (device/licensed flows;
usually equals `WORKOS_CLIENT_ID`).

When **AgentKitAuto** is enabled (`auto.enabled=true`), also add:

| Key | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Inference key — operator BYO key (free) or managed key |
| `AUTO_WORKER_SERVICE_KEY` | Service key the sweep + worker present to the internal Auto endpoints (`openssl rand -hex 32`) |

See [`docs/SELF_HOST_AUTO.md`](../../docs/SELF_HOST_AUTO.md) for the full Auto
self-host guide (worker image, RBAC, sweep CronJob, billing policy).

> Until those keys exist in Infisical, the `agentkitforge-web-secrets` Secret is
> empty/absent and the web pod will **crashloop / stay pending** — this is
> expected during GitOps bootstrap.

## Quick install (non-GitOps, inline secrets)

```sh
helm install agentkitforge-web ./charts/agentkitforge-web \
  --set web.secrets.workosApiKey=sk_... \
  --set web.secrets.workosClientId=client_... \
  --set web.secrets.workosCookiePassword="$(openssl rand -base64 32)" \
  --set web.secrets.forgeWebSecret="$(openssl rand -base64 32)" \
  --set web.config.appUrl=https://forge.example.ts.net \
  --set postgres.password=... --set minio.rootPassword=...
```
