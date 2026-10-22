import type { Command } from "commander";
import {
  createVolunteerCertificationReviewClient,
  createVolunteerHoursClient,
  FriendsError,
  FriendsErrorCode,
  type VerifiedVolunteerSession,
} from "../index.js";
import { prepareVolunteerCertificationReviewInEgo } from "../node.js";
import { resolveQuerySession } from "./session.js";

type SessionSource = Awaited<ReturnType<typeof resolveQuerySession>>;

export const volunteerReviewSchemas = {
  "volunteer-hours.list": {
    operation: "volunteer-hours.list",
    permission: "authenticated volunteer; school API enforces access",
    phases: ["query"],
    input: {
      via: { type: "api or ego", default: "api" },
      egoTaskSpace: { type: "integer", required: "with --via ego" },
      egoPage: { type: "string", default: "p1" },
      page: { type: "integer", minimum: 1, default: 1 },
      pageSize: { type: "integer", minimum: 1, default: 10 },
      keyword: { type: "string", upstreamField: "key" },
    },
    output: "one page of recognized transcript summaries",
    readonly: true,
    supportedVia: ["api", "ego"],
    requestMode: "direct-api",
    verifiedWith: "public-source; controlled-sdk; controlled-cli",
  },
  "volunteer-hours.show": {
    operation: "volunteer-hours.show",
    permission: "authenticated volunteer; school API enforces access",
    phases: ["query"],
    input: {
      via: { type: "api or ego", default: "api" },
      egoTaskSpace: { type: "integer", required: "with --via ego" },
      egoPage: { type: "string", default: "p1" },
      transcriptId: { type: "transcript UUID", required: true },
    },
    output: "recognized transcript totals and item projections in hours",
    readonly: true,
    supportedVia: ["api", "ego"],
    requestMode: "direct-api",
    verifiedWith: "public-source; controlled-sdk; controlled-cli",
  },
  "volunteer-certification-reviews.list": {
    operation: "volunteer-certification-reviews.list",
    permission: "a real school certification review role; upstream enforces access",
    phases: ["query"],
    input: {
      via: { type: "api or ego", default: "api" },
      egoTaskSpace: { type: "integer", required: "with --via ego" },
      egoPage: { type: "string", default: "p1" },
      page: { type: "integer", minimum: 1, default: 1 },
      pageSize: { type: "integer", minimum: 1, default: 10 },
      keyword: { type: "string", upstreamField: "key" },
    },
    output: "one page of certification review summaries with raw states",
    readonly: true,
    supportedVia: ["api", "ego"],
    requestMode: "direct-api",
    verifiedWith: "public-source; controlled-sdk; controlled-cli",
  },
  "volunteer-certification-reviews.show": {
    operation: "volunteer-certification-reviews.show",
    permission: "a real school certification review role; upstream enforces access",
    phases: ["query"],
    input: {
      via: { type: "api or ego", default: "api" },
      egoTaskSpace: { type: "integer", required: "with --via ego" },
      egoPage: { type: "string", default: "p1" },
      reviewId: { type: "certification application UUID", required: true },
    },
    output: "certification review detail, roster, raw state, and school-derived role",
    readonly: true,
    supportedVia: ["api", "ego"],
    requestMode: "direct-api",
    verifiedWith: "public-source; controlled-sdk; controlled-cli",
  },
  "volunteer-certification-reviews.decide": {
    operation: "volunteer-certification-reviews.decide",
    permission: "a real school certification review role; upstream enforces access",
    phases: ["validate", "decide", "readback"],
    input: {
      reviewId: { type: "certification application UUID", required: true },
      via: { type: "api", required: true },
      decision: { type: "pass or back; refuse is not a visible school action", required: true },
      message: { type: "string", maximumLength: 100, required: true },
      time: { type: "YYYY-MM-DD", required: true },
      callbackActivityId: { type: "school callback node ID; required when multiple nodes exist" },
      confirm: { type: "boolean; required unless dry-run" },
      dryRun: { type: "boolean; performs validation with zero remote writes" },
    },
    output: "acknowledgement and one read-only readback; unavailable readback is reported separately",
    readonly: false,
    remoteReadonly: false,
    confirmation: "requires independent --via api and --confirm or --dry-run",
    sideEffect: "one confirmed PASS or BACK request followed by one read-only detail request; never retries the write",
    supportedVia: ["api"],
    submittedViaEgo: "never",
    unknownOutcome: "exit 7; inspect the application before another decision",
    verifiedWith: "public-source; controlled-sdk; controlled-cli",
  },
  "volunteer-certification-reviews.prepare": {
    operation: "volunteer-certification-reviews.prepare",
    permission: "a real school certification review role; upstream enforces access",
    phases: ["visible-prepare"],
    input: {
      reviewId: { type: "certification application UUID", required: true },
      via: { type: "ego", required: true },
      egoTaskSpace: { type: "integer", required: true },
      egoPage: { type: "string", default: "p1" },
      decision: { type: "pass or back", required: true },
      message: { type: "string", maximumLength: 100, required: true },
      allowBlankNavigation: { type: "boolean; only an explicitly selected about:blank page may navigate" },
    },
    output: "an open review dialog handed to the user; submitted is always false",
    readonly: false,
    remoteReadonly: true,
    sideEffect: "opens the visible PASS or BACK dialog and fills the review message; final confirmation is user-only",
    supportedVia: ["ego"],
    requestMode: "visible-ego-prepare",
    submittedViaEgo: "prepare-only",
    verifiedWith: "public-source; controlled-cli",
  },
} as const;

