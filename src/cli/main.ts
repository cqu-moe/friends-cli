#!/usr/bin/env node
import { certificationApiSchemas, registerCertificationApiCommands } from "./certification-api.js";
import { Command } from "commander";
import {
  courseId,
  validateCourseListInput,
  createFriendsSdk,
  exitCodeFor,
  FriendsError,
  FriendsErrorCode,
} from "../index.js";
import {
  loadSession,
  readEgoSession,
  saveSession,
  sessionPath,
  SessionStorageType,
} from "../node.js";
import { resolveQuerySession } from "./session.js";
import { draftSchemas, registerDraftCommands } from "./drafts.js";

const productionBaseUrl = "https://friends.cqu.edu.cn/gateway";
const schemas = {
  ...certificationApiSchemas,
  ...draftSchemas,
  errors: {
    operation: "errors", readonly:true, permission:"none", phases:["inspect"], supportedVia:["local"],
    exitCodes: {0:"success", 2:"INVALID_INPUT", 3:"AUTH_REQUIRED", 4:"PERMISSION_DENIED", 5:"BUSINESS_REJECTED", 6:"NETWORK_PROTOCOL_ERROR", 7:"UNKNOWN_OUTCOME"},
  },
  "auth.login": {
    operation: "auth.login",
    permission: "school login and an available identity", phases: ["login"],
    input: {
      method: { type: "local", required: true },
      egoTaskSpace: { type: "integer", default: "managed friends-cli space; explicit integer reuses an existing space" },
      egoPage: { type: "string", default: "p1" },
      storage: { type: "keyring or explicit file", default: "keyring", fileSupport: "POSIX only: dedicated 0700 directory and 0600 file" },
      levelNo: { type: "string", required: "only when multiple contexts match" },
      unitNo: { type: "string", required: "only when multiple contexts match" },
    },
    output: "account and selected context; never token",
    readonly: false,
    sideEffect: "establishes a local session and fixed friends context",
    supportedVia: ["ego-login", "api-verification"],
    verifiedWith: "controlled-api; live-read-only-evidence",
  },
  "auth.status": {
    operation: "auth.status",
    permission: "valid local school session", phases: ["inspect"],
    input: {},
    output: "redacted account, context, and storage state",
    readonly: true,
    supportedVia: ["api"],
    verifiedWith: "controlled-api",
  },
  "courses.list": {
    operation: "courses.list",
    permission: "school-verified identity; upstream enforces course access", phases: ["query"],
    input: {
      via: { type: "api or ego", default: "api", egoTaskSpace: "required integer; reuses an existing Ego task space" },
      egoPage: { type: "string", default: "p1" },
      levelNo: { type: "string", required: "only when multiple Ego contexts match" },
      unitNo: { type: "string", required: "only when multiple Ego contexts match" },
      page: { type: "integer", minimum: 1, default: 1 },
      pageSize: { type: "integer", minimum: 1, default: 10 },
      keyword: {
        type: "string",
        upstreamField: "key",
        evidence: "live UI and read-only replay",
      },
    },
    output: "one page of necessary course projections",
    readonly: true,
    supportedVia: ["api", "ego"],
    requestMode: "direct-api",
    verifiedWith: "controlled-api; controlled-ego; live-read-only-evidence",
  },
  "courses.get": {
    operation: "courses.get",
    permission: "school-verified identity; upstream enforces course access", phases: ["query"],
    input: {
      via: { type: "api or ego", default: "api", egoTaskSpace: "required integer; reuses an existing Ego task space" },
      egoPage: { type: "string", default: "p1" },
      levelNo: { type: "string", required: "only when multiple Ego contexts match" },
      unitNo: { type: "string", required: "only when multiple Ego contexts match" },
      courseId: { type: "course UUID", required: true },
    },
    output: "necessary public course detail projection",
    readonly: true,
    supportedVia: ["api", "ego"],
    requestMode: "direct-api",
    verifiedWith: "controlled-api; controlled-ego; live-read-only-evidence",
  },
} as const;

