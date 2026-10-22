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
    session: {token:string; userLevel:string};
    decision: 'pass' | 'back' | 'refuse';
    message: string;
    time: string;
    isSafeEducation?: 0 | 1;
    callbackActivityId?: unknown;
}) {
    const completed: string[] = [];
    function inspect() {
        const frame = document.querySelector("iframe");
        const d = frame ? frame.contentDocument : document;
        const w = d?.defaultView;
        if (!d || !w) return {url:null,token:null,userLevel:null,title:null,message:'',safe:[],date:null,callback:false};
        let token=w.localStorage.getItem('token_str');
        try {if(token?.startsWith('{')){const parsed=JSON.parse(token);token=parsed.token??(typeof parsed.data==='string'?parsed.data:parsed.data?.token)??null;}} catch {token=null;}
        const visible = (e: Element) => { for (let n: Element | null = e; n; n = n.parentElement)
            if (getComputedStyle(n).display === 'none' || getComputedStyle(n).visibility === 'hidden')
                return false; return true; };
        const dialogs = [...d.querySelectorAll('.van-dialog')].filter(visible);
        const dialog = dialogs[0];
        const textarea = dialog?.querySelector('textarea');
        return { url:w.location.href,token,userLevel:w.localStorage.getItem('userLevel_str'),title: dialog?.querySelector('.van-dialog__header')?.textContent?.trim() ?? null, message: (textarea as HTMLTextAreaElement)?.value ?? '', safe: [...dialog?.querySelectorAll('[role="radio"]') ?? []].filter(e => e.getAttribute('aria-checked') === 'true').map(e => e.textContent?.trim()), date: (dialog?.querySelector('input[name="time"]') as HTMLInputElement)?.value ?? null, callback: !!dialog?.querySelector('input[name="callbackActivityId"]') };
    }
    async function readState() {
        const state=await page.evaluate(inspect);
        const target=new URL(input.url);
        const current=state.url?new URL(state.url):null;
        if(!current || current.origin!==target.origin || current.pathname!==target.pathname ||
           [...target.searchParams].some(([key,value])=>current.searchParams.get(key)!==value) ||
           state.token!==input.session.token || state.userLevel!==input.session.userLevel) {
            throw Object.assign(new Error('The visible review iframe, account, role, or application does not match'),{code:'PERMISSION_DENIED'});
        }
        return state;
    }
    try {
        await readState();
        await page.snapshot({ scope: 'full_page' });
        const expected = { pass: '审批通过', back: '审批打回', refuse: '审批拒绝' }[input.decision];
        let state = await readState();
        if (state.title && state.title !== expected)
            return { status: 'needs-user' as const, submitted: false as const, completed, manualFields: ['different-open-decision'] };
        if (!state.title) {
            const button = { pass: '通过', back: '打回', refuse: '拒绝' }[input.decision];
            await page.click(`loc=css:.action-bar button:has-text("${button}")`);
            completed.push('opened-decision');
            await page.waitForSelector('loc=css:.van-dialog textarea');
            await page.snapshot({ scope: 'full_page' });
            state = await readState();
            if (state.title !== expected)
                throw new Error('Unexpected decision dialog');
        }
        state = await readState();
        const manualFields: string[] = [];
        if (!state.message) {
            await page.fill('loc=css:.van-dialog textarea', input.message);
            completed.push('filled-message');
        }
        else if (state.message !== input.message)
            manualFields.push('preserved-human-message');
        if (input.isSafeEducation !== undefined) {
            state=await readState();
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
    catch (error) {
        if(completed.length===0 && (error as {code?:string})?.code==='PERMISSION_DENIED') {
            return {status:'needs-user' as const,submitted:false as const,completed,manualFields:[],denied:true,error:(error as Error).message,errorCode:'PERMISSION_DENIED'};
        }
        return { status: 'needs-user' as const, submitted: false as const, completed, manualFields: ['inspect-partial-form'], executionError: true };
    }
}
