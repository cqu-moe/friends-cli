#!/usr/bin/env node
import {courseReviewSchemas, registerCourseReviewCommands} from "./course-reviews.js";
import {volunteerActivityReviewSchemas,registerVolunteerActivityReviewCommands} from "./volunteer-activity-reviews.js";
import { certificationApiSchemas, registerCertificationApiCommands } from "./certification-api.js";
import { Command } from "commander";
import { organizationActivityReviewSchemas, registerOrganizationActivityReviewCommands } from "./organization-activity-reviews.js";
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
import {
  openAuthorizationUrl,
  recoverCquFriendsSession,
  saveCquAuthGrant,
  startCquAuthLoopback,
} from "../auth-node.js";
import { createCquAuthClient } from "../auth.js";
import { resolveQuerySession } from "./session.js";
import { draftSchemas, registerDraftCommands } from "./drafts.js";
import { organizationSchemas, registerOrganizationCommands } from "./organizations.js";
import { registerVolunteerReviewCommands, volunteerReviewSchemas } from "./volunteer-reviews.js";
import { offeringSchemas, registerOfferingCommands } from "./offerings.js";

import {organizationParticipationSchemas,registerOrganizationParticipationCommands} from "./organization-participation.js";

const productionBaseUrl = "https://friends.cqu.edu.cn/gateway";
const schemas = {
  ...organizationParticipationSchemas,
  ...courseReviewSchemas,
  ...offeringSchemas,
  ...volunteerActivityReviewSchemas,
  ...certificationApiSchemas,
  ...draftSchemas,
  ...organizationSchemas,
  ...organizationActivityReviewSchemas,
  ...volunteerReviewSchemas,
  errors: {
    operation: "errors", readonly:true, permission:"none", phases:["inspect"], supportedVia:["local"],
    exitCodes: {0:"success", 2:"INVALID_INPUT", 3:"AUTH_REQUIRED", 4:"PERMISSION_DENIED", 5:"BUSINESS_REJECTED", 6:"NETWORK_PROTOCOL_ERROR", 7:"UNKNOWN_OUTCOME"},
  },
  "auth.login": {
    operation: "auth.login",
    permission: "school login and an available identity", phases: ["login"],
    input: {
      method: { type: "local or cqu-auth", required: true },
      egoTaskSpace: { type: "integer", default: "managed friends-cli space; explicit integer reuses an existing space" },
      egoPage: { type: "string", default: "p1" },
      issuer: { type: "URL or CQU_AUTH_ISSUER; required for cqu-auth" },
      clientId: { type: "public client ID or CQU_AUTH_CLIENT_ID; required for cqu-auth" },
      noOpen: { type: "boolean; prints only the authorization URL for manual opening" },
      storage: { type: "keyring or explicit file", default: "keyring", fileSupport: "POSIX only: dedicated 0700 directory and 0600 file" },
      levelNo: { type: "string", required: "only when multiple contexts match" },
      unitNo: { type: "string", required: "only when multiple contexts match" },
    },
    output: "authorization event when --no-open is used, then account and selected context; never code, state, verifier, key, or token",
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
    `${JSON.stringify({ schemaVersion: 1, ok: true, data, meta })}\n`,
  );
}

function invalid(message: string): never {
  throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message });
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

async function createQueryCourseClient(
  source: { session: { loginMethod?: "local" | "cqu-auth"; token: string; userLevel: string; account: { userNo: string }; context: { levelNo: string; unit: { unitNo: string } } }; entry: "api" | "ego" },
  baseUrl: string,
) {
  const sdkInstance = createFriendsSdk({ baseUrl });
  try {
    return await sdkInstance.createCourseClient(source.session);
  } catch (error) {
    if (
      source.entry !== "api" ||
      source.session.loginMethod !== "cqu-auth" ||
      !(error instanceof FriendsError) ||
      error.code !== FriendsErrorCode.AuthRequired
    ) {
      throw error;
    }
    const recovered = await recoverCquFriendsSession({ friendsBaseUrl: baseUrl });
    return sdkInstance.createCourseClient(recovered);
  }
}


