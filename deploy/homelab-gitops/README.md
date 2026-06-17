# homelab-gitops files for agentkitforge-web

These mirror the agentkitmarket self-host GitOps setup. **Copy them into your
`homelab-gitops` repo** (it is not part of this repo / workspace), then commit
there so ArgoCD picks them up:

```
homelab-gitops/
  bootstrap/
    agentkitforge-web-chart-app.yaml       <- from deploy/homelab-gitops/bootstrap/
    agentkitforge-web-manifests-app.yaml   <- from deploy/homelab-gitops/bootstrap/
  agentkitforge-web/
    values.yaml                            <- from deploy/homelab-gitops/agentkitforge-web/
    manifests/
      infisical-secret.yaml                <- from deploy/homelab-gitops/agentkitforge-web/manifests/
      ghcr-pull-secret.yaml                <- from deploy/homelab-gitops/agentkitforge-web/manifests/
```

## Before it will sync — action items

1. **Replace `<HOMELAB_GITOPS_REPO_URL>`** in both bootstrap apps with your
   homelab-gitops repo URL (match `agentkitmarket-chart-app.yaml`'s `$values`
   source and `agentkitmarket-manifests-app.yaml`'s `repoURL`).

2. **ArgoCD must be able to read the PRIVATE `agentkitforge-web` repo.** The
   chart-app's source 1 is `github.com/AgentKitProject/agentkitforge-web` (private).
   Unless ArgoCD already has a credential covering the whole `AgentKitProject` org,
   **add a repository credential** (a `repository`/`repo-creds` Secret in the
   `argocd` namespace with a PAT or deploy key). Until then the app shows
   `ComparisonError: repository not accessible`. (agentkitmarket-core is public, so
   its chart-app needed no credential — this is the one genuinely new requirement.)

3. **Fix the InfisicalSecret `authentication` block** to match your operator. The
   blocks here use `universalAuth` with `secretsPath: /k8s/agentkitforge-web` and
   `envSlug: prod` against the homelab Infisical project
   (`82d16545-bc55-4d34-a9a4-8c8416a78fa6`). Copy the EXACT `authentication`
   stanza from your existing agentkitmarket InfisicalSecret (machine-identity /
   credentialsRef names) — these were authored without sight of that file.

4. **Populate Infisical** `/k8s/agentkitforge-web` with the required keys (see
   `infisical-secret.yaml` header and the chart README). Until then the web pod
   stays pending/crashloops — expected.

Tailnet: `tailf14b5e.ts.net`. Served host: `agentkitforge-web.tailf14b5e.ts.net`.
