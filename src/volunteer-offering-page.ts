/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { FriendsError, FriendsErrorCode } from "./errors.js";

export interface VolunteerOfferingPageAction {
  field: string;
  action: "filled" | "selected" | "already-matching" | "human-value-preserved";
}

export interface VolunteerOfferingVisiblePreparation {
  status: "ready" | "awaiting-user";
  submitted: false;
  dryRun?: boolean;
  handoff?: "completed";
  actions: VolunteerOfferingPageAction[];
  missing: string[];
  executionError: { code: string; message: string } | null;
  finalSubmitActions: 0;
  page: {
    url: string;
    fields: Array<{ name: string; value: string }>;
    publicityUploadCount: number;
    attachmentUploadCount: number;
    finalActionLabel: string | null;
  };
}

interface Page {
  url(): Promise<string>;
  goto(url: string): Promise<unknown>;
  snapshot(options?: { scope?: string }): Promise<string>;
  click(selector: string, options?: { label?: string }): Promise<unknown>;
  fill(selector: string, value: string): Promise<unknown>;
  waitForSelector(selector: string, options?: { state?: string; timeout?: number }): Promise<unknown>;
  waitForFunction<A>(fn: (arg: A) => unknown, arg: A, options?: { timeout: number }): Promise<unknown>;
  evaluate<T>(fn: () => T): Promise<T>;
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>;
}
interface Task { page(label: string): Page; handOff(): Promise<unknown> }

interface Input {
  page: string;
  url: string;
  dryRun?: boolean;
  activityCategory: "SCHOOL_ACTIVITY" | "TEMP_ACTIVITY";
  activity: {
    activityName: string; activityTypeLabel: string; activityLevelLabel: string;
    beginTime: string; endTime: string; activityPlace: string; contacts: string; phone: string;
    volunteerNumber: string; totalDuration: string; activityContent: string; overview: string;
  };
  organizationName: string;
  expectedPublicityCount: number;
  sessionToken: string;
  sessionUserLevel: string;
}

const textFields: Array<[keyof Input["activity"], string]> = [
  ["activityName", "活动名称"], ["activityPlace", "活动地点"], ["contacts", "活动联系人"],
  ["phone", "联系电话"], ["volunteerNumber", "预计志愿者人数"], ["totalDuration", "预计活动总时长"],
  ["activityContent", "志愿服务内容与时长明细"], ["overview", "活动概述"],
];

function dateLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(value);
  if (!match) throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message: "Unsupported offering date" });
  const [, year, month, day, hour, minute] = match;
  return `${year}年${Number(month)}月${Number(day)}日 ${Number(hour)}:${Number(minute)}`;
}

async function facts(page: Page) {
  return page.evaluate(() => {
    const fields = Array.from(document.querySelectorAll("[name]")).map((node) => ({
      name: node.getAttribute("name") ?? "",
      value: (node.querySelector("input,textarea") as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? "",
    }));
    const count = (name: string) => document.querySelectorAll(`[name="${name}"] .van-uploader__preview`).length;
    const button = Array.from(document.querySelectorAll("button")).map((node) => node.textContent?.trim() ?? "").find((text) => text === "提交申请" || text === "下一步") ?? null;
    return {
      url: window.location.href,
      token: localStorage.getItem("token_str"),
      userLevel: localStorage.getItem("userLevel_str"),
      fields,
      publicityUploadCount: count("publicityPicturesGroupUuid"),
      attachmentUploadCount: count("attachmentGroupUuid"),
      finalActionLabel: button,
    };
  });
}

async function selectField(page: Page, wrapperSelector: string, label: string, field: string, actions: VolunteerOfferingPageAction[]) {
  await page.click(wrapperSelector, { label: `open ${field}` });
  await page.waitForSelector("loc=css:.van-picker", { state: "visible", timeout: 15_000 });
  await page.snapshot();
  await page.click(`text="${label}"`, { label: `select ${label}` });
  await page.click('text="完成"', { label: "confirm picker" });
  await page.waitForSelector("loc=css:.van-picker", { state: "hidden", timeout: 15_000 });
  actions.push({ field, action: "selected" });
}

async function selectDate(page: Page, wrapperSelector: string, expected: string, field: string, actions: VolunteerOfferingPageAction[]) {
  const label = dateLabel(expected);
  await page.click(wrapperSelector, { label: `open ${field}` });
  await page.waitForSelector("loc=css:.van-picker", { state: "visible", timeout: 15_000 });
  await page.snapshot();
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(expected);
  if (!match) throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message: "Unsupported offering date" });
  const [, year, month, day, hour, minute] = match;
  for (const option of [`${year}年`, `${Number(month)}月`, `${Number(day)}日`, `${Number(hour)}时`, `${Number(minute)}分`]) {
    await page.click(`text="${option}"`, { label: `choose ${option}` });
  }
  await page.click('text="完成"', { label: "confirm date" });
  await page.waitForSelector("loc=css:.van-picker", { state: "hidden", timeout: 15_000 });
  actions.push({ field, action: "selected" });
  return label;
}

