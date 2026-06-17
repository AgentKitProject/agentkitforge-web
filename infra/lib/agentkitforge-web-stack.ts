import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";

/**
 * Hosted (AWS) backing store for the agentkitforge-web `KitStore`/`UserSettingsStore`
 * AWS adapter (server/store/aws-*.ts). Provisions:
 *   - an S3 bucket for kit file trees    (S3_BUCKET)
 *   - a DynamoDB table for kit metadata  (DYNAMODB_KITS_TABLE; PK userId / SK kitId)
 *   - a DynamoDB table for user settings (DYNAMODB_SETTINGS_TABLE; PK userId)
 *
 * The web app reads these names from env when KITSTORE_BACKEND=aws. This stack
 * only creates the data stores; the Next.js app itself is hosted on Amplify
 * (separate), and its IAM principal must be granted access to these resources.
 */
export class AgentKitForgeWebStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const kitTrees = new s3.Bucket(this, "KitTreesBucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: false,
      // Retain on stack delete — kit content is user data, never auto-destroy.
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    const kitsTable = new dynamodb.Table(this, "KitsTable", {
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "kitId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    const settingsTable = new dynamodb.Table(this, "UserSettingsTable", {
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    // Env-var values for the web app (KITSTORE_BACKEND=aws).
    new cdk.CfnOutput(this, "S3Bucket", {
      value: kitTrees.bucketName,
      description: "S3_BUCKET"
    });
    new cdk.CfnOutput(this, "DynamoKitsTable", {
      value: kitsTable.tableName,
      description: "DYNAMODB_KITS_TABLE"
    });
    new cdk.CfnOutput(this, "DynamoSettingsTable", {
      value: settingsTable.tableName,
      description: "DYNAMODB_SETTINGS_TABLE"
    });
  }
}
