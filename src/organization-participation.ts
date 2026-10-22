import { createFriendsSdk, type VerifiedCourseSession } from './index.js';
import { FriendsError, FriendsErrorCode } from './errors.js';
type Row = Record<string, unknown>;
export interface OrganizationParticipationQuery {
    page?: number;
    pageSize?: number;
    keyword?: string;
    mine?: boolean;
}
export interface OrganizationParticipationInput {
    activityId: string;
    action: 'register' | 'exit';
    answers?: Record<string, string | string[]>;
}
export interface OrganizationParticipationPlan {
    activityId: string;
    action: 'register' | 'exit';
    submitted: false;
    name: string;
    route: string;
    payload: Row;
    questions: Array<{
        id: string;
        title: string;
        type: string;
        required: boolean;
        options: string[];
    }>;
}
const service = 'zovecenter-saip-ek-app-team-organization-manage';
const prefix = `/${service}/mob`;
function fail(message: string, code: FriendsErrorCode = FriendsErrorCode.InvalidInput): never { throw new FriendsError({ code, message }); }
function object(value: unknown): Row { if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('Invalid organization participation response', FriendsErrorCode.NetworkProtocol); return value as Row; }
function identifier(value: unknown): string { if (typeof value !== 'string' || !value || value === '.' || value === '..' || /[\s\\/?#]/.test(value))
    fail('Invalid organization activity or question ID'); return value; }
function boolean(value: unknown): boolean | null { return value === true || value === 1 ? true : value === false || value === 0 ? false : null; }
function query(input: OrganizationParticipationQuery = {}) { const { page = 1, pageSize = 10, keyword = '', mine = false } = input; if (Object.keys(input).some(k => !['page', 'pageSize', 'keyword', 'mine'].includes(k)) || !Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 || typeof keyword !== 'string' || typeof mine !== 'boolean')
    fail('Invalid participation query'); return { page, pageSize, keyword, mine }; }
function date(value: unknown): number | null { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value))
    return null; const ms = Date.parse(value.replace(' ', 'T') + '+08:00'); return Number.isFinite(ms) && new Date(ms + 8 * 3600000).toISOString().slice(0, value.length).replace('T', ' ') === value ? ms : null; }
function summary(row: Row) { const applied = boolean(row.application), code = row.applicationCode; return { type: 'organization-activity' as const, activityId: identifier(row.uuid), name: typeof row.activityName === 'string' ? row.activityName : null, organizationId: row.organizationId ?? null, registration: { id: typeof row.applicationUuid === 'string' ? row.applicationUuid : null, applied, state: { raw: code ?? null, known: applied === false && code == null || applied === true && [3, 5, 7].includes(code as number), name: applied === false ? 'not-applied' : code === 3 ? 'pending' : code === 5 ? 'rejected' : code === 7 ? 'approved' : 'unknown' } } }; }
export function validateOrganizationParticipationInput(input: OrganizationParticipationInput) { if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['activityId', 'action', 'answers'].includes(k)))
    fail('Unsupported participation fields'); identifier(input.activityId); if (!['register', 'exit'].includes(input.action))
    fail('Action must be register or exit'); if (input.answers !== undefined && (!input.answers || typeof input.answers !== 'object' || Array.isArray(input.answers) || Object.entries(input.answers).some(([k, v]) => !k || typeof v !== 'string' && (!Array.isArray(v) || !v.every(x => typeof x === 'string')))))
    fail('Answers must map question IDs to strings or string arrays'); if (input.action === 'exit' && Object.keys(input.answers ?? {}).length)
    fail('Exit does not take questionnaire answers'); }
