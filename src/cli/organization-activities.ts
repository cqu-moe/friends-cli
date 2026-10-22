import type {Command} from 'commander';
import {lstat,readFile} from 'node:fs/promises';
import {basename,extname} from 'node:path';
import {createFriendsSdk,organizationActivityId,FriendsError,FriendsErrorCode,type OrganizationActivityMaterials} from '../index.js';
import {prepareOrganizationActivityOfferingInEgo} from '../node.js';
import {readJsonInput} from './json-input.js';
import {resolveQuerySession} from './session.js';
const queryInput = {via:'api|ego; defaults to api',egoTaskSpace:'existing task required for ego',egoPage:'existing page, default p1',levelNo:'select school identity',unitNo:'select school unit'};
const querySchema = {permission:'fresh school account; upstream organization activity access',phases:['query'],readonly:true,remoteReadonly:true,supportedVia:['api','ego'],requestMode:'direct-api',input:queryInput,verifiedWith:'public-source; controlled SDK and real CLI only'};
export const organizationActivitySchemas = {
  'organization-activities.list':{...querySchema,operation:'organization-activities.list',input:{...queryInput,kind:'public|manageable (my-page-list)',page:'positive integer, default 1',pageSize:'positive integer, default 10',keyword:'school key filter'},output:'one organization activity page; unknown pagination remains null'},
  'organization-activities.show':{...querySchema,operation:'organization-activities.show',input:{...queryInput,activityId:'organization activity UUID'},output:'organization activity projection with uninterpreted school state'},
  'organization-activities.requirements':{...querySchema,operation:'organization-activities.requirements',input:{...queryInput,activityId:'organization activity UUID'},output:'enrollment settings and questionnaire definitions, without registering'},
  'organization-activities.status':{...querySchema,operation:'organization-activities.status',input:{...queryInput,activityId:'organization activity UUID'},output:'current opening application state and school workflow records; no volunteer/course status mapping'},
  'organization-activities.prepare':{...querySchema,operation:'organization-activities.prepare',readonly:false,remoteReadonly:true,phases:['validate','query','visible-prepare','awaiting-user'],input:{...queryInput,input:'JSON file or stdin (-); fields and registration settings; materials.publicityPictures/attachments use {path}',dryRun:'inspection only; zero controls, uploads, saves or handoff'},output:'API materials-required plan or Ego editable activity information with manual fields',finalSubmission:'human-only for Ego',sideEffect:'Ego fills empty editable text controls and hands off; Next saves remotely and is never clicked'},
  'organization-activities.materials':{operation:'organization-activities.materials',permission:'fresh offering organization returned by chose-type',phases:['validate','query','upload','readback'],readonly:false,remoteReadonly:false,supportedVia:['api'],input:{via:'api',input:'same JSON file or stdin (-)',confirm:'required for uploads; SDK confirmation organization-activities.materials',dryRun:'plan only'},output:'material groups and acknowledged resource IDs; no activity save',sideEffect:'one upload per file, no retry; unknown upload stops all remaining writes',verifiedWith:'public-source; controlled SDK and real CLI only'},
  'organization-activities.submit':{operation:'organization-activities.submit',permission:'fresh offering organization and school-verified materials',phases:['validate','query','next-update','set-update','readback'],readonly:false,remoteReadonly:false,supportedVia:['api'],input:{via:'api',input:'same JSON file or stdin (-)',materials:'material receipt JSON file or stdin, from materials command',confirm:'required; SDK confirmation organization-activities.submit',dryRun:'plan only'},output:'acknowledgement and separate readback; approved remains null',sideEffect:'first-step PUT then final PUT once; any uncertain result stops writes and exits 7 even if readback matches',finalSubmission:'Ego submission is rejected',verifiedWith:'public-source; controlled SDK and real CLI only'},
} as const;
function invalid(message: string): never {throw new FriendsError({code:FriendsErrorCode.InvalidInput,message});}
function object(value: unknown): Record<string,unknown> | null {return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : null;}
async function input(source: string) {
  const raw = object(await readJsonInput(source)), materials = object(raw?.materials);
  if (!raw || !materials) invalid('Organization activity materials are required');
  const hydrate = async (value: unknown,publicity: boolean) => {
    if (!Array.isArray(value) || value.length > (publicity ? 5 : 10) || publicity && value.length === 0) invalid('Materials require 1..5 publicity pictures and at most 10 attachments');
    const files: File[] = [];
    for (const entry of value) {
      const item = object(entry);
      if (!item || typeof item.path !== 'string' || !item.path || Object.keys(item).some(key => key !== 'path')) invalid('Each CLI material must contain only a path');
      const stat = await lstat(item.path).catch(() => null);
      if (!stat?.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > (publicity ? 20 : 200)*1024*1024) invalid('Material path must be a supported regular file within the upload size limit');
      const extension = extname(item.path).slice(1).toLowerCase();
      const types: Record<string,string> = {png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',bmp:'image/bmp'};
      files.push(new File([new Uint8Array(await readFile(item.path))],basename(item.path),{type:types[extension] ?? 'application/octet-stream'}));
    }
    return files;
  };
  return {...raw,materials:{...materials,publicityPictures:await hydrate(materials.publicityPictures,true),attachments:await hydrate(materials.attachments ?? [],false)}};
}
function queryOptions(command: Command) {
  return command.option('--via <source>','api or existing Ego session','api').option('--ego-task-space <number>','existing Ego task space').option('--ego-page <label>','existing Ego page label').option('--level-no <value>','select Ego school identity').option('--unit-no <value>','select Ego school unit').option('--json','print versioned JSON',true);
}
export function registerOrganizationActivityCommands(program: Command,{baseUrl}: {baseUrl: string}) {
  const root = program.command('organization-activities').description('Organization activity browsing and opening applications');
  const output = (operation: string,data: unknown,entry: 'api'|'ego',requestMode: string) => process.stdout.write(`${JSON.stringify({schemaVersion:1,ok:true,data,meta:{operation,selectedEntry:entry,requestMode}})}\n`);
  async function source(options: Record<string,string>) {
    const selected = await resolveQuerySession(options,baseUrl);
    return {...selected,client:await createFriendsSdk({baseUrl}).createOrganizationActivityClient(selected.session)};
  }
  queryOptions(root.command('list').description('List public activities or own manageable applications')).option('--kind <value>','public or manageable','public').option('--page <number>','page','1').option('--page-size <number>','page size','10').option('--keyword <value>','activity or organization keyword')
    .action(async (options: Record<string,string>) => {
      const selected = await source(options);
      if (options.kind !== 'public' && options.kind !== 'manageable') invalid('kind must be public or manageable');
      output('organization-activities.list',await selected.client.list({kind:options.kind,page:Number(options.page),pageSize:Number(options.pageSize),keyword:options.keyword}),selected.entry,'direct-api');
    });
  for (const operation of ['show','requirements','status'] as const) queryOptions(root.command(operation).description(`Read organization activity ${operation}`).argument('<activityId>','organization activity UUID'))
    .action(async (id: string,options: Record<string,string>) => {
      const activityId = organizationActivityId(id), selected = await source(options);
      output(`organization-activities.${operation}`,await selected.client[operation === 'show' ? 'get' : operation](activityId),selected.entry,'direct-api');
    });
  for (const operation of ['prepare','materials','submit'] as const) {
    const command = queryOptions(root.command(operation).description(`${operation} an organization activity opening application`).requiredOption('--input <path>','JSON file or - for stdin').option('--dry-run','read and validate only'));
    if (operation !== 'prepare') command.option('--confirm','confirm this API write stage');
    if (operation === 'submit') command.option('--materials <path>','material upload receipt JSON or - for stdin');
    command.action(async (options: Record<string,string|boolean>) => {
      if (options.via !== 'api' && options.via !== 'ego') invalid('--via must be api or ego');
      if (operation !== 'prepare' && options.via !== 'api') invalid('Ego only prepares the visible form; the user personally uploads, saves and submits');
      if (operation !== 'prepare' && options.dryRun !== true && options.confirm !== true) invalid('Explicit --confirm is required for API writes');
      if (operation === 'submit' && options.input === '-' && options.materials === '-') invalid('Input and material receipt cannot both consume stdin');
      if (operation === 'submit' && options.dryRun !== true && typeof options.materials !== 'string') invalid('--materials receipt is required for submission');
      const value = await input(String(options.input));
      if (operation === 'prepare' && options.via === 'ego') {
        const result = await prepareOrganizationActivityOfferingInEgo({input:value,taskSpaceId:Number(options.egoTaskSpace),page:typeof options.egoPage === 'string' ? options.egoPage : undefined,
          levelNo:typeof options.levelNo === 'string' ? options.levelNo : undefined,unitNo:typeof options.unitNo === 'string' ? options.unitNo : undefined,baseUrl,dryRun:options.dryRun === true,command:process.env.FRIENDS_EGO_COMMAND});
        output('organization-activities.prepare',result,'ego','visible-prepare');return;
      }
      const selected = await source(options as Record<string,string>);
      let result: unknown;
      if (operation === 'prepare' || options.dryRun === true) result = await selected.client.prepare(value);
      else if (operation === 'materials') result = await selected.client.uploadMaterials(value,{confirmation:'organization-activities.materials'});
      else {
        const raw = object(await readJsonInput(String(options.materials)));
        if (raw?.schemaVersion !== undefined && (raw.schemaVersion !== 1 || raw.ok !== true)) invalid('Invalid material receipt envelope');
        result = await selected.client.submit(value,{confirmation:'organization-activities.submit',materials:(raw?.schemaVersion === 1 ? raw.data : raw) as OrganizationActivityMaterials});
      }
      output(`organization-activities.${operation}`,result,selected.entry,operation === 'prepare' || options.dryRun === true ? 'direct-api' : 'api-write');
    });
  }
}
