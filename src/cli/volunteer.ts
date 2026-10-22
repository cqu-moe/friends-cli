import type { Command } from "commander";
import { readJsonInput } from "./json-input.js";
import { resolveQuerySession } from "./session.js";
import {
  FriendsError,
  FriendsErrorCode,
  validateVolunteerListInput,
  volunteerActivityId,
  volunteerRegistrationId,
  type VolunteerRegisterInput,
} from "../index.js";
import {
  prepareVolunteerRegistrationEgo,
  prepareVolunteerWithdrawalEgo,
  type VisibleVolunteerAnswer,
} from "../volunteer-ego.js";

const productionBaseUrl = "https://friends.cqu.edu.cn/gateway";

const viaInput = {
  via: { type: "api or ego", default: "api", egoTaskSpace: "required integer; reuses an existing Ego task space" },
  egoPage: { type: "string", default: "p1" },
  levelNo: { type: "string", required: "only when multiple Ego contexts match" },
  unitNo: { type: "string", required: "only when multiple Ego contexts match" },
};

const sessionContract = {
  credentialSource: "api selects the stored local session; ego selects the existing Ego page session; independent from auth login method",
  executionSource: "via api|ego is execution only and is reported separately from credentialSource",
};

export const volunteerSchemas = {
  "volunteers.identity": {
    operation: "volunteers.identity",
    permission: "school-verified identity; upstream enforces volunteer access", phases: ["query"],
    input: viaInput, output: "own volunteer membership evidence without interpreting unverified member fields",
    readonly: true, supportedVia: ["api", "ego"], requestMode: "direct-api",
    ...sessionContract, verifiedWith: "public-source; controlled-api; controlled-ego-script",
  },
  "volunteers.activities.list": {
    operation: "volunteers.activities.list",
    permission: "school-verified identity; upstream enforces activity access", phases: ["query"],
    input: {
      ...viaInput,
      kind: { type: "participable or manageable", default: "participable", manageableSupport: "list only; no page or keyword filter" },
      page: { type: "integer", minimum: 1, default: 1, participableOnly: true },
      pageSize: { type: "integer", minimum: 1, default: 10, participableOnly: true },
      keyword: { type: "string", upstreamField: "key", participableOnly: true },
    },
    output: "one participable activity page or the manageable activity list",
    readonly: true, supportedVia: ["api", "ego"], requestMode: "direct-api",
    ...sessionContract,
    verifiedWith: "public-source; controlled-api; controlled-ego-script",
  },
  "volunteers.activities.show": {
    operation: "volunteers.activities.show",
    permission: "school-verified identity; upstream enforces activity access", phases: ["query"],
    input: { ...viaInput, activityId: { type: "volunteer activity UUID", required: true } },
    output: "activity detail and questionnaire definitions", readonly: true,
    supportedVia: ["api", "ego"], requestMode: "direct-api",
    ...sessionContract,
    verifiedWith: "public-source; controlled-api; controlled-ego-script",
  },
  "volunteers.activities.requirements": {
    operation: "volunteers.activities.requirements",
    permission: "school-verified identity; upstream enforces activity access", phases: ["query"],
    input: { ...viaInput, activityId: { type: "volunteer activity UUID", required: true } },
    output: "activity, posts, school can-apply result, and unsupported questionnaire types",
    readonly: true, supportedVia: ["api", "ego"], requestMode: "direct-api",
    ...sessionContract,
    verifiedWith: "public-source; controlled-api; controlled-ego-script",
  },
  "volunteers.registrations.list": {
    operation: "volunteers.registrations.list",
    permission: "own school-verified student session", phases: ["query"],
    input: {
      ...viaInput,
      page: { type: "integer", minimum: 1, default: 1 },
      pageSize: { type: "integer", minimum: 1, default: 10 },
      keyword: { type: "string", upstreamField: "key" },
    },
    output: "own registration records and upstream review state", readonly: true,
    supportedVia: ["api", "ego"], requestMode: "direct-api",
    ...sessionContract,
    verifiedWith: "public-source; controlled-api; controlled-ego-script",
  },
  "volunteers.registrations.show": {
    operation: "volunteers.registrations.show",
    permission: "own school-verified student session", phases: ["query"],
    input: { ...viaInput, registrationId: { type: "volunteer registration UUID", required: true } },
    output: "one own registration and upstream review state", readonly: true,
    supportedVia: ["api", "ego"], requestMode: "direct-api",
    ...sessionContract,
    verifiedWith: "public-source; controlled-api; controlled-ego-script",
  },
  "volunteers.register": {
    operation: "volunteers.register",
    permission: "eligible own student session", phases: ["validate", "prepare", "api-write"],
    input: {
      activityId: { type: "volunteer activity UUID", required: true },
      input: { type: "JSON file path or - for stdin", required: true, shape: "{postId, questionnaireAnswers?}" },
      via: { type: "api or ego", default: "api" },
      confirm: { type: "flag", required: "API writes only; never valid with ego", sdkConfirmation: "volunteers.register" },
      dryRun: { type: "flag", performsReadsAndValidationOnly: true },
      egoTaskSpace: { type: "integer", required: "ego writes only; preparation opens a dedicated page" },
      levelNo: { type: "string", required: "only when multiple Ego contexts match" },
      unitNo: { type: "string", required: "only when multiple Ego contexts match" },
    },
    output: "API acknowledgement or Ego preparation handoff; neither means approval",
    readonly: false,
    supportedVia: ["api", "ego"], apiWriteConfirmation: "--confirm required; --dry-run performs no write",
    egoWriteStage: "visible prepare + human submit", requestMode: "via-dependent",
    ...sessionContract,
    verifiedWith: "public-source; controlled-api; controlled-ego-script",
  },
  "volunteers.withdraw": {
    operation: "volunteers.withdraw",
    permission: "own approved registration", phases: ["validate", "prepare", "api-write"],
    input: {
      activityId: { type: "volunteer activity UUID", required: true },
      registrationId: { type: "volunteer registration UUID", required: true },
      via: { type: "api or ego", default: "api" },
      confirm: { type: "flag", required: "API writes only; never valid with ego", sdkConfirmation: "volunteers.withdraw" },
      dryRun: { type: "flag", performsReadsAndValidationOnly: true },
      egoTaskSpace: { type: "integer", required: "ego writes only; preparation opens a dedicated page" },
      levelNo: { type: "string", required: "only when multiple Ego contexts match" },
      unitNo: { type: "string", required: "only when multiple Ego contexts match" },
    },
    output: "API acknowledgement or Ego withdrawal handoff; neither means approval",
    readonly: false,
    supportedVia: ["api", "ego"], apiWriteConfirmation: "--confirm required; --dry-run performs no write",
    egoWriteStage: "visible prepare + human final confirmation", requestMode: "via-dependent",
    ...sessionContract, verifiedWith: "public-source; controlled-api; controlled-ego-script",
  },
} as const;

