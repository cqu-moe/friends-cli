import type { Command } from "commander";
import { resolveQuerySession } from "./session.js";
import {
  courseRegistrationId,
  createFriendsSdk,
  FriendsError,
  FriendsErrorCode,
  validateCourseRegistrationListInput,
} from "../index.js";

export const courseParticipationSchemas = {
  "courses.registrations.list": {
    operation: "courses.registrations.list",
    permission: "school-verified identity; upstream enforces personal registration access",
    phases: ["query"],
    input: {
      via: { type: "api or ego", default: "api", egoTaskSpace: "required integer with ego" },
      egoPage: { type: "string", default: "p1" },
      levelNo: { type: "string", required: "only when multiple Ego contexts match" },
      unitNo: { type: "string", required: "only when multiple Ego contexts match" },
      page: { type: "integer", minimum: 1, default: 1 },
      pageSize: { type: "integer", minimum: 1, default: 10 },
      keyword: { type: "string", upstreamField: "key", evidence: "current public course UI" },
    },
    output: "one page of personal course registration projections",
    readonly: true,
    supportedVia: ["api", "ego"],
    requestMode: "direct-api",
    verifiedWith: "public-source; controlled-api",
  },
  "courses.registrations.show": {
    operation: "courses.registrations.show",
    permission: "school-verified identity; only personal records are searched",
    phases: ["query"],
    input: {
      via: { type: "api or ego", default: "api", egoTaskSpace: "required integer with ego" },
      egoPage: { type: "string", default: "p1" },
      levelNo: { type: "string", required: "only when multiple Ego contexts match" },
      unitNo: { type: "string", required: "only when multiple Ego contexts match" },
      registrationId: { type: "course registration UUID", required: true },
    },
    output: "one personal registration located through my-applied-page-list",
    readonly: true,
    supportedVia: ["api", "ego"],
    requestMode: "direct-api",
    verifiedWith: "public-source; controlled-api",
  },
  "courses.registrations.apply.prepare": {
    operation: "courses.registrations.apply.prepare",
    permission: "school-verified identity; upstream enforces course access",
    phases: ["query", "prepare"],
    input: {
      via: { type: "api or ego", default: "api", egoTaskSpace: "required integer with ego" },
      egoPage: { type: "string", default: "p1" },
      levelNo: { type: "string", required: "only when multiple Ego contexts match" },
      unitNo: { type: "string", required: "only when multiple Ego contexts match" },
      courseId: { type: "course UUID", required: true },
      roleId: { type: "course role UUID", required: "when course detail returns roles" },
    },
    output: "course facts and exact API payload with submitted=false",
    readonly: true,
    dryRun: true,
    forbiddenEndpoints: [
      "student-apply/can-apply/{courseId}",
      "student-apply/apply",
      "student-apply/{registrationId}",
      "student-apply/quit/{registrationId}",
    ],
    supportedVia: ["api", "ego"],
    requestMode: "direct-api",
    verifiedWith: "public-source; controlled-api",
  },
  "courses.registrations.apply": {
    operation: "courses.registrations.apply",
    permission: "explicitly confirmed school-verified student session",
    phases: ["query", "write", "read-only-follow-up"],
    input: {
      courseId: { type: "course UUID", required: true },
      roleId: { type: "course role UUID", required: "when course detail returns roles" },
      confirm: { type: "literal apply", required: true },
    },
    output: "school acceptance plus a read-only personal-record follow-up when visible",
    readonly: false,
    httpMethod: "POST",
    businessEffect: "create course registration",
    sideEffect: "submits student-apply/apply exactly once after explicit confirmation",
    unknownOutcome: "exit 7 with recovery IDs; read-only follow-up only; no automatic retry",
    supportedVia: ["api"],
    verifiedWith: "public-source; controlled-api",
  },
  "courses.registrations.withdraw": {
    operation: "courses.registrations.withdraw",
    permission: "explicitly confirmed owner of a pending personal registration",
    phases: ["query", "write", "read-only-follow-up"],
    input: {
      registrationId: { type: "course registration UUID", required: true },
      confirm: { type: "literal withdraw", required: true },
    },
    output: "school withdrawal result and whether the record remains listed",
    readonly: false,
    httpMethod: "GET",
    businessEffect: "withdraw registration",
    sideEffect: "calls student-apply/{registrationId} once; this GET is a business write",
    unknownOutcome: "exit 7 with registrationId; read-only follow-up only; no automatic retry",
    supportedVia: ["api"],
    verifiedWith: "public-source; controlled-api",
  },
  "courses.registrations.exit": {
    operation: "courses.registrations.exit",
    permission: "explicitly confirmed owner of an accepted personal registration",
    phases: ["query", "write", "read-only-follow-up"],
    input: {
      registrationId: { type: "course registration UUID", required: true },
      confirm: { type: "literal exit", required: true },
    },
    output: "school exit result and whether the record remains listed",
    readonly: false,
    httpMethod: "DELETE",
    businessEffect: "exit accepted registration",
    sideEffect: "calls student-apply/quit/{registrationId} once after explicit confirmation",
    unknownOutcome: "exit 7 with registrationId; read-only follow-up only; no automatic retry",
    supportedVia: ["api"],
    verifiedWith: "public-source; controlled-api",
  },
} as const;

function output(data: unknown, meta: Record<string, unknown>): void {
  process.stdout.write(
    `${JSON.stringify({ schemaVersion: 1, ok: true, data, meta }, null, 2)}\n`,
  );
}

function invalid(message: string): never {
  throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message });
}