function output(data: unknown, meta: Record<string, unknown> = {}): void {
  process.stdout.write(
    `${JSON.stringify({ schemaVersion: 1, ok: true, data, meta }, null, 2)}\n`,
  );
}

function sdk() {
  return createFriendsSdk({
    baseUrl: process.env.FRIENDS_BASE_URL ?? productionBaseUrl,
  });
}

function queryMeta(source: {
  entry: "api" | "ego";
  session: { account: unknown; context: unknown };
}) {
  return {
    via: source.entry === "ego" ? "ego-selected+direct-api" : "api",
    selectedEntry: source.entry,
    requestMode: "direct-api",
    verification: {
      identityAndContext: source.entry === "ego" ? "school-api-verified" : "school-api-reverified",
      account: source.session.account,
      context: source.session.context,
      queryContract: "live-read-only-evidence+controlled-api",
    },
  };
}


const program = new Command()
  .name("friends")
  .description("Query courses and manage local volunteer certification drafts")
  .version("0.1.0")
  .configureOutput({
    writeOut: (text) => process.stdout.write(text),
    writeErr: (text) => process.stderr.write(text),
  })
  .exitOverride();

program
  .command("schema")
  .description("Print a command contract")
  .argument("<operation>", "operation name")
  .option("--json", "print stable JSON", true)
  .action((operation: string) => {
    const schema = Object.hasOwn(schemas, operation) ? Reflect.get(schemas, operation) : undefined;
    if (!schema) {
      throw new FriendsError({
        code: FriendsErrorCode.InvalidInput,
        message: `Unknown schema operation: ${operation}`,
      });
    }
    output(schema, { operation: "schema" });
  });

const auth = program.command("auth").description("Local session management");

auth
  .command("login")
  .description("Log in through the existing Ego page and verify the school context")
  .requiredOption("--method <method>", "login source", "local")
  .option(
    "--storage <type>",
    "session storage backend",
    process.env.FRIENDS_STORAGE ?? "keyring",
  )
  .option("--ego-task-space <number>", "reuse an existing Ego task space by numeric ID")
  .option("--ego-page <label>", "existing Ego page label (default p1)")
  .option("--level-no <value>", "select a level when multiple contexts match")
  .option("--unit-no <value>", "select an identity unit when multiple contexts match")
  .option("--json", "print stable JSON", true)
  .action(async (options: Record<string, string>) => {
    if (options.method !== "local") {
      throw new FriendsError({
        code: FriendsErrorCode.InvalidInput,
        message: "Only --method local is implemented in this task",
      });
    }
    if (options.storage !== "keyring" && options.storage !== "file") {
      throw new FriendsError({
        code: FriendsErrorCode.InvalidInput,
        message: "--storage must be keyring or file",
      });
    }
    const taskSpaceId = options.egoTaskSpace === undefined
      ? undefined
      : Number(options.egoTaskSpace);
    if (taskSpaceId !== undefined && (!Number.isInteger(taskSpaceId) || taskSpaceId < 1)) {
      throw new FriendsError({
        code: FriendsErrorCode.InvalidInput,
        message: "--ego-task-space must be a positive integer",
      });
    }
    const browserSession = await readEgoSession({
      taskSpaceId,
      page: options.egoPage,
    });
    const activated = await sdk().activateLocalContext({
      token: browserSession.token,
      userLevel: browserSession.userLevel,
      selector:
        options.levelNo === undefined && options.unitNo === undefined
          ? undefined
          : { levelNo: options.levelNo, unitNo: options.unitNo },
    });
    const storedSession = {
      schemaVersion: 1 as const,
      loginMethod: "local" as const,
      storage: options.storage as SessionStorageType,
      token: browserSession.token,
      userLevel: activated.context.levelNo,
      account: activated.account,
      context: activated.context,
    };
    const path = await saveSession(storedSession, options.storage);
    output(
      {
        loginMethod: "local",
        account: activated.account,
        context: activated.context,
        storage: { type: options.storage, path },
      },
      {
        operation: "auth.login",
        via: "ego-login+api-verification",
        verification: { identityAndContext: "school-api-verified" },
      },
    );
  });

