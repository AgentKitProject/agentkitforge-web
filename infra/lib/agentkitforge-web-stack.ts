import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";

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

    // ========================================================================
    // AgentKitAuto — hosted execution infrastructure (Phase A)
    //
    // Provisions the cloud worker plane that runs Agent Kits on Fargate:
    //   - AutoRunsTable / AutoApprovalsTable (run state + approval grants)
    //   - an ECR repo for the worker image (agentkit-auto-worker)
    //   - a dedicated public-only VPC, a locked-down egress security group,
    //     a CloudWatch log group, an ECS cluster, and a Fargate task def
    //   - IAM exec/task roles (least-privilege) and grants to the out-of-band
    //     SSR IAM user so the web app's FargateDispatcher can RunTask.
    //
    // Out-of-band resources (created elsewhere in AWS, only REFERENCED here):
    //   - the scoped SSR IAM user `agentkitforge-web-ssr`
    //   - the Gateway credit ledger tables (Accounts/Txns/Holds)
    //
    // Synth-safe VPC decision: we deliberately do NOT use ec2.Vpc.fromLookup
    // (which performs a live environment lookup needing AWS creds and would
    // break `cdk synth` in CI). Instead we provision a small DEDICATED VPC with
    // ONLY public subnets and NO NAT gateways — this synthesizes with no creds,
    // gives the worker public-subnet egress (443 over an internet gateway via
    // public IP), and satisfies the "no NAT" rule. The original "use the
    // default VPC's public subnets" intent is preserved in spirit.
    // ========================================================================

    // Configurable names/values (context-overridable, sensible defaults).
    const ssrUserName: string =
      this.node.tryGetContext("ssrUserName") ?? "agentkitforge-web-ssr";
    const gatewayCreditAccountsName: string =
      this.node.tryGetContext("gatewayCreditAccountsTable") ?? "GatewayCreditAccounts";
    const gatewayCreditTxnsName: string =
      this.node.tryGetContext("gatewayCreditTxnsTable") ?? "GatewayCreditTxns";
    const gatewayCreditHoldsName: string =
      this.node.tryGetContext("gatewayCreditHoldsTable") ?? "GatewayCreditHolds";
    const autoMarkupBps: string =
      this.node.tryGetContext("autoMarkupBps") ?? "2500";
    const autoCloudRunCentsPerMin: string =
      this.node.tryGetContext("autoCloudRunCentsPerMin") ?? "1";
    const webForgeInternalUrl: string =
      this.node.tryGetContext("webForgeInternalUrl") ??
      "https://webapp.forge.agentkitproject.com";
    // Phase-A secrets pulled from context only (never hardcoded); see note below.
    const anthropicApiKey: string | undefined =
      this.node.tryGetContext("anthropicApiKey");
    const autoWorkerServiceKey: string | undefined =
      this.node.tryGetContext("autoWorkerServiceKey");

    // ---- 1. DynamoDB tables --------------------------------------------------
    const autoRunsTable = new dynamodb.Table(this, "AutoRunsTable", {
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });
    autoRunsTable.addGlobalSecondaryIndex({
      indexName: "userId-index",
      partitionKey: { name: "gsiUserId", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });

    const autoApprovalsTable = new dynamodb.Table(this, "AutoApprovalsTable", {
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });
    autoApprovalsTable.addGlobalSecondaryIndex({
      indexName: "userKitKey-index",
      partitionKey: { name: "gsiUserKitKey", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });
    autoApprovalsTable.addGlobalSecondaryIndex({
      indexName: "userId-index",
      partitionKey: { name: "gsiUserId", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });

    // AutoSchedules (Phase B) — standing cron schedules. Key schema MUST mirror
    // auto-core's aws adapter (src/adapters/aws DynamoAutoScheduleRepository):
    //   - PK `id`.
    //   - GSI `userId-index` (PK gsiUserId)        — listSchedulesByUser.
    //   - GSI `dueIndex`     (PK gsiDue, SK nextRunAt) — listDueSchedules: a single
    //     Query on gsiDue="1" (a constant partition present only on ENABLED rows)
    //     with KeyCondition nextRunAt <= now. Disabled schedules drop out of the
    //     index (adapter omits gsiDue), so the per-minute sweep scans no extra rows.
    const autoSchedulesTable = new dynamodb.Table(this, "AutoSchedulesTable", {
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });
    autoSchedulesTable.addGlobalSecondaryIndex({
      indexName: "userId-index",
      partitionKey: { name: "gsiUserId", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });
    autoSchedulesTable.addGlobalSecondaryIndex({
      indexName: "dueIndex",
      partitionKey: { name: "gsiDue", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "nextRunAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });

    // ---- 2. ECR repository ---------------------------------------------------
    const workerRepo = new ecr.Repository(this, "AutoWorkerRepo", {
      repositoryName: "agentkit-auto-worker",
      imageScanOnPush: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });
    workerRepo.addLifecycleRule({
      description: "Expire untagged images after 14 days",
      tagStatus: ecr.TagStatus.UNTAGGED,
      maxImageAge: cdk.Duration.days(14)
    });

    // ---- 3. Networking — dedicated public-only VPC, no NAT --------------------
    // Public subnets + internet gateway only; egress 443/DNS via public IP.
    const vpc = new ec2.Vpc(this, "AutoVpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }
      ]
    });

    const sg = new ec2.SecurityGroup(this, "AutoWorkerSg", {
      vpc,
      allowAllOutbound: false,
      description: "Auto worker egress: 443 + DNS only"
    });
    sg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS egress");
    sg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.udp(53), "DNS (UDP)");
    sg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(53), "DNS (TCP)");

    // ---- 4. CloudWatch log group ---------------------------------------------
    const logGroup = new logs.LogGroup(this, "AutoWorkerLogs", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // ---- 5. ECS cluster + roles + task def -----------------------------------
    const cluster = new ecs.Cluster(this, "AutoCluster", { vpc });

    // Execution role: ECR pull + log writes (used by the awslogs driver).
    const executionRole = new iam.Role(this, "AutoTaskExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com")
    });
    executionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AmazonECSTaskExecutionRolePolicy"
      )
    );

    // Reference the out-of-band Gateway credit ledger tables (RW for the worker).
    const gatewayCreditAccounts = dynamodb.Table.fromTableName(
      this,
      "GatewayCreditAccountsTable",
      gatewayCreditAccountsName
    );
    const gatewayCreditTxns = dynamodb.Table.fromTableName(
      this,
      "GatewayCreditTxnsTable",
      gatewayCreditTxnsName
    );
    const gatewayCreditHolds = dynamodb.Table.fromTableName(
      this,
      "GatewayCreditHoldsTable",
      gatewayCreditHoldsName
    );

    // Task role: least privilege for what the worker itself touches at runtime.
    const taskRole = new iam.Role(this, "AutoTaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com")
    });
    // Run state + approvals (grants auto-include index ARNs).
    autoRunsTable.grantReadWriteData(taskRole);
    autoApprovalsTable.grantReadWriteData(taskRole);
    // Schedules (Phase B): the worker itself doesn't sweep, but the sweep runs in
    // the web app under the SSR user; the task role gets RW for parity + any future
    // worker-side schedule reads. Index ARNs are auto-included.
    autoSchedulesTable.grantReadWriteData(taskRole);
    // Gateway credit ledger — the worker debits during a run.
    gatewayCreditAccounts.grantReadWriteData(taskRole);
    gatewayCreditTxns.grantReadWriteData(taskRole);
    gatewayCreditHolds.grantReadWriteData(taskRole);
    // Kit-trees bucket: Phase A run workspaces are local-ephemeral (auto-core
    // uses os.tmpdir), so this S3 RW is for kit-tree reads + future S3-backed
    // workspaces. Whole-bucket grant matches the existing simple-grant style.
    kitTrees.grantReadWrite(taskRole);
    // Log writes: primarily the execution role (awslogs driver), task role too
    // for any direct in-container log API usage (belt-and-suspenders).
    logGroup.grantWrite(executionRole);
    logGroup.grantWrite(taskRole);
    // NOTE: deliberately NO grant on UserSettingsTable — the web app's resolve
    // endpoint reads settings, not the worker. Keep least-privilege.

    const taskDef = new ecs.FargateTaskDefinition(this, "AutoTaskDef", {
      cpu: 512,
      memoryLimitMiB: 1024,
      taskRole,
      executionRole,
      family: "agentkit-auto-worker"
    });

    // Non-secret config as plain environment.
    const containerEnv: { [key: string]: string } = {
      AUTO_RUNS_TABLE: autoRunsTable.tableName,
      AUTO_APPROVALS_TABLE: autoApprovalsTable.tableName,
      AUTO_SCHEDULES_TABLE: autoSchedulesTable.tableName,
      GATEWAY_CREDIT_ACCOUNTS_TABLE: gatewayCreditAccounts.tableName,
      GATEWAY_CREDIT_TXNS_TABLE: gatewayCreditTxns.tableName,
      GATEWAY_CREDIT_HOLDS_TABLE: gatewayCreditHolds.tableName,
      AUTO_MARKUP_BPS: autoMarkupBps,
      AUTO_CLOUD_RUN_CENTS_PER_MIN: autoCloudRunCentsPerMin,
      WEB_FORGE_INTERNAL_URL: webForgeInternalUrl,
      FORGE_AWS_REGION: this.region
    };
    // Phase A: ANTHROPIC_API_KEY (platform key) and AUTO_WORKER_SERVICE_KEY are
    // passed as plain env from CDK context for simplicity; migrate to Secrets
    // Manager / SSM SecureString (ecs.Secret.fromSsmParameter) in Phase B.
    // Values come from context only (never hardcoded); omitted if absent so
    // credless/contextless synth still works.
    if (anthropicApiKey) {
      containerEnv.ANTHROPIC_API_KEY = anthropicApiKey;
    }
    if (autoWorkerServiceKey) {
      containerEnv.AUTO_WORKER_SERVICE_KEY = autoWorkerServiceKey;
    }

    // Container name MUST stay exactly "auto-worker" — the dispatcher's
    // RunTask container override targets this name.
    taskDef.addContainer("auto-worker", {
      image: ecs.ContainerImage.fromEcrRepository(workerRepo, "latest"),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "auto-worker",
        logGroup
      }),
      environment: containerEnv
    });

    // ---- 6. Grant the out-of-band SSR IAM user -------------------------------
    // IAM users have a HARD 2048-byte INLINE policy limit. The SSR user's inline
    // policy is already near that limit (Kits/Settings/credit/S3 grants), so the
    // Auto grants are attached as a SEPARATE MANAGED policy (own 6144-byte limit)
    // rather than appended inline (which overflowed the 2048-byte cap).
    const ssrUser = iam.User.fromUserName(this, "SsrUser", ssrUserName);
    new iam.ManagedPolicy(this, "SsrAutoPolicy", {
      users: [ssrUser],
      statements: [
        // RunTask on the task def.
        new iam.PolicyStatement({
          actions: ["ecs:RunTask"],
          resources: [taskDef.taskDefinitionArn]
        }),
        // PassRole on both task roles (required to launch the task).
        new iam.PolicyStatement({
          actions: ["iam:PassRole"],
          resources: [taskRole.roleArn, executionRole.roleArn]
        }),
        // The web app reads/writes runs + approvals (incl. GSIs).
        new iam.PolicyStatement({
          actions: [
            "dynamodb:BatchGetItem",
            "dynamodb:GetItem",
            "dynamodb:Query",
            "dynamodb:Scan",
            "dynamodb:ConditionCheckItem",
            "dynamodb:BatchWriteItem",
            "dynamodb:PutItem",
            "dynamodb:UpdateItem",
            "dynamodb:DeleteItem",
            "dynamodb:DescribeTable"
          ],
          resources: [
            autoRunsTable.tableArn,
            `${autoRunsTable.tableArn}/index/*`,
            autoApprovalsTable.tableArn,
            `${autoApprovalsTable.tableArn}/index/*`,
            // Phase B: the SSR app does schedule CRUD + the per-minute sweep
            // (listDueSchedules over dueIndex), so it needs RW on the table + GSIs.
            autoSchedulesTable.tableArn,
            `${autoSchedulesTable.tableArn}/index/*`
          ]
        })
      ]
    });

    // ---- 6b. Per-minute schedule-sweep trigger (Phase B) ---------------------
    // An EventBridge rule fires every minute and invokes a tiny Lambda that does a
    // single HTTPS POST to the web app's internal sweep endpoint with the shared
    // service key. The web app (SSR) then runs auto-core's runDueSchedules, which
    // selects + dispatches due schedules onto Fargate. The Lambda is intentionally
    // dependency-free (Node 20 global fetch), needs only outbound internet (the
    // default Lambda networking) + CloudWatch logs, and carries the URL + key in
    // its env from CDK context — the SAME context-secret pattern the task def uses
    // for anthropicApiKey / autoWorkerServiceKey (never hardcoded).
    //
    // COST: a 1-minute schedule is ~43,800 invocations/month of a sub-second, 128MB
    // function — trivially within free tier / a few cents/month.
    const sweepLogGroup = new logs.LogGroup(this, "AutoScheduleSweepLogs", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });
    const sweepLambda = new lambda.Function(this, "AutoScheduleSweepFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
      logGroup: sweepLogGroup,
      environment: {
        WEB_FORGE_INTERNAL_URL: webForgeInternalUrl,
        // AUTO_WORKER_SERVICE_KEY: same shared internal trust-boundary key the
        // resolve-context + sweep endpoints verify. Sourced from CDK context only
        // (never hardcoded); empty string when contextless so synth still works —
        // the endpoint then returns 401 until the real key is provisioned.
        AUTO_WORKER_SERVICE_KEY: autoWorkerServiceKey ?? ""
      },
      code: lambda.Code.fromInline(
        [
          "exports.handler = async () => {",
          "  const base = process.env.WEB_FORGE_INTERNAL_URL;",
          "  const key = process.env.AUTO_WORKER_SERVICE_KEY;",
          "  if (!base || !key) {",
          "    console.error('sweep: missing WEB_FORGE_INTERNAL_URL or service key');",
          "    return { ok: false, reason: 'unconfigured' };",
          "  }",
          "  const url = base.replace(/\\/$/, '') + '/api/internal/auto/sweep';",
          "  const res = await fetch(url, {",
          "    method: 'POST',",
          "    headers: { 'x-service-key': key, 'content-type': 'application/json' },",
          "    body: '{}'",
          "  });",
          "  const text = await res.text().catch(() => '');",
          // Never log the service key; log only status + a short body snippet.
          "  console.info('sweep status=' + res.status + ' body=' + text.slice(0, 200));",
          "  if (!res.ok) throw new Error('sweep failed: HTTP ' + res.status);",
          "  return { ok: true, status: res.status };",
          "};"
        ].join("\n")
      )
    });

    const sweepRule = new events.Rule(this, "AutoScheduleSweepRule", {
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      description: "Per-minute AgentKitAuto schedule sweep trigger (Phase B)"
    });
    sweepRule.addTarget(new targets.LambdaFunction(sweepLambda));

    // ---- 7. CfnOutputs -------------------------------------------------------
    new cdk.CfnOutput(this, "AutoRunsTableOut", {
      value: autoRunsTable.tableName,
      description: "AUTO_RUNS_TABLE"
    });
    new cdk.CfnOutput(this, "AutoApprovalsTableOut", {
      value: autoApprovalsTable.tableName,
      description: "AUTO_APPROVALS_TABLE"
    });
    new cdk.CfnOutput(this, "AutoSchedulesTableOut", {
      value: autoSchedulesTable.tableName,
      description: "AUTO_SCHEDULES_TABLE"
    });
    new cdk.CfnOutput(this, "AutoScheduleSweepRuleOut", {
      value: sweepRule.ruleName,
      description: "AUTO_SCHEDULE_SWEEP_RULE"
    });
    new cdk.CfnOutput(this, "AutoScheduleSweepFnOut", {
      value: sweepLambda.functionName,
      description: "AUTO_SCHEDULE_SWEEP_FUNCTION"
    });
    new cdk.CfnOutput(this, "AutoEcsCluster", {
      value: cluster.clusterName,
      description: "AUTO_ECS_CLUSTER"
    });
    new cdk.CfnOutput(this, "AutoEcsTaskDef", {
      value: taskDef.family,
      description: "AUTO_ECS_TASK_DEF"
    });
    new cdk.CfnOutput(this, "AutoEcsSubnetIds", {
      value: cdk.Fn.join(
        ",",
        vpc.selectSubnets({ subnetType: ec2.SubnetType.PUBLIC }).subnetIds
      ),
      description: "AUTO_ECS_SUBNET_IDS"
    });
    new cdk.CfnOutput(this, "AutoEcsSecurityGroupId", {
      value: sg.securityGroupId,
      description: "AUTO_ECS_SECURITY_GROUP_ID"
    });
    new cdk.CfnOutput(this, "AutoWorkerRepoUri", {
      value: workerRepo.repositoryUri,
      description: "AUTO_WORKER_ECR_REPO_URI"
    });
  }
}
