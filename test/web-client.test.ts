// Verifies the WebForgeClient maps ForgeClient methods to the right HTTP
// endpoints/verbs/bodies, and that desktop-only seams degrade as documented.
import { describe, expect, it, vi } from "vitest";
import { NotAvailableOnWebError, WebForgeClient } from "@/forge-client/web-client";

type Call = { url: string; init?: RequestInit };

function makeClient(responder: (call: Call) => { status?: number; body?: unknown; headers?: Record<string, string> }) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const r = responder({ url, init });
    const body = typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {});
    return new Response(body, {
      status: r.status ?? 200,
      headers: r.headers ?? { "content-type": "application/json" }
    });
  });
  const downloads: { name: string }[] = [];
  const client = new WebForgeClient({
    fetchImpl: fetchImpl as unknown as typeof fetch,
    download: (_d, name) => downloads.push({ name })
  });
  return { client, calls, downloads, fetchImpl };
}

describe("WebForgeClient endpoint mapping", () => {
  it("listMyKits GETs /api/kits with credentials", async () => {
    const { client, calls } = makeClient(() => ({ body: { kits: [{ kitId: "k1" }] } }));
    const kits = await client.listMyKits();
    expect(kits).toEqual([{ kitId: "k1" }]);
    expect(calls[0].url).toBe("/api/kits");
    expect(calls[0].init?.credentials).toBe("include");
  });

  it("createAgentKitFromTemplate POSTs /api/kits/from-template", async () => {
    const { client, calls } = makeClient(() => ({ body: { kit: { kitId: "new" } } }));
    const res = await client.createAgentKitFromTemplate({ template: "blank", id: "i", name: "n", description: "d" });
    expect(res.kitId).toBe("new");
    expect(calls[0].url).toBe("/api/kits/from-template");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ template: "blank", id: "i" });
  });

  it("validateAgentKit POSTs /api/kits/:id/validate using rootPath as kitId", async () => {
    const { client, calls } = makeClient(() => ({ body: { report: { valid: true } } }));
    const report = await client.validateAgentKit({ rootPath: "kit 1", profile: "publishable" });
    expect(report.valid).toBe(true);
    expect(calls[0].url).toBe("/api/kits/kit%201/validate");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ profile: "publishable" });
  });

  it("packageAgentKit downloads zip bytes from /package", async () => {
    const { client, calls, downloads } = makeClient(() => ({
      body: "PK",
      headers: { "content-type": "application/zip", "content-disposition": 'attachment; filename="my-kit.agentkit.zip"' }
    }));
    const res = await client.packageAgentKit({ rootPath: "k1", outputFolder: "" });
    expect(calls[0].url).toBe("/api/kits/k1/package");
    expect(res.fileName).toBe("my-kit.agentkit.zip");
    expect(downloads[0].name).toBe("my-kit.agentkit.zip");
  });

  it("exportAgentKitOneFile downloads returned text", async () => {
    const { client, calls, downloads } = makeClient(() => ({ body: { text: "# kit", fileName: "kit.md" } }));
    const res = await client.exportAgentKitOneFile({ rootPath: "k1", outputPath: "" });
    expect(calls[0].url).toBe("/api/kits/k1/export/onefile");
    expect(res.text).toBe("# kit");
    expect(downloads[0].name).toBe("kit.md");
  });

  it("importHostedMarketKit POSTs /api/import/market", async () => {
    const { client, calls } = makeClient(() => ({ body: { kitId: "imported" } }));
    await client.importHostedMarketKit({ slug: "s", marketBaseUrl: "", validationProfile: "local-valid" });
    expect(calls[0].url).toBe("/api/import/market");
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ slug: "s" });
  });

  it("fetchLicensedMarketKit POSTs /api/market/licensed", async () => {
    const { client, calls } = makeClient(() => ({ body: { onlineOnly: true, preview: { files: [], texts: {} } } }));
    const res = await client.fetchLicensedMarketKit({ slug: "s", marketBaseUrl: "", validationProfile: "local-valid" });
    expect(res.onlineOnly).toBe(true);
    expect(calls[0].url).toBe("/api/market/licensed");
  });

  it("removeKitFromLibrary DELETEs /api/kits/:id", async () => {
    const { client, calls } = makeClient(() => ({ body: { ok: true } }));
    await client.removeKitFromLibrary("k1");
    expect(calls[0].url).toBe("/api/kits/k1");
    expect(calls[0].init?.method).toBe("DELETE");
  });

  it("surfaces server error envelopes", async () => {
    const { client } = makeClient(() => ({ status: 400, body: { error: "boom" } }));
    await expect(client.listMyKits()).rejects.toThrow("boom");
  });

  it("desktop-only seams throw NotAvailableOnWebError", async () => {
    const { client } = makeClient(() => ({ body: {} }));
    expect(() => client.addKitToLibrary()).toThrow(NotAvailableOnWebError);
    await expect(async () => client.runAgentKitWithAi()).rejects.toBeInstanceOf(NotAvailableOnWebError);
  });

  it("updater + openFolder degrade quietly on web", async () => {
    const { client } = makeClient(() => ({ body: {} }));
    expect(await client.checkForUpdate()).toBeNull();
    await expect(client.openFolder()).resolves.toBeUndefined();
    await expect(client.markLibraryKitUsed()).resolves.toBeUndefined();
  });
});