const program = new Command()
  .name("friends")
  .description("Query courses and manage local volunteer certification drafts and student organizations")
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
  .description("Log in through the existing Ego page or CQU Auth and verify the school context")
  .requiredOption("--method <method>", "login source", "local")
  .option(
    "--storage <type>",
    "session storage backend",
    process.env.FRIENDS_STORAGE ?? "keyring",
  )
  .option("--ego-task-space <number>", "reuse an existing Ego task space by numeric ID")
  .option("--ego-page <label>", "existing Ego page label (default p1)")
  .option("--issuer <url>", "CQU Auth issuer URL")
  .option("--client-id <id>", "CQU Auth public client ID")
  .option("--no-open", "print the authorization URL without opening a browser")
  .option("--level-no <value>", "select a level when multiple contexts match")
  .option("--unit-no <value>", "select an identity unit when multiple contexts match")
  .option("--json", "print stable JSON", true)
  .action(async (options: Record<string, string>) => {
    if (options.storage !== "keyring" && options.storage !== "file") {
      invalid("--storage must be keyring or file");
    }
    if (options.method === "cqu-auth") {
      const egoOptions = ["egoTaskSpace", "egoPage"].filter(key => options[key] !== undefined);
      if (egoOptions.length > 0) invalid(`Ego options require --method local: ${egoOptions.join(", ")}`);
      const issuer = options.issuer ?? process.env.CQU_AUTH_ISSUER;
      const clientId = options.clientId ?? process.env.CQU_AUTH_CLIENT_ID;
      if (issuer === undefined || issuer === "") invalid("cqu-auth requires --issuer or CQU_AUTH_ISSUER");
      if (clientId === undefined || clientId === "") invalid("cqu-auth requires --client-id or CQU_AUTH_CLIENT_ID");
      if ((options.levelNo === undefined) !== (options.unitNo === undefined)) {
        invalid("A multi-account CQU Auth login requires both --level-no and --unit-no");
      }
      const selector = options.levelNo === undefined
        ? undefined
        : { levelNo: options.levelNo, unitNo: options.unitNo };
      const loopback = await startCquAuthLoopback({
        issuer,
        clientId,
        friendsBaseUrl: process.env.FRIENDS_BASE_URL ?? productionBaseUrl,
      });
      try {
        if ((options as Record<string, unknown>).open === false) {
          output({ authorizationUrl: loopback.authorizationUrl }, {
            operation: "auth.login",
            phase: "authorization",
            via: "cqu-auth",
          });
        } else {
          await openAuthorizationUrl(loopback.authorizationUrl, {
            command: process.env.FRIENDS_BROWSER,
          });
        }
        const grant = await loopback.completeAuthorization();
        const auth = createCquAuthClient({
          issuer,
          clientId,
          redirectUri: loopback.redirectUri,
          friendsBaseUrl: process.env.FRIENDS_BASE_URL ?? productionBaseUrl,
        });
        const activated = await auth.createGrantManager({
          credentials: grant.credentials,
          keyPair: grant.keyPair,
        }).exchangeFriendsSession(selector);
        const authPath = await saveCquAuthGrant(grant, { issuer, clientId, storage: options.storage });
        const storedSession = {
          schemaVersion: 1 as const,
          loginMethod: "cqu-auth" as const,
          storage: options.storage as SessionStorageType,
          token: activated.token,
          userLevel: activated.context.levelNo,
          account: activated.account,
          context: activated.context,
        };
        const sessionPathValue = await saveSession(storedSession, options.storage);
        output(
          {
            loginMethod: "cqu-auth",
            account: activated.account,
            context: activated.context,
            storage: { type: options.storage, authPath, sessionPath: sessionPathValue },
          },
          {
            operation: "auth.login",
            via: "cqu-auth+school-api-verification",
            verification: { identityAndContext: "school-api-verified" },
          },
        );
      } finally {
        await loopback.close().catch(() => undefined);
      }
      return;
    }
    if (options.method !== "local") invalid("--method must be local or cqu-auth");
    const cquOptions = ["issuer", "clientId"].filter(key => options[key] !== undefined);
    if ((options as Record<string, unknown>).open === false || cquOptions.length > 0) {
      invalid(`CQU Auth options require --method cqu-auth: ${["no-open", ...cquOptions].join(", ")}`);
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
    const client = await createQueryCourseClient(source, process.env.FRIENDS_BASE_URL ?? productionBaseUrl);
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
    const client = await createQueryCourseClient(source, process.env.FRIENDS_BASE_URL ?? productionBaseUrl);
    output(await client.get(id), {
      operation: "courses.get",
      ...queryMeta(source),
    });
  });

registerOrganizationParticipationCommands(program,{baseUrl:process.env.FRIENDS_BASE_URL??productionBaseUrl});
registerOrganizationActivityReviewCommands(program, { baseUrl: process.env.FRIENDS_BASE_URL ?? productionBaseUrl });


registerCourseReviewCommands(program, {baseUrl:process.env.FRIENDS_BASE_URL ?? productionBaseUrl});
registerVolunteerActivityReviewCommands(program, {baseUrl:process.env.FRIENDS_BASE_URL ?? productionBaseUrl});
registerCertificationApiCommands(program, {baseUrl:process.env.FRIENDS_BASE_URL ?? productionBaseUrl});

registerOfferingCommands(program, { baseUrl: process.env.FRIENDS_BASE_URL ?? productionBaseUrl });

registerDraftCommands(program, {
  baseUrl: process.env.FRIENDS_BASE_URL ?? productionBaseUrl,
});

registerOrganizationCommands(program, {
  baseUrl: process.env.FRIENDS_BASE_URL ?? productionBaseUrl,
});

registerVolunteerReviewCommands(program, {
  baseUrl: process.env.FRIENDS_BASE_URL ?? productionBaseUrl,
});

program.parseAsync(process.argv).catch(async (error: unknown) => {
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
      ? `friends auth login --method ${await loadSession().then(session => session.loginMethod).catch(() => "local")}`
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
    )}\n`,
  );
  process.stderr.write(`${friendsError.message}\n`);
  process.exitCode = exitCodeFor(friendsError.code);
});
