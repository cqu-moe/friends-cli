import {createFriendsSdk, type VerifiedCourseSession} from './index.js';
import {FriendsError, FriendsErrorCode} from './errors.js';

type SchoolObject = Record<string, unknown>;
export type CourseReviewType = 'offering' | 'registration';
export interface CourseReviewInput {
  type: CourseReviewType;
  id: string;
  decision: 'pass' | 'back' | 'refuse';
  message: string;
  time: string;
}
export interface PreparedCourseReview {
  type: CourseReviewType;
  id: string;
  courseId: string;
  decision: CourseReviewInput['decision'];
  submitted: false;
  payload: SchoolObject;
  route: string;
}
const service = 'zovecenter-saip-ek-app-curriculum';
const prefix = `/${service}/mob`;
const contracts = {
  offering: {list: 'apply/apply-page-list', detail: 'apply/approve-detail', write: 'apply', route: '/mobile/course/applyApprovalDetail', decisions: ['pass', 'back', 'refuse']},
  registration: {list: 'student-apply/page-list', detail: 'student-apply', write: 'student-apply', route: '/mobile/course/reportApprovalDetail', decisions: ['pass', 'refuse']},
} as const;
function fail(message: string, code: FriendsErrorCode = FriendsErrorCode.InvalidInput): never {
  throw new FriendsError({code, message});
}
function object(value: unknown): SchoolObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Invalid school review object', FriendsErrorCode.NetworkProtocol);
  return value as SchoolObject;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' || /[\s\\/?#]/.test(value)) fail('Invalid course review ID');
  return value;
}
function type(value: unknown): CourseReviewType {
  if (value !== 'offering' && value !== 'registration') fail('Review type must be offering or registration');
  return value;
}
function query(input: {page?: number; pageSize?: number; keyword?: string} = {}) {
  const page = input.page ?? 1, pageSize = input.pageSize ?? 10, keyword = input.keyword ?? '';
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || typeof keyword !== 'string') fail('Invalid review pagination or keyword');
  return {page, pageSize, keyword};
}
export function validateCourseReviewInput(input: CourseReviewInput): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Expected course review input');
  type(input.type); id(input.id);
  if (Object.keys(input).some(key => !['type', 'id', 'decision', 'message', 'time'].includes(key))) fail('Unsupported course review field');
  if (!(contracts[input.type].decisions as readonly string[]).includes(input.decision)) fail('The school detail page does not offer this decision');
  if (typeof input.message !== 'string' || !input.message.trim() || input.message.length > 100) fail('Review message must contain 1 to 100 characters');
  if (typeof input.time !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.time) || Number.isNaN(Date.parse(input.time)) || new Date(input.time).toISOString().slice(0, 10) !== input.time) fail('Review time must be a valid YYYY-MM-DD date');
}
function summary(kind: CourseReviewType, raw: SchoolObject) {
  return {
    type: kind, id: id(raw.uuid), courseId: kind === 'offering' ? id(raw.uuid) : id(raw.curriculumId),
    name: raw.curriculumName ?? null, studentNo: kind === 'registration' ? raw.studentNo ?? null : null,
    state: {raw: raw.flowOverallState ?? null, known: false as const, message: raw.flowCurrMsg ?? null},
  };
}
export function createCourseReviewClient(options: {baseUrl: string; session: VerifiedCourseSession; fetch?: typeof fetch; timeoutMs?: number}) {
  const baseUrl = options.baseUrl.replace(/\/$/, ''), session = structuredClone(options.session);
  const fetchImpl = options.fetch ?? fetch, timeoutMs = options.timeoutMs ?? 60000;
  const sdk = createFriendsSdk({baseUrl, fetch: fetchImpl, timeoutMs});
  const prepared = new WeakMap<PreparedCourseReview, {raw: string; handle: string; plan: string}>();
  const attempted = new Set<string>();
  let uncertain: FriendsError | undefined;
  async function request(path: string, body?: SchoolObject) {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: {'content-type': 'application/json', 'h-zove-token': session.token, 'h-zove-userlevel': session.userLevel, 'h-zove-source': '30100', 'h-zove-clienttype': '1', 'h-zove-tenantid': 'EK', 'h-zove-appkey': path.startsWith('/ek-agg-mob/') ? 'zovecenter-saip-ek-agg-mob' : service},
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch { fail('Could not reach course reviews', FriendsErrorCode.NetworkProtocol); }
    if (response.status === 401) fail('Friends session expired', FriendsErrorCode.AuthRequired);
    if (response.status === 403) fail('The school denied this course review', FriendsErrorCode.PermissionDenied);
    if (!response.ok) fail(`Unexpected school HTTP ${response.status}`, FriendsErrorCode.NetworkProtocol);
    let envelope: SchoolObject;
    try { envelope = object(await response.json()); } catch { fail('Invalid school review response', FriendsErrorCode.NetworkProtocol); }
    if (typeof envelope.code !== 'string') fail('Invalid school review envelope', FriendsErrorCode.NetworkProtocol);
    if (envelope.code !== '0') throw new FriendsError({code: FriendsErrorCode.UpstreamBusiness, message: 'The school rejected the course review operation', upstreamCode: envelope.code});
    return envelope.data;
  }
  async function role(kind: CourseReviewType) {
    await sdk.verifyLocalSession(session);
    const user = object(await request('/ek-agg-mob/user/info', {}));
    if (user.userNo !== session.account.userNo || user.userLoginStateLevel !== session.userLevel) fail('School account or active role changed; select the intended context again', FriendsErrorCode.AuthRequired);
    if (kind === 'registration') return 'XS02';
    const roles: Record<string, string> = {XSC: 'ZNBM', XY: 'EJXY', FDY: 'ZDLS'};
    const handle = typeof user.userLoginStateLevel === 'string' ? roles[user.userLoginStateLevel] : undefined;
    if (!handle) fail('This school identity has no source-supported offering review role', FriendsErrorCode.PermissionDenied);
    return handle;
  }
  async function listRaw(kind: CourseReviewType, handle: string, q: ReturnType<typeof query>) {
    if (kind === 'registration') {
      const states = await request('/ek-agg-mob/biz-common/flow/template-activity-state', {businessTypeCode: '课程学生报名申请', handleType: handle});
      if (!Array.isArray(states) || !states.some(item => object(item).code === '0')) fail('The school did not expose a pending registration filter', FriendsErrorCode.NetworkProtocol);
    }
    const body = kind === 'offering'
      ? {currentPage: q.page, pageSize: q.pageSize, classNo: '', collegeNo: '', specialtyNo: '', specialtyType: '', key: q.keyword, curriculumType: '', curriculumState: '', curriculumLevel: '', handleType: handle, isInstructor: false, state: 0}
      : {currentPage: q.page, pageSize: q.pageSize, state: '0', handleType: handle, key: q.keyword, roleId: '', studentName: '', curriculumId: ''};
    const page = object(await request(`${prefix}/${contracts[kind].list}`, body));
    if (!Array.isArray(page.data) || !Number.isSafeInteger(page.pages) || (page.pages as number) < 0 || page.currentPage !== q.page || page.pageSize !== q.pageSize) fail('Invalid school review pagination', FriendsErrorCode.NetworkProtocol);
    return {body, rows: page.data.map(object), page: q.page, pageSize: q.pageSize, totalCount: typeof page.totalCount === 'number' ? page.totalCount : null, hasMore: q.page < (page.pages as number)};
  }
  async function pending(kind: CourseReviewType, reviewId: string, handle: string) {
    for (let page = 1; page <= 100; page++) {
      const result = await listRaw(kind, handle, query({page, pageSize: 50}));
      const matches = result.rows.filter(row => row.uuid === reviewId);
      if (matches.length > 1) fail('Ambiguous pending course review', FriendsErrorCode.NetworkProtocol);
      if (matches.length === 1) return {row: matches[0], query: result.body};
      if (!result.hasMore) return null;
    }
    fail('Pending review scan exceeded 100 pages', FriendsErrorCode.NetworkProtocol);
  }
  async function detail(kind: CourseReviewType, reviewId: string) {
    const raw = object(await request(`${prefix}/${contracts[kind].detail}/${encodeURIComponent(reviewId)}`));
    if (raw.uuid !== reviewId || kind === 'offering' && (typeof raw.curriculumName !== 'string' || !raw.curriculumName || typeof raw.studentNo === 'string') || kind === 'registration' && (typeof raw.curriculumId !== 'string' || !raw.curriculumId || typeof raw.studentNo !== 'string' || !raw.studentNo)) fail('Course review detail does not match the requested type and ID', FriendsErrorCode.NetworkProtocol);
    return raw;
  }
  async function current(kind: CourseReviewType, reviewId: string, requirePending: boolean) {
    const handle = await role(kind), record = await pending(kind, reviewId, handle);
    if (requirePending && !record) fail('This review is no longer pending for the current identity', FriendsErrorCode.UpstreamBusiness);
    const raw = await detail(kind, reviewId);
    if (record) {
      if (kind === 'offering' && record.row.organizationId !== raw.organizationId || kind === 'registration' && (record.row.curriculumId !== raw.curriculumId || record.row.studentNo !== raw.studentNo) || record.row.flowOverallState !== raw.flowOverallState) fail('Pending review binding or state changed', FriendsErrorCode.NetworkProtocol);
    }
    const courseId = kind === 'offering' ? reviewId : id(raw.curriculumId);
    if (kind === 'registration') {
      const managed = await request(`${prefix}/apply/manager-activity-list`);
      if (!Array.isArray(managed) || !managed.some(item => object(item).uuid === courseId)) fail('The current identity cannot manage this course', FriendsErrorCode.PermissionDenied);
    }
    return {handle, raw, courseId, record};
  }
  return {
    async list(kindInput: CourseReviewType, input?: {page?: number; pageSize?: number; keyword?: string}) {
      const kind = type(kindInput), q = query(input), handle = await role(kind), page = await listRaw(kind, handle, q);
      return {items: page.rows.map(row => summary(kind, row)), page: page.page, pageSize: page.pageSize, totalCount: page.totalCount, hasMore: page.hasMore};
    },
    async get(kindInput: CourseReviewType, reviewId: string) {
      const kind = type(kindInput); id(reviewId);
      const now = await current(kind, reviewId, false);
      return {...summary(kind, now.raw), pending: !!now.record, allowedDecisions: now.record ? [...contracts[kind].decisions] : []};
    },
    async prepare(input: CourseReviewInput): Promise<PreparedCourseReview> {
      validateCourseReviewInput(input);
      input = structuredClone(input);
      if (uncertain) throw uncertain;
      if (attempted.has(`${input.type}:${input.id}`)) fail('This client already attempted the decision; inspect with get before any further action');
      const now = await current(input.type, input.id, true);
      if (now.raw.flowOverallState === undefined || now.raw.flowOverallState === null) fail('Missing school workflow state', FriendsErrorCode.NetworkProtocol);
      // The school offering formatter uses month ({m}) in the minutes position.
      const payload: SchoolObject = {time: input.type === 'offering' ? `${input.time} 00:${input.time.slice(5, 7)}:00` : input.time, msg: input.message, handleType: now.handle, applyInfo: now.raw, uuid: input.id};
      if (input.type === 'registration') payload.queryDto = {...now.record!.query, curriculumId: now.courseId};
      const params = new URLSearchParams({uuid: input.id, ...(input.type === 'offering' ? {handleType: now.handle} : {studentNo: String(now.raw.studentNo), curriculumId: now.courseId})});
      const plan: PreparedCourseReview = {type: input.type, id: input.id, courseId: now.courseId, decision: input.decision, submitted: false, payload, route: `${contracts[input.type].route}?${params}`};
      prepared.set(plan, {raw: JSON.stringify(now.raw), handle: now.handle, plan: JSON.stringify(plan)});
      return plan;
    },
    async decide(plan: PreparedCourseReview, intent: {via: 'api'; intent: 'decide-course-review'; confirm: true}) {
      if (uncertain) throw uncertain;
      if (intent?.via !== 'api' || intent.intent !== 'decide-course-review' || intent.confirm !== true) fail('Course review execution requires explicit API intent and confirmation');
      const saved = prepared.get(plan);
      if (!saved || saved.plan !== JSON.stringify(plan) || attempted.has(`${plan.type}:${plan.id}`)) fail('Use an unchanged, unconsumed course review prepared by this client');
      prepared.delete(plan);
      plan = structuredClone(plan);
      const latest = await current(plan.type, plan.id, true);
      if (JSON.stringify(latest.raw) !== saved.raw || latest.handle !== saved.handle) fail('The course review or school role changed after preparation', FriendsErrorCode.UpstreamBusiness);
      if (uncertain) throw uncertain;
      const key = `${plan.type}:${plan.id}`;
      if (attempted.has(key)) fail('A decision for this review is already in progress');
      attempted.add(key);
      let acknowledged = false;
      try {
        await request(`${prefix}/${contracts[plan.type].write}/${plan.decision === 'back' ? 'callback' : plan.decision}`, plan.payload);
        acknowledged = true;
      } catch (error) {
        if (!(error instanceof FriendsError) || error.code !== FriendsErrorCode.NetworkProtocol) throw error;
      }
      let readback: 'matched' | 'unmatched' | 'unavailable' = 'unavailable';
      let after: SchoolObject | undefined;
      try {
        after = await detail(plan.type, plan.id);
        const remaining = await pending(plan.type, plan.id, latest.handle);
        // Course FlowRecord maps audit nodeState 3/5/7 to pass/back/refuse.
        const expectedState = {pass: '3', back: '5', refuse: '7'}[plan.decision];
        const matchingRecords = (raw: SchoolObject) => Array.isArray(raw.approvalRecords) ? raw.approvalRecords.filter(item => {
          const record = object(item);
          return String(record.nodeState) === expectedState && record.handleOpinion === plan.payload.msg && typeof record.handleTime === 'string' && record.handleTime.slice(0, 10) === String(plan.payload.time).slice(0, 10);
        }).length : 0;
        readback = !remaining && matchingRecords(after) > matchingRecords(latest.raw) ? 'matched' : 'unmatched';
      } catch { /* Readback cannot resolve a missing write acknowledgement. */ }
      if (!acknowledged || readback !== 'matched') {
        uncertain = new FriendsError({code: FriendsErrorCode.UnknownOutcome, message: 'The course decision needs read-only verification; do not retry or switch paths', recovery: {operation: 'courses.reviews.decide', applicationId: plan.id, ...(plan.type === 'registration' ? {registrationId: plan.id} : {}), completed: ['decision-request-sent'], serverAcknowledged: acknowledged ? true : 'unknown', readback}});
        throw uncertain;
      }
      return {type: plan.type, id: plan.id, courseId: plan.courseId, submitted: true as const, serverAcknowledged: true as const, readback, state: after ? summary(plan.type, after).state : null};
    },
  };
}
