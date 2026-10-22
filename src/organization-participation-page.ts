import type { OrganizationParticipationPlan } from './organization-participation.js';
export async function prepareOrganizationParticipationPage(page: {
    url(): Promise<string>;
    goto(url: string): Promise<unknown>;
    snapshot(options?: unknown): Promise<unknown>;
    evaluate<T>(fn: (arg: any) => T, arg?: any): Promise<T>;
    click(selector: string): Promise<unknown>;
    fill(selector: string, value: string): Promise<unknown>;
    waitForSelector(selector: string, options?: unknown): Promise<unknown>;
}, input: {
    url: string;
    plan: OrganizationParticipationPlan;
    answers: Record<string, string | string[]>;
    token: string;
    userLevel: string;
}) {
    const completed: string[] = [], manualFields: string[] = [];
    const literal = (value: string) => value.includes("'") ? 'concat(' + value.split("'").map(v => "'" + v + "'").join(',"\'",') + ')' : "'" + value + "'";
    function inspect() {
        const frame = document.querySelector('iframe');
        const d = frame ? frame.contentDocument : document;
        if(!d)throw new Error('The visible activity iframe is unavailable');
        const visible = (e: Element) => {
            for (let p: Element | null = e; p; p = p.parentElement)
                if (getComputedStyle(p).display === 'none' || getComputedStyle(p).visibility === 'hidden') return false;
            return true;
        };
        const documents = d === document ? [d] : [document, d];
        const hasInputs = documents.some(doc =>
            [...doc.querySelectorAll('input:not([type=hidden]),textarea,select,[contenteditable="true"]')].some(e => {
                if (!visible(e)) return false;
                const field = e as HTMLInputElement;
                if (field.type === 'checkbox' || field.type === 'radio') return field.checked;
                if (field.type === 'file') return !!field.files?.length || !!field.value;
                if (field.type === 'button' || field.type === 'submit') return false;
                return !!(field.value ?? e.textContent)?.trim();
            }) || [...doc.querySelectorAll('[aria-checked="true"],.van-radio__icon--checked,.van-checkbox__icon--checked,.van-uploader__preview')].some(visible));
        return {
            url: d.location.href,
            hasInputs,
            questions: [...d.querySelectorAll('.form-container')].map(e => ({
                title: e.querySelector('.form-title')?.textContent?.trim().replace(/^\d+\./, '') ?? '',
                value: (e.querySelector('textarea,input:not([type=file])') as HTMLInputElement)?.value ?? '',
                choices: [...e.querySelectorAll('[role=radio],[role=checkbox]')].map(o => ({
                    label: o.closest('.van-cell')?.querySelector('.van-cell__title')?.textContent?.trim() ?? '',
                    selected: o.getAttribute('aria-checked') === 'true',
                })),
            })),
            dialog: [...d.querySelectorAll('.van-dialog')].filter(visible).map(e => e.querySelector('.van-dialog__header')?.textContent?.trim()),
            cards: [...d.querySelectorAll('.list-group')].map(e => e.textContent ?? ''),
        };
    }
    try {
        const binding = await page.evaluate(() => {
            const frame=document.querySelector('iframe');
            const w=frame?frame.contentDocument?.defaultView:window;
            return {token:w?.localStorage.getItem('token_str')??null,userLevel:w?.localStorage.getItem('userLevel_str')??null};
        });
        let token = binding.token;
        try {
            const decoded = JSON.parse(token ?? '');
            if (typeof decoded === 'string') token = decoded;
            else token=decoded.token??(typeof decoded.data==='string'?decoded.data:decoded.data?.token)??null;
        }
        catch { }
        if (token !== input.token || binding.userLevel !== input.userLevel)
            return { status: 'needs-user', submitted: false, completed, manualFields: ['browser-account-changed'], denied: true };
        await page.snapshot({ scope: 'full_page' });
        const initial = await page.evaluate(inspect);
        const here = new URL(initial.url), target = new URL(input.url);
        if (here.origin !== target.origin || here.pathname !== target.pathname || [...target.searchParams].some(([key, value]) => here.searchParams.get(key) !== value)) {
            if (here.origin !== target.origin || initial.hasInputs)
                return { status: 'needs-user', submitted: false, completed, manualFields: ['preserved-unrelated-page'] };
            await page.goto(input.url);
            completed.push('opened-activity');
            await page.waitForSelector(input.plan.action === 'register' ? 'loc=css:.bot_btn' : 'loc=css:.list-group');
            await page.snapshot({ scope: 'full_page' });
        }
        const ready=await page.evaluate(inspect);
        const readyUrl=new URL(ready.url);
        if(readyUrl.origin!==target.origin||readyUrl.pathname!==target.pathname||[...target.searchParams].some(([key,value])=>readyUrl.searchParams.get(key)!==value))
            throw new Error('The activity iframe did not retain the requested route');
        if (input.plan.action === 'exit') {
            const state = await page.evaluate(inspect);
            if (state.dialog.length) {
                if (state.dialog.length !== 1 || state.dialog[0] !== '退出确认')
                    return { status: 'needs-user', submitted: false, completed, manualFields: ['different-open-dialog'] };
            }
            else {
                const cards = state.cards.map((text, index) => ({ text, index })).filter(v => v.text.includes(input.plan.name));
                if (cards.length !== 1)
                    return { status: 'needs-user', submitted: false, completed, manualFields: ['locate-unique-activity-for-exit'] };
                await page.click(`xpath=(//div[contains(concat(' ',normalize-space(@class),' '),' list-group ')])[${cards[0].index + 1}]//div[span[normalize-space(.)='退出报名']]`);
                completed.push('opened-exit-confirmation');
                await page.snapshot({ scope: 'full_page' });
                if (!(await page.evaluate(inspect)).dialog.includes('退出确认'))
                    throw new Error('Missing exit confirmation');
            }
        }
        else {
            for (let i = 0; i < input.plan.questions.length; i++) {
                const question = input.plan.questions[i], answer = input.answers[question.id], state = (await page.evaluate(inspect)).questions[i];
                if (!state || state.title !== question.title)
                    throw new Error('Visible questionnaire differs from verified definition');
                if (answer === undefined) {
                    if (question.required)
                        manualFields.push('required:' + question.id);
                    continue;
                }
                const scope = `(//div[contains(concat(' ',normalize-space(@class),' '),' form-container ')])[${i + 1}]`;
                if (question.type === '31' || question.type === '33') {
                    if (state.value && state.value !== answer)
                        manualFields.push('preserved:' + question.id);
                    else if (!state.value) {
                        await page.fill(`xpath=${scope}//${question.type === '31' ? 'textarea' : 'input[@type="number"]'}`, String(answer));
                        completed.push('filled:' + question.id);
                    }
                }
                else if (question.type === '1' || question.type === '2') {
                    const desired = Array.isArray(answer) ? answer : [answer], selected = state.choices.filter(c => c.selected).map(c => c.label);
                    if (selected.length) {
                        if (desired.length !== selected.length || desired.some(v => !selected.includes(v)))
                            manualFields.push('preserved:' + question.id);
                        continue;
                    }
                    for (const choice of desired) {
                        const found = state.choices.filter(c => c.label === choice);
                        if (found.length !== 1)
                            throw new Error('Ambiguous choice');
                        await page.click(`xpath=${scope}//div[contains(concat(' ',normalize-space(@class),' '),' van-cell ')][.//*[contains(concat(' ',normalize-space(@class),' '),' van-cell__title ')][normalize-space(.)=${literal(choice)}]]//*[@role='${question.type === '1' ? 'radio' : 'checkbox'}']`);
                        completed.push('selected:' + question.id + ':' + choice);
                    }
                }
                else
                    manualFields.push((question.type === '32' ? 'date:' : 'attachment:') + question.id);
            }
        }
        await page.snapshot({ scope: 'full_page' });
        return { status: 'awaiting-user', submitted: false, completed, manualFields };
    }
    catch {
        return { status: 'needs-user', submitted: false, completed, manualFields: [...manualFields, 'inspect-partial-form'], executionError: true };
    }
}
