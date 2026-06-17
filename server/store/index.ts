// Adapter selection factory for Web Forge persistence.
//
// KITSTORE_BACKEND selects the KitStore + UserSettingsStore implementation:
//   local    (default) — LocalDiskKitStore + disk UserSettingsStore.
//                         Needs a persistent volume; works self-host (k8s PV)
//                         but NOT on Amplify (ephemeral FS).
//   aws                — AwsKitStore (S3 trees + DynamoDB metadata) +
//                         AwsUserSettingsStore (DynamoDB). For hosted/Amplify.
//   selfhost           — SelfHostKitStore (Postgres metadata + MinIO/S3 trees)
//                         + SelfHostUserSettingsStore (Postgres). For k8s with
//                         bundled-or-external Postgres + MinIO.
//
// Required env per backend is documented in .env.example + README.md. The
// returned stores are singletons.
import type { KitStore } from "@/server/store/types";
import type { UserSettingsStore } from "@/server/store/settings-types";

export type StoreBackend = "local" | "aws" | "selfhost";

function backend(): StoreBackend {
  const raw = (process.env.KITSTORE_BACKEND || "local").toLowerCase();
  if (raw === "local" || raw === "aws" || raw === "selfhost") return raw;
  throw new Error(`Invalid KITSTORE_BACKEND="${raw}". Expected local | aws | selfhost.`);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required for KITSTORE_BACKEND=${backend()}.`);
  return v;
}

/**
 * AWS client region + credentials for the `aws` backend. On Amplify SSR the
 * managed compute role can't be granted DynamoDB/S3 access, and AWS_* env names
 * are reserved by Amplify — so a scoped IAM user's keys are injected via
 * FORGE_AWS_*. Region falls back to the runtime-provided AWS_REGION. When no
 * explicit keys are set, the default credential chain is used (local/role).
 */
function awsClientEnv(): {
  region: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
} {
  const region = process.env.FORGE_AWS_REGION || process.env.AWS_REGION || "us-east-1";
  const accessKeyId = process.env.FORGE_AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.FORGE_AWS_SECRET_ACCESS_KEY;
  return {
    region,
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {})
  };
}

let kitStoreSingleton: KitStore | null = null;
let settingsSingleton: UserSettingsStore | null = null;

async function buildKitStore(): Promise<KitStore> {
  switch (backend()) {
    case "aws": {
      const { AwsKitStore } = await import("@/server/store/aws-kit-store");
      return new AwsKitStore({
        kitsTable: requireEnv("DYNAMODB_KITS_TABLE"),
        s3Bucket: requireEnv("S3_BUCKET"),
        s3Prefix: process.env.S3_PREFIX,
        ...awsClientEnv()
      });
    }
    case "selfhost": {
      const { SelfHostKitStore } = await import("@/server/store/selfhost-kit-store");
      const { getSelfHostPgPool } = await import("@/server/store/selfhost-user-settings");
      return new SelfHostKitStore(await getSelfHostPgPool(), {
        s3Endpoint: requireEnv("S3_ENDPOINT"),
        s3Bucket: requireEnv("S3_BUCKET"),
        s3Prefix: process.env.S3_PREFIX,
        s3AccessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
        s3SecretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
        region: process.env.AWS_REGION
      });
    }
    default: {
      const { LocalDiskKitStore } = await import("@/server/store/local-disk");
      return new LocalDiskKitStore();
    }
  }
}

async function buildSettingsStore(): Promise<UserSettingsStore> {
  switch (backend()) {
    case "aws": {
      const { AwsUserSettingsStore } = await import("@/server/store/aws-user-settings");
      return new AwsUserSettingsStore({
        settingsTable: requireEnv("DYNAMODB_SETTINGS_TABLE"),
        ...awsClientEnv()
      });
    }
    case "selfhost": {
      const { SelfHostUserSettingsStore, getSelfHostPgPool } = await import(
        "@/server/store/selfhost-user-settings"
      );
      return new SelfHostUserSettingsStore(await getSelfHostPgPool());
    }
    default: {
      const { DiskUserSettingsStore } = await import("@/server/store/user-settings");
      return new DiskUserSettingsStore();
    }
  }
}

export async function getKitStore(): Promise<KitStore> {
  if (!kitStoreSingleton) kitStoreSingleton = await buildKitStore();
  return kitStoreSingleton;
}

export async function getUserSettingsStore(): Promise<UserSettingsStore> {
  if (!settingsSingleton) settingsSingleton = await buildSettingsStore();
  return settingsSingleton;
}
