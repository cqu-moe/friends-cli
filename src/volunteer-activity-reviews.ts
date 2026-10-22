import { createFriendsSdk, type VerifiedCourseSession } from './index.js';
import { FriendsError, FriendsErrorCode } from './errors.js';
type ObjectValue = Record<string, unknown>;
export type VolunteerActivityReviewType = 'offering' | 'registration';
export interface VolunteerActivityReviewInput {
    type: VolunteerActivityReviewType;
    id: string;
    decision: 'pass' | 'back' | 'refuse';
    message: string;
    time: string;
    isSafeEducation?: 0 | 1;
    callbackActivityId?: string;
}
export interface PreparedVolunteerActivityReview {
    type: VolunteerActivityReviewType;
    id: string;
    activityId: string;
    submitted: false;
    decision: VolunteerActivityReviewInput['decision'];
    payload: ObjectValue;
    route: string;
}
export interface VolunteerActivityReviewClientOptions {
    baseUrl: string;
    session: VerifiedCourseSession;
    fetch?: typeof fetch;
    timeoutMs?: number;
}
const service = 'zovecenter-saip-ek-app-young-volunteers';
const prefix = `/${service}/mob`;
const contracts = {
    offering: { business: '校内活动申请', list: 'school-activity-apply/apply-page-list', detail: 'school-activity-apply/approve-detail', write: 'school-activity-apply', route: '/mobile/volunteerManage/campusApprovalDetail' },
    registration: { business: '校内活动学生报名申请', list: 'schoolActivityStudentApply/page-list', detail: 'schoolActivityStudentApply', write: 'schoolActivityStudentApply', route: '/mobile/volunteerManage/activityRegisterApprovalDetails' },
};
function fail(message: string, code: FriendsErrorCode = FriendsErrorCode.InvalidInput): never { throw new FriendsError({ code, message }); }
function object(value: unknown): ObjectValue {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        fail('Invalid school object', FriendsErrorCode.NetworkProtocol);
    return value as ObjectValue;
}
function id(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value === '.' || value === '..' || /[\s\\/?#]/.test(value))
        fail('Invalid review or activity ID');
    return value;
}
function type(value: unknown): VolunteerActivityReviewType {
    if (value !== 'offering' && value !== 'registration')
        fail('Review type must be offering or registration');
    return value;
}
function query(input: {
    page?: number;
    pageSize?: number;
    keyword?: string;
} = {}) {
    const page = input.page ?? 1, pageSize = input.pageSize ?? 10, keyword = input.keyword ?? '';
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || typeof keyword !== 'string')
        fail('Invalid review pagination or keyword');
    return { page, pageSize, keyword };
}
export function validateVolunteerActivityReviewInput(input: VolunteerActivityReviewInput) {
    object(input);
    type(input.type);
    id(input.id);
    if (Object.keys(input).some(key => !['type', 'id', 'decision', 'message', 'time', 'isSafeEducation', 'callbackActivityId'].includes(key)))
        fail('Unsupported review input field');
    if (!['pass', 'back', 'refuse'].includes(input.decision) || input.type === 'registration' && input.decision === 'back')
        fail('Unsupported review decision');
    if (typeof input.message !== 'string' || !input.message.trim() || input.message.length > 100)
        fail('Review message must contain 1 to 100 characters');
    if (typeof input.time !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.time) || Number.isNaN(Date.parse(input.time)) || new Date(input.time).toISOString().slice(0, 10) !== input.time)
        fail('Review time must be a valid YYYY-MM-DD date');
    if (input.type === 'offering' && input.isSafeEducation !== 0 && input.isSafeEducation !== 1)
        fail('Offering review requires isSafeEducation 0 or 1');
    if (input.type === 'registration' && input.isSafeEducation !== undefined)
        fail('Registration review does not accept safety-education fields');
    if (input.callbackActivityId !== undefined) {
        id(input.callbackActivityId);
        if (input.decision !== 'back')
            fail('Callback node is only valid for back decisions');
    }
}
function summary(kind: VolunteerActivityReviewType, raw: ObjectValue) {
    return { type: kind, id: id(raw.uuid), activityId: kind === 'offering' ? id(raw.uuid) : id(raw.activityId), name: raw.activityName ?? null, studentNo: kind === 'registration' ? raw.studentNo ?? null : null, studentName: kind === 'registration' ? raw.studentName ?? null : null, state: { raw: raw.flowOverallState ?? null, known: false as const, message: raw.flowCurrMsg ?? null } };
}
export function createVolunteerActivityReviewClient(options: VolunteerActivityReviewClientOptions) {
    const baseUrl = options.baseUrl.replace(/\/$/, '');
    const session = structuredClone(options.session), fetchImpl = options.fetch ?? fetch, timeoutMs = options.timeoutMs ?? 60000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
        fail('timeoutMs must be a positive integer');
    const sdk = createFriendsSdk({ baseUrl, fetch: fetchImpl, timeoutMs });
    const headers = { 'content-type': 'application/json', 'h-zove-token': session.token, 'h-zove-userlevel': session.userLevel, 'h-zove-source': '30100', 'h-zove-clienttype': '1', 'h-zove-tenantid': 'EK', 'h-zove-appkey': service };
    const prepared = new WeakMap<PreparedVolunteerActivityReview, {
        input: VolunteerActivityReviewInput;
        raw: string;
        plan: string;
    }>();
    async function request(path: string, body?: ObjectValue) {
        let response: Response;
        try {
            response = await fetchImpl(`${baseUrl}${path}`, { method: body ? 'POST' : 'GET', headers: {...headers, ...(path.startsWith('/ek-agg-mob/') ? {'h-zove-appkey': 'zovecenter-saip-ek-agg-mob'} : {})}, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
        }
        catch {
            fail('Could not reach volunteer activity reviews', FriendsErrorCode.NetworkProtocol);
        }
        if (response.status === 401)
            fail('Friends session expired', FriendsErrorCode.AuthRequired);
        if (response.status === 403)
            fail('The school denied this review', FriendsErrorCode.PermissionDenied);
        if (!response.ok)
            fail(`Unexpected school HTTP ${response.status}`, FriendsErrorCode.NetworkProtocol);
        let envelope: ObjectValue;
        try {
            envelope = object(await response.json());
        }
        catch {
            fail('Invalid school review response', FriendsErrorCode.NetworkProtocol);
        }
        if (typeof envelope.code !== 'string')
            fail('Invalid school review response', FriendsErrorCode.NetworkProtocol);
        if (envelope.code !== '0')
            throw new FriendsError({ code: FriendsErrorCode.UpstreamBusiness, message: 'The school rejected the review operation', upstreamCode: envelope.code });
        return envelope.data;
    }
    async function role(kind: VolunteerActivityReviewType) {
        await sdk.verifyLocalSession(session);
        if (kind === 'registration')
            return 'XS02';
        const user = object(await request('/ek-agg-mob/user/info', {}));
        if (user.userNo !== session.account.userNo)
            fail('School account changed', FriendsErrorCode.AuthRequired);
        const roles: Record<string, string> = { XSC: 'XJ02', XY: 'YJ01', FDY: 'FDY01', Tutor: 'JZG01', GuidingUnit: 'YRDW01' };
        const handle = typeof user.userLoginStateLevel === 'string' ? roles[user.userLoginStateLevel] : undefined;
        if (!handle)
            fail('This school identity has no offering review role', FriendsErrorCode.PermissionDenied);
        return handle;
    }
    async function listRaw(kind: VolunteerActivityReviewType, handle: string, input: ReturnType<typeof query>) {
        const states = await request('/ek-agg-mob/biz-common/flow/template-activity-state', { businessTypeCode: contracts[kind].business, handleType: handle });
        if (!Array.isArray(states) || !states.some(v => object(v).code === '0'))
            fail('The school did not expose a pending review filter', FriendsErrorCode.NetworkProtocol);
        const body = kind === 'offering' ? { currentPage: input.page, pageSize: input.pageSize, classNo: '', collegeNo: '', specialtyNo: '', specialtyType: '', key: input.keyword, activityLevel: '', activityState: '', activityType: '', activityCategory: '', handleType: handle, isInstructor: handle === 'JZG01', organizationId: '', state: '0', isGuidanceUnit: handle === 'YRDW01' } : { currentPage: input.page, pageSize: input.pageSize, activityId: '', state: '0', handleType: handle, key: input.keyword, postId: '', studentName: '' };
        const page = object(await request(`${prefix}/${contracts[kind].list}`, body));
        if (!Array.isArray(page.data))
            fail('Invalid school review page', FriendsErrorCode.NetworkProtocol);
        return { body, rows: page.data.map(object), page: typeof page.currentPage === 'number' ? page.currentPage : input.page, pageSize: typeof page.pageSize === 'number' ? page.pageSize : input.pageSize, totalCount: typeof page.totalCount === 'number' ? page.totalCount : null, hasMore: typeof page.pages === 'number' ? input.page < page.pages : null };
    }
    async function detail(kind: VolunteerActivityReviewType, reviewId: string) {
        const raw = object(await request(`${prefix}/${contracts[kind].detail}/${encodeURIComponent(reviewId)}`));
        if (raw.uuid !== reviewId || kind === 'offering' && (typeof raw.activityName !== 'string' || !['SCHOOL_ACTIVITY', 'TEMP_ACTIVITY'].includes(String(raw.activityCategory))) || kind === 'registration' && (typeof raw.activityId !== 'string' || typeof raw.studentNo !== 'string'))
            fail('The review detail does not match its requested type and ID', FriendsErrorCode.NetworkProtocol);
        return raw;
    }
    async function pending(kind: VolunteerActivityReviewType, reviewId: string, handle: string) {
        for (let page = 1; page <= 100; page++) {
            const result = await listRaw(kind, handle, query({ page, pageSize: 50 }));
            const match = result.rows.find(row => row.uuid === reviewId);
            if (match)
                return { match, query: result.body };
            if (result.hasMore === false)
                return null;
            if (result.hasMore === null)
                fail('Cannot verify pending membership without school pagination', FriendsErrorCode.NetworkProtocol);
        }
        fail('Pending review scan exceeded 100 pages', FriendsErrorCode.NetworkProtocol);
    }
    async function current(kind: VolunteerActivityReviewType, reviewId: string) {
        const handle = await role(kind), record = await pending(kind, reviewId, handle);
        if (!record)
            fail('The review is no longer in this identity’s pending list', FriendsErrorCode.UpstreamBusiness);
        const raw = await detail(kind, reviewId), activityId = kind === 'offering' ? reviewId : id(raw.activityId);
        if (kind === 'registration') {
            if (record.match.activityId !== activityId)
                fail('Registration activity binding changed', FriendsErrorCode.NetworkProtocol);
            const managed = await request(`${prefix}/school-activity-apply/manager-activity-list`);
            if (!Array.isArray(managed) || !managed.some(item => object(item).uuid === activityId))
                fail('The current user cannot manage this volunteer activity', FriendsErrorCode.PermissionDenied);
        }
        return { handle, raw, activityId, query: record.query };
    }
    async function prepare(input: VolunteerActivityReviewInput): Promise<PreparedVolunteerActivityReview> {
        validateVolunteerActivityReviewInput(input);
        const now = await current(input.type, input.id);
        let callbackActivityId: string | null = null;
        if (input.decision === 'back') {
            const nodes = await request('/ek-agg-mob/biz-common/flow/callback-list', { businessTypeCode: contracts.offering.business, handleType: now.handle });
            if (!Array.isArray(nodes) || nodes.length === 0)
                fail('No school callback node is available');
            const ids = nodes.map(node => id(object(object(node).templateActivityRespDto).activityid));
            callbackActivityId = input.callbackActivityId ?? (ids.length === 1 ? ids[0] : null);
            if (callbackActivityId === null || !ids.includes(callbackActivityId))
                fail('Select a callbackActivityId returned by the school');
        }
        const payload: ObjectValue = { time: input.time, msg: input.message, handleType: now.handle, uuid: input.id };
        if (input.type === 'offering') {
            if (input.decision === 'pass' && (!Array.isArray(now.raw.posts) || now.raw.activityCategory === 'TEMP_ACTIVITY' && !Array.isArray(now.raw.nameList)))
                fail('Incomplete offering details; review the school form first', FriendsErrorCode.NetworkProtocol);
            Object.assign(payload, { callbackActivityId, isSafeEducation: input.isSafeEducation, applyInfo: input.decision === 'pass' ? { ...now.raw, posts: now.raw.activityCategory === 'TEMP_ACTIVITY' ? [] : now.raw.posts } : null });
        }
        else
            Object.assign(payload, { applyInfo: now.raw, queryDto: { ...now.query, activityId: now.activityId } });
        const params = new URLSearchParams({ uuid: input.id, ...(input.type === 'offering' ? { handleType: now.handle, isInstructor: String(now.handle === 'JZG01'), isGuidanceUnit: String(now.handle === 'YRDW01') } : { activityId: now.activityId, studentNo: String(now.raw.studentNo) }) });
        const plan: PreparedVolunteerActivityReview = { type: input.type, id: input.id, activityId: now.activityId, decision: input.decision, submitted: false, payload, route: `${contracts[input.type].route}?${params}` };
        prepared.set(plan, { input: structuredClone(input), raw: JSON.stringify(now.raw), plan: JSON.stringify(plan) });
        return plan;
    }
    return {
        async list(kindInput: VolunteerActivityReviewType, input?: {
            page?: number;
            pageSize?: number;
            keyword?: string;
        }) {
            const kind = type(kindInput), q = query(input), handle = await role(kind), page = await listRaw(kind, handle, q);
            return { items: page.rows.map(row => summary(kind, row)), page: page.page, pageSize: page.pageSize, totalCount: page.totalCount, hasMore: page.hasMore };
        },
        async get(kindInput: VolunteerActivityReviewType, reviewId: string) {
            const kind = type(kindInput);
            id(reviewId);
            await role(kind);
            const raw = await detail(kind, reviewId);
            const entries = kind === 'offering' ? await request(`${prefix}/schoolActivityStudentApply/apply-list-by-activity/${encodeURIComponent(reviewId)}`) : [raw];
            if (!Array.isArray(entries))
                fail('Invalid review participant list', FriendsErrorCode.NetworkProtocol);
            return { ...summary(kind, raw), participants: entries.map(item => { const row = object(item); return { registrationId: row.uuid ?? null, studentNo: row.studentNo ?? null, studentName: row.studentName ?? null, postName: row.postName ?? null }; }) };
        },
        prepare,
        async decide(plan: PreparedVolunteerActivityReview, intent: {
            via: 'api';
            intent: 'decide-volunteer-activity-review';
            confirm: true;
        }) {
            if (intent?.via !== 'api' || intent.intent !== 'decide-volunteer-activity-review' || intent.confirm !== true)
                fail('Review submission requires explicit API intent and confirmation');
            const saved = prepared.get(plan);
            if (!saved || saved.plan !== JSON.stringify(plan))
                fail('Use an unchanged review prepared by this client');
            const latest = await current(plan.type, plan.id);
            if (JSON.stringify(latest.raw) !== saved.raw)
                fail('The review changed after preparation', FriendsErrorCode.UpstreamBusiness);
            let acknowledged = false;
            try {
                await request(`${prefix}/${contracts[plan.type].write}/${plan.decision === 'back' ? 'callback' : plan.decision}`, plan.payload);
                acknowledged = true;
            }
            catch (error) {
                if (!(error instanceof FriendsError) || error.code !== FriendsErrorCode.NetworkProtocol)
                    throw error;
            }
            let readback: 'matched' | 'unmatched' | 'unavailable' = 'unavailable';
            try {
                const after = await detail(plan.type, plan.id);
                const remaining = await pending(plan.type, plan.id, latest.handle);
                readback = !remaining && JSON.stringify(after) !== saved.raw ? 'matched' : 'unmatched';
            }
            catch { }
            if (!acknowledged)
                throw new FriendsError({ code: FriendsErrorCode.UnknownOutcome, message: 'The school may have accepted this review; inspect its state before another decision; no retry was made', recovery: { operation: 'volunteer.activity-reviews.decide', activityId: plan.activityId, applicationId: plan.id, serverAcknowledged: 'unknown', readback } });
            return { type: plan.type, id: plan.id, submitted: true as const, serverAcknowledged: true as const, readback };
        },
    };
}
