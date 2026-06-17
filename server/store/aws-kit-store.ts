// AwsKitStore — hosted (AWS) KitStore adapter.
//
// LAYOUT
//   Kit file trees  → S3, one object per kit:
//       s3://<S3_BUCKET>/<prefix>kits/<userId>/<kitId>/tree.json
//   Kit metadata    → DynamoDB table <DYNAMODB_KITS_TABLE>:
//       PK userId (S), SK kitId (S), plus name/createdAt/updatedAt/source.
//
// Mutating a single file (writeKitFile/deleteKitFile) does read-modify-write on
// the whole tree object — S3 has no partial object edit, and kit trees are
// small. Same path-traversal guards as the local adapter (via shared.ts).
//
// FAVORITES are VESTIGIAL: favorites moved to the Market cloud API in Phase 3
// (commit 495b435). The interface methods remain for source compatibility but
// this adapter NO-OPS them (listFavorites → []); nothing here is the source of
// truth for favorites. Do not reintroduce favorite storage here.
import { randomUUID } from "node:crypto";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { S3TreeStore } from "@/server/store/s3-tree";
import { materializeTemplateTree } from "@/server/store/template-tree";
import { assertSafeSegment, normalizeRelPath, parseKitName } from "@/server/store/shared";
import {
  type CreateKitInput,
  type FavoriteRecord,
  type KitFile,
  type KitMetadataRecord,
  type KitStore,
  type KitTree
} from "@/server/store/types";

export type AwsKitStoreConfig = {
  kitsTable: string;
  s3Bucket: string;
  s3Prefix?: string;
  region?: string;
  /**
   * Explicit AWS credentials. Needed on Amplify SSR, whose managed compute role
   * can't be granted DynamoDB/S3 access — a scoped IAM user's keys are injected
   * via FORGE_AWS_* env vars (AWS_* names are reserved by Amplify). When absent,
   * the default credential chain is used (local role / env / profile).
   */
  credentials?: { accessKeyId: string; secretAccessKey: string };
  /** Optional endpoint override (e.g. dynamodb-local / LocalStack for tests). */
  dynamoEndpoint?: string;
  s3Endpoint?: string;
  /** forcePathStyle for S3-compatible endpoints in tests. */
  s3ForcePathStyle?: boolean;
};

export class AwsKitStore implements KitStore {
  private readonly ddb: DynamoDBDocumentClient;
  private readonly trees: S3TreeStore;
  private readonly table: string;

  constructor(config: AwsKitStoreConfig, deps?: { ddb?: DynamoDBDocumentClient; s3?: S3Client }) {
    this.table = config.kitsTable;
    const region = config.region ?? "us-east-1";
    const creds = config.credentials ? { credentials: config.credentials } : {};
    this.ddb =
      deps?.ddb ??
      DynamoDBDocumentClient.from(
        new DynamoDBClient({
          region,
          ...creds,
          ...(config.dynamoEndpoint ? { endpoint: config.dynamoEndpoint } : {})
        }),
        { marshallOptions: { removeUndefinedValues: true } }
      );
    const s3 =
      deps?.s3 ??
      new S3Client({
        region,
        ...creds,
        ...(config.s3Endpoint ? { endpoint: config.s3Endpoint } : {}),
        ...(config.s3ForcePathStyle ? { forcePathStyle: true } : {})
      });
    this.trees = new S3TreeStore(s3, { bucket: config.s3Bucket, prefix: config.s3Prefix });
  }

  async createKit(userId: string, input: CreateKitInput): Promise<KitMetadataRecord> {
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
    const metadata: KitMetadataRecord = { kitId, ownerUserId: userId, name, createdAt: now, updatedAt: now, source };
    await this.ddb.send(new PutCommand({ TableName: this.table, Item: { userId, ...metadata } }));
    return metadata;
  }

  async listUserKits(userId: string): Promise<KitMetadataRecord[]> {
    assertSafeSegment(userId, "userId");
    const res = await this.ddb.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: "userId = :u",
        ExpressionAttributeValues: { ":u": userId }
      })
    );
    const records = (res.Items ?? []).map(toMetadata);
    records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return records;
  }

  async getKitMetadata(userId: string, kitId: string): Promise<KitMetadataRecord | null> {
    assertSafeSegment(userId, "userId");
    assertSafeSegment(kitId, "kitId");
    const res = await this.ddb.send(new GetCommand({ TableName: this.table, Key: { userId, kitId } }));
    return res.Item ? toMetadata(res.Item) : null;
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
    assertSafeSegment(userId, "userId");
    assertSafeSegment(kitId, "kitId");
    await this.trees.deleteTree(userId, kitId);
    await this.ddb.send(new DeleteCommand({ TableName: this.table, Key: { userId, kitId } }));
  }

  // --- favorites: vestigial (moved to Market in Phase 3) --------------------
  async addFavorite(_userId: string, favorite: FavoriteRecord): Promise<FavoriteRecord> {
    return favorite; // no-op; Market owns favorites now.
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
    await this.ddb.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { userId, kitId },
        UpdateExpression: "SET updatedAt = :now",
        ExpressionAttributeValues: { ":now": new Date().toISOString() }
      })
    );
  }
}

function toMetadata(item: Record<string, unknown>): KitMetadataRecord {
  return {
    kitId: String(item.kitId),
    ownerUserId: String(item.ownerUserId ?? item.userId),
    name: item.name as string | undefined,
    createdAt: String(item.createdAt),
    updatedAt: String(item.updatedAt),
    source: item.source as KitMetadataRecord["source"]
  };
}