function invalid(message: string): never {
  throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message });
}

function output(data: unknown, meta: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: true, data, meta })}\n`);
}

function positiveInteger(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) invalid(`--${name} must be a positive integer`);
  return parsed;
}

function decisionValue(value: string | boolean | undefined): "pass" | "back" {
  if (value !== "pass" && value !== "back") invalid("--decision must be pass or back");
  return value;
}

function requiredText(value: string | boolean | undefined, name: string): string {
  if (typeof value !== "string" || value === "") invalid(`--${name} is required`);
  return value;
}

function volunteerSession(source: SessionSource): VerifiedVolunteerSession {
  return {
    token: source.session.token,
    userLevel: source.session.userLevel,
    accountUserNo: source.session.account.userNo,
    levelNo: source.session.context.levelNo,
    unitNo: source.session.context.unit.unitNo,
  };
}

function directApiMeta(operation: string, entry: "api" | "ego") {
  return {
    operation,
    via: entry,
    selectedEntry: entry,
    requestMode: "direct-api",
    verification: { volunteerReviewContract: "public-source+controlled-api" },
  };
}

function queryOptions(command: Command): Command {
  return command
    .option("--via <source>", "session source for a direct API query", "api")
    .option("--ego-task-space <number>", "existing Ego task space required by --via ego")
    .option("--ego-page <label>", "existing school page (default p1)")
    .option("--level-no <value>", "select an available school role")
    .option("--unit-no <value>", "select an available identity unit");
}

export function registerVolunteerReviewCommands(program: Command, options: { baseUrl: string }): void {
  const hours = program
    .command("volunteer-hours")
    .description("query authenticated volunteer hours and recognized transcript records");

  queryOptions(hours.command("list"))
    .description("List one page of recognized volunteer transcripts")
    .option("--page <number>", "result page", "1")
    .option("--page-size <number>", "results per page", "10")
    .option("--keyword <value>", "activity keyword")
    .option("--json", "print stable JSON", true)
    .action(async (commandOptions: Record<string, string | undefined>) => {
      const source = await resolveQuerySession(commandOptions, options.baseUrl);
      const data = await createVolunteerHoursClient({
        baseUrl: options.baseUrl,
        session: volunteerSession(source),
      }).list({
        page: positiveInteger(commandOptions.page, "page"),
        pageSize: positiveInteger(commandOptions.pageSize, "page-size"),
        keyword: commandOptions.keyword,
      });
      output(data, directApiMeta("volunteer-hours.list", source.entry));
    });

  queryOptions(hours.command("show"))
    .description("Show one recognized volunteer transcript")
    .argument("<transcriptId>", "transcript UUID")
    .option("--json", "print stable JSON", true)
    .action(async (transcriptId: string, commandOptions: Record<string, string | undefined>) => {
      const source = await resolveQuerySession(commandOptions, options.baseUrl);
      const data = await createVolunteerHoursClient({
        baseUrl: options.baseUrl,
        session: volunteerSession(source),
      }).get(transcriptId);
      output(data, directApiMeta("volunteer-hours.show", source.entry));
    });

  const reviews = program
    .command("volunteer-certification-reviews")
    .description("query and review school volunteer certification applications");

  queryOptions(reviews.command("list"))
    .description("List one page of certification reviews for the real school role")
    .option("--page <number>", "result page", "1")
    .option("--page-size <number>", "results per page", "10")
    .option("--keyword <value>", "activity keyword")
    .option("--json", "print stable JSON", true)
    .action(async (commandOptions: Record<string, string | undefined>) => {
      const source = await resolveQuerySession(commandOptions, options.baseUrl);
      const data = await createVolunteerCertificationReviewClient({
        baseUrl: options.baseUrl,
        session: volunteerSession(source),
      }).list({
        page: positiveInteger(commandOptions.page, "page"),
        pageSize: positiveInteger(commandOptions.pageSize, "page-size"),
        keyword: commandOptions.keyword,
      });
      output(data, directApiMeta("volunteer-certification-reviews.list", source.entry));
    });

  queryOptions(reviews.command("show"))
    .description("Show one certification review detail")
    .argument("<reviewId>", "certification application UUID")
    .option("--json", "print stable JSON", true)
    .action(async (reviewId: string, commandOptions: Record<string, string | undefined>) => {
      const source = await resolveQuerySession(commandOptions, options.baseUrl);
      const data = await createVolunteerCertificationReviewClient({
        baseUrl: options.baseUrl,
        session: volunteerSession(source),
      }).get(reviewId);
      output(data, directApiMeta("volunteer-certification-reviews.show", source.entry));
    });

  reviews.command("decide")
    .description("Confirm one PASS or BACK API decision and read it back once")
    .argument("<reviewId>", "certification application UUID")
    .requiredOption("--via <source>", "independent API write intent")
    .requiredOption("--decision <decision>", "pass or back")
    .requiredOption("--message <text>", "review message shown by the school")
    .requiredOption("--time <date>", "review date in YYYY-MM-DD format")
    .option("--callback-activity-id <id>", "school-returned callback node for BACK")
    .option("--confirm", "confirm one certification review write")
    .option("--dry-run", "validate without remote writes")
    .option("--json", "print stable JSON", true)
    .action(async (
      reviewId: string,
      commandOptions: Record<string, string | boolean | undefined>,
    ) => {
      if (commandOptions.via !== "api") {
        invalid("Certification review decisions require --via api; Ego preparation never authorizes an API write");
      }
      if (commandOptions.dryRun === true && commandOptions.confirm === true) {
        invalid("Choose either --dry-run or --confirm, not both");
      }
      const decision = decisionValue(commandOptions.decision);
      const message = requiredText(commandOptions.message, "message");
      const time = requiredText(commandOptions.time, "time");
      const source = await resolveQuerySession({ via: "api" }, options.baseUrl);
      const data = await createVolunteerCertificationReviewClient({
        baseUrl: options.baseUrl,
        session: volunteerSession(source),
      }).decide(reviewId, {
        via: "api",
        intent: "submit-volunteer-certification-review",
        decision,
        confirm: commandOptions.confirm === true,
        dryRun: commandOptions.dryRun === true,
        message,
        time,
        callbackActivityId: commandOptions.callbackActivityId === undefined
          ? undefined
          : String(commandOptions.callbackActivityId),
      });
      output(data, {
        operation: "volunteer-certification-reviews.decide",
        via: "api",
        selectedEntry: "api",
        requestMode: "api-write",
        verification: { writeRetries: 0, serverReadback: data.readback.state !== "not-submitted" },
      });
    });

  reviews.command("prepare")
    .description("Open a visible PASS or BACK review dialog in Ego and hand it to the user")
    .argument("<reviewId>", "certification application UUID")
    .requiredOption("--via <source>", "visible preparation source", "ego")
    .requiredOption("--ego-task-space <number>", "existing Ego task space")
    .option("--ego-page <label>", "existing school page (default p1)")
    .option("--level-no <value>", "select an available school role")
    .option("--unit-no <value>", "select an available identity unit")
    .requiredOption("--decision <decision>", "pass or back")
    .requiredOption("--message <text>", "review message shown by the school")
    .option("--allow-blank-navigation", "allow navigation only when the selected Ego page is about:blank")
    .option("--json", "print stable JSON", true)
    .action(async (reviewId: string, commandOptions: Record<string, string | boolean | undefined>) => {
      if (commandOptions.via !== "ego") invalid("Certification review preparation requires --via ego");
      const egoTaskSpace = typeof commandOptions.egoTaskSpace === "string"
        ? commandOptions.egoTaskSpace
        : undefined;
      const egoPage = typeof commandOptions.egoPage === "string" ? commandOptions.egoPage : undefined;
      const taskSpaceId = positiveInteger(egoTaskSpace, "ego-task-space");
      const decision = decisionValue(commandOptions.decision);
      const message = requiredText(commandOptions.message, "message");
      const source = await resolveQuerySession(
        {
          via: typeof commandOptions.via === "string" ? commandOptions.via : undefined,
          egoTaskSpace,
          egoPage,
          levelNo: typeof commandOptions.levelNo === "string" ? commandOptions.levelNo : undefined,
          unitNo: typeof commandOptions.unitNo === "string" ? commandOptions.unitNo : undefined,
        },
        options.baseUrl,
      );
      const prepared = await prepareVolunteerCertificationReviewInEgo({
        taskSpaceId,
        page: egoPage,
        reviewId,
        session: volunteerSession(source),
        baseUrl: options.baseUrl,
        decision,
        message,
        allowBlankNavigation: commandOptions.allowBlankNavigation === true,
      });
      output({
        status: "awaiting-user",
        submitted: false,
        reviewId: prepared.review.id,
        activityId: prepared.review.activityId,
        decision: prepared.decision,
        schoolRole: prepared.review.schoolRole,
        handleType: prepared.review.handleType,
        manualSteps: prepared.decision === "pass"
          ? ["review message", "final confirmation"]
          : ["review message", "callback node", "final confirmation"],
        ego: prepared,
      }, {
        operation: "volunteer-certification-reviews.prepare",
        via: "ego",
        selectedEntry: "ego",
        requestMode: "visible-ego-prepare",
        verification: { finalSubmission: "user-only", pendingReview: "school-api-rechecked" },
      });
    });
}
