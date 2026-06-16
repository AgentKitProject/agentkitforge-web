// POST /api/market/licensed -> fetchLicensedMarketKit
// body: { slug, kitId?, marketBaseUrl? }
//
// Tier-2 paid/licensed kits. Calls core's fetchLicensedKit server-side and
// builds an IN-MEMORY preview. Online-only kits are NEVER persisted to the
// KitStore — bytes stay in this process and are discarded. (Mirrors the desktop
// market-operation.mjs licensed-package path.)
//
// TODO(market-auth): seed a real capture TokenStore from the user's WorkOS
// session so entitlement checks pass; the tokenless store below only works for
// previewing public metadata where entitlement is not enforced.
import { withUser } from "@/lib/api";
import { loadCoreMarket } from "@/server/core/load-core";

export const dynamic = "force-dynamic";

const MAX_PREVIEW_TEXT_BYTES = 64 * 1024;
const PREVIEW_TEXT_CANDIDATES = ["agentkit.yaml", "AGENTKIT.md", "START_HERE.md"];

async function buildInMemoryPreview(bytes: Uint8Array) {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(bytes);
  const files: string[] = [];
  zip.forEach((relativePath, entry) => {
    if (!entry.dir) files.push(relativePath);
  });
  files.sort();
  const texts: Record<string, string> = {};
  for (const name of PREVIEW_TEXT_CANDIDATES) {
    const entry = zip.file(name);
    if (!entry) continue;
    const content = await entry.async("string");
    texts[name] =
      content.length > MAX_PREVIEW_TEXT_BYTES ? `${content.slice(0, MAX_PREVIEW_TEXT_BYTES)}\n\n[Preview truncated]` : content;
  }
  return { files, texts };
}

export async function POST(request: Request) {
  return withUser(async () => {
    const body = (await request.json()) as { slug?: string; kitId?: string; marketBaseUrl?: string };
    if (!body.slug) throw new Error("slug is required.");
    const market = await loadCoreMarket();
    const store = {
      async get() {
        return null;
      },
      async set() {
        /* no-op */
      },
      async clear() {
        /* no-op */
      }
    };
    const licensed = await market.fetchLicensedKit(store as never, {
      slug: body.slug,
      marketBaseUrl: body.marketBaseUrl ?? process.env.AGENTKITMARKET_BASE_URL,
      clientId: process.env.AGENTKITPROJECT_WORKOS_CLIENT_ID ?? ""
    });
    const preview = await buildInMemoryPreview(licensed.bytes);
    // ONLINE-ONLY: never persist; only preview. DOWNLOADABLE: the web client can
    // re-fetch and download; we still do not write to the KitStore here.
    return {
      onlineOnly: licensed.onlineOnly === true,
      pricing: licensed.pricing,
      downloadable: licensed.downloadable === true,
      kitId: licensed.kitId,
      fileName: licensed.fileName,
      sha256: licensed.sha256,
      licenseVersion: licensed.licenseVersion,
      entitlementId: licensed.entitlementId,
      preview
    };
  });
}
