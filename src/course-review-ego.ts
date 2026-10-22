import {createCourseReviewClient, validateCourseReviewInput, type CourseReviewInput} from './course-reviews.js';
import {prepareVolunteerActivityReviewPage} from './volunteer-activity-review-page.js';
import {readVerifiedEgoSession} from './node.js';
import {runEgoJson} from './certification-ego.js';
import {FriendsError, FriendsErrorCode} from './errors.js';

export async function prepareCourseReviewInEgo(options: {
  input: CourseReviewInput;
  taskSpaceId: number;
  page?: string;
  baseUrl?: string;
  command?: string;
  timeoutMs?: number;
}) {
  if (!Number.isSafeInteger(options.taskSpaceId) || options.taskSpaceId < 1 || !/^p[1-9][0-9]*$/.test(options.page ?? 'p1') || Object.keys(options).some(key => !['input', 'taskSpaceId', 'page', 'baseUrl', 'command', 'timeoutMs'].includes(key))) throw new FriendsError({code: FriendsErrorCode.InvalidInput, message: 'Invalid Ego course preparation options; final submission is manual'});
  const timeoutMs = options.timeoutMs ?? 120000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new FriendsError({code: FriendsErrorCode.InvalidInput, message: 'Invalid Ego timeout'});
  validateCourseReviewInput(options.input);
  options = {...options, input: structuredClone(options.input)};
  const baseUrl = options.baseUrl ?? 'https://friends.cqu.edu.cn/gateway';
  const session = await readVerifiedEgoSession({...options, baseUrl});
  const plan = await createCourseReviewClient({baseUrl, session, timeoutMs}).prepare(options.input);
  const script = `const task=await taskSpace(${options.taskSpaceId});const page=task.page(${JSON.stringify(options.page ?? 'p1')});
const result=await (${prepareVolunteerActivityReviewPage.toString()})(page,${JSON.stringify({url: new URL(plan.route, baseUrl).href, ...options.input, session:{token:session.token,userLevel:session.userLevel}})});
if(!result.denied)await task.handOff();console.log('FRIENDS_COURSE_REVIEW:'+JSON.stringify({...result,handoff:result.denied?'not-attempted':'completed'}));`;
  try {
    const result = await runEgoJson<{status: string; submitted: false; completed: string[]; manualFields: string[]; handoff: 'completed'; executionError?: boolean}>({script, command: options.command ?? 'ego-browser', timeoutMs, marker: 'FRIENDS_COURSE_REVIEW:', failure: 'Ego course review preparation was interrupted'});
    if (result.submitted !== false || result.handoff !== 'completed' || !['needs-user', 'awaiting-user'].includes(result.status) || !Array.isArray(result.completed) || !result.completed.every(v => typeof v === 'string') || !Array.isArray(result.manualFields) || !result.manualFields.every(v => typeof v === 'string')) throw new Error('Invalid Ego course preparation response');
    if (result.executionError) throw new FriendsError({code: FriendsErrorCode.UnknownOutcome, message: 'Visible course review preparation stopped partway; inspect the handed-off page before continuing', recovery: {operation: 'courses.reviews.prepare', applicationId: plan.id, completed: result.completed}});
    return {...result, type: plan.type, id: plan.id, courseId: plan.courseId};
  } catch (error) {
    if (error instanceof FriendsError && [FriendsErrorCode.PermissionDenied,FriendsErrorCode.AuthRequired,FriendsErrorCode.InvalidInput].some(code=>code===error.code)) throw error;
    if (error instanceof FriendsError && error.code === FriendsErrorCode.UnknownOutcome && error.recovery) throw error;
    throw new FriendsError({code: FriendsErrorCode.UnknownOutcome, message: 'Course review preparation may be partial; inspect the existing page before continuing; final submission was not requested', recovery: {operation: 'courses.reviews.prepare', applicationId: plan.id, completed: ['visible-preparation-started']}});
  }
}
