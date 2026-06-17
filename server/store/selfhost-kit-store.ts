// SelfHostKitStore — self-host KitStore adapter (Postgres + MinIO/S3).
//
// LAYOUT
//   Kit file trees → MinIO (S3-compatible), one object per kit via S3TreeStore:
//       <bucket>/<prefix>kits/<userId>/<kitId>/tree.json
//   Kit metadata   → Postgres table kit_metadata (PK user_id, kit_id).
//
// Reuses @aws-sdk/client-s3 against the MinIO endpoint (forcePathStyle) so tree
// storage is byte-for-byte identical to the AWS adapter. The schema is created
// idempotently on startup (ensureSchema) and the bucket is ensured on startup
// (ensureBucket), mirroring the Market self-host backend. Same path-traversal
// guards via shared.ts.
//
// FAVORITES are VESTIGIAL here too (moved to Market in Phase 3): the methods
// no-op and nothing is persisted.
import { randomUUID } from "node:crypto";
import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { S3TreeStore } from "@/server/store/s3-tree";
import { materializeTemplateTree } from "@/server/store/template-tree";
import { assertSafeSegment, normalizeRelPath, parseKitName } from "@/server/store/shared";
import { ensureSchema, type PgPool } from "@/server/store/selfhost-pg";
import {
  type CreateKitInput,
  type FavoriteRecord,
  type KitFile,
  type KitMetadataRecord,
  type KitStore,
  type KitTree
} from "@/server/store/types";

export type SelfHostKitStoreConfig = {
  s3Endpoint: string;
  s3Bucket: string;
  s3Prefix?: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  region?: string;
  /** Ensure the MinIO bucket exists on startup. Default true. */
  ensureBucket?: boolean;
};

export class SelfHostKitStore implements KitStore {
  private readonly pool: PgPool;
  private readonly s3: S3Client;
  private readonly trees: S3TreeStore;
  private readonly bucket: string;
  private readonly ensureBucketOnStart: boolean;
  private ready: Promise<void> | null = null;

  constructor(pool: PgPool, config: SelfHostKitStoreConfig, deps?: { s3?: S3Client }) {
    this.pool = pool;
    this.bucket = config.s3Bucket;
    this.ensureBucketOnStart = config.ensureBucket ?? true;
    this.s3 =
      deps?.s3 ??
      new S3Client({
        endpoint: config.s3Endpoint,
        region: config.region ?? "us-east-1",
        forcePathStyle: true,
        credentials: { accessKeyId: config.s3AccessKeyId, secretAccessKey: config.s3SecretAccessKey }
      });
    this.trees = new S3TreeStore(this.s3, { bucket: config.s3Bucket, prefix: config.s3Prefix });
  }

