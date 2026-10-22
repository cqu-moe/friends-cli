import type { Command } from 'commander';
import { createVolunteerActivityReviewClient, FriendsError, FriendsErrorCode, type VolunteerActivityReviewInput, type VolunteerActivityReviewType } from '../index.js';
import { prepareVolunteerActivityReviewInEgo } from '../node.js';
import { resolveQuerySession } from './session.js';
import { readJsonInput } from './json-input.js';
const querySchema = { readonly: true, phases: ['query'], supportedVia: ['api', 'ego'], requestMode: 'direct-api', permission: 'fresh school role and upstream review visibility', input: { type: 'offering|registration', page: 'positive integer', pageSize: 'positive integer', keyword: 'string' }, verification: 'public-source+controlled-api' };
export const volunteerActivityReviewSchemas = {
    'volunteer.activity-reviews.list': querySchema,
    'volunteer.activity-reviews.show': querySchema,
    'volunteer.activity-reviews.prepare': { ...querySchema, readonly: false, phases: ['visible-prepare', 'human-final-submit'], supportedVia: ['ego'], requestMode: 'visible-ui', input: { type: 'offering|registration', id: 'domain-specific review UUID', decision: 'pass|back|refuse (registration has no back)', input: 'JSON file or stdin: message, time, isSafeEducation (offering), callbackActivityId (back)' } },
    'volunteer.activity-reviews.decide': { ...querySchema, readonly: false, phases: ['dry-run', 'explicit-api-write', 'readback'], supportedVia: ['api'], input: { type: 'offering|registration', id: 'domain-specific review UUID', decision: 'pass|back|refuse (registration has no back)', input: 'JSON file or stdin: message, time, isSafeEducation (offering), callbackActivityId (back)', yes: 'required unless dry-run' } },
};
function invalid(message: string): never { throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message }); }
function output(data: unknown, operation: string, via: string, requestMode = 'direct-api', session?: {
    account: unknown;
    context: unknown;
}) { process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: true, data, meta: { operation, via, selectedEntry: via, requestMode, ...(session ? { account: session.account, context: session.context } : {}) } }) + '\n'); }
function options(command: Command, write = false) {
    command.requiredOption('--type <type>', 'offering or registration');
    if (write)
        command.requiredOption('--via <source>', 'explicit API or Ego operation');
    else
        command.option('--via <source>', 'verified session source', 'api');
    return command.option('--ego-task-space <number>', 'existing Ego task space').option('--ego-page <label>', 'existing page label').option('--level-no <value>', 'existing role selector').option('--unit-no <value>', 'existing unit selector').option('--json', 'versioned JSON', true);
}
export function registerVolunteerActivityReviewCommands(program: Command, { baseUrl }: {
    baseUrl: string;
}) {
    const parent = program.commands.find(c => c.name() === 'volunteer') ?? program.command('volunteer');
    const group = parent.command('activity-reviews').description('Separate volunteer offering and registration approvals');
    async function context(opts: Record<string, string | undefined>) { const source = await resolveQuerySession(opts, baseUrl); return { source, client: createVolunteerActivityReviewClient({ baseUrl, session: source.session }) }; }
    options(group.command('list')).option('--page <number>', 'page', '1').option('--page-size <number>', 'page size', '10').option('--keyword <text>', 'school keyword filter').action(async (opts) => { const { source, client } = await context(opts); output(await client.list(opts.type as VolunteerActivityReviewType, { page: Number(opts.page), pageSize: Number(opts.pageSize), keyword: opts.keyword }), 'volunteer.activity-reviews.list', source.entry, 'direct-api', source.session); });
    options(group.command('show').argument('<id>', 'review UUID')).action(async (reviewId, opts) => { const { source, client } = await context(opts); output(await client.get(opts.type, reviewId), 'volunteer.activity-reviews.show', source.entry, 'direct-api', source.session); });
    for (const operation of ['prepare', 'decide'] as const) {
        const cmd = options(group.command(operation).argument('<id>', 'review UUID'), true).requiredOption('--decision <value>', 'pass, back (offering only), or refuse').requiredOption('--input <file|->', 'review fields from JSON');
        if (operation === 'decide')
            cmd.option('--dry-run', 'validate without submitting').option('--yes', 'explicit confirmation');
        cmd.action(async (reviewId, opts) => {
            if (opts.via !== (operation === 'prepare' ? 'ego' : 'api'))
                invalid(`${operation} requires --via ${operation === 'prepare' ? 'ego' : 'api'}`);
            if (operation === 'decide' && !opts.dryRun && !opts.yes)
                invalid('API review requires --yes or --dry-run');
            const fields = await readJsonInput(opts.input);
            if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).some(key => !['message', 'time', 'isSafeEducation', 'callbackActivityId'].includes(key)))
                invalid('Unsupported review JSON fields');
            const input = { ...fields, type: opts.type, id: reviewId, decision: opts.decision } as VolunteerActivityReviewInput;
            if (operation === 'prepare') {
                if (opts.levelNo !== undefined || opts.unitNo !== undefined)
                    invalid('Select the desired school context in Ego before preparing a review');
                const result = await prepareVolunteerActivityReviewInEgo({ input, baseUrl, taskSpaceId: Number(opts.egoTaskSpace), page: opts.egoPage });
                output(result, 'volunteer.activity-reviews.prepare', 'ego', 'visible-ui');
                return;
            }
            const { source, client } = await context(opts);
            const prepared = await client.prepare(input);
            output(opts.dryRun ? prepared : await client.decide(prepared, { via: 'api', intent: 'decide-volunteer-activity-review', confirm: true }), 'volunteer.activity-reviews.decide', 'api', 'direct-api', source.session);
        });
    }
}