function meta(source: { entry: "api" | "ego"; session: { account: unknown; context: unknown } }, operation: string) {
  const write = operation.startsWith("volunteers.register") || operation.startsWith("volunteers.withdraw");
  return {
    via: write && source.entry === "ego"
      ? operation === "volunteers.register" ? "ego-visible-form+human-submit" : "ego-visible-action+human-confirm"
      : source.entry === "ego" ? "ego-selected+direct-api" : "api",
    selectedEntry: source.entry,
    requestMode: write ? (source.entry === "ego" ? "visible-prepare-only" : "api-write") : "direct-api",
    verification: {
      identityAndContext: source.entry === "ego" ? "school-api-verified" : "school-api-reverified",
      account: source.session.account,
      context: source.session.context,
      queryContract: "public-source+controlled-api",
      serverAcknowledgementIsNotApproval: write || undefined,
    },
  };
}

function validateWriteFlags(options: Record<string, string | boolean | undefined>) {
  const via = options.via ?? "api";
  if (via !== "api" && via !== "ego") invalid("--via must be api or ego");
  if (options.confirm === true && options.dryRun === true) invalid("--confirm and --dry-run are mutually exclusive");
  if (via === "api" && options.confirm !== true && options.dryRun !== true) {
    invalid("API volunteer writes require --confirm; use --dry-run for validation only");
  }
  if (via === "ego" && options.confirm === true) invalid("Ego preparation must end with human action; --confirm is invalid");
}

