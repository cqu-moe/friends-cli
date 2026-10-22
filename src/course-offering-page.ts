/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { FriendsError, FriendsErrorCode } from "./errors.js";
import type { PreparedCourseOfferingApplication } from "./course-offering.js";

interface Page {
  url(): Promise<string>;
  goto(url: string): Promise<unknown>;
  snapshot(): Promise<unknown>;
  click(selector: string): Promise<unknown>;
  fill(selector: string, value: string): Promise<unknown>;
  waitForSelector(selector: string, options?: { state?: string; timeout?: number }): Promise<unknown>;
  waitForFunction<A>(fn: (arg: A) => unknown, arg: A, options?: { timeout: number }): Promise<unknown>;
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<Awaited<T>>;
}
interface Task { page(label: string): Page; handOff(): Promise<unknown> }
interface Input {
  prepared: PreparedCourseOfferingApplication;
  session: { token: string; userLevel: string };
  page: string;
  url: string;
}
const labels = {
  curriculumName: "课程名称", curriculumType: "课程类型", curriculumLevel: "课程级别",
  organizationName: "主办方", curriculumPlace: "课程地址", curriculumContent: "课程介绍",
  beginTime: "课程开始时间", endTime: "课程结束时间", role: "积分设置", attestationType: "认证方式",
};
type Field = keyof typeof labels;
const activePicker = '.van-popup:not([style*="display: none"]) .van-picker';
const selector = (field: Field) => `loc=css:[data-friends-course-field="${field}"]`;

async function choose(page: Page, column: number, expected: string) {
  const selector = `${activePicker} .van-picker-column:nth-child(${column})`;
  // Vant clips distant options; move through visible neighbours and wait for its transition.
  for (let step = 0; step < 60; step++) {
    const values = await page.evaluate(({ selector }) => {
      const d = document.querySelector("iframe")?.contentDocument ?? document;
      const nodes = Array.from(d.querySelectorAll(`${selector} .van-picker-column__item`));
      return { labels: nodes.map(n => n.textContent?.trim()), selected: nodes.findIndex(n => n.classList.contains("van-picker-column__item--selected")) };
    }, { selector });
    const target = values.labels.indexOf(expected);
    if (target < 0 || values.selected < 0) throw new FriendsError({ code: FriendsErrorCode.UpstreamBusiness, message: `Course picker option unavailable: ${expected}` });
    if (target === values.selected) return;
    const next = values.labels[values.selected + Math.sign(target - values.selected) * Math.min(2, Math.abs(target - values.selected))]!;
    await page.click(`loc=css:${selector} .van-ellipsis:text-is(${JSON.stringify(next)})`);
    await page.waitForFunction(({ selector, next }) => {
      const d = document.querySelector("iframe")?.contentDocument ?? document;
      const selected = d.querySelector(`${selector} .van-picker-column__item--selected`);
      const moving = d.querySelector(`${selector} .van-picker-column__wrapper`)?.getAnimations?.().some(a => a.playState === "running") ?? false;
      return selected?.textContent?.trim() === next && !moving;
    }, { selector, next }, { timeout: 5_000 });
  }
  throw new FriendsError({ code: FriendsErrorCode.UnknownOutcome, message: "The course picker did not settle" });
}

