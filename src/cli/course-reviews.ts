import type {Command} from 'commander';
import {createCourseReviewClient, validateCourseReviewInput, FriendsError, FriendsErrorCode, type CourseReviewInput, type CourseReviewType} from '../index.js';
import {prepareCourseReviewInEgo} from '../node.js';
import {resolveQuerySession} from './session.js';
import {readJsonInput} from './json-input.js';

const querySchema = {readonly: true, phases: ['query'], supportedVia: ['api', 'ego'], requestMode: 'direct-api', permission: 'fresh school identity and pending visibility; registration also requires a manageable course', input: {type: 'offering|registration', page: 'positive integer', pageSize: 'positive integer', keyword: 'string'}, verification: 'public-source+controlled-api; production not verified'};
const decisionInput = {type: 'offering|registration', id: 'domain-specific application UUID', decision: 'offering: pass|back|refuse; registration: pass|refuse', input: 'JSON file or stdin: message (1..100 characters), time (YYYY-MM-DD)'};
export const courseReviewSchemas = {
  'courses.reviews.list': querySchema,
  'courses.reviews.show': {...querySchema, input: {type: 'offering|registration', id: 'domain-specific application UUID'}, output: 'raw school state, pending membership and source-supported allowedDecisions'},
  'courses.reviews.prepare': {...querySchema, readonly: false, supportedVia: ['ego'], phases: ['visible-prepare', 'human-final-submit'], requestMode: 'visible-ui', input: decisionInput, verification: 'public-source+controlled-iframe-DOM; live Ego not verified'},
  'courses.reviews.decide': {...querySchema, readonly: false, supportedVia: ['api'], phases: ['dry-run', 'explicit-api-write', 'readback'], input: {...decisionInput, yes: 'required unless dry-run'}, uncertainResult: 'UNKNOWN_OUTCOME / exit 7 even with matching readback; read-only inspection, no automatic retry'},
};
function invalid(message: string): never {throw new FriendsError({code: FriendsErrorCode.InvalidInput, message});}
function output(data: unknown, operation: string, via: string, requestMode = 'direct-api', session?: {account: unknown; context: unknown}) {
  process.stdout.write(JSON.stringify({schemaVersion: 1, ok: true, data, meta: {operation, via, selectedEntry: via, requestMode, ...(session ? {account: session.account, context: session.context} : {})}})+'\n');
}
function options(command: Command, write = false) {
  command.requiredOption('--type <type>', 'offering or registration');
  if (write) command.requiredOption('--via <source>', 'explicit API or Ego operation');
  else command.option('--via <source>', 'verified session source', 'api');
  return command.option('--ego-task-space <number>', 'existing Ego task space').option('--ego-page <label>', 'existing page label').option('--level-no <value>', 'existing role selector').option('--unit-no <value>', 'existing unit selector').option('--json', 'versioned JSON', true);
}
export function registerCourseReviewCommands(program: Command, {baseUrl}: {baseUrl: string}) {
  const parent = program.commands.find(c => c.name() === 'courses') ?? program.command('courses');
  const group = parent.command('reviews').description('Separate existing course offering and registration approvals');
  async function context(opts: Record<string, string | undefined>) {
    const source = await resolveQuerySession(opts, baseUrl);
    return {source, client: createCourseReviewClient({baseUrl, session: source.session})};
  }
  options(group.command('list')).option('--page <number>', 'page', '1').option('--page-size <number>', 'page size', '10').option('--keyword <text>', 'school keyword filter').action(async opts => {
    const {source, client} = await context(opts);
    output(await client.list(opts.type as CourseReviewType, {page: Number(opts.page), pageSize: Number(opts.pageSize), keyword: opts.keyword}), 'courses.reviews.list', source.entry, 'direct-api', source.session);
  });
  options(group.command('show').argument('<id>', 'review UUID')).action(async (reviewId, opts) => {
    const {source, client} = await context(opts);
    output(await client.get(opts.type, reviewId), 'courses.reviews.show', source.entry, 'direct-api', source.session);
  });
  for (const operation of ['prepare', 'decide'] as const) {
    const cmd = options(group.command(operation).argument('<id>', 'review UUID'), true).requiredOption('--decision <value>', 'pass, back (offering only), or refuse').requiredOption('--input <file|->', 'message and time from JSON');
    if (operation === 'decide') cmd.option('--dry-run', 'validate without submitting').option('--yes', 'explicit API confirmation');
    cmd.action(async (reviewId, opts) => {
      if (opts.via !== (operation === 'prepare' ? 'ego' : 'api')) invalid(`${operation} requires --via ${operation === 'prepare' ? 'ego' : 'api'}`);
      if (operation === 'decide' && !opts.dryRun && !opts.yes) invalid('API course review requires --yes or --dry-run');
      const fields = await readJsonInput(opts.input);
      if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).some(key => !['message', 'time'].includes(key))) invalid('Only message and time are accepted in review JSON');
      const input = {...fields, type: opts.type, id: reviewId, decision: opts.decision} as CourseReviewInput;
      validateCourseReviewInput(input);
      if (operation === 'prepare') {
        if (opts.levelNo !== undefined || opts.unitNo !== undefined) invalid('Select the desired school context in Ego before preparing a review');
        const result = await prepareCourseReviewInEgo({input, baseUrl, taskSpaceId: Number(opts.egoTaskSpace), page: opts.egoPage});
        output(result, 'courses.reviews.prepare', 'ego', 'visible-ui');
        return;
      }
      const {source, client} = await context(opts);
      const plan = await client.prepare(input);
      output(opts.dryRun ? plan : await client.decide(plan, {via: 'api', intent: 'decide-course-review', confirm: true}), 'courses.reviews.decide', 'api', 'direct-api', source.session);
    });
  }
}