function invalid(message: string): never {
  throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message });
}

function requireVisibleText(value: string | null | undefined, kind: string, id: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    invalid(`Ego preparation requires a visible ${kind} for ${id}`);
  }
  return value;
}

function sessionOptions(options: Record<string, string | boolean | undefined>): Record<string, string | undefined> {
  return {
    via: typeof options.via === "string" ? options.via : undefined,
    egoTaskSpace: typeof options.egoTaskSpace === "string" ? options.egoTaskSpace : undefined,
    egoPage: typeof options.egoPage === "string" ? options.egoPage : undefined,
    levelNo: typeof options.levelNo === "string" ? options.levelNo : undefined,
    unitNo: typeof options.unitNo === "string" ? options.unitNo : undefined,
  };
}

function pageOptions(command: Command) {
  return command
    .option("--page <number>", "result page", "1")
    .option("--page-size <number>", "results per page", "10")
    .option("--keyword <value>", "activity name or organization keyword");
}

function queryOptions(command: Command, includeVia = true) {
  if (!includeVia) return command;
  return command
    .option("--via <source>", "query execution path", "api")
    .option("--ego-task-space <number>", "existing Ego task space required by --via ego")
    .option("--ego-page <label>", "existing Ego page label (default p1)")
    .option("--level-no <value>", "select an Ego level when multiple contexts match")
    .option("--unit-no <value>", "select an Ego identity unit when multiple contexts match");
}

