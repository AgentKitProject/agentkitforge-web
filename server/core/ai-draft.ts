// AI draft generation/revision — ported from the desktop
// generate-agent-kit-draft.mjs bridge. Provider config is read from SERVER env
// (AGENTKITFORGE_AI_PROVIDER_CONFIG), never supplied by the client, so API keys
// never reach the browser.
//
// Supports the same provider types as the desktop app: openai, anthropic,
// gemini, ollama, openai-compatible. (Verified against the published Anthropic
// Messages API shape used by the desktop bridge.)
import { loadCore } from "@/server/core/load-core";

type ProviderConfig = {
  id?: string;
  name: string;
  providerType: "openai" | "anthropic" | "gemini" | "ollama" | "openai-compatible";
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  defaultModel?: string;
};

// Core expects array fields; the UI sends either a string or an array.
function toList(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  const trimmed = value.trim();
  return trimmed ? [trimmed] : undefined;
}

function loadProviderConfig(): ProviderConfig {
  const raw = process.env.AGENTKITFORGE_AI_PROVIDER_CONFIG;
  if (!raw) {
    throw new Error("AI provider configuration is required (set AGENTKITFORGE_AI_PROVIDER_CONFIG).");
  }
  const parsed = JSON.parse(raw) as ProviderConfig;
  return {
    ...parsed,
    name: parsed.name?.trim() || parsed.providerType,
    baseUrl: parsed.baseUrl?.trim().replace(/\/+$/, "") || undefined,
    apiKey: parsed.apiKey?.trim() || undefined,
    defaultModel: parsed.defaultModel?.trim() || ""
  };
}

function resolveModel(provider: ProviderConfig, inputModel?: string): string {
  return (
    [inputModel, provider.model, provider.defaultModel]
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .find((v) => v.length > 0) ?? ""
  );
}

function normalizeSecureBaseUrl(value: string): string {
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Base URL must start with http:// or https://.");
  }
  const host = parsed.hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (parsed.protocol === "http:" && !isLocal) {
    throw new Error("Non-local HTTP providers may leak prompts/keys. Use HTTPS or a local address.");
  }
  return value.replace(/\/+$/, "");
}

function providerErrorMessage(name: string, status: number, body: string): string {
  try {
    const parsed = JSON.parse(body);
    const message = parsed?.error?.message || parsed?.error;
    if (message) return `${name} request failed (${status}): ${message}`;
  } catch {
    // fall through
  }
  return `${name} request failed (${status}).`;
}

type DraftRequestLike = {
  systemInstructions: string;
  builderInstructions: string;
  userPrompt: string;
  expectedJsonSchema: unknown;
  responseFormatName: string;
  warnings?: unknown;
};

async function callProvider(provider: ProviderConfig, model: string, draftRequest: DraftRequestLike): Promise<string> {
  const instructions = draftRequest.systemInstructions;
  const input = [
    draftRequest.builderInstructions,
    "",
    draftRequest.userPrompt,
    "",
    "Return only valid AgentKitDraft JSON.",
    "Expected JSON schema:",
    JSON.stringify(draftRequest.expectedJsonSchema)
  ].join("\n");

  switch (provider.providerType) {
    case "anthropic": {
      const baseUrl = normalizeSecureBaseUrl(provider.baseUrl || "https://api.anthropic.com/v1");
      const res = await fetch(`${baseUrl}/messages`, {
        method: "POST",
        headers: {
          "x-api-key": requiredKey(provider),
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          system: instructions,
          messages: [{ role: "user", content: input }],
          max_tokens: 4000
        })
      });
      const body = await res.text();
      if (!res.ok) throw new Error(providerErrorMessage(provider.name, res.status, body));
      const parsed = JSON.parse(body);
      const text = (parsed.content ?? [])
        .map((item: { text?: string }) => item.text)
        .filter(Boolean)
        .join("\n")
        .trim();
      if (!text) throw new Error("Anthropic returned an empty draft response.");
      return text;
    }
    case "openai":
    case "openai-compatible": {
      const baseUrl = normalizeSecureBaseUrl(provider.baseUrl || "https://api.openai.com/v1");
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: instructions },
            { role: "user", content: input }
          ],
          temperature: 0.2
        })
      });
      const body = await res.text();
      if (!res.ok) throw new Error(providerErrorMessage(provider.name, res.status, body));
      const parsed = JSON.parse(body);
      const text = parsed?.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error(`${provider.name} returned an empty draft response.`);
      return text;
    }
    case "gemini": {
      const baseUrl = normalizeSecureBaseUrl(provider.baseUrl || "https://generativelanguage.googleapis.com/v1beta");
      const res = await fetch(
        `${baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(requiredKey(provider))}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${instructions}\n\n${input}` }] }],
            generationConfig: { maxOutputTokens: 4000 }
          })
        }
      );
      const body = await res.text();
      if (!res.ok) throw new Error(providerErrorMessage(provider.name, res.status, body));
      const parsed = JSON.parse(body);
      const text = (parsed.candidates ?? [])
        .flatMap((c: { content?: { parts?: { text?: string }[] } }) => c.content?.parts ?? [])
        .map((p: { text?: string }) => p.text)
        .filter(Boolean)
        .join("\n")
        .trim();
      if (!text) throw new Error("Gemini returned an empty draft response.");
      return text;
    }
    case "ollama": {
      const baseUrl = normalizeSecureBaseUrl(provider.baseUrl || "http://localhost:11434");
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, system: instructions, prompt: input, stream: false, options: { num_predict: 4000 } })
      });
      const body = await res.text();
      if (!res.ok) throw new Error(providerErrorMessage(provider.name, res.status, body));
      const parsed = JSON.parse(body);
      const text = parsed.response?.trim();
      if (!text) throw new Error("Ollama returned an empty draft response.");
      return text;
    }
    default:
      throw new Error(`Unsupported AI provider type: ${provider.providerType}`);
  }
}