function queryOptions(command: Command): Command {
  return command
    .option("--via <api|ego>", "session source for direct API queries", "api")
    .option("--ego-task-space <number>", "existing Ego task space required by --via ego")
    .option("--ego-page <label>", "existing school page (default p1)")
    .option("--level-no <value>", "select an available school role")
    .option("--unit-no <value>", "select an available identity unit");
}

export function registerCourseParticipationCommands(
  courses: Command,
  options: { baseUrl: string },
): void {
  const sdk = createFriendsSdk({ baseUrl: options.baseUrl });
  const registrations = courses
    .command("registrations")
    .description("Manage personal course registrations");

  async function client(queryInput: Record<string, string | undefined>) {
    const source = await resolveQuerySession(queryInput, options.baseUrl);
    return {
      source,
      client: await sdk.createCourseParticipationClient(source.session),
    };
  }

  function writeSession(queryInput: Record<string, string | undefined>) {
    const mixedEgoOptions = ["egoTaskSpace", "egoPage", "levelNo", "unitNo"]
      .filter((key) => queryInput[key] != null);
    if (queryInput.via !== undefined && queryInput.via !== "api") {
      invalid("Course registration writes require --via api; Ego final submission is human-only");
    }
    if (mixedEgoOptions.length > 0) {
      invalid(`Ego options require --via ego: ${mixedEgoOptions.join(", ")}`);
    }
    return client({ ...queryInput, via: "api" });
  }

  function queryMeta(
    source: { entry: "api" | "ego"; session: { account: unknown; context: unknown } },
    readonly: boolean,
  ) {
    return {
      via: source.entry === "ego" ? "ego-selected+direct-api" : "api",
      selectedEntry: source.entry,
      requestMode: readonly ? "direct-api" : "school-api",
      verification: {
        identityAndContext: source.entry === "ego" ? "school-api-verified" : "school-api-reverified",
        account: source.session.account,
        context: source.session.context,
        queryContract: "public-source+controlled-api",
        remoteWrites: readonly ? 0 : 1,
      },
    };
  }

  queryOptions(registrations.command("list"))
    .description("List one page of personal course registrations")
    .option("--page <number>", "result page", "1")
    .option("--page-size <number>", "results per page", "10")
    .option("--keyword <value>", "course name or organizer keyword")
    .option("--json", "print stable JSON", true)
    .action(async (options: Record<string, string>) => {
      const query = validateCourseRegistrationListInput({
        page: Number(options.page),
        pageSize: Number(options.pageSize),
        keyword: options.keyword,
      });
      const active = await client(options);
      output(await active.client.listMyRegistrations(query), {
        operation: "courses.registrations.list",
        ...queryMeta(active.source, true),
      });
    });

  queryOptions(registrations.command("show"))
    .description("Show one personal registration by registration UUID")
    .argument("<registrationId>", "course registration UUID, not a course UUID")
    .option("--json", "print stable JSON", true)
    .action(async (registrationIdValue: string, options: Record<string, string>) => {
      const id = courseRegistrationId(registrationIdValue);
      const active = await client(options);
      output(await active.client.getMyRegistration(id), {
        operation: "courses.registrations.show",
        ...queryMeta(active.source, true),
      });
    });

  queryOptions(registrations.command("apply"))
    .description("Prepare or explicitly submit one course registration")
    .argument("<courseId>", "course UUID, not a registration UUID")
    .option("--role-id <uuid>", "explicit role UUID returned by course detail")
    .option("--dry-run", "read course detail and return submitted=false without any write")
    .option("--confirm <action>", "required literal action for an API write")
    .option("--json", "print stable JSON", true)
    .action(async (courseIdValue: string, options: Record<string, string | boolean | undefined>) => {
      const queryInput = options as Record<string, string | undefined>;
      const dryRun = options.dryRun === true;
      const roleId = typeof options.roleId === "string" ? options.roleId : undefined;
      if (!dryRun && options.confirm !== "apply") {
        invalid("--confirm apply is required for course registration writes");
      }
      if (dryRun) {
        const active = await client(queryInput);
        const prepared = await active.client.prepareApply(courseIdValue, {
          roleId,
        });
        output(prepared, {
          operation: "courses.registrations.apply.prepare",
          ...queryMeta(active.source, true),
        });
        return;
      }
      const active = await writeSession(queryInput);
      output(await active.client.apply({
        courseId: courseIdValue,
        roleId,
        confirm: "apply",
      }), {
        operation: "courses.registrations.apply",
        ...queryMeta(active.source, false),
      });
    });

  for (const operation of ["withdraw", "exit"] as const) {
    registrations.command(operation)
      .description(operation === "withdraw"
        ? "Withdraw one pending personal course registration"
        : "Exit one accepted personal course registration")
      .argument("<registrationId>", "course registration UUID, not a course UUID")
      .option("--confirm <action>", `required literal action ${operation}`)
      .option("--json", "print stable JSON", true)
      .action(async (registrationIdValue: string, options: Record<string, string | undefined>) => {
        if (options.confirm !== operation) {
          invalid(`--confirm ${operation} is required for course registration writes`);
        }
        const id = courseRegistrationId(registrationIdValue);
        const active = await writeSession(options);
        const result = operation === "withdraw"
          ? await active.client.withdraw({ registrationId: id, confirm: "withdraw" })
          : await active.client.exit({ registrationId: id, confirm: "exit" });
        output(result, {
          operation: `courses.registrations.${operation}`,
          ...queryMeta(active.source, false),
        });
      });
  }
}
