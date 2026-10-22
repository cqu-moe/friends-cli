import { prepareOrganizationParticipationInEgo } from '../node.js';
import type { Command } from 'commander';
import { createOrganizationParticipationClient, FriendsError, FriendsErrorCode, type OrganizationParticipationInput } from '../index.js';
import { resolveQuerySession } from './session.js';
import { readJsonInput } from './json-input.js';
const read = { readonly: true, phases: ['query'], supportedVia: ['api', 'ego'], requestMode: 'direct-api', permission: 'fresh school identity and activity visibility', input: { page: '1 by default', pageSize: '1..100', keyword: 'server keyword', mine: 'personal participation records' }, verification: 'public-source+controlled-sdk-and-cli' };
export const organizationParticipationSchemas = {
    'organization-participation.list': read, 'organization-participation.show': read,
    'organization-participation.prepare': { ...read, readonly: false, supportedVia: ['ego'], requestMode: 'visible-ui', phases: ['visible-prepare', 'human-final-submit'], input: { action: 'register|exit', input: 'question ID to answer object, file or stdin; optional for exit' } },
    'organization-participation.register': { ...read, readonly: false, supportedVia: ['api'], phases: ['dry-run', 'explicit-api-write', 'readback'], input: { input: 'question ID to answer object, file or stdin; attachment answer is existing resource group', yes: 'required unless dry-run' } },
    'organization-participation.exit': { ...read, readonly: false, supportedVia: ['api'], phases: ['dry-run', 'explicit-api-write', 'readback'], input: { yes: 'required unless dry-run' } },
};
function fail(message: string): never { throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message }); }
function output(data: unknown, operation: string, via: string, session?: {
    account: unknown;
    context: unknown;
}, requestMode = 'direct-api') { process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: true, data, meta: { operation: 'organization-participation.' + operation, via, selectedEntry: via, requestMode, ...(session ? { account: session.account, context: session.context } : {}) } }) + '\n'); }
function options(command: Command, write = false) { if (write)
    command.requiredOption('--via <source>', 'explicit execution path');
else
    command.option('--via <source>', 'verified session source', 'api'); return command.option('--ego-task-space <number>', 'existing Ego task space').option('--ego-page <label>', 'existing school page').option('--level-no <value>', 'existing role selector').option('--unit-no <value>', 'existing unit selector').option('--json', 'versioned JSON', true); }
export function registerOrganizationParticipationCommands(program: Command, { baseUrl }: {
    baseUrl: string;
}) {
    const group = program.command('organization-participation').description('Existing organization activities, registration and personal records');
    async function context(opts: Record<string, string | undefined>) { const source = await resolveQuerySession(opts, baseUrl); return { source, client: createOrganizationParticipationClient({ baseUrl, session: source.session }) }; }
    options(group.command('list')).option('--page <number>', 'page', '1').option('--page-size <number>', 'page size', '10').option('--keyword <text>', 'school keyword filter').option('--mine', 'my records').action(async (opts) => { const { source, client } = await context(opts); output(await client.list({ page: Number(opts.page), pageSize: Number(opts.pageSize), keyword: opts.keyword, mine: opts.mine }), 'list', source.entry, source.session); });
    options(group.command('show').argument('<id>', 'organization activity ID')).action(async (id, opts) => { const { source, client } = await context(opts); output(await client.get(id), 'show', source.entry, source.session); });
    for (const action of ['register', 'exit'] as const) {
        const command = options(group.command(action).argument('<id>', 'organization activity ID'), true).option('--dry-run', 'read-only preparation').option('--yes', 'explicit API confirmation');
        if (action === 'register')
            command.option('--input <file|->', 'questionnaire answers');
        command.action(async (id, opts) => { if (opts.via !== 'api' || !opts.dryRun && !opts.yes)
            fail('API participation requires --via api and --yes or --dry-run'); const answers = opts.input ? await readJsonInput(opts.input) : undefined; const { source, client } = await context(opts); const plan = await client.prepare({ activityId: id, action, answers } as OrganizationParticipationInput); output(opts.dryRun ? plan : await client.execute(plan, { via: 'api', intent: 'organization-participation', confirm: true }), action, 'api', source.session); });
    }
    options(group.command('prepare').argument('<id>', 'organization activity ID'), true).requiredOption('--action <action>', 'register or exit').option('--input <file|->', 'questionnaire answers').action(async (id, opts) => {
        if (opts.via !== 'ego' || opts.levelNo !== undefined || opts.unitNo !== undefined)
            fail('Visible preparation requires --via ego in the currently selected identity');
        const answers = opts.input ? await readJsonInput(opts.input) : undefined;
        output(await prepareOrganizationParticipationInEgo({ input: { activityId: id, action: opts.action, answers } as OrganizationParticipationInput, taskSpaceId: Number(opts.egoTaskSpace), page: opts.egoPage, baseUrl }), 'prepare', 'ego', undefined, 'visible-ui');
    });
}
