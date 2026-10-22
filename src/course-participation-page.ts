/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { FriendsError, FriendsErrorCode } from "./errors.js";
import type { CourseParticipationSession, CourseQuestionnaireAnswerInput, PreparedCourseApply } from "./course-participation.js";

interface Page {
  url(): Promise<string>;
  goto(url: string): Promise<unknown>;
  snapshot(options?: { scope: "full_page" }): Promise<unknown>;
  click(selector: string): Promise<unknown>;
  fill(selector: string, value: string): Promise<unknown>;
  setInputFiles(selector: string, paths: string[]): Promise<unknown>;
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<Awaited<T>>;
  waitForFunction<A>(fn: (arg: A) => unknown, arg: A, options: { timeout: number }): Promise<unknown>;
}
interface Task { page(label: string): Page; handOff(): Promise<unknown> }
interface Input {
  operation: "apply" | "withdraw" | "exit";
  page: string;
  route: string;
  courseId?: string;
  registrationId?: string;
  courseName: string;
  session: CourseParticipationSession;
  prepared?: PreparedCourseApply;
  roleId?: string;
  answers?: CourseQuestionnaireAnswerInput[];
  paths: Record<string, string[]>;
}

/** Runs in Ego's Node process; evaluate only reads the school page. */
export async function prepareCourseParticipationPage(task: Task, input: Input) {
  const page = task.page(input.page);
  if (await page.url() === "about:blank") await page.goto(input.route);
  const completedActions: string[] = [], preservedInputs: string[] = [], pendingInputs: string[] = [];
  let attempted: string | undefined;
  let handoffAttempted = false;
  const capture = () => page.evaluate(({ session, operation, courseId, courseName, definitions, expectedOrigin }) => {
    const frame = document.querySelector<HTMLIFrameElement>("iframe");
    const d = frame?.contentDocument ?? document;
    const w = d.defaultView!;
    const clean = (value: string | null | undefined) => value?.replace(/\s+/g, " ").trim() ?? "";
    let bound = false;
    try {
      const token = (storage: Storage) => {
        const raw = storage.getItem("token_str");
        if (!raw?.startsWith("{")) return raw;
        const parsed = JSON.parse(raw); return parsed.token ?? parsed.data?.token ?? parsed.data;
      };
      const info = JSON.parse(w.localStorage.getItem("userInfo_obj") ?? "null");
      const url = new URL(w.location.href);
      bound = location.origin === expectedOrigin && w.location.origin === location.origin &&
        token(localStorage) === session.token && token(w.localStorage) === session.token &&
        localStorage.getItem("userLevel_str") === session.userLevel && w.localStorage.getItem("userLevel_str") === session.userLevel &&
        info?.account === session.account.userNo && info?.userLoginStateLevel === session.context.levelNo && info?.departmentNo === session.context.unit.unitNo &&
        (operation === "apply" ? url.pathname === "/mobile/course/stuCourseDetail" && url.searchParams.get("uuid") === courseId && url.searchParams.get("type") === "Apply" : url.pathname === "/mobile/course/stuCourseQuery");
    } catch { /* A missing or changed binding is not safe to edit. */ }
    const cell = [...d.querySelectorAll(".activity-info .van-cell")].find(e => clean(e.querySelector(".van-cell__title")?.textContent) === "课程名称");
    const name = clean(cell?.querySelector(".van-cell__value")?.textContent);
    if (operation === "apply" && name !== courseName) bound = false;
    // Ego selectors prefer the outer document; never let a lookalike form intercept an iframe action.
    if (frame && document.querySelector(operation === "apply" ? ".report-info-set" : ".list-group")) bound = false;
    const groups = [...d.querySelectorAll(".report-info-set > .form-content")];
    const questions = definitions.map((definition, i) => {
      const q = groups[i];
      const selector = `.report-info-set > .form-content:nth-child(${i + 1})`;
      const title = clean(q?.querySelector(".top-title")?.textContent).replace(/^\d+\.\s*/, "");
      if (!q || title !== definition.title) bound = false;
      const control = q?.querySelector<HTMLInputElement | HTMLTextAreaElement>("textarea,input:not([type=file])");
      const choices = [...q?.querySelectorAll<HTMLElement>("[role=radio],[role=checkbox]") ?? []].map(e => ({
        name: clean(e.closest(".van-cell")?.querySelector(".van-cell__title")?.textContent),
        selected: e.getAttribute("aria-checked") === "true", disabled: e.getAttribute("aria-disabled") === "true",
      }));
      return { id: definition.id, selector, value: control?.value ?? "", editable: !!control && !control.disabled && !control.readOnly,
        control: control?.tagName === "TEXTAREA" ? "textarea" : "input:not([type=file])", choices,
        previews: q?.querySelectorAll(".van-uploader__preview").length ?? 0,
        upload: !!q?.querySelector(".form-uploader input[type=file]:not(:disabled)") };
    });
    const rows = [...d.querySelectorAll(".list-group")].map((row, i) => ({
      selector: `.list-group:nth-of-type(${[...row.parentElement!.children].filter(e => e.tagName === row.tagName).indexOf(row) + 1})`,
      unique: d.querySelectorAll(`.list-group:nth-of-type(${[...row.parentElement!.children].filter(e => e.tagName === row.tagName).indexOf(row) + 1})`).length === 1,
      name: clean(row.querySelector(".list-item-bottom-line")?.textContent),
      actions: [...row.querySelectorAll(".list-action > div")].map((e, j) => ({ text: clean(e.textContent), index: j })),
    }));
    return { bound, questions, rows, dialog: !!d.querySelector(".van-dialog"),
      role: d.querySelector<HTMLInputElement>('input[name="roleName"]')?.value ?? "",
      applyButton: [...d.querySelectorAll<HTMLButtonElement>(".footer button")].some(e => clean(e.textContent) === "申请加入" && !e.disabled),
      dialogTitle: clean(d.querySelector(".van-dialog__header")?.textContent) };
  }, { session: input.session, operation: input.operation, courseId: input.courseId, courseName: input.courseName, definitions: input.prepared?.questionnaires ?? [], expectedOrigin: new URL(input.route).origin });
  const inspect = async () => {
    const state = await capture();
    if (!state.bound) throw new FriendsError({ code: FriendsErrorCode.PermissionDenied, message: "The visible course page, account or context does not match the verified request" });
    return state;
  };
  await page.snapshot({ scope: "full_page" });
  const initial = await inspect();
  let role: { id: string; name: string; status: string } | null = null;
  if (input.operation === "apply") {
    if (!initial.applyButton) throw new FriendsError({ code: FriendsErrorCode.UpstreamBusiness, message: "The school apply form is not available" });
    const selected = input.prepared?.roles.find(role => role.id === input.roleId);
    if (selected) role = { id: selected.id, name: selected.name,
      status: initial.role === selected.name ? "already-matching" : initial.role ? "human-value-preserved" : "human-required" };
    // The production role picker is commented out; never inject a hidden role model.
    if (input.prepared?.rolesRequired && role?.status !== "already-matching") pendingInputs.push("role: review the requested role in the school form; the source build has no active role picker");
  }
  try {
    if (input.operation === "apply") {
      for (const answer of input.answers ?? []) {
        await page.snapshot({ scope: "full_page" });
        const state = await inspect();
        const q = state.questions.find(q => q.id === answer.questionId)!;
        const definition = input.prepared!.questionnaires.find(q => q.id === answer.questionId)!;
        if ("text" in answer) {
          if (q.value) { if (q.value !== answer.text.trim()) preservedInputs.push(q.id); continue; }
          if (!q.editable) { pendingInputs.push(q.id); continue; }
          attempted = `fill:${q.id}`;
          await page.fill(`loc=css:${q.selector} ${q.control}`, answer.text.trim());
          if ((await inspect()).questions.find(item => item.id === q.id)?.value !== answer.text.trim()) throw new Error("The school form did not retain the entered answer");
        } else if ("attachments" in answer) {
          if (q.previews > 0) { preservedInputs.push(q.id); continue; }
          if (!q.upload) { pendingInputs.push(q.id); continue; }
          let count = 0;
          for (const path of input.paths[q.id] ?? []) {
            const before = (await inspect()).questions.find(item => item.id === q.id)!;
            if (before.previews !== count) throw new Error("A human changed the attachments; inspect before continuing");
            attempted = `upload:${q.id}:${path.split(/[\\/]/).at(-1)}`;
            await page.setInputFiles(`loc=css:${q.selector} .form-uploader input[type=file]`, [path]);
            count++;
            await page.waitForFunction(({ selector, count }) => {
              const d = document.querySelector<HTMLIFrameElement>("iframe")?.contentDocument ?? document;
              const uploader = d.querySelector(`${selector} .form-uploader`);
              return uploader?.querySelectorAll(".van-uploader__preview").length === count && !uploader.querySelector(".van-uploader__mask");
            }, { selector: q.selector, count }, { timeout: 15000 });
            await inspect();
            completedActions.push(attempted); attempted = undefined;
          }
          continue;
        } else {
          const ids = "choiceOptionId" in answer ? [answer.choiceOptionId] : answer.choiceOptionIds;
          const names = ids.map(id => definition.options.find(option => option.id === id)!.name);
          const selected = q.choices.filter(choice => choice.selected).map(choice => choice.name);
          if (selected.length) { if (selected.length !== names.length || !selected.every(name => names.includes(name))) preservedInputs.push(q.id); continue; }
          if (names.some(name => q.choices.filter(choice => choice.name === name && !choice.disabled).length !== 1)) throw new Error("The visible questionnaire options are ambiguous");
          for (const name of names) {
            attempted = `choice:${q.id}:${name}`;
            const index = q.choices.findIndex(choice => choice.name === name);
            await page.click(`loc=css:${q.selector} [role=${definition.itemType === "CHOICE" ? "radio" : "checkbox"}] >> nth=${index}`);
            if (!(await inspect()).questions.find(item => item.id === q.id)?.choices.some(choice => choice.name === name && choice.selected)) throw new Error("The school form did not retain the chosen option");
            completedActions.push(attempted); attempted = undefined;
          }
          continue;
        }
        completedActions.push(attempted!); attempted = undefined;
      }
    } else {
      if (initial.dialog) throw new FriendsError({ code: FriendsErrorCode.PermissionDenied, message: "Preserve the existing human confirmation dialog" });
      const matching = initial.rows.filter(row => row.name === input.courseName);
      if (matching.length !== 1 || !matching[0].unique) throw new FriendsError({ code: FriendsErrorCode.UpstreamBusiness, message: "The exact personal course row is missing or ambiguous; select it manually" });
      const action = input.operation === "withdraw" ? "撤销" : "退出报名";
      const actions = matching[0].actions.filter(item => item.text === action);
      if (actions.length !== 1) throw new FriendsError({ code: FriendsErrorCode.UpstreamBusiness, message: "The requested course action is not available in the school page" });
      await page.snapshot({ scope: "full_page" });
      const fresh = await inspect();
      if (fresh.dialog || fresh.rows.filter(row => row.name === input.courseName).length !== 1 || fresh.rows.find(row => row.name === input.courseName)?.selector !== matching[0].selector) throw new FriendsError({ code: FriendsErrorCode.PermissionDenied, message: "The personal course row changed; preserve the page" });
      attempted = `open-${input.operation}-dialog`;
      await page.click(`loc=css:${matching[0].selector} .list-action > div:nth-child(${actions[0].index + 1})`);
      await page.waitForFunction((title) => {
        const d = document.querySelector<HTMLIFrameElement>("iframe")?.contentDocument ?? document;
        return d.querySelector(".van-dialog__header")?.textContent?.trim() === title;
      }, input.operation === "withdraw" ? "撤销确认" : "退出确认", { timeout: 15000 });
      const after = await inspect();
      if (after.dialogTitle !== (input.operation === "withdraw" ? "撤销确认" : "退出确认")) throw new Error("The requested confirmation did not appear");
      completedActions.push(attempted); attempted = undefined;
    }
    await page.snapshot({ scope: "full_page" }); await inspect();
    handoffAttempted = true;
    await task.handOff();
  } catch (cause) {
    if (!attempted && completedActions.length === 0 && cause instanceof FriendsError) throw cause;
    if (!handoffAttempted) {
      handoffAttempted = true;
      try { await task.handOff(); } catch { /* Keep the interrupted preparation and recovery information. */ }
    }
    throw new FriendsError({ code: FriendsErrorCode.UnknownOutcome,
      message: "Course preparation was interrupted; preserve the page and inspect it before any retry", cause,
      recovery: { operation: `courses.registrations.${input.operation}.prepare`, courseId: input.courseId,
        registrationId: input.registrationId, completed: [...completedActions, ...(attempted ? [`attempted:${attempted}`] : [])] } });
  }
  return { role, completedActions, preservedInputs, pendingInputs };
}
