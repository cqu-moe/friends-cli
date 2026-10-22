/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import {FriendsError,FriendsErrorCode} from './errors.js';
interface Page {
  url(): Promise<string>; goto(url: string): Promise<unknown>; snapshot(): Promise<unknown>;
  fill(selector: string,value: string): Promise<unknown>;
  waitForSelector(selector: string,options?: {state?: string;timeout?: number}): Promise<unknown>;
  evaluate<T,A>(fn: (argument: A) => T,argument: A): Promise<Awaited<T>>;
}
interface Task {page(label: string): Page; handOff(): Promise<unknown>}
interface Input {
  page: string; url: string; dryRun: boolean; token: string; userLevel: string; accountUserNo: string;
  organizationId: string; organizationName: string; activityName: string; activityContent: string; activityPlace: string;
  beginTime: string; endTime: string; attachmentCount: number;
}
async function facts(page: Page) {
  return page.evaluate(() => {
    const d = document.querySelector('iframe')?.contentDocument ?? document, w = d.defaultView!;
    const area = [...d.querySelectorAll('textarea')];
    const inputs = [...d.querySelectorAll('input')];
    const label = (input: HTMLInputElement) => input.closest('.van-field')?.querySelector('.van-field__label')?.textContent?.trim();
    const place = inputs.find(input => input.name === 'activityPlace' || label(input) === '活动地址');
    const organization = [...d.querySelectorAll('.van-field')]
      .find(field => field.querySelector('.van-field__label')?.textContent?.trim() === '发起组织')
      ?.querySelector('.van-field__control--custom')?.textContent?.trim() ?? '';
    const selector = (element: Element | undefined) => {
      if (!element) return '';
      const parts: string[] = [];
      for (let node: Element | null = element; node?.parentElement; node = node.parentElement) parts.unshift(`${node.localName}:nth-child(${[...node.parentElement.children].indexOf(node)+1})`);
      return 'loc=css:html > ' + parts.join(' > ');
    };
    const fields = [
      {name:'activityName',element:area.length === 2 ? area[0] : undefined,selector:selector(area[0])},
      {name:'activityContent',element:area.length === 2 ? area[1] : undefined,selector:selector(area[1])},
      {name:'activityPlace',element:place,selector:selector(place)},
    ].map(({name,element,selector}) => ({name,selector,found:!!element,value:element?.value ?? '',readonly:element?.readOnly === true || element?.disabled === true}));
    const accounts = ['userInfo_obj','userInfo_str','account_str','account_obj'].flatMap(key => {
      const raw = w.localStorage.getItem(key); if (!raw) return [];
      try { const value = JSON.parse(raw); return [value?.userNo,value?.account].filter(value => typeof value === 'string'); } catch { return [raw]; }
    });
    return {url:w.location.href,token:w.localStorage.getItem('token_str'),userLevel:w.localStorage.getItem('userLevel_str'),accounts,fields,organizationName:organization === '请选择' ? '' : organization};
  },null);
}
/** First-step text changes are local; Next saves remotely and remains a human action. */
export async function prepareOrganizationActivityPage(task: Task,input: Input) {
  const page = task.page(input.page), target = new URL(input.url);
  if (await page.url() === 'about:blank') {
    if (input.dryRun) throw new FriendsError({code:FriendsErrorCode.InvalidInput,message:'Open the organization activity form before a dry-run'});
    await page.goto(target.href);
  }
  await page.waitForSelector('xpath=(//textarea)[1]',{state:'visible',timeout:15000});
  await page.snapshot();
  const initial = await facts(page), current = new URL(initial.url);
  if (current.origin !== target.origin || current.pathname !== target.pathname || current.searchParams.get('type') !== 'ADD' || current.searchParams.has('uuid') || current.searchParams.has('orId') && current.searchParams.get('orId') !== input.organizationId || initial.token !== input.token || initial.userLevel !== input.userLevel || !initial.accounts.includes(input.accountUserNo)) {
    throw new FriendsError({code:FriendsErrorCode.PermissionDenied,message:'The visible organization activity form does not match the fresh account, role or create route'});
  }
  const manualFields = ['beginTime','endTime','publicityPictures','registration-settings',...(input.attachmentCount ? ['attachments'] : [])];
  const completedActions: string[] = [], preservedFields: string[] = [];
  let inProgress: string | undefined, executionError: string | null = null;
  if (!initial.organizationName || initial.organizationName !== input.organizationName) manualFields.push('organization');
  if (!input.dryRun) try {
    if (!initial.organizationName || initial.organizationName === input.organizationName) for (const name of ['activityName','activityContent','activityPlace'] as const) {
      const field = (await facts(page)).fields.find(field => field.name === name)!;
      if (!field.found) { manualFields.push(name); continue; }
      if (field.value !== '' || field.readonly) { preservedFields.push(name); if (field.value !== input[name]) manualFields.push(name); continue; }
      inProgress = name; await page.fill(field.selector,input[name]);
      if ((await facts(page)).fields.find(field => field.name === name)?.value !== input[name]) throw new Error('The visible field did not retain its entered value');
      completedActions.push(name); inProgress = undefined;
    }
    await page.snapshot();
  } catch (error) { executionError = error instanceof Error ? error.message : 'Visible organization activity preparation stopped partway'; }
  let handoff: 'completed' | undefined;
  if (!input.dryRun) try { await task.handOff(); handoff = 'completed'; } catch { executionError ??= 'Could not hand off the partial organization activity form'; }
  return {status:input.dryRun ? 'ready' as const : 'awaiting-user' as const,submitted:false as const,pageLabel:input.page,stage:'activity-information' as const,materials:'manual-required' as const,
    manualFields,completedActions,preservedFields,inProgress,executionError,handoff,dryRun:input.dryRun};
}