export async function prepareVolunteerOfferingPage(task: Task, input: Input): Promise<VolunteerOfferingVisiblePreparation> {
  const page = task.page(input.page);
  const target = new URL(input.url);
  const before = await page.url();
  if (before === "about:blank") {
    if (input.dryRun) throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message: "Open the offering page before a dry-run" });
    await page.goto(target.href);
  }
  await page.waitForSelector("loc=css:.cmine", { timeout: 15_000 });
  await page.snapshot({ scope: "full_page" });
  const initial = await facts(page);
  const currentUrl = new URL(initial.url);
  const parsedToken = initial.token?.startsWith("{")
    ? (() => { try { return JSON.parse(initial.token).token ?? JSON.parse(initial.token).data?.token ?? JSON.parse(initial.token).data; } catch { return null; } })()
    : initial.token;
  if (
    currentUrl.origin !== target.origin || currentUrl.pathname !== target.pathname ||
    currentUrl.searchParams.get("activityPageTypes") !== "Apply" ||
    currentUrl.searchParams.get("activityCategory") !== input.activityCategory ||
    parsedToken !== input.sessionToken || initial.userLevel !== input.sessionUserLevel
  ) {
    throw new FriendsError({ code: FriendsErrorCode.PermissionDenied, message: "The visible offering page, account, category, or route does not match" });
  }
  const values = new Map(initial.fields.map((field) => [field.name, field.value]));
  const missing = [...values.entries()].filter(([, value]) => value === "").map(([name]) => `page:${name}`);
  if (initial.publicityUploadCount < input.expectedPublicityCount) missing.push("materials:publicityPictures");
  if (input.dryRun) {
    return { status: "ready", submitted: false, dryRun: true, actions: [], missing, executionError: null, finalSubmitActions: 0,
      page: { url: initial.url, fields: initial.fields, publicityUploadCount: initial.publicityUploadCount, attachmentUploadCount: initial.attachmentUploadCount, finalActionLabel: initial.finalActionLabel } };
  }
  const actions: VolunteerOfferingPageAction[] = [];
  let executionError: { code: string; message: string } | null = null;
  try {
    for (const [key, name] of textFields) {
      const expected = String(input.activity[key]);
      const current = values.get(name) ?? "";
      if (current === expected) actions.push({ field: name, action: "already-matching" });
      else if (current !== "") actions.push({ field: name, action: "human-value-preserved" });
      else {
        await page.fill(`loc=css:[name="${name}"] input, [name="${name}"] textarea`, expected);
        actions.push({ field: name, action: "filled" });
      }
    }
    for (const [index, field] of ["activityType", "activityLevel", "organizationName"].entries()) {
      const expected = index === 0 ? input.activity.activityTypeLabel : index === 1 ? input.activity.activityLevelLabel : input.organizationName;
      const current = values.get(field) ?? "";
      if (current === expected) actions.push({ field, action: "already-matching" });
      else if (current !== "") actions.push({ field, action: "human-value-preserved" });
      else await selectField(page, `xpath=//div[contains(@class,"field-select")][.//*[@name=${JSON.stringify(field)}]]`, expected, field, actions);
    }
    for (const [index, field] of [["beginTime", "活动开始时间"], ["endTime", "活动结束时间"] as const].entries()) {
      const [key, name] = field;
      const expected = input.activity[key as "beginTime" | "endTime"];
      const expectedDisplay = dateLabel(expected);
      const current = values.get(name) ?? "";
      if (current === expectedDisplay) actions.push({ field: name, action: "already-matching" });
      else if (current !== "") actions.push({ field: name, action: "human-value-preserved" });
      else await selectDate(page, `xpath=//div[contains(@class,"field-datetime-picker")][.//*[@name=${JSON.stringify(name)}]]`, expected, name, actions);
    }
  } catch (error) {
    executionError = { code: error instanceof FriendsError ? error.code : FriendsErrorCode.UnknownOutcome, message: error instanceof Error ? error.message : "Visible preparation failed" };
  }
  const final = await facts(page);
  const stillMissing = final.fields.filter((field) => field.value === "" && field.name !== "publicityPicturesGroupUuid" && field.name !== "attachmentGroupUuid").map((field) => `page:${field.name}`);
  if (final.publicityUploadCount < input.expectedPublicityCount) stillMissing.push("materials:publicityPictures");
  stillMissing.push(input.activityCategory === "TEMP_ACTIVITY" ? "human-review:final-submit" : "human-review:next-step-and-final-submit");
  await task.handOff();
  const handoff: "completed" = "completed";
  return {
    status: executionError ? "awaiting-user" : "awaiting-user", submitted: false, handoff,
    actions, missing: stillMissing, executionError, finalSubmitActions: 0,
    page: { url: final.url, fields: final.fields, publicityUploadCount: final.publicityUploadCount, attachmentUploadCount: final.attachmentUploadCount, finalActionLabel: final.finalActionLabel },
  };
}
