import { createVolunteerCertificationClient, type VerifiedVolunteerSession } from './draft-source.js';
import { buildVolunteerCertificationSubmitPayload, parseVolunteerCertificationDraft, type VolunteerCertificationDraft, type VolunteerCertificationSubmitPayload } from './drafts.js';
import { FriendsError, FriendsErrorCode } from './errors.js';

type JsonObject = Record<string, unknown>;
const service = 'zovecenter-saip-ek-app-young-volunteers';
const prefix = `/${service}/mob/school-activity-attestation-apply`;
const object = (value: unknown): JsonObject | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : null;
const text = (value: unknown): string | null => typeof value === 'string' && value.length > 0 ? value : null;
function invalid(message: string): never { throw new FriendsError({code:FriendsErrorCode.InvalidInput,message}); }
function conflict(message: string): never { throw new FriendsError({code:FriendsErrorCode.UpstreamBusiness,message}); }

export interface CertificationStatus {
  activityId: string;
  applicationId: string | null;
  state: 'absent' | 'present';
  rawState: unknown;
  entries: Array<{ studentNo: string; postId: string | null; durationHours: number | null }>;
}
export interface CertificationSubmitIntent {
  via: 'api';
  intent: 'submit-volunteer-certification';
  confirm?: boolean;
  dryRun?: boolean;
}

