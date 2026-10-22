import {record,strings} from "./ego-receipt.js";
import { createVolunteerActivityReviewClient, validateVolunteerActivityReviewInput, type VolunteerActivityReviewInput } from './volunteer-activity-reviews.js';
import { prepareVolunteerActivityReviewPage } from './volunteer-activity-review-page.js';
import { readVerifiedEgoSession } from './node.js';
import { runEgoJson } from './certification-ego.js';
import { FriendsError, FriendsErrorCode } from './errors.js';
export async function prepareVolunteerActivityReviewInEgo(options: {
    input: VolunteerActivityReviewInput;
    taskSpaceId: number;
    page?: string;
    baseUrl?: string;
    command?: string;
    timeoutMs?: number;
}) {
    if (!Number.isSafeInteger(options.taskSpaceId) || options.taskSpaceId < 1 || !/^p[1-9][0-9]*$/.test(options.page ?? 'p1'))
        throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message: 'Invalid Ego task space or page' });
    const timeoutMs = options.timeoutMs ?? 120000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
        throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message: 'Invalid Ego timeout' });
    validateVolunteerActivityReviewInput(options.input);
    options={...options,input:structuredClone(options.input)};
    const baseUrl = options.baseUrl ?? 'https://friends.cqu.edu.cn/gateway';
    const session = await readVerifiedEgoSession({ ...options, baseUrl });
    const client = createVolunteerActivityReviewClient({ baseUrl, session, timeoutMs });
    const plan = await client.prepare(options.input);
    const input = { session:{token:session.token,userLevel:session.userLevel}, url: new URL(plan.route, baseUrl).href, ...options.input, callbackActivityId: plan.payload.callbackActivityId };
    const script = `const task=await taskSpace(${options.taskSpaceId});const page=task.page(${JSON.stringify(options.page ?? 'p1')});
const result=await (${prepareVolunteerActivityReviewPage.toString()})(page,${JSON.stringify(input)});
if(!result.denied)await task.handOff();console.log('FRIENDS_ACTIVITY_REVIEW:'+JSON.stringify({...result,handoff:result.denied?'not-attempted':'completed'}));`;
    try {
        const result = await runEgoJson<{
            status: string;
            submitted: false;
            completed: string[];
            manualFields: string[];
            handoff: 'completed';
            executionError?: boolean;
        }>({ script, command: options.command ?? 'ego-browser', timeoutMs, marker: 'FRIENDS_ACTIVITY_REVIEW:', failure: 'Ego review preparation was interrupted; inspect the page before continuing' });
        if(!record(result)||result.submitted!==false||result.handoff!=='completed'||!['needs-user','awaiting-user'].includes(result.status)||!strings(result.completed)||!strings(result.manualFields)||result.executionError!==undefined&&typeof result.executionError!=='boolean')throw new Error('Incomplete Ego review receipt');
        if (result.executionError)
            throw new FriendsError({ code: FriendsErrorCode.UnknownOutcome, message: 'Visible review preparation stopped partway; inspect the handed-off page before continuing', recovery: { operation: 'volunteer.activity-reviews.prepare', activityId: plan.activityId, applicationId: plan.id, completed: result.completed } });
        return { ...result, type: plan.type, id: plan.id, activityId: plan.activityId };
    }
    catch (error) {
        if (error instanceof FriendsError && [FriendsErrorCode.PermissionDenied,FriendsErrorCode.AuthRequired,FriendsErrorCode.InvalidInput].some(code=>code===error.code)) throw error;
        if (error instanceof FriendsError && error.code === FriendsErrorCode.UnknownOutcome && error.recovery)
            throw error;
        throw new FriendsError({ code: FriendsErrorCode.UnknownOutcome, message: 'Ego review preparation may be partial; inspect the existing page before retrying; final submission was not requested', recovery: { operation: 'volunteer.activity-reviews.prepare', activityId: plan.activityId, applicationId: plan.id, completed: ['visible-preparation-started'],handoff:'unknown',pageLabel:options.page??'p1' } });
    }
}