  private async init(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        await ensureSchema(this.pool);
        if (this.ensureBucketOnStart) await this.ensureBucket();
      })();
    }
    return this.ready;
  }

  private async ensureBucket(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return;
    } catch {
      // fall through to create
    }
    try {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      const name = (error as { name?: string; Code?: string })?.name ?? (error as { Code?: string })?.Code;
      if (name === "BucketAlreadyOwnedByYou" || name === "BucketAlreadyExists") return;
      throw new Error(`Failed to ensure kit-tree bucket "${this.bucket}": ${String(error)}`);
    }
  }

  async createKit(userId: string, input: CreateKitInput): Promise<KitMetadataRecord> {
    await this.init();
    assertSafeSegment(userId, "userId");
    const kitId = randomUUID();
    const now = new Date().toISOString();
    let tree: KitTree;
    let source: KitMetadataRecord["source"];
    let name: string | undefined;

    if (input.kind === "template") {
      tree = await materializeTemplateTree(input);
      source = "template";
      name = input.name;
    } else {
      tree = input.tree;
      source = input.source;
      name = input.name ?? parseKitName(tree);
    }

    await this.trees.putTree(userId, kitId, tree);
    await this.pool.query(
      `INSERT INTO kit_metadata (user_id, kit_id, name, source, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, kitId, name ?? null, source, now, now]
    );
    return { kitId, ownerUserId: userId, name, createdAt: now, updatedAt: now, source };
  }

  async listUserKits(userId: string): Promise<KitMetadataRecord[]> {
    await this.init();
    assertSafeSegment(userId, "userId");
    const res = await this.pool.query(
      `SELECT * FROM kit_metadata WHERE user_id = $1 ORDER BY updated_at DESC`,
      [userId]
    );
    return res.rows.map(toMetadata);
  }

  async getKitMetadata(userId: string, kitId: string): Promise<KitMetadataRecord | null> {
    await this.init();
    assertSafeSegment(userId, "userId");
    assertSafeSegment(kitId, "kitId");
    const res = await this.pool.query(
      `SELECT * FROM kit_metadata WHERE user_id = $1 AND kit_id = $2`,
      [userId, kitId]
    );
    return res.rows[0] ? toMetadata(res.rows[0]) : null;
  }

  async getKitTree(userId: string, kitId: string): Promise<KitTree> {
    await this.requireKit(userId, kitId);
    return this.trees.getTree(userId, kitId);
  }

  async putKitTree(userId: string, kitId: string, tree: KitTree): Promise<void> {
    await this.requireKit(userId, kitId);
    await this.trees.putTree(userId, kitId, tree);
    await this.touch(userId, kitId);
  }

  async writeKitFile(userId: string, kitId: string, file: KitFile): Promise<void> {
    await this.requireKit(userId, kitId);
    const rel = normalizeRelPath(file.path);
    const tree = await this.trees.getTree(userId, kitId);
    const files = tree.files.filter((f) => f.path !== rel);
    files.push({ path: rel, content: file.content, encoding: file.encoding ?? "utf8" });
    await this.trees.putTree(userId, kitId, { files });
    await this.touch(userId, kitId);
  }

  async deleteKitFile(userId: string, kitId: string, filePath: string): Promise<void> {
    await this.requireKit(userId, kitId);
    const rel = normalizeRelPath(filePath);
    const tree = await this.trees.getTree(userId, kitId);
    await this.trees.putTree(userId, kitId, { files: tree.files.filter((f) => f.path !== rel) });
    await this.touch(userId, kitId);
  }

  async deleteKit(userId: string, kitId: string): Promise<void> {
    await this.init();
    assertSafeSegment(userId, "userId");
    assertSafeSegment(kitId, "kitId");
    await this.trees.deleteTree(userId, kitId);
    await this.pool.query(`DELETE FROM kit_metadata WHERE user_id = $1 AND kit_id = $2`, [userId, kitId]);
  }

  // --- favorites: vestigial (moved to Market in Phase 3) --------------------
  async addFavorite(_userId: string, favorite: FavoriteRecord): Promise<FavoriteRecord> {
    return favorite;
  }
  async listFavorites(_userId: string): Promise<FavoriteRecord[]> {
    return [];
  }
  async removeFavorite(_userId: string, _marketSlug: string): Promise<void> {
    // no-op
  }

  private async requireKit(userId: string, kitId: string): Promise<void> {
    const meta = await this.getKitMetadata(userId, kitId);
    if (!meta) throw new Error("Kit not found.");
  }

  private async touch(userId: string, kitId: string): Promise<void> {
    await this.pool.query(
      `UPDATE kit_metadata SET updated_at = $3 WHERE user_id = $1 AND kit_id = $2`,
      [userId, kitId, new Date().toISOString()]
    );
  }
}

function toMetadata(row: Record<string, unknown>): KitMetadataRecord {
  return {
    kitId: String(row.kit_id),
    ownerUserId: String(row.user_id),
    name: (row.name as string | null) ?? undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    source: row.source as KitMetadataRecord["source"]
  };
}