export function createVolunteerCertificationApi(options: {
  baseUrl: string; session: VerifiedVolunteerSession; fetch?: typeof fetch; timeoutMs?: number;
}) {
  const source = createVolunteerCertificationClient(options);
  const session = {...options.session};
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const timeoutMs = options.timeoutMs ?? 60_000;
  async function request(path: string, payload?: VolunteerCertificationSubmitPayload) {
    let response: Response;
    try { response = await fetchImpl(`${baseUrl}${path}`, {
      method: payload ? 'POST' : 'GET', redirect:'error', signal:AbortSignal.timeout(timeoutMs),
      headers:{'content-type':'application/json','h-zove-token':session.token,'h-zove-source':'30100','h-zove-clienttype':'1','h-zove-tenantid':'EK','h-zove-appkey':service,'h-zove-userlevel':session.userLevel},
      body: payload ? JSON.stringify(payload) : undefined,
    }); } catch(cause) { throw new FriendsError({code:FriendsErrorCode.NetworkProtocol,message:'Could not reach the school certification service',retryable:payload===undefined,cause}); }
    if(response.status===401) throw new FriendsError({code:FriendsErrorCode.AuthRequired,message:'Friends session expired'});
    if(response.status===403) throw new FriendsError({code:FriendsErrorCode.PermissionDenied,message:'The school denied certification submission in this context'});
    if(response.status===409) conflict('The school reported a certification state conflict');
    if(!response.ok) throw new FriendsError({code:FriendsErrorCode.NetworkProtocol,message:`Unexpected school HTTP status ${response.status}`});
    let body:unknown;
    try { body=await response.json(); } catch(cause) { throw new FriendsError({code:FriendsErrorCode.NetworkProtocol,message:'Invalid certification JSON response',cause}); }
    const envelope=object(body);
    if(!envelope || typeof envelope.code!=='string') throw new FriendsError({code:FriendsErrorCode.NetworkProtocol,message:'Invalid certification response'});
    if(envelope.code!=='0') throw new FriendsError({code:FriendsErrorCode.UpstreamBusiness,message:'The school rejected the certification operation',upstreamCode:envelope.code});
    return envelope;
  }
  async function readStatus(activityId: string): Promise<CertificationStatus> {
    const envelope=await request(`${prefix}/find-by-activity/${encodeURIComponent(activityId)}`);
    const data=object(envelope.data);
    // The school returns an all-null DTO when no certification exists.
    const emptyDto=data?.uuid===null && data.activityId===null && data.activityInfo===null && data.nameList===null && Object.values(data).every(value=>value===null);
    if(envelope.data===null || emptyDto) return {activityId,applicationId:null,state:'absent',rawState:null,entries:[]};
    if(!data || object(data.activityInfo)?.uuid!==activityId || !Array.isArray(data.nameList)) {
      throw new FriendsError({code:FriendsErrorCode.NetworkProtocol,message:'Certification readback does not identify the requested activity'});
    }
    return {activityId,applicationId:text(data.uuid),state:'present',rawState:data.flowOverallState??data.state??null,
      entries:data.nameList.map(value=>{
        const row=object(value);
        if(!text(row?.studentNo)) throw new FriendsError({code:FriendsErrorCode.NetworkProtocol,message:'Invalid certification roster readback'});
        return {studentNo:row!.studentNo as string,postId:text(row!.postId),durationHours:typeof row!.attestationDuration==='number'?row!.attestationDuration:null};
      })};
  }
  async function status(activityId: string): Promise<CertificationStatus> {
    await source.getCertificationSource(activityId);
    try { return await readStatus(activityId); }
    catch(error) { if(error instanceof FriendsError) throw error; throw new FriendsError({code:FriendsErrorCode.NetworkProtocol,message:'Could not read certification status',retryable:true}); }
  }
  async function readback(draft: VolunteerCertificationDraft) {
    try {
      const current=await readStatus(draft.binding.activityId);
      const matched=current.state==='present' && current.entries.length===draft.includedStudentNos.length && draft.includedStudentNos.every(studentNo=>{
        const expected=draft.registrations.find(row=>row.studentNo===studentNo)!;
        return current.entries.some(row=>row.studentNo===studentNo && row.postId===expected.postId && row.durationHours===draft.durations[studentNo]);
      });
      return {...current,state:matched?'matched' as const:'unmatched' as const};
    } catch { return {state:'unavailable' as const,applicationId:null}; }
  }
  return {
    status,
    async submit(value: unknown, intent: CertificationSubmitIntent) {
      if(intent?.via!=='api' || intent.intent!=='submit-volunteer-certification') invalid('Certification submission requires independent --via api intent; Ego preparation never authorizes it');
      if(intent.dryRun!==undefined && typeof intent.dryRun!=='boolean' || intent.confirm!==undefined && typeof intent.confirm!=='boolean') invalid('Confirmation and dry-run must be booleans');
      if(!intent.dryRun && intent.confirm!==true) invalid('Certification submission requires explicit confirmation');
      const draft=parseVolunteerCertificationDraft(value);
      const payload=buildVolunteerCertificationSubmitPayload(draft);
      if(draft.binding.accountUserNo!==session.accountUserNo || draft.binding.levelNo!==session.levelNo || draft.binding.unitNo!==session.unitNo) invalid('The draft belongs to a different account or context');
      const current=await source.getCertificationSource(draft.binding.activityId);
      if(draft.binding.organizationId!==current.binding.organizationId || draft.activity.positionSetMethod!==current.activity.positionSetMethod) conflict('The school organization or certification method changed; refresh and review the draft');
      for(const studentNo of draft.includedStudentNos) {
        const row=draft.registrations.find(row=>row.studentNo===studentNo)!;
        const post=current.activity.posts.find(post=>post.id===row.postId);
        if(!post || post.name!==row.postName) conflict('A selected post changed; refresh and review the draft');
        const registration=current.registrations.find(item=>item.studentNo===studentNo);
        if(row.registrationId!==null) {
          if(!registration || registration.registrationId!==row.registrationId || registration.isApplied!==row.isApplied) conflict('A selected registration changed; refresh and review the draft');
        } else {
          if(registration) conflict('A manually added student now has a registration; refresh the draft');
          await source.getStudent(studentNo);
        }
      }
      const previous=await readStatus(draft.binding.activityId);
      if(previous.state!=='absent') conflict('An existing certification needs review; this command does not overwrite or resubmit it');
      if(intent.dryRun) return {submitted:false,serverAcknowledged:false,draftId:draft.id,selectedCount:payload.nameList.length,materials:{state:'none',prepared:0},readback:{state:'not-submitted'}};
      let envelope: JsonObject;
      try { envelope=await request(`${prefix}/apply`,payload); }
      catch(error) {
        if(error instanceof FriendsError && [FriendsErrorCode.AuthRequired,FriendsErrorCode.PermissionDenied,FriendsErrorCode.UpstreamBusiness].some(code=>code===error.code)) throw error;
        const result=await readback(draft);
        throw new FriendsError({code:FriendsErrorCode.UnknownOutcome,message:'The school may have accepted certification. Inspect certification status before any new submission; no retry was made.',recovery:{operation:'certification.submit',activityId:draft.binding.activityId,draftId:draft.id,applicationId:result.applicationId??undefined,completed:[`readback:${result.state}`]}});
      }
      return {submitted:true,serverAcknowledged:true,draftId:draft.id,selectedCount:payload.nameList.length,materials:{state:'none',prepared:0},receipt:{code:envelope.code,requestId:text(envelope.requestId)},readback:await readback(draft)};
    },
  };
}
