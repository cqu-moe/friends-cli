/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

// These source-specific buttons only open local popups; their final 确定 stays with the user.
export async function prepareOrganizationActivityReviewPage(page: {
  goto(url: string): Promise<unknown>;
  snapshot(options?: unknown): Promise<unknown>;
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>;
  click(selector: string): Promise<unknown>;
  fill(selector: string, value: string): Promise<unknown>;
  waitForSelector(selector: string, options?: unknown): Promise<unknown>;
}, input: { url: string; decision: "pass" | "back" | "refuse"; message: string; time: string; token: string; userLevel: string }) {
  const completed: string[] = [], manualFields: string[] = [];
  function inspect(expected: { token: string; userLevel: string }) {
    const d = document.querySelector("iframe")?.contentDocument ?? document;
    const w = d.defaultView!;
    const visible = (element: Element) => {
      for (let node: Element | null = element; node; node = node.parentElement) if (w.getComputedStyle(node).display === "none" || w.getComputedStyle(node).visibility === "hidden" || node.hasAttribute("hidden")) return false;
      return true;
    };
    const popups = [...d.querySelectorAll(".pop")].filter(visible);
    const popup = popups.length === 1 ? popups[0] : undefined;
    const area = popup?.querySelector<HTMLTextAreaElement>(".advice textarea");
    return { url: w.location.href, sessionMatches: w.location.origin === location.origin && w.localStorage.getItem("token_str") === expected.token && w.localStorage.getItem("userLevel_str") === expected.userLevel,
      hasInputs: [...d.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea")].some(node => visible(node) && !node.disabled && !node.readOnly && Boolean(node.value)),
      popups: popups.length, title: popup?.querySelector(".title")?.textContent?.trim() ?? null, message: area?.value ?? null,
      time: popup?.querySelector(".time div:last-child")?.textContent?.trim() ?? null,
      buttons: [...d.querySelectorAll(".btn button")].filter(visible).map(node => node.textContent?.trim()),
    };
  }
  const expectedSession = { token: input.token, userLevel: input.userLevel };
  const sameTarget = (url: string) => {
    const actual = new URL(url), target = new URL(input.url);
    return actual.origin === target.origin && actual.pathname === target.pathname && ["uuid", "acId", "studentNo"].every(key => !target.searchParams.has(key) || actual.searchParams.get(key) === target.searchParams.get(key));
  };
  try {
    await page.snapshot({ scope: "full_page" });
    let state = await page.evaluate(inspect, expectedSession);
    if (!state.sessionMatches) throw new Error("Page identity changed");
    if (!sameTarget(state.url)) {
      const actual = new URL(state.url), target = new URL(input.url);
      if (actual.origin !== target.origin || !actual.pathname.startsWith("/mobile/") || state.hasInputs) return { status: "needs-user" as const, submitted: false as const, completed, manualFields: ["preserve-existing-page"] };
      await page.goto(input.url); completed.push("opened-review");
      await page.waitForSelector('loc=css:.btn button:text-is("通过")');
      await page.snapshot({ scope: "full_page" }); state = await page.evaluate(inspect, expectedSession);
    }
    if (!state.sessionMatches || !sameTarget(state.url)) throw new Error("Wrong review page");
    const label = { pass: "通过", back: "打回", refuse: "拒绝" }[input.decision], title = "审批" + label;
    if (state.popups > 1 || state.title && state.title !== title) return { status: "needs-user" as const, submitted: false as const, completed, manualFields: ["preserve-open-popup"] };
    if (!state.title) {
      if (state.buttons.filter(value => value === label).length !== 1) throw new Error("Decision button is missing or ambiguous");
      await page.click(`loc=css:.btn button:text-is(${JSON.stringify(label)})`); completed.push("opened-decision");
      await page.waitForSelector("loc=css:.pop .advice textarea");
      await page.snapshot({ scope: "full_page" }); state = await page.evaluate(inspect, expectedSession);
    }
    if (!state.sessionMatches || !sameTarget(state.url) || state.title !== title || state.message === null) throw new Error("Decision popup changed");
    if (state.message === "") { await page.fill("loc=css:.pop .advice textarea", input.message); completed.push("filled-message"); }
    else if (state.message !== input.message) manualFields.push("preserved-human-message");
    if (state.time !== input.time) manualFields.push("review-date");
    await page.snapshot({ scope: "full_page" });
    return { status: "awaiting-user" as const, submitted: false as const, completed, manualFields };
  } catch {
    return { status: "needs-user" as const, submitted: false as const, completed, manualFields: ["inspect-partial-form"], executionError: true };
  }
}
