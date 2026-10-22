import { spawn } from "node:child_process";
import {
  buildVolunteerCertificationPreparation,
  rejectVolunteerCertificationEgoSubmit,
  type CertificationPageSnapshot,
  type VolunteerCertificationPreparation,
} from "./certification-prepare.js";
import { parseVolunteerCertificationDraft, validateVolunteerCertificationDraft, type VolunteerCertificationDraft } from "./drafts.js";
import { createVolunteerCertificationClient } from "./draft-source.js";
import { FriendsError, FriendsErrorCode } from "./errors.js";

export interface VolunteerCertificationEgoPreparationResult extends VolunteerCertificationPreparation {
  handoff?: "completed";
  executionError?: {code:string;message:string}|null;
  completedActions: Array<VolunteerCertificationPreparation["actions"][number]>;
  page: CertificationPageSnapshot;
}

interface VerifiedEgoPreparationSession {
  token: string;
  userLevel: string;
  account: { userNo: string; userName?: string };
  context: { levelNo: string; levelName?: string; unit: { unitType?: number; unitNo: string; unitName?: string } };
}

interface EgoOptions {
  draft: VolunteerCertificationDraft;
  session: VerifiedEgoPreparationSession;
  taskSpaceId: number;
  page?: string;
  baseUrl?: string;
  command?: string;
  timeoutMs?: number;
  dryRun?: boolean;
}

const certificationPath = "/mobile/volunteerManage/campusActivityCerApply";

function error(message: string, code: FriendsErrorCode = FriendsErrorCode.AuthRequired): FriendsError {
  return new FriendsError({ code, message });
}

function invalid(message: string): never {
  throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message });
}

function targetUrl(options: EgoOptions): string {
  const base = new URL(options.baseUrl ?? "https://friends.cqu.edu.cn/gateway");
  const url = new URL(certificationPath, base.origin);
  url.searchParams.set("uuid", options.draft.activity.id);
  url.searchParams.set("type", "attestApply");
  return url.toString();
}

function validateEgoOptions(options: EgoOptions): void {
  if (!Number.isSafeInteger(options.taskSpaceId) || options.taskSpaceId < 1) {
    throw error("Invalid Ego task space", FriendsErrorCode.InvalidInput);
  }
  const page = options.page ?? "p1";
  if (!/^p[1-9][0-9]*$/.test(page)) throw error("Invalid Ego page label", FriendsErrorCode.InvalidInput);
  const timeoutMs = options.timeoutMs ?? 300_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw error("Invalid Ego timeout", FriendsErrorCode.InvalidInput);
  }
}

async function runEgoJson<T>(options: {
  script: string;
  command: string;
  timeoutMs: number;
  marker: string;
  failure: string;
}): Promise<T> {
  const child = spawn(options.command, ["nodejs"], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  const collect = (stream: "stdout" | "stderr", chunk: Buffer) => {
    if (stream === "stdout") stdout += chunk.toString(); else stderr += chunk.toString();
    if (stdout.length + stderr.length > 1024 * 1024) child.kill("SIGTERM");
  };
  child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
  child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
  child.stdin.on("error", () => child.kill("SIGTERM"));
  const timer = setTimeout(() => child.kill("SIGTERM"), options.timeoutMs);
  const closed = new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? -1));
  });
  child.stdin.end(options.script);
  let exitCode: number;
  try {
    exitCode = await closed;
  } catch {
    child.kill("SIGTERM");
    throw error("Could not start the configured Ego browser command");
  } finally {
    clearTimeout(timer);
  }
  if (exitCode !== 0) throw error(options.failure, FriendsErrorCode.UnknownOutcome);
  const lines = `${stdout}\n${stderr}`.split("\n").filter((line) => line.startsWith(options.marker));
  const last = lines.length === 1 ? lines[0].slice(options.marker.length) : undefined;
  if (last === undefined) throw error(options.failure, FriendsErrorCode.UnknownOutcome);
  let parsed: T & { error?: string; errorCode?: string };
  try {
    parsed = JSON.parse(last) as T & { error?: string; errorCode?: string };
  } catch {
    throw error("The Ego certification bridge returned an invalid result");
  }
  if (typeof parsed === "object" && parsed !== null && typeof parsed.error === "string") {
    const code = Object.values(FriendsErrorCode).find((value) => value === parsed.errorCode);
    throw error(parsed.error, code ?? FriendsErrorCode.NetworkProtocol);
  }
  return parsed;
}

export async function prepareVolunteerCertificationInEgo(options: EgoOptions): Promise<VolunteerCertificationEgoPreparationResult> {
  validateEgoOptions(options);
  const draft = parseVolunteerCertificationDraft(options.draft);
  if (!validateVolunteerCertificationDraft(draft, "complete").complete) invalid("The certification draft is incomplete");
  const client = createVolunteerCertificationClient({
    baseUrl:options.baseUrl ?? "https://friends.cqu.edu.cn/gateway",
    session:{token:options.session.token,userLevel:options.session.userLevel,accountUserNo:options.session.account.userNo,levelNo:options.session.context.levelNo,unitNo:options.session.context.unit.unitNo},
  });
  const source=await client.getCertificationSource(draft.activity.id);
  for(const studentNo of draft.includedStudentNos){
    const row=draft.registrations.find(item=>item.studentNo===studentNo)!;
    const current=source.registrations.find(item=>item.studentNo===studentNo);
    const post=source.activity.posts.find(item=>item.id===row.postId);
    if(!post||post.name!==row.postName || row.registrationId!==null && current?.registrationId!==row.registrationId) invalid("The selected roster or post changed; refresh the draft");
    if(row.registrationId===null){
      if(current) invalid("The manually added student now has a registration; refresh the draft");
      const student=await client.getStudent(studentNo);
      if(student.studentName!==row.studentName) invalid("The selected student name changed; refresh the draft");
    }
  }
  buildVolunteerCertificationPreparation(draft,source,{activity:draft.activity,rows:[],selectedStudentNos:[]},options.session);
  const runtime = new URL("./certification-page.js", import.meta.url).href;
  const input = {draft,source,session:options.session,page:options.page??"p1",url:targetUrl(options),dryRun:options.dryRun};
  const script = `
const task = await taskSpace(${options.taskSpaceId});
const {prepareCertificationPage} = await import(${JSON.stringify(runtime)});
try {
 const result = await prepareCertificationPage(task, ${JSON.stringify(input)});
 console.log("FRIENDS_CLI_CERTIFICATION_PREPARE:" + JSON.stringify(result));
} catch(error) {
 console.log("FRIENDS_CLI_CERTIFICATION_PREPARE:" + JSON.stringify({error:error.message,errorCode:error.code}));
}
`;
  const result = await runEgoJson<VolunteerCertificationEgoPreparationResult>({script,
    command:options.command??"ego-browser",timeoutMs:(options.timeoutMs??300_000)+30_000,
    marker:"FRIENDS_CLI_CERTIFICATION_PREPARE:",failure:"Could not prepare the visible volunteer certification page; inspect it before retrying"});
  if(result.executionError) throw new FriendsError({code:FriendsErrorCode.UnknownOutcome,message:result.executionError.message,recovery:{operation:"drafts.prepare",draftId:draft.id,activityId:draft.activity.id,completed:result.completedActions.map(action=>action.kind)}});
  return result;
}

export function rejectVolunteerCertificationEgoSubmitInEgo(input: Parameters<typeof rejectVolunteerCertificationEgoSubmit>[0]): never {
  rejectVolunteerCertificationEgoSubmit(input);
}
