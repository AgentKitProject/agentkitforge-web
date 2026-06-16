// Import operations that bring an external kit into the user's KitStore.
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { loadCoreMarket } from "@/server/core/load-core";
import { readTreeFromDir } from "@/server/core/runner";
import { getKitStore } from "@/server/store/local-disk";
import { unzipToTree } from "@/server/core/operations";

const execFileAsync = promisify(execFile);

// --- import from git (server-side clone) -------------------------------------
export async function importFromGit(
  userId: string,
  repositoryUrl: string,
  reference: string
): Promise<{ kitId: string }> {
  if (!/^https?:\/\//i.test(repositoryUrl)) {
    throw new Error("Only http(s) git URLs are supported.");
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "akf-git-"));
  try {
    const dest = path.join(tmp, "repo");
    // Shallow clone, then optionally checkout the requested ref.
    await execFileAsync("git", ["clone", "--depth", "1", repositoryUrl, dest], { timeout: 120_000 });
    if (reference && reference.trim()) {
      await execFileAsync("git", ["-C", dest, "fetch", "--depth", "1", "origin", reference], { timeout: 120_000 }).catch(
        () => undefined
      );
      await execFileAsync("git", ["-C", dest, "checkout", reference], { timeout: 60_000 });
    }
    // Drop the .git dir so it is not persisted into the kit tree.
    await fs.rm(path.join(dest, ".git"), { recursive: true, force: true });
    const tree = await readTreeFromDir(dest);
    const meta = await getKitStore().createKit(userId, { kind: "tree", tree, source: "git" });
    return { kitId: meta.kitId };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

// --- import from Market (via core market client) -----------------------------
// Uses the public download path; persists the imported tree into the KitStore.
export async function importFromMarket(
  userId: string,
  params: { slug: string; kitId?: string; marketBaseUrl?: string; clientId?: string }
): Promise<{ kitId: string; provenance?: unknown }> {
  const market = await loadCoreMarket();
  // Tokenless public catalog read + download. The core client returns the zip
  // bytes; we materialize them straight into a KitStore tree (no user FS).
  const { bytes, provenance } = await market.downloadKit(makeTokenlessStore() as never, {
    slug: params.slug,
    kitId: params.kitId,
    marketBaseUrl: params.marketBaseUrl,
    clientId: params.clientId ?? ""
  });
  const tree = await unzipToTree(Buffer.from(bytes));
  const meta = await getKitStore().createKit(userId, { kind: "tree", tree, source: "market-import" });
  return { kitId: meta.kitId, provenance };
}

// A no-session TokenStore for public/tokenless Market reads. The hosted
// authenticated download flow (entitlements, private kits) should instead seed
// this with the user's WorkOS session — see TODO below.
//
// TODO(market-auth): wire the user's WorkOS access token (from the AuthKit
// session) into a real capture TokenStore so private/entitled downloads work,
// mirroring market-operation.mjs's createCaptureStore. Public kits work today.
function makeTokenlessStore() {
  return {
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
}
