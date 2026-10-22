// Only visible school controls are used; the dialog's confirmation remains manual.
export async function prepareVolunteerActivityReviewPage(page: {
    url(): Promise<string>;
    goto(url: string): Promise<unknown>;
    snapshot(options?: unknown): Promise<unknown>;
    evaluate<T>(fn: (arg: any) => T, arg?: any): Promise<T>;
    click(selector: string): Promise<unknown>;
    fill(selector: string, value: string): Promise<unknown>;
    waitForSelector(selector: string, options?: unknown): Promise<unknown>;
}, input: {
    url: string;
    decision: 'pass' | 'back' | 'refuse';
    message: string;
    time: string;
    isSafeEducation?: 0 | 1;
    callbackActivityId?: unknown;
}) {
    const completed: string[] = [];
    function inspect() {
        const visible = (e: Element) => { for (let n: Element | null = e; n; n = n.parentElement)
            if (getComputedStyle(n).display === 'none' || getComputedStyle(n).visibility === 'hidden')
                return false; return true; };
        const dialogs = [...document.querySelectorAll('.van-dialog')].filter(visible);
        const dialog = dialogs[0];
        const textarea = dialog?.querySelector('textarea');
        return { hasInputs: [...document.querySelectorAll('input,textarea')].some(e => visible(e) && !!(e as HTMLInputElement).value), title: dialog?.querySelector('.van-dialog__header')?.textContent?.trim() ?? null, message: (textarea as HTMLTextAreaElement)?.value ?? '', safe: [...dialog?.querySelectorAll('[role="radio"]') ?? []].filter(e => e.getAttribute('aria-checked') === 'true').map(e => e.textContent?.trim()), date: (dialog?.querySelector('input[name="time"]') as HTMLInputElement)?.value ?? null, callback: !!dialog?.querySelector('input[name="callbackActivityId"]') };
    }
    try {
        const url = await page.url();
        await page.snapshot({ scope: 'full_page' });
        const current = new URL(url);
        const target = new URL(input.url);
        const sameTarget = current.origin === target.origin && current.pathname === target.pathname && [...target.searchParams].every(([key, value]) => current.searchParams.get(key) === value);
        if (!sameTarget) {
            if (current.origin !== target.origin || !current.pathname.startsWith('/mobile/'))
                return { status: 'needs-user' as const, submitted: false as const, completed, manualFields: ['unrelated-page'] };
            const state = await page.evaluate(inspect);
            if (state.hasInputs)
                return { status: 'needs-user' as const, submitted: false as const, completed, manualFields: ['existing-page-inputs'] };
            await page.goto(input.url);
            completed.push('opened-review');
            await page.waitForSelector('loc=css:.action-bar button:has-text("通过")');
            await page.snapshot({ scope: 'full_page' });
        }
        const expected = { pass: '审批通过', back: '审批打回', refuse: '审批拒绝' }[input.decision];
        let state = await page.evaluate(inspect);
        if (state.title && state.title !== expected)
            return { status: 'needs-user' as const, submitted: false as const, completed, manualFields: ['different-open-decision'] };
        if (!state.title) {
            const button = { pass: '通过', back: '打回', refuse: '拒绝' }[input.decision];
            await page.click(`loc=css:.action-bar button:has-text("${button}")`);
            completed.push('opened-decision');
            await page.waitForSelector('loc=css:.van-dialog textarea');
            await page.snapshot({ scope: 'full_page' });
            state = await page.evaluate(inspect);
            if (state.title !== expected)
                throw new Error('Unexpected decision dialog');
        }
        const manualFields: string[] = [];
        if (!state.message) {
            await page.fill('loc=css:.van-dialog textarea', input.message);
            completed.push('filled-message');
        }
        else if (state.message !== input.message)
            manualFields.push('preserved-human-message');
        if (input.isSafeEducation !== undefined) {
            const label = input.isSafeEducation === 1 ? '是' : '否';
            if (state.safe.length === 0) {
                await page.click(`loc=css:.van-dialog [role="radio"]:has-text("${label}")`);
                completed.push('selected-safety-education');
            }
            else if (!state.safe.includes(label))
                manualFields.push('preserved-human-safety-education');
        }
        if (state.date !== input.time)
            manualFields.push('review-date');
        if (state.callback)
            manualFields.push('callback-node');
        await page.snapshot({ scope: 'full_page' });
        return { status: 'awaiting-user' as const, submitted: false as const, completed, manualFields };
    }
    catch {
        return { status: 'needs-user' as const, submitted: false as const, completed, manualFields: ['inspect-partial-form'], executionError: true };
    }
}