auth
  .command("status")
  .description("Reverify the stored account and fixed context through the school API")
  .option("--json", "print stable JSON", true)
  .action(async () => {
    const session = await loadSession();
    const inspection = await sdk().verifyLocalSession(session);
    output(
      {
        loginMethod: session.loginMethod,
        account: inspection.account,
        context: session.context,
        storage: { type: session.storage, path: sessionPath() },
      },
      {
        operation: "auth.status",
        via: "api",
        verification: { identityAndContext: "school-api-reverified" },
      },
    );
  });

const courses = program.command("courses").description("Course queries");

courses
  .command("list")
  .description("List one page of courses")
  .option("--page <number>", "result page", "1")
  .option("--page-size <number>", "results per page", "10")
  .option("--keyword <value>", "course name or organizer keyword")
  .option("--via <source>", "query execution path", "api")
  .option("--ego-task-space <number>", "existing Ego task space required by --via ego")
  .option("--ego-page <label>", "existing Ego page label (default p1)")
  .option("--level-no <value>", "select an Ego level when multiple contexts match")
  .option("--unit-no <value>", "select an Ego identity unit when multiple contexts match")
  .option("--json", "print stable JSON", true)
  .action(async (options: Record<string, string>) => {
    const query = validateCourseListInput({page:Number(options.page), pageSize:Number(options.pageSize), keyword:options.keyword});
    const source = await resolveQuerySession(options, process.env.FRIENDS_BASE_URL ?? productionBaseUrl);
    const client = await sdk().createCourseClient(source.session);
    const data = await client.list(query);
    output(data, {
      operation: "courses.list",
      ...queryMeta(source),
    });
  });

courses
  .command("show")
  .description("Show one course by course UUID")
  .argument("<courseId>", "course UUID, not an application or certification UUID")
  .option("--via <source>", "query execution path", "api")
  .option("--ego-task-space <number>", "existing Ego task space required by --via ego")
  .option("--ego-page <label>", "existing Ego page label (default p1)")
  .option("--level-no <value>", "select an Ego level when multiple contexts match")
  .option("--unit-no <value>", "select an Ego identity unit when multiple contexts match")
  .option("--json", "print stable JSON", true)
  .action(async (courseIdValue: string, options: Record<string, string>) => {
    const id = courseId(courseIdValue);
    const source = await resolveQuerySession(options, process.env.FRIENDS_BASE_URL ?? productionBaseUrl);
    const client = await sdk().createCourseClient(source.session);
    output(await client.get(id), {
      operation: "courses.get",
      ...queryMeta(source),
    });
  });

registerCertificationApiCommands(program, {baseUrl:process.env.FRIENDS_BASE_URL ?? productionBaseUrl});

registerDraftCommands(program, {
  baseUrl: process.env.FRIENDS_BASE_URL ?? productionBaseUrl,
});

program.parseAsync(process.argv).catch((error: unknown) => {
  const code = (error as { code?: string }).code;
  if (
    code === "commander.help" ||
    code === "commander.helpDisplayed" ||
    code === "commander.version"
  ) {
    return;
  }
  const friendsError =
    error instanceof FriendsError
      ? error
      : new FriendsError({
          code: code?.startsWith("commander.") ? FriendsErrorCode.InvalidInput : FriendsErrorCode.NetworkProtocol,
          message: code?.startsWith("commander.") && error instanceof Error ? error.message : "The local operation failed",
        });
  const nextAction =
    friendsError.code === FriendsErrorCode.AuthRequired
      ? "friends auth login --method local"
      : undefined;
  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        ok: false,
        error: {
          code: friendsError.code,
          message: friendsError.message,
          retryable: friendsError.retryable,
          upstreamCode: friendsError.upstreamCode,
          requestId: friendsError.requestId,
          recovery: friendsError.recovery,
          nextAction,
        },
      },
      null,
      2,
    )}\n`,
  );
  process.stderr.write(`${friendsError.message}\n`);
  process.exitCode = exitCodeFor(friendsError.code);
});