export function createOrganizationParticipationClient(options: {
    baseUrl: string;
    session: VerifiedCourseSession;
    fetch?: typeof fetch;
    timeoutMs?: number;
}) {
    const baseUrl = options.baseUrl.replace(/\/$/, ''), session = structuredClone(options.session), fetchImpl = options.fetch ?? fetch, timeoutMs = options.timeoutMs ?? 60000;
    const sdk = createFriendsSdk({ baseUrl, fetch: fetchImpl, timeoutMs });
    async function request(path: string, method = 'GET', body?: unknown) {
        let response: Response;
        try {
            response = await fetchImpl(baseUrl + path, { method, headers: { 'content-type': 'application/json', 'h-zove-token': session.token, 'h-zove-userlevel': session.userLevel, 'h-zove-source': '30100', 'h-zove-clienttype': '1', 'h-zove-tenantid': 'EK', 'h-zove-appkey': path.startsWith('/ek-agg-mob/') ? 'zovecenter-saip-ek-agg-mob' : service }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
        }
        catch {
            fail('Organization participation request failed', FriendsErrorCode.NetworkProtocol);
        }
        if (response.status === 401)
            fail('School session expired', FriendsErrorCode.AuthRequired);
        if (response.status === 403)
            fail('The school denied this participation operation', FriendsErrorCode.PermissionDenied);
        if (!response.ok)
            fail(`Unexpected HTTP ${response.status}`, FriendsErrorCode.NetworkProtocol);
        let data: Row;
        try {
            data = object(await response.json());
        }
        catch {
            fail('Invalid participation response', FriendsErrorCode.NetworkProtocol);
        }
        if (typeof data.code !== 'string')
            fail('Invalid school envelope', FriendsErrorCode.NetworkProtocol);
        if (data.code !== '0')
            throw new FriendsError({ code: FriendsErrorCode.UpstreamBusiness, message: 'The school rejected the participation operation', upstreamCode: data.code });
        return data.data;
    }
    async function listRaw(q: ReturnType<typeof query>) { const page = object(await request(`${prefix}/${q.mine ? 'apply-info/my-apply-list' : 'enroll-info/apply-page-list'}`, 'POST', { currentPage: q.page, pageSize: q.pageSize, key: q.keyword, userNo: q.mine ? session.account.userNo : '' })); if (!Array.isArray(page.data))
        fail('Invalid participation page', FriendsErrorCode.NetworkProtocol); return { rows: page.data.map(object), page: typeof page.currentPage === 'number' ? page.currentPage : q.page, pageSize: typeof page.pageSize === 'number' ? page.pageSize : q.pageSize, totalCount: typeof page.totalCount === 'number' ? page.totalCount : null, hasMore: typeof page.pages === 'number' ? q.page < page.pages : null }; }
    async function current(activityId: string) {
        identifier(activityId);
        await sdk.verifyLocalSession(session);
        const detail = object(await request(`${prefix}/enroll-info/find/${encodeURIComponent(activityId)}`));
        if (detail.uuid !== activityId || typeof detail.activityName !== 'string')
            fail('Organization activity detail ID mismatch', FriendsErrorCode.NetworkProtocol);
        let row: Row | undefined;
        let scanned = 0;
        for (let page = 1; page <= 20; page++) {
            const found = await listRaw(query({ page, pageSize: 50, keyword: detail.activityName }));
            scanned++;
            row = found.rows.find(r => r.uuid === activityId);
            if (row)
                break;
            if (found.hasMore === false)
                break;
            if (found.hasMore === null)
                fail('Cannot verify personal state without pagination', FriendsErrorCode.NetworkProtocol);
        }
        if (!row)
            fail(`Activity was not found in the current identity's activity list within ${scanned} pages`, FriendsErrorCode.PermissionDenied);
        const start = date(row.openTime), end = date(row.deadline), now = Date.now(), reasons: string[] = [];
        if (boolean(row.isCancel) !== false)
            reasons.push('canceled-or-unknown');
        if (boolean(row.isOpenEnrollment) !== true)
            reasons.push('enrollment-not-open');
        if (start === null || end === null || start > end)
            reasons.push('unknown-enrollment-window');
        else if (now < start || now > end)
            reasons.push('outside-enrollment-window');
        const restricted = boolean(row.isEnrollPower);
        if (restricted === null || restricted && !boolean(row.isOrganization))
            reasons.push('membership-not-verified');
        const personal = summary(row);
        const known = personal.registration.applied !== null && personal.registration.state.known;
        if (!known)
            reasons.push('unknown-registration-state');
        const rawQuestions = detail.questionnaireInfoRespDtoList ?? [];
        if (!Array.isArray(rawQuestions))
            fail('Invalid questionnaire', FriendsErrorCode.NetworkProtocol);
        const questions = rawQuestions.map(value => { const q = object(value); if (typeof q.title !== 'string' || typeof q.itemType !== 'string' || boolean(q.isMandatory) === null)
            fail('Invalid questionnaire definition', FriendsErrorCode.NetworkProtocol); return { id: identifier(q.uuid), title: q.title, type: q.itemType, required: boolean(q.isMandatory)!, options: Array.isArray(q.respDtoList) ? q.respDtoList.map(v => object(v).optionName).filter((v): v is string => typeof v === 'string') : [] }; });
        if (new Set(questions.map(q => q.id)).size !== questions.length)
            fail('Duplicate questionnaire IDs', FriendsErrorCode.NetworkProtocol);
        return { detail, row, rawQuestions: rawQuestions.map(object), view: { ...personal, questions, eligibility: { register: reasons.length === 0 && personal.registration.applied === false, exit: reasons.filter(reason => reason !== 'membership-not-verified').length === 0 && personal.registration.applied === true && row.applicationCode === 7, reasons }, enrollment: { opens: row.openTime ?? null, closes: row.deadline ?? null, restrictedToMembers: restricted, isMember: boolean(row.isOrganization) }, scan: { pages: scanned, maxPages: 20, matched: true } } };
    }
    const plans = new WeakMap<OrganizationParticipationPlan, {
        fingerprint: string;
        serialized: string;
        input: OrganizationParticipationInput;
        via: 'api' | 'ego';
    }>();
    const attempted = new Set<string>();
    let uncertain: FriendsError | undefined;
    async function prepare(input: OrganizationParticipationInput, via: 'api' | 'ego' = 'api'): Promise<OrganizationParticipationPlan> {
        validateOrganizationParticipationInput(input);
        if (via !== 'api' && via !== 'ego')
            fail('Invalid preparation path');
        input = structuredClone(input);
        const latest = await current(input.activityId);
        if (!latest.view.eligibility[input.action])
            fail(`Organization activity cannot ${input.action}: ${latest.view.eligibility.reasons.join(', ') || 'current registration state'}`, FriendsErrorCode.UpstreamBusiness);
        const answers = input.answers ?? {};
        if (Object.keys(answers).some(id => !latest.view.questions.some(q => q.id === id)))
            fail('Answer references an unknown organization questionnaire ID');
        const questionnaire: Row[] = [];
        if (input.action === 'register')
            for (let i = 0; i < latest.view.questions.length; i++) {
                const q = latest.view.questions[i], raw = latest.rawQuestions[i], answer = answers[q.id];
                let write: unknown = '', annex: unknown = null;
                if (via === 'api' && q.required && (answer === undefined || answer === '' || Array.isArray(answer) && answer.length === 0))
                    fail(`Required questionnaire answer: ${q.id}`);
                if (answer !== undefined) {
                    if (q.type === '1') {
                        if (typeof answer !== 'string' || !q.options.includes(answer))
                            fail(`Invalid choice: ${q.id}`);
                        write = answer;
                    }
                    else if (q.type === '2') {
                        if (!Array.isArray(answer) || new Set(answer).size !== answer.length || answer.some(v => !q.options.includes(v) || v.includes(',')))
                            fail(`Invalid multiple choices: ${q.id}`);
                        write = answer.join(',');
                    }
                    else if (q.type === '31') {
                        if (typeof answer !== 'string' || answer.length > 300)
                            fail(`Text must have at most 300 characters: ${q.id}`);
                        write = answer;
                    }
                    else if (q.type === '32') {
                        if (typeof answer !== 'string' || date(answer) === null)
                            fail(`Invalid questionnaire date: ${q.id}`);
                        write = answer;
                    }
                    else if (q.type === '33') {
                        if (typeof answer !== 'string' || !answer.trim() || !Number.isFinite(Number(answer)))
                            fail(`Invalid questionnaire number: ${q.id}`);
                        write = answer;
                    }
                    else if (['411', '412', '421', '422'].includes(q.type)) {
                        if (typeof answer !== 'string')
                            fail(`Attachment answer must be an existing school resource group: ${q.id}`);
                        identifier(answer);
                        const resources = await request(`/ek-agg-mob/biz-common/list-group-resource?groupUuid=${encodeURIComponent(answer)}`, 'POST');
                        if (!Array.isArray(resources) || resources.length === 0 || ['411', '421'].includes(q.type) && resources.length !== 1)
                            fail(`Attachment group is empty or has the wrong count: ${q.id}`);
                        annex = answer;
                    }
                    else
                        fail(`Unsupported questionnaire type ${q.type}; complete it in the school form`);
                }
                else if (via === 'api' && !['1', '2', '31', '32', '33', '411', '412', '421', '422'].includes(q.type))
                    fail(`Unknown questionnaire type ${q.type}`);
                questionnaire.push({ ...raw, activityId: input.activityId, write, annex });
            }
        const plan: OrganizationParticipationPlan = { activityId: input.activityId, action: input.action, submitted: false, name: String(latest.view.name), route: input.action === 'register' ? `/mobile/acManage/stuActivityApplyDetail?pageType=JOIN&uuid=${encodeURIComponent(input.activityId)}` : '/mobile/acManage/stuActivityApplyList', payload: { activityId: input.activityId, questionnaireInfoRespDtoList: questionnaire }, questions: latest.view.questions };
        plans.set(plan, { fingerprint: JSON.stringify([latest.row, latest.detail]), serialized: JSON.stringify(plan), input, via });
        return plan;
    }
    async function execute(plan: OrganizationParticipationPlan, intent: {
        via: 'api';
        intent: 'organization-participation';
        confirm: true;
    }) {
        if (intent?.via !== 'api' || intent.intent !== 'organization-participation' || intent.confirm !== true)
            fail('Participation writes require explicit API intent and confirmation');
        if (uncertain)
            throw uncertain;
        const saved = plans.get(plan);
        if (!saved || saved.via !== 'api' || saved.serialized !== JSON.stringify(plan))
            fail('Use an unchanged participation plan prepared by this client');
        const snapshot = structuredClone(plan), latest = await current(snapshot.activityId);
        if (!latest.view.eligibility[snapshot.action] || saved.fingerprint !== JSON.stringify([latest.row, latest.detail]))
            fail('Activity or personal registration changed since preparation', FriendsErrorCode.UpstreamBusiness);
        const key = snapshot.activityId + ':' + snapshot.action;
        if (attempted.has(key))
            fail('This participation operation was already attempted; inspect its state before a new action', FriendsErrorCode.UpstreamBusiness);
        attempted.add(key);
        plans.delete(plan);
        let acknowledged = false;
        try {
            await request(snapshot.action === 'register' ? `${prefix}/enroll-info` : `${prefix}/enroll-info/exit/${encodeURIComponent(snapshot.activityId)}`, snapshot.action === 'register' ? 'POST' : 'DELETE', snapshot.action === 'register' ? snapshot.payload : undefined);
            acknowledged = true;
        }
        catch (error) {
            if (!(error instanceof FriendsError) || error.code !== FriendsErrorCode.NetworkProtocol)
                throw error;
        }
        let readback: 'matched' | 'unmatched' | 'unavailable' = 'unavailable', registrationId: string | null = null;
        try {
            const after = (await current(snapshot.activityId)).view;
            registrationId = after.registration.id;
            readback = (snapshot.action === 'register' ? after.registration.applied === true && !!registrationId : after.registration.applied === false) ? 'matched' : 'unmatched';
        }
        catch { }
        if (!acknowledged || readback !== 'matched') {
            uncertain = new FriendsError({ code: FriendsErrorCode.UnknownOutcome, message: 'Organization participation outcome is uncertain; inspect the personal record, no retry was made', recovery: { operation: `organization-participation.${snapshot.action}`, activityId: snapshot.activityId, registrationId: registrationId ?? undefined, serverAcknowledged: acknowledged ? true : 'unknown', readback } });
            throw uncertain;
        }
        return { activityId: snapshot.activityId, registrationId, action: snapshot.action, submitted: true as const, serverAcknowledged: true as const, readback };
    }
    return { prepare, execute, async list(input?: OrganizationParticipationQuery) { const q = query(input); await sdk.verifyLocalSession(session); const { rows, ...page } = await listRaw(q); return { ...page, items: rows.map(summary) }; }, async get(activityId: string) { return (await current(activityId)).view; } };
}
