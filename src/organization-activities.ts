import { createFriendsSdk, type VerifiedCourseSession } from './index.js';
import { FriendsError, FriendsErrorCode, type WriteRecovery } from './errors.js';

declare const organizationActivityIdBrand: unique symbol;
export type OrganizationActivityId = string & {readonly [organizationActivityIdBrand]: true};
type JsonObject = Record<string, unknown>;
const service = 'zovecenter-saip-ek-app-team-organization-manage';
const prefix = `/${service}/mob`;
const common = '/ek-agg-mob/biz-common';
const mainService = 'zovecenter-saip-ek-agg-mob';

function invalid(message: string): never { throw new FriendsError({code: FriendsErrorCode.InvalidInput, message}); }
function protocol(message: string): never { throw new FriendsError({code: FriendsErrorCode.NetworkProtocol, message}); }
function object(value: unknown): JsonObject | null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null; }
function text(value: unknown): string | null { return typeof value === 'string' ? value : null; }
function number(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function scalar(value: unknown): string | number | boolean | null { return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null; }
function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value === '.' || value === '..' || /[\\/?#\s\0]/.test(value)) invalid(`Invalid ${label}`);
  return value;
}
export function organizationActivityId(value: string): OrganizationActivityId { return identifier(value, 'organization activity ID') as OrganizationActivityId; }

export interface OrganizationActivityQuery {kind?: 'public' | 'manageable'; page?: number; pageSize?: number; keyword?: string}
export interface OrganizationActivity {
  domain: 'organization-activity'; id: string; name: string | null; organizationId: string | null;
  organizationName: string | null; place: string | null; beginTime: string | null; endTime: string | null;
  state: {raw: string | number | boolean | null; flowOverallState: string | number | boolean | null; known: false};
}
export interface OrganizationActivityRequirements {
  activityId: string; isOpenEnrollment: boolean | null; membersOnly: boolean | null;
  openTime: string | null; deadline: string | null; applyNumber: number | null;
  questionnaire: Array<{id: string | null; title: string | null; type: string | null}>;
}
function activity(raw: unknown): OrganizationActivity {
  const row = object(raw);
  if (!row || typeof row.uuid !== 'string' || !row.uuid) protocol('Invalid organization activity response');
  return {domain:'organization-activity', id:row.uuid, name:text(row.activityName), organizationId:text(row.organizationId),
    organizationName:text(row.organizationName), place:text(row.activityPlace), beginTime:text(row.beginTime), endTime:text(row.endTime),
    state:{raw:scalar(row.approvalState), flowOverallState:scalar(row.flowOverallState), known:false}};
}
function query(input: OrganizationActivityQuery = {}) {
  if (!object(input) || Object.keys(input).some(key => !['kind','page','pageSize','keyword'].includes(key))) invalid('Invalid organization activity query');
  const {kind = 'public', page = 1, pageSize = 10, keyword = ''} = input;
  if (!['public','manageable'].includes(kind) || !Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || typeof keyword !== 'string') invalid('Invalid organization activity paging or keyword');
  return {kind, page, pageSize, keyword};
}

export interface OrganizationActivityOfferingInput {
  organizationId: string; activityName: string; activityContent: string; activityPlace: string;
  beginTime: string; endTime: string; term?: {beginYear: string; endYear: string; termNo: string};
  registration: {isOpenEnrollment: boolean; isHideList: boolean; isEnrollExamine: boolean; isEnrollPower: boolean; signinNum: number; openTime: string; deadline: string};
  materials: {publicityPictures: File[]; attachments?: File[]};
}
export interface OrganizationActivityMaterials {
  publicity: {groupUuid: string; resourceUuids: string[]};
  attachments: {groupUuid: string; resourceUuids: string[]} | null;
}
function only(raw: JsonObject, keys: string[], label: string) {
  if (Object.keys(raw).some(key => !keys.includes(key))) invalid(`Unknown ${label} field`);
}
function date(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)) invalid(`${label} must be YYYY-MM-DD HH:mm`);
  const time = new Date(value.replace(' ','T') + ':00Z');
  if (!Number.isFinite(time.getTime()) || time.toISOString().slice(0,16).replace('T',' ') !== value) invalid(`Invalid ${label}`);
  return value;
}
export function validateOrganizationActivityOfferingInput(value: unknown): OrganizationActivityOfferingInput {
  const raw = object(value); if (!raw) invalid('Expected an organization activity offering');
  only(raw,['organizationId','activityName','activityContent','activityPlace','beginTime','endTime','term','registration','materials'],'organization activity offering');
  const registration = object(raw.registration), materials = object(raw.materials);
  if (!registration || !materials) invalid('Registration settings and materials are required');
  only(registration,['isOpenEnrollment','isHideList','isEnrollExamine','isEnrollPower','signinNum','openTime','deadline'],'organization activity registration');
  only(materials,['publicityPictures','attachments'],'organization activity materials');
  for (const [key,max] of [['activityName',32],['activityContent',200],['activityPlace',32]] as const) {
    if (typeof raw[key] !== 'string' || !(raw[key] as string).trim() || (raw[key] as string).length > max) invalid(`${key} is required and limited to ${max} characters`);
  }
  for (const key of ['isOpenEnrollment','isHideList','isEnrollExamine','isEnrollPower']) if (typeof registration[key] !== 'boolean') invalid(`${key} must be boolean`);
  if (!Number.isSafeInteger(registration.signinNum) || (registration.signinNum as number) < 1 || (registration.signinNum as number) > 8) invalid('signinNum must be from 1 through 8');
  const beginTime = date(raw.beginTime,'beginTime'), endTime = date(raw.endTime,'endTime');
  const openTime = date(registration.openTime,'registration.openTime'), deadline = date(registration.deadline,'registration.deadline');
  if (!(openTime < deadline && deadline < beginTime && beginTime < endTime)) invalid('Require enrollment opening < deadline < activity start < activity end');
  const imageTypes = ['image/png','image/jpg','image/jpeg','image/gif','image/bmp'];
  const extensions = ['pdf','doc','docx','xls','xlsx','ppt','pptx','png','jpg','jpeg','gif','bmp','txt','rar','zip','7z','mp3','avi','wmv','mpeg','mp4'];
  function files(input: unknown, publicity: boolean): File[] {
    if (!Array.isArray(input) || input.length > (publicity ? 5 : 10) || publicity && input.length === 0) invalid('Publicity pictures require 1..5 files; attachments allow 0..10');
    const names = new Set<string>();
    return input.map(file => {
      if (!(file instanceof File) || !file.name || /[\\/\r\n\0]/.test(file.name) || names.has(file.name)) invalid('Materials must be File objects with unique safe names');
      names.add(file.name);
      const ext = file.name.split('.').pop()!.toLowerCase();
      const max = !publicity && ['avi','wmv','mpeg','mp4'].includes(ext) ? 200 : 20;
      if (file.size === 0 || file.size > max * 1024 * 1024 || publicity && !imageTypes.includes(file.type) || !publicity && !extensions.includes(ext)) invalid(`Invalid organization activity material: ${file.name}`);
      return file;
    });
  }
  let term: OrganizationActivityOfferingInput['term'];
  if (raw.term !== undefined) {
    const item = object(raw.term); if (!item) invalid('Invalid school term');
    only(item,['beginYear','endYear','termNo'],'school term');
    term = {beginYear:identifier(item.beginYear,'beginYear'),endYear:identifier(item.endYear,'endYear'),termNo:identifier(item.termNo,'termNo')};
  }
  return {organizationId:identifier(raw.organizationId,'organization ID'),activityName:raw.activityName as string,activityContent:raw.activityContent as string,activityPlace:raw.activityPlace as string,beginTime,endTime,term,
    registration:{isOpenEnrollment:registration.isOpenEnrollment as boolean,isHideList:registration.isHideList as boolean,isEnrollExamine:registration.isEnrollExamine as boolean,isEnrollPower:registration.isEnrollPower as boolean,signinNum:registration.signinNum as number,openTime,deadline},
    materials:{publicityPictures:files(materials.publicityPictures,true),attachments:files(materials.attachments ?? [],false)}};
}

