/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

interface LeaderPage {
  evaluate<T, A>(callback: (argument: A) => T, argument: A): Promise<T>;
  snapshot(options: { scope: string }): Promise<string>;
  click(selector: string): Promise<unknown>;
  fill(selector: string, value: string): Promise<unknown>;
  waitForFunction<A>(callback: (argument: A) => unknown, argument: A, options: { timeout: number }): Promise<unknown>;
}

export async function prepareOrganizationLeaderPage(page: LeaderPage, input: {
  url: string; token: string; userLevel: string; candidateName: string; candidateStudentNo: string;
  candidateRow: string; phone: string; political: string; postName: string | null; reason: string; dryRun: boolean;
}) {
  const actions: string[] = [];
  const manualFields: string[] = [];
  async function inspect() {
    return page.evaluate(expected => {
      const target = document.querySelector("iframe")?.contentWindow ?? window;
      const origin = new URL(expected.url).origin;
      if (location.origin !== origin || target.location.href !== expected.url ||
          localStorage.getItem("token_str") !== expected.token || target.localStorage.getItem("token_str") !== expected.token ||
          localStorage.getItem("userLevel_str") !== expected.userLevel || target.localStorage.getItem("userLevel_str") !== expected.userLevel) {
        throw new Error("The visible organization form or verified session changed");
      }
      const doc = target.document;
      const visible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const named = (name: string, label: string) => {
        const selector = `input[name="${name}"]`;
        const inputs = [...doc.querySelectorAll<HTMLInputElement>(selector)].filter(visible);
        if (inputs.length === 1) return { value: inputs[0].value, selector };
        if (inputs.length > 1) throw new Error("Ambiguous form control: " + name);
        const fields = [...doc.querySelectorAll<HTMLElement>(".van-field")];
        const matching = fields.filter(field => visible(field) &&
          field.closest(".field-block")?.textContent?.includes("新负责人") &&
          field.querySelector(".van-field__label")?.textContent?.trim() === label);
        if (matching.length !== 1) return { value: null, selector: null };
        const field = matching[0];
        return { value: field.querySelector(".van-field__body")?.textContent?.trim() ?? "",
          selector: `loc=css:.van-field >> nth=${fields.indexOf(field)}` };
      };
      const candidate = named("newResponsiblePersonName", "负责人");
      const post = named("newPostUuidName", "负责人职务");
      const phones = [...doc.querySelectorAll<HTMLInputElement>('input[name="newResponsiblePhone"]')].filter(visible);
      const reasons = [...doc.querySelectorAll<HTMLTextAreaElement>('textarea[placeholder="请输入变更原因"]')].filter(visible);
      if (phones.length !== 1 || reasons.length !== 1) throw new Error("Expected one phone and reason control");
      const politics = [...doc.querySelectorAll(".van-field")].find(field =>
        field.closest(".field-block")?.textContent?.includes("新负责人") &&
        field.querySelector(".van-field__label")?.textContent?.trim() === "政治面貌");
      const political = politics?.querySelector(".van-field__body")?.textContent?.trim() ?? null;
      const humanSearch = [...doc.querySelectorAll<HTMLInputElement>('input[placeholder="学号/姓名"]')]
        .some(field => visible(field) && field.value !== "");
      return { candidate, post, phone: phones[0].value, reason: reasons[0].value, political, humanSearch };
    }, input);
  }
  function ref(snapshot: string, label: string): string {
    const entries = snapshot.split(/\n(?=[^\n]*\[ref=\d+\])/);
    const refs = entries.flatMap(entry => {
      const match = entry.match(/\[ref=(\d+)\]/);
      if (!match) return [];
      const text = entry.replace(/\[ref=\d+\]/g, "").replace(/^[\s-]*(button|generic|textbox|radio|option)\b/, "").replace(/["']/g, "").trim();
      return text === label ? ["@" + match[1]] : [];
    });
    if (refs.length !== 1) throw new Error("Expected one visible snapshot target: " + label);
    return refs[0];
  }
  async function click(label: string) {
    const snapshot = await page.snapshot({ scope: "full_page" });
    await page.click(ref(snapshot, label));
    actions.push("selected:" + label);
  }
  try {
    let state = await inspect();
    if (input.dryRun) return { status: "prepared" as const, submitted: false as const, dryRun: true, actions, manualFields };
    if (state.humanSearch || !state.candidate.selector || state.candidate.value) {
      manualFields.push(state.candidate.value === input.candidateName ? "candidate-identity" : "candidate");
      return { status: "awaiting-user" as const, submitted: false as const, actions, manualFields };
    }
    if (!state.candidate.value) {
      if (state.phone || state.reason || state.post.value && state.post.value !== "请选择") {
        manualFields.push("candidate", "preserved-human-fields");
        return { status: "awaiting-user" as const, submitted: false as const, actions, manualFields };
      }
      await page.snapshot({ scope: "full_page" });
      await page.click(state.candidate.selector);
      actions.push("opened-candidate-search");
      const snapshot = await page.snapshot({ scope: "full_page" });
      await page.fill(ref(snapshot, "学号/姓名"), input.candidateStudentNo);
      actions.push("searched-student-number");
      await click("搜索");
      await page.waitForFunction((row) => {
        const doc = (document.querySelector("iframe")?.contentWindow ?? window).document;
        return doc.body.innerText.includes(row);
      }, input.candidateRow, { timeout: 15000 });
      const radioIndex = await page.evaluate((row) => {
        const doc = (document.querySelector("iframe")?.contentWindow ?? window).document;
        const radios = [...doc.querySelectorAll('[role="radio"]')];
        const matches = radios.filter(radio => radio.closest(".stu-info")?.textContent?.trim() === row);
        if (matches.length !== 1) throw new Error("Expected exactly one candidate radio row");
        return radios.indexOf(matches[0]);
      }, input.candidateRow);
      await page.snapshot({ scope: "full_page" });
      await page.click(`loc=css:[role="radio"] >> nth=${radioIndex}`);
      actions.push("selected-candidate");
      await page.waitForFunction((row) => {
        const doc = (document.querySelector("iframe")?.contentWindow ?? window).document;
        return [...doc.querySelectorAll('[role="radio"]')].some(radio =>
          radio.closest(".stu-info")?.textContent?.trim() === row && radio.getAttribute("aria-checked") === "true");
      }, input.candidateRow, { timeout: 15000 });
      await click("确定");
      await page.waitForFunction((name) => {
        const doc = (document.querySelector("iframe")?.contentWindow ?? window).document;
        const field = doc.querySelector<HTMLInputElement>('input[name="newResponsiblePersonName"]');
        return field ? field.value === name : doc.body.innerText.includes(name);
      }, input.candidateName, { timeout: 15000 });
      state = await inspect();
      if (state.candidate.value !== input.candidateName) throw new Error("The chosen candidate did not remain visible");
    }
    if (state.political !== input.political) manualFields.push("political");
    if (input.postName !== null) {
      if (!state.post.selector) manualFields.push("post");
      else if (!state.post.value || state.post.value === "请选择") {
        await page.snapshot({ scope: "full_page" });
        await page.click(state.post.selector);
        actions.push("opened-post-picker");
        await click(input.postName);
        await click("确认");
      } else if (state.post.value !== input.postName) manualFields.push("post");
    }
    for (const [key, selector, expected] of [
      ["phone", 'input[name="newResponsiblePhone"]', input.phone],
      ["reason", 'textarea[placeholder="请输入变更原因"]', input.reason],
    ] as const) {
      const current = (await inspect())[key];
      if (current === "" && expected !== "") {
        await page.snapshot({ scope: "full_page" });
        await page.fill(selector, expected);
        const readback = (await inspect())[key];
        if (readback !== expected) throw new Error("The visible field did not retain its value: " + key);
        actions.push("filled:" + key);
      } else if (current !== expected) manualFields.push(key);
    }
    const after = await inspect();
    if (after.candidate.value !== input.candidateName) throw new Error("The candidate changed during preparation");
    if (input.postName !== null && after.post.value !== input.postName && !manualFields.includes("post")) throw new Error("The post was not selected");
    return { status: "awaiting-user" as const, submitted: false as const, actions, manualFields };
  } catch (error) {
    return { status: "awaiting-user" as const, submitted: false as const, actions, manualFields,
      executionError: error instanceof Error ? error.message : "Visible preparation failed" };
  }
}