export async function prepareCourseOfferingPage(task: Task, input: Input) {
  const page = task.page(input.page);
  const target = new URL(input.url);
  if (await page.url() === "about:blank") await page.goto(target.href);
  await page.waitForSelector("loc=css:.cmine", { timeout: 15_000 });
  const identity = await page.evaluate(({ origin, token, userLevel }) => {
    const frame = document.querySelector("iframe");
    if (frame && frame.contentDocument === null) return { matches: false, url: location.href, courseId: null };
    const w = frame?.contentDocument?.defaultView ?? window;
    let current = w.localStorage.getItem("token_str");
    try {
      if (current?.startsWith("{")) {
        const parsed = JSON.parse(current);
        current = parsed.token ?? (typeof parsed.data === "string" ? parsed.data : parsed.data?.token) ?? "";
      }
    } catch { current = ""; }
    return {
      matches: location.origin === origin && w.location.origin === origin && current === token && w.localStorage.getItem("userLevel_str") === userLevel,
      url: w.location.href,
      courseId: w.sessionStorage.getItem("course_uuid"),
    };
  }, { origin: target.origin, token: input.session.token, userLevel: input.session.userLevel });
  const current = new URL(identity.url);
  if (!identity.matches || current.origin !== target.origin || current.pathname !== target.pathname ||
      current.searchParams.get("type") !== target.searchParams.get("type") ||
      current.searchParams.get("uuid") !== target.searchParams.get("uuid") ||
      (identity.courseId !== null && identity.courseId !== input.prepared.uuid)) {
    throw new FriendsError({ code: FriendsErrorCode.PermissionDenied, message: "The visible course page, account, role, or application does not match" });
  }

  await page.evaluate((labels) => {
    const d = document.querySelector("iframe")?.contentDocument ?? document;
    const normalize = (s: string | null | undefined) => s?.replace(/\s+/g, "") ?? "";
    const cells = Array.from(d.querySelectorAll(".van-cell"));
    for (const node of d.querySelectorAll("[data-friends-course-field]")) node.removeAttribute("data-friends-course-field");
    for (const [field, label] of Object.entries(labels)) {
      const named = Array.from(d.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input[name],textarea[name]")).find(n => n.name === field || n.name === label);
      const cell = named?.closest(".van-cell") ?? cells.find(n => normalize(n.querySelector(".van-cell__title")?.textContent) === label);
      const textField = ["curriculumName", "curriculumPlace", "curriculumContent"].includes(field);
      const target = textField
        ? named ?? cell?.querySelector("input:not([readonly]),textarea:not([readonly])") ?? cell?.closest(".borderf5")?.nextElementSibling?.querySelector("input:not([readonly]),textarea:not([readonly])")
        : cell?.querySelector(".van-field__body > .van-field__control--custom > div") ?? named?.closest(".field-select") ?? cell?.querySelector(".van-field__body > div") ?? cell?.querySelector(".van-field__body");
      target?.setAttribute("data-friends-course-field", field);
    }
    return true;
  }, labels);

  const capture = () => page.evaluate((fields) => {
    const d = document.querySelector("iframe")?.contentDocument ?? document;
    return {
      fields: Object.fromEntries(fields.map(field => {
        const node = d.querySelector(`[data-friends-course-field="${field}"]`);
        const control = node?.matches("input,textarea") ? node : node?.querySelector("input,textarea");
        const value = control ? (control as HTMLInputElement).value : node?.textContent?.trim() ?? "";
        return [field, value === "" || value === "请选择" ? null : value];
      })) as Record<Field, string | null>,
      publicity: d.querySelectorAll(".van-uploader")[0]?.querySelectorAll(".van-uploader__preview").length ?? 0,
      attachments: d.querySelectorAll(".van-uploader")[1]?.querySelectorAll(".van-uploader__preview").length ?? 0,
    };
  }, Object.keys(labels) as Field[]);
  const actions: Array<{ field: string; action: "filled" | "already-matching" | "human-value-preserved" | "missing" }> = [];
  let executionError: { code: string; message: string } | null = null;
  const requested: Partial<Record<Field, string>> = {
    curriculumName: input.prepared.firstStep.curriculumName, curriculumPlace: input.prepared.firstStep.curriculumPlace,
    curriculumContent: input.prepared.firstStep.curriculumContent, curriculumType: input.prepared.typeName,
    curriculumLevel: input.prepared.levelName, organizationName: input.prepared.organization.name,
    beginTime: input.prepared.firstStep.beginTime, endTime: input.prepared.firstStep.endTime,
  };
  try {
    for (const [field, expected] of Object.entries(requested) as Array<[Field, string]>) {
      const value = (await capture()).fields[field];
      const isDate = field === "beginTime" || field === "endTime";
      if (value === expected || (isDate && value === expected.slice(0, 16))) {
        actions.push({ field, action: "already-matching" });
      } else if (value !== null) {
        actions.push({ field, action: "human-value-preserved" });
      } else if (["curriculumName", "curriculumPlace", "curriculumContent"].includes(field)) {
        await page.fill(selector(field), expected);
        if ((await capture()).fields[field] !== expected) throw new Error(`Course field did not retain its value: ${field}`);
        actions.push({ field, action: "filled" });
      } else {
        await page.click(selector(field));
        await page.waitForSelector(`loc=css:${activePicker}`, { state: "visible", timeout: 15_000 });
        await page.snapshot();
        const columns = isDate ? expected.slice(0, 16).split(/[- :]/) : [expected];
        for (const [i, label] of columns.entries()) await choose(page, i + 1, label);
        await page.click(`loc=css:${activePicker} .van-picker__confirm`);
        await page.waitForSelector(`loc=css:${activePicker}`, { state: "hidden", timeout: 15_000 });
        const actual = (await capture()).fields[field];
        if (actual !== expected && !(isDate && actual === expected.slice(0, 16))) throw new Error(`Course picker did not retain its value: ${field}`);
        actions.push({ field, action: "filled" });
      }
    }
  } catch (error) {
    executionError = { code: error instanceof FriendsError ? error.code : FriendsErrorCode.UnknownOutcome, message: error instanceof Error ? error.message : "Visible course preparation failed" };
  }
  const final = await capture();
  for (const field of ["role", "attestationType"] as const) actions.push({ field, action: final.fields[field] === null ? "missing" : "human-value-preserved" });
  const missing = Object.entries(final.fields).filter(([, v]) => v === null).map(([field]) => field);
  if (final.publicity === 0) missing.push("materials:publicity");
  if (final.attachments === 0) missing.push("materials:attachment");
  missing.push("human-review:report-settings-and-final-submit");
  await page.snapshot();
  await task.handOff();
  return { status: "awaiting-user" as const, submitted: false as const, handoff: "completed" as const,
    actions, missing, executionError, page: final.fields };
}
