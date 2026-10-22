import { createOrganizationParticipationClient, validateOrganizationParticipationInput, type OrganizationParticipationInput } from './organization-participation.js';
import { prepareOrganizationParticipationPage } from './organization-participation-page.js';
import { readVerifiedEgoSession } from './node.js';
import { runEgoJson } from './certification-ego.js';
import { FriendsError, FriendsErrorCode } from './errors.js';
export async function prepareOrganizationParticipationInEgo(options: {
    input: OrganizationParticipationInput;
    taskSpaceId: number;
    page?: string;
    baseUrl?: string;
    command?: string;
    timeoutMs?: number;
}) {
    if (!Number.isSafeInteger(options.taskSpaceId) || options.taskSpaceId < 1 || !/^p[1-9][0-9]*$/.test(options.page ?? 'p1') || Object.keys(options).some(k => !['input', 'taskSpaceId', 'page', 'baseUrl', 'command', 'timeoutMs'].includes(k)))
        throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message: 'Invalid Ego preparation options; final submission is manual' });
    const timeoutMs = options.timeoutMs ?? 120000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
        throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message: 'Invalid Ego timeout' });
    validateOrganizationParticipationInput(options.input);
    const input = structuredClone(options.input), baseUrl = options.baseUrl ?? 'https://friends.cqu.edu.cn/gateway';
    const session = await readVerifiedEgoSession({ ...options, baseUrl });
    const plan = await createOrganizationParticipationClient({ baseUrl, session }).prepare(input, 'ego');
    const script = `const task=await taskSpace(${options.taskSpaceId});const page=task.page(${JSON.stringify(options.page ?? 'p1')});const result=await (${prepareOrganizationParticipationPage.toString()})(page,${JSON.stringify({ url: new URL(plan.route, baseUrl).href, plan, answers: input.answers ?? {}, token: session.token, userLevel: session.userLevel })});if(!result.denied)await task.handOff();console.log('FRIENDS_ORG_PARTICIPATION:'+JSON.stringify({...result,handoff:result.denied?'not-required':'completed'}));`;
    try {
        const result = await runEgoJson<{
            status: string;
            submitted: false;
            completed: string[];
            manualFields: string[];
            handoff: string;
            executionError?: boolean;
            denied?: boolean;
        }>({ script, command: options.command ?? 'ego-browser', timeoutMs, marker: 'FRIENDS_ORG_PARTICIPATION:', failure: 'Visible organization participation preparation was interrupted' });
        if (result.denied)
            throw new FriendsError({ code: FriendsErrorCode.PermissionDenied, message: 'The visible browser identity changed' });
        if (result.submitted !== false || !Array.isArray(result.completed) || !Array.isArray(result.manualFields) || result.handoff !== 'completed' || !['awaiting-user', 'needs-user'].includes(result.status))
            throw new Error('Invalid browser result');
        if (result.executionError)
            throw new FriendsError({ code: FriendsErrorCode.UnknownOutcome, message: 'Visible preparation stopped partway; review the current page before continuing', recovery: { operation: 'organization-participation.prepare', activityId: input.activityId, completed: result.completed } });
        return { ...result, activityId: input.activityId, action: input.action };
    }
    catch (error) {
        if (error instanceof FriendsError && (error.code === FriendsErrorCode.PermissionDenied || error.code === FriendsErrorCode.UnknownOutcome && error.recovery))
            throw error;
        throw new FriendsError({ code: FriendsErrorCode.UnknownOutcome, message: 'Ego preparation may be partial; inspect the current page; no final submission was requested', recovery: { operation: 'organization-participation.prepare', activityId: input.activityId, completed: ['visible-preparation-started'] } });
    }
}