export function registerVolunteerCommands(
  program: Command,
  options: {
    sdk: () => ReturnType<typeof import("../index.js").createFriendsSdk>;
    output: (data: unknown, meta?: Record<string, unknown>) => void;
    selectedSession: typeof resolveQuerySession;
  },
): void {
  const volunteers = program.command("volunteers").description("Volunteer identity, activities, and own registrations");

  queryOptions(volunteers.command("identity").description("Show own volunteer identity evidence"))
    .option("--json", "print stable JSON", true)
    .action(async (commandOptions: Record<string, string>) => {
      const source = await options.selectedSession(commandOptions, process.env.FRIENDS_BASE_URL ?? productionBaseUrl);
      const data = await (await options.sdk().createVolunteerClient(source.session)).getIdentity();
      options.output(data, { operation: "volunteers.identity", ...meta(source, "volunteers.identity") });
    });

  const activities = volunteers.command("activities").description("Volunteer activity queries");
  queryOptions(pageOptions(activities.command("list").description("List activities")))
    .option("--kind <type>", "participable or manageable", "participable")
    .option("--json", "print stable JSON", true)
    .action(async (commandOptions: Record<string, string>) => {
      if (commandOptions.kind !== "participable" && commandOptions.kind !== "manageable") {
        invalid("--kind must be participable or manageable");
      }
      const source = await options.selectedSession(commandOptions, process.env.FRIENDS_BASE_URL ?? productionBaseUrl);
      const client = await options.sdk().createVolunteerClient(source.session);
      const operation = "volunteers.activities.list";
      if (commandOptions.kind === "manageable") {
        if (commandOptions.page !== "1" || commandOptions.pageSize !== "10" || commandOptions.keyword !== undefined) {
          invalid("Manageable volunteer activities have no verified page or keyword filter");
        }
        options.output(await client.listManageableActivities(), { operation, ...meta(source, operation) });
        return;
      }
      const query = validateVolunteerListInput({
        page: Number(commandOptions.page),
        pageSize: Number(commandOptions.pageSize),
        keyword: commandOptions.keyword,
      });
      options.output(await client.listActivities(query), { operation, ...meta(source, operation) });
    });

  queryOptions(activities.command("show").description("Show one volunteer activity"))
    .argument("<activityId>", "volunteer activity UUID, not a registration UUID")
    .option("--json", "print stable JSON", true)
    .action(async (activityIdValue: string, commandOptions: Record<string, string>) => {
      const id = volunteerActivityId(activityIdValue);
      const source = await options.selectedSession(commandOptions, process.env.FRIENDS_BASE_URL ?? productionBaseUrl);
      const data = await (await options.sdk().createVolunteerClient(source.session)).getActivity(id);
      options.output(data, { operation: "volunteers.activities.show", ...meta(source, "volunteers.activities.show") });
    });

  queryOptions(activities.command("requirements").description("Show posts and registration requirements"))
    .argument("<activityId>", "volunteer activity UUID")
    .option("--json", "print stable JSON", true)
    .action(async (activityIdValue: string, commandOptions: Record<string, string>) => {
      const id = volunteerActivityId(activityIdValue);
      const source = await options.selectedSession(commandOptions, process.env.FRIENDS_BASE_URL ?? productionBaseUrl);
      const data = await (await options.sdk().createVolunteerClient(source.session)).getRegistrationRequirements(id);
      options.output(data, { operation: "volunteers.activities.requirements", ...meta(source, "volunteers.activities.requirements") });
    });

  const registrations = volunteers.command("registrations").description("Own volunteer registrations");
  queryOptions(pageOptions(registrations.command("list").description("List own volunteer registrations")))
    .option("--json", "print stable JSON", true)
    .action(async (commandOptions: Record<string, string>) => {
      const query = validateVolunteerListInput({
        page: Number(commandOptions.page),
        pageSize: Number(commandOptions.pageSize),
        keyword: commandOptions.keyword,
      });
      const source = await options.selectedSession(commandOptions, process.env.FRIENDS_BASE_URL ?? productionBaseUrl);
      const data = await (await options.sdk().createVolunteerClient(source.session)).listRegistrations(query);
      options.output(data, { operation: "volunteers.registrations.list", ...meta(source, "volunteers.registrations.list") });
    });

  queryOptions(registrations.command("show").description("Show one own volunteer registration"))
    .argument("<registrationId>", "volunteer registration UUID, not an activity UUID")
    .option("--json", "print stable JSON", true)
    .action(async (registrationIdValue: string, commandOptions: Record<string, string>) => {
      const id = volunteerRegistrationId(registrationIdValue);
      const source = await options.selectedSession(commandOptions, process.env.FRIENDS_BASE_URL ?? productionBaseUrl);
      const data = await (await options.sdk().createVolunteerClient(source.session)).getRegistration(id);
      options.output(data, { operation: "volunteers.registrations.show", ...meta(source, "volunteers.registrations.show") });
    });

  queryOptions(volunteers.command("register").description("Register for one volunteer activity"), false)
    .argument("<activityId>", "volunteer activity UUID")
    .requiredOption("--input <path>", "JSON file path or - for stdin")
    .option("--via <source>", "api write or visible Ego preparation", "api")
    .option("--confirm", "confirm one API write; never submits through Ego")
    .option("--dry-run", "validate and build payload without writing")
    .option("--ego-task-space <number>", "existing Ego task space required by --via ego")
    .option("--level-no <value>", "select an Ego level when multiple contexts match")
    .option("--unit-no <value>", "select an Ego identity unit when multiple contexts match")
    .option("--json", "print stable JSON", true)
    .action(async (activityIdValue: string, commandOptions: Record<string, string | boolean>) => {
      validateWriteFlags(commandOptions);
      const id = volunteerActivityId(activityIdValue);
      const input = await readJsonInput(String(commandOptions.input)) as VolunteerRegisterInput;
      const source = await options.selectedSession(sessionOptions(commandOptions), process.env.FRIENDS_BASE_URL ?? productionBaseUrl);
      const client = await options.sdk().createVolunteerClient(source.session);
      const preparation = await client.prepareRegistration(id, input);
      const operation = "volunteers.register";
      if (commandOptions.dryRun === true) {
        options.output({ wouldWrite: true, payload: preparation.payload, activity: preparation.activity, posts: preparation.posts }, {
          operation, ...meta(source, operation), dryRun: true,
        });
        return;
      }
      if (source.entry === "ego") {
        const visibleAnswers: VisibleVolunteerAnswer[] = (input.questionnaireAnswers ?? []).map((answer) => {
          const question = preparation.activity.questionnaires.find((item) => item.id === answer.itemUuid);
          if (question === undefined) invalid("Questionnaire answer does not belong to this activity");
          const title = requireVisibleText(question.title, "questionnaire title", question.id);
          if (answer.type === "CHOICE") {
            const option = question.options.find((item) => item.id === answer.optionUuid);
            if (option === undefined) invalid("Questionnaire option does not belong to this activity question");
            return { title, type: answer.type, optionLabels: [requireVisibleText(option.name, "questionnaire option label", option.id)] };
          }
          if (answer.type === "MULTIPLE_CHOICE") {
            return {
              title,
              type: answer.type,
              optionLabels: answer.optionUuids.map((optionId) => {
                const option = question.options.find((item) => item.id === optionId);
                if (option === undefined) invalid("Questionnaire option does not belong to this activity question");
                return requireVisibleText(option.name, "questionnaire option label", option.id);
              }),
            };
          }
          if (answer.type === "DATE") {
            invalid("DATE questionnaire Ego preparation is not implemented; complete the visible date field after handoff");
          }
          return { title, type: answer.type, inputContent: answer.inputContent };
        });
        const data = await prepareVolunteerRegistrationEgo({
          activityId: id,
          activityName: preparation.activity.name,
          postName: preparation.payload.postName,
          answers: visibleAnswers,
          taskSpaceId: Number(commandOptions.egoTaskSpace),
          command: process.env.FRIENDS_EGO_COMMAND,
        });
        options.output(data, { operation, ...meta(source, operation), nextAction: "Review the visible form and personally submit it" });
        return;
      }
      const data = await client.register(id, { ...input, confirmation: "volunteers.register" });
      options.output(data, {
        operation, ...meta(source, operation), nextAction: "Read back volunteers registrations list; code 0 is not approval",
      });
    });

  queryOptions(volunteers.command("withdraw").description("Withdraw one approved volunteer registration"), false)
    .argument("<activityId>", "volunteer activity UUID")
    .argument("<registrationId>", "volunteer registration UUID")
    .option("--via <source>", "api write or visible Ego handoff", "api")
    .option("--confirm", "confirm one API write; never confirms through Ego")
    .option("--dry-run", "validate without writing")
    .option("--ego-task-space <number>", "existing Ego task space required by --via ego")
    .option("--level-no <value>", "select an Ego level when multiple contexts match")
    .option("--unit-no <value>", "select an Ego identity unit when multiple contexts match")
    .option("--json", "print stable JSON", true)
    .action(async (activityIdValue: string, registrationIdValue: string, commandOptions: Record<string, string | boolean>) => {
      validateWriteFlags(commandOptions);
      const activityId = volunteerActivityId(activityIdValue);
      const registrationId = volunteerRegistrationId(registrationIdValue);
      const source = await options.selectedSession(sessionOptions(commandOptions), process.env.FRIENDS_BASE_URL ?? productionBaseUrl);
      const client = await options.sdk().createVolunteerClient(source.session);
      const preparation = await client.prepareWithdrawal(activityId, registrationId);
      const operation = "volunteers.withdraw";
      if (commandOptions.dryRun === true) {
        options.output({ wouldWrite: true, activity: preparation.activity, registration: preparation.registration }, {
          operation, ...meta(source, operation), dryRun: true,
        });
        return;
      }
      if (source.entry === "ego") {
        const data = await prepareVolunteerWithdrawalEgo({
          activityId,
          taskSpaceId: Number(commandOptions.egoTaskSpace),
          command: process.env.FRIENDS_EGO_COMMAND,
        });
        options.output(data, { operation, ...meta(source, operation), nextAction: "Review the page and personally confirm withdrawal" });
        return;
      }
      const data = await client.withdraw(activityId, registrationId, { confirmation: "volunteers.withdraw" });
      options.output(data, {
        operation, ...meta(source, operation), nextAction: "Read back volunteers registrations list; code 0 is not approval",
      });
    });
}