export function createOrganizationActivityClient(options: {baseUrl?: string; session: VerifiedCourseSession; fetch?: typeof fetch; timeoutMs?: number}) {
  if (!options || !object(options.session)) invalid('A complete verified organization activity session is required');
  const given = options.session;
  if ([given.token,given.userLevel,given.account?.userNo,given.context?.levelNo,given.context?.unit?.unitNo].some(value => typeof value !== 'string' || !value || /[\r\n]/.test(value)) || given.userLevel !== given.context.levelNo) invalid('A complete verified organization activity session is required');
  if (options.baseUrl !== undefined && typeof options.baseUrl !== 'string' || options.fetch !== undefined && typeof options.fetch !== 'function') invalid('Invalid organization activity base URL or fetch implementation');
  const baseUrl = (options.baseUrl ?? 'https://friends.cqu.edu.cn/gateway').replace(/\/$/,'');
  const session = structuredClone(options.session);
  const fetchImpl = options.fetch ?? fetch, timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) invalid('Invalid organization activity timeout');
  try { const base = new URL(baseUrl); if (!['http:','https:'].includes(base.protocol) || base.username || base.password) invalid('Invalid friends base URL'); } catch { invalid('Invalid friends base URL'); }
  const sdk = createFriendsSdk({baseUrl, fetch:fetchImpl, timeoutMs});
  async function verify() { await sdk.activateLocalContext({token:session.token,userLevel:session.userLevel,expectedAccount:session.account.userNo,selector:{levelNo:session.context.levelNo,unitNo:session.context.unit.unitNo}}); }
  async function request(path: string, method: string, body?: unknown, recovery?: WriteRecovery): Promise<JsonObject> {
    const isForm = body instanceof FormData;
    const headers: Record<string,string> = {'h-zove-token':session.token,'h-zove-userlevel':session.userLevel,'h-zove-source':'30100','h-zove-clienttype':'1','h-zove-tenantid':'EK','h-zove-appkey':path.startsWith(common) ? mainService : service};
    if (!isForm) headers['content-type'] = path.startsWith(`${common}/list-group-resource?`) ? 'application/x-www-form-urlencoded' : 'application/json';
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {method, headers, body:body === undefined ? undefined : isForm ? body : JSON.stringify(body), redirect:'error', signal:AbortSignal.timeout(timeoutMs)});
      if (response.status === 401) throw new FriendsError({code:FriendsErrorCode.AuthRequired,message:'Friends session expired'});
      if (response.status === 403) throw new FriendsError({code:FriendsErrorCode.PermissionDenied,message:'The school denied this organization activity context'});
      if (!response.ok) protocol(`Unexpected organization activity HTTP status ${response.status}`);
      const envelope = object(await response.json());
      if (!envelope || typeof envelope.code !== 'string') protocol('Invalid organization activity envelope');
      if (envelope.code !== '0') throw new FriendsError({code:FriendsErrorCode.UpstreamBusiness,message:text(envelope.message) ?? 'The school rejected the organization activity operation',upstreamCode:envelope.code,requestId:text(envelope.requestId) ?? undefined});
      return envelope;
    } catch (error) {
      if (error instanceof FriendsError && [FriendsErrorCode.AuthRequired,FriendsErrorCode.PermissionDenied,FriendsErrorCode.UpstreamBusiness].some(code => code === error.code)) throw error;
      if (recovery) throw new FriendsError({code:FriendsErrorCode.UnknownOutcome,message:'The organization activity write outcome is unknown; inspect it manually before any further write',recovery:{...recovery,serverAcknowledged:'unknown'},cause:error});
      if (error instanceof FriendsError) throw error;
      throw new FriendsError({code:FriendsErrorCode.NetworkProtocol,message:'Could not read organization activity data',cause:error});
    }
  }
  async function detail(id: OrganizationActivityId) {
    organizationActivityId(id); await verify();
    const raw = object((await request(`${prefix}/apply-info/${encodeURIComponent(id)}`,'GET')).data);
    if (!raw || raw.uuid !== id) protocol('The school returned a different organization activity');
    return raw;
  }
  async function organization(id: string) {
    await verify();
    const data = (await request(`${prefix}/apply-info/drop-down-list`,'POST',{isTeacher:false})).data;
    if (!Array.isArray(data)) protocol('Invalid organization activity permissions');
    const matches = data.map(object).filter(row => row?.uuid === id);
    if (matches.length !== 1) throw new FriendsError({code:FriendsErrorCode.PermissionDenied,message:'This organization is not available for activity offering'});
    const selected = matches[0]!;
    if (!text(selected.organizationName) || !text(selected.organizationType)) protocol('Incomplete organization activity permission');
    return selected;
  }
  async function prepare(value: unknown) {
    const input = validateOrganizationActivityOfferingInput(value);
    const selected = await organization(input.organizationId);
    const terms = (await request(`${common}/term-list`,'POST')).data;
    if (!Array.isArray(terms)) protocol('Invalid school term list');
    const available = terms.map(object).filter((term): term is JsonObject => !!term && (input.term ? ['beginYear','endYear','termNo'].every(key => String(term[key]) === input.term![key as keyof typeof input.term]) : (term.isCurrentTerm === 1 || term.isCurrentTerm === '1' || term.isCurrentTerm === true)));
    if (available.length !== 1 || ['beginYear','endYear','termNo'].some(key => !['string','number'].includes(typeof available[0][key]))) invalid('Select one school-returned term');
    const term = available[0];
    const firstStep = {beginYear:term.beginYear,endYear:term.endYear,termNo:term.termNo,activityName:input.activityName,activityContent:input.activityContent,activityPlace:input.activityPlace,
      beginTime:input.beginTime,endTime:input.endTime,organizationId:input.organizationId,organizationName:selected.organizationName,organizationType:selected.organizationType === 'CCYL' ? 1 : 3,
      attachmentGroupUuid:'',publicityPicturesGroupUuid:'',uuid:''};
    const settings = {...input.registration,organizationId:input.organizationId,activityName:input.activityName,beginTime:input.beginTime,isEnrollPowerStr:'1',beginEndFlagStr:'1',openType:'TIMING_ON',finishType:'TIMING_ON',applyNumber:0,draft:false,push:true,addOrUpdate:2,questionnaireInfoRespDtoList:[]};
    const plan = {status:'materials-required' as const,submitted:false as const,binding:{accountUserNo:session.account.userNo,levelNo:session.context.levelNo,unitNo:session.context.unit.unitNo,organizationId:input.organizationId},firstStep,settings,
      materials:{publicityPictures:input.materials.publicityPictures.map(file => ({name:file.name,size:file.size,type:file.type})),attachments:input.materials.attachments!.map(file => ({name:file.name,size:file.size,type:file.type}))}};
    return {input,plan};
  }
  async function resources(groupUuid: string) {
    const data = (await request(`${common}/list-group-resource?groupUuid=${encodeURIComponent(groupUuid)}`,'POST')).data;
    if (!Array.isArray(data)) protocol('Invalid organization activity resource group');
    return data.map(value => { const row = object(value); if (!row || !text(row.uuid) || !text(row.title) || typeof row.fileExtension !== 'string') protocol('Invalid organization activity resource'); return {id:row.uuid as string,name:(row.title as string)+row.fileExtension}; });
  }
  function groups(value: unknown): OrganizationActivityMaterials {
    const raw = object(value); if (!raw) invalid('Confirmed uploaded material groups are required');
    function group(value: unknown) {
      const item = object(value);
      if (!item || typeof item.groupUuid !== 'string' || !/^[0-9a-f]{32}$/.test(item.groupUuid) || !Array.isArray(item.resourceUuids) || item.resourceUuids.length === 0) invalid('Invalid organization activity material group');
      const ids = item.resourceUuids.map(id => identifier(id,'material resource ID'));
      if (new Set(ids).size !== ids.length) invalid('Duplicate material resource ID');
      return {groupUuid:item.groupUuid,resourceUuids:ids};
    }
    return {publicity:group(raw.publicity),attachments:raw.attachments === null || raw.attachments === undefined ? null : group(raw.attachments)};
  }
  async function verifyMaterials(input: OrganizationActivityOfferingInput, materials: OrganizationActivityMaterials) {
    for (const [group,files] of [[materials.publicity,input.materials.publicityPictures],[materials.attachments,input.materials.attachments!]] as const) {
      if (!group && files.length === 0) continue;
      if (!group || group.resourceUuids.length !== files.length) invalid('Missing organization activity materials');
      const remote = await resources(group.groupUuid);
      if (!files.every((file,index) => remote.some(item => item.id === group.resourceUuids[index] && item.name === file.name))) invalid('Uploaded organization activity materials do not match the school resource group');
    }
  }
  function requireConfirmation(value: unknown, expected: string) {
    if (object(value)?.confirmation !== expected) invalid(`SDK confirmation required: ${expected}`);
  }
  const client = {
    async prepare(value: unknown) { return (await prepare(value)).plan; },
    async uploadMaterials(value: unknown, intent: {confirmation: 'organization-activities.materials'}) {
      requireConfirmation(intent,'organization-activities.materials');
      const {input} = await prepare(value);
      const materials: OrganizationActivityMaterials = {publicity:{groupUuid:crypto.randomUUID().replaceAll('-',''),resourceUuids:[]},attachments:input.materials.attachments!.length ? {groupUuid:crypto.randomUUID().replaceAll('-',''),resourceUuids:[]} : null};
      const completed = [`publicity-group:${materials.publicity.groupUuid}`,...(materials.attachments ? [`attachment-group:${materials.attachments.groupUuid}`] : [])];
      for (const [group,files] of [[materials.publicity,input.materials.publicityPictures],[materials.attachments,input.materials.attachments!]] as const) {
        if (!group) continue;
        for (const file of files) {
          const form = new FormData(); form.append('files',file,file.name); form.append('groupId',group.groupUuid);
          const recovery: WriteRecovery = {operation:'organization-activities.materials',organizationId:input.organizationId,completed:[...completed],inProgress:`upload:${group.groupUuid}:${file.name}`};
          let acknowledged = false;
          try {
            const envelope = await request(`${common}/protected-file-upload`,'POST',form,recovery);
            acknowledged = true;
            if (!Array.isArray(envelope.data) || envelope.data.length !== 1 || typeof envelope.data[0] !== 'string' || !envelope.data[0]) throw new FriendsError({code:FriendsErrorCode.UnknownOutcome,message:'The material upload did not return a resource ID',recovery});
            const resourceId = envelope.data[0];
            group.resourceUuids.push(resourceId); completed.push(`upload:${resourceId}`);
            const remote = await resources(group.groupUuid);
            if (!remote.some(item => item.id === resourceId && item.name === file.name)) throw new FriendsError({code:FriendsErrorCode.UnknownOutcome,message:'The uploaded material could not be verified',recovery});
          } catch (error) {
            const uncertain = !(error instanceof FriendsError) || ![FriendsErrorCode.AuthRequired,FriendsErrorCode.PermissionDenied,FriendsErrorCode.UpstreamBusiness].some(code => code === error.code);
            let readback: WriteRecovery['readback'] = 'unavailable';
            if (uncertain && !acknowledged) try { readback = (await resources(group.groupUuid)).some(item => item.name === file.name) ? 'matched' : 'unmatched'; } catch {}
            throw new FriendsError({code:uncertain ? FriendsErrorCode.UnknownOutcome : (error as FriendsError).code,message:uncertain ? 'The material upload outcome is unknown; remaining writes were stopped' : (error as Error).message,
              recovery:{...recovery,completed:[...completed],serverAcknowledged:acknowledged ? true : uncertain ? 'unknown' : false,readback},cause:error});
          }
        }
      }
      return {status:'materials-ready' as const,submitted:false as const,...materials};
    },
    async submit(value: unknown, intent: {confirmation: 'organization-activities.submit'; materials: OrganizationActivityMaterials}) {
      requireConfirmation(intent,'organization-activities.submit');
      const materials = groups(intent.materials);
      const {input,plan} = await prepare(value);
      await verifyMaterials(input,materials);
      const expected = {...plan.firstStep,...plan.settings,publicityPicturesGroupUuid:materials.publicity.groupUuid,attachmentGroupUuid:materials.attachments?.groupUuid ?? ''};
      const persisted = ['organizationId','activityName','activityContent','activityPlace','beginTime','endTime','publicityPicturesGroupUuid','attachmentGroupUuid','isOpenEnrollment','isHideList','isEnrollExamine','isEnrollPower','signinNum','openType','openTime','finishType','deadline','applyNumber'] as const;
      const matches = (raw: JsonObject) => persisted.every(key => raw[key] === expected[key]);
      const completed = ['materials-verified'];
      let applicationId: string | undefined, inProgress = 'next-update';
      try {
        const saved = await request(`${prefix}/apply-info/next-update`,'PUT',{...plan.firstStep,publicityPicturesGroupUuid:materials.publicity.groupUuid,attachmentGroupUuid:materials.attachments?.groupUuid ?? ''},{operation:'organization-activities.submit',organizationId:input.organizationId,completed:[...completed],inProgress});
        try { applicationId = identifier(saved.data,'new organization activity ID'); } catch { throw new FriendsError({code:FriendsErrorCode.UnknownOutcome,message:'The first save did not return a valid activity ID'}); }
        completed.push(`next-update:${applicationId}`);
        inProgress = 'recheck-permission'; await organization(input.organizationId);
        inProgress = 'set-update';
        await request(`${prefix}/apply-info/set-update`,'PUT',{...plan.settings,uuid:applicationId},{operation:'organization-activities.submit',organizationId:input.organizationId,applicationId,completed:[...completed],inProgress});
        completed.push(`set-update:${applicationId}`);
      } catch (error) {
        const code = error instanceof FriendsError ? error.code : FriendsErrorCode.UnknownOutcome;
        let readback: WriteRecovery['readback'] = 'unavailable';
        if (code === FriendsErrorCode.UnknownOutcome && applicationId) try { const current = await detail(organizationActivityId(applicationId)); readback = matches(current) ? 'matched' : 'unmatched'; } catch {}
        throw new FriendsError({code,message:error instanceof Error ? error.message : 'The organization activity submission outcome is unknown',recovery:{operation:'organization-activities.submit',organizationId:input.organizationId,applicationId,activityId:applicationId,completed:[...completed],inProgress,serverAcknowledged:code === FriendsErrorCode.UnknownOutcome ? 'unknown' : false,readback},cause:error});
      }
      let readback: {state:'matched'|'unmatched'|'unavailable';activity:OrganizationActivity|null} = {state:'unavailable',activity:null};
      try { const raw = await detail(organizationActivityId(applicationId!)); readback = {state:matches(raw) ? 'matched' : 'unmatched',activity:activity(raw)}; } catch {}
      return {submitted:true as const,serverAcknowledged:true as const,approved:null,applicationId:applicationId!,completed,readback};
    },
    async list(input: OrganizationActivityQuery = {}) {
      const q = query(input); await verify();
      const result = object((await request(`${prefix}/apply-info/${q.kind === 'public' ? 'activity-page-list' : 'my-page-list'}`,'POST', {currentPage:q.page,pageSize:q.pageSize,key:q.keyword,...(q.kind === 'public' ? {approve:false} : {})})).data);
      if (!result || !Array.isArray(result.data)) protocol('Invalid organization activity page');
      const page = number(result.currentPage) ?? q.page, pages = Number.isSafeInteger(result.pages) && (result.pages as number) >= 0 ? result.pages as number : null;
      return {items:result.data.map(activity),page,pageSize:number(result.pageSize) ?? q.pageSize,totalCount:number(result.totalCount),hasMore:pages === null ? null : page < pages};
    },
    async get(id: OrganizationActivityId) { return activity(await detail(id)); },
    async status(id: OrganizationActivityId) {
      const current = activity(await detail(id));
      const flow = object((await request(`${common}/flow/approve-list`,'POST',{businessTypeCode:'组织活动申请流程',applyId:id,branchNo:''})).data);
      if (!flow) protocol('Invalid organization activity workflow response');
      return {...current,flow:{nodeList:Array.isArray(flow.nodeList) ? flow.nodeList : null,evaluationRecords:Array.isArray(flow.evaluationRecords) ? flow.evaluationRecords : null}};
    },
    async requirements(id: OrganizationActivityId): Promise<OrganizationActivityRequirements> {
      const raw = await detail(id);
      return {activityId:id,isOpenEnrollment:typeof raw.isOpenEnrollment === 'boolean' ? raw.isOpenEnrollment : null,membersOnly:typeof raw.isEnrollPower === 'boolean' ? raw.isEnrollPower : null,
        openTime:text(raw.openTime),deadline:text(raw.deadline),applyNumber:number(raw.applyNumber),questionnaire:Array.isArray(raw.questionnaireInfoRespDtoList) ? raw.questionnaireInfoRespDtoList.map(value => {const row=object(value); if(!row)protocol('Invalid organization activity questionnaire');return {id:text(row.uuid),title:text(row.title),type:text(row.itemType)};}) : []};
    },
  };
  return client;
}