function requiredKey(provider: ProviderConfig): string {
  if (!provider.apiKey) throw new Error(`${provider.name} API key is required.`);
  return provider.apiKey;
}

// Parse the first AgentKitDraft-valid JSON object out of the model text.
async function parseDraft(core: Awaited<ReturnType<typeof loadCore>>, text: string) {
  const trimmed = String(text ?? "").trim();
  const candidates: unknown[] = [];
  const push = (value: string) => {
    try {
      candidates.push(JSON.parse(value));
    } catch {
      /* keep looking */
    }
  };
  push(trimmed);
  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) push(match[1]);

  for (const candidate of candidates) {
    const obj = candidate as Record<string, unknown>;
    const unwrapped =
      obj && typeof obj === "object"
        ? (["draftJson", "draft", "agentKitDraft", "agentKit", "result"]
            .map((k) => obj[k])
            .find((v) => v && typeof v === "object") ?? obj)
        : candidate;
    const parsed = core.agentKitDraftSchema.safeParse(unwrapped);
    if (parsed.success) return parsed.data;
  }
  throw new Error("Provider returned no valid AgentKitDraft JSON. Try regenerating or a stricter model.");
}

export type GenerateDraftInput = {
  userRequest: string;
  targetUsers?: string | string[];
  domain?: string;
  desiredValidationLevel?: string;
  constraints?: string | string[];
  sourceNotes?: string | string[];
  requestedSections?: string[];
  excludedSections?: string[];
  exampleInputDocuments?: unknown[];
  model?: string;
};

export async function generateDraft(input: GenerateDraftInput) {
  const provider = loadProviderConfig();
  const core = await loadCore();
  const model = resolveModel(provider, input.model);
  if (!model) throw new Error(`${provider.name} model is required.`);
  const draftRequest = core.createAgentKitDraftRequest({
    userRequest: input.userRequest,
    targetUsers: toList(input.targetUsers),
    domain: input.domain,
    desiredValidationLevel: input.desiredValidationLevel as never,
    constraints: toList(input.constraints),
    sourceNotes: toList(input.sourceNotes),
    requestedSections: input.requestedSections,
    excludedSections: input.excludedSections,
    exampleInputDocuments: input.exampleInputDocuments as never
  }) as unknown as DraftRequestLike;
  const rawText = await callProvider(provider, model, draftRequest);
  const draft = await parseDraft(core, rawText);
  const session = core.createDraftSession({
    originalRequest: input.userRequest,
    initialDraft: draft,
    provider: provider.name,
    model,
    warnings: draftRequest.warnings as never,
    name: draft.name
  });
  return {
    draftJson: draft,
    warnings: draftRequest.warnings,
    providerName: provider.name,
    model,
    session,
    currentRevision: core.getCurrentDraftRevision(session)
  };
}

export type ReviseDraftInput = {
  session: unknown;
  changeRequest: string;
  desiredValidationLevel?: string;
  constraints?: string | string[];
  sourceNotes?: string | string[];
  requestedSections?: string[];
  excludedSections?: string[];
  exampleInputDocuments?: unknown[];
  model?: string;
};

export async function reviseDraft(input: ReviseDraftInput) {
  const provider = loadProviderConfig();
  const core = await loadCore();
  const model = resolveModel(provider, input.model);
  if (!model) throw new Error(`${provider.name} model is required.`);
  const session = core.validateDraftSession(input.session);
  const currentRevision = core.getCurrentDraftRevision(session);
  const revisionRequest = core.createAgentKitDraftRevisionRequest({
    currentDraft: currentRevision.draft,
    changeRequest: input.changeRequest,
    originalRequest: session.originalRequest,
    desiredValidationLevel: input.desiredValidationLevel as never,
    constraints: toList(input.constraints),
    sourceNotes: toList(input.sourceNotes),
    requestedSections: input.requestedSections,
    excludedSections: input.excludedSections,
    exampleInputDocuments: input.exampleInputDocuments as never
  }) as unknown as DraftRequestLike;
  const rawText = await callProvider(provider, model, revisionRequest);
  const draft = await parseDraft(core, rawText);
  const updatedSession = core.addDraftRevision(session, {
    draft,
    changeRequest: input.changeRequest,
    provider: provider.name,
    model,
    warnings: revisionRequest.warnings as never
  });
  return {
    draftJson: draft,
    warnings: revisionRequest.warnings,
    providerName: provider.name,
    model,
    session: updatedSession,
    currentRevision: core.getCurrentDraftRevision(updatedSession)
  };
}
