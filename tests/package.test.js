import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const execFileAsync = promisify(execFile);
const run = (file, args, options = {}) =>
  execFileAsync(file, args, { timeout: 60_000, ...options });

test('packed installation exposes SDK without Ego and runs the complete CLI flow', { timeout: 120000 }, async () => {
  const root = resolve('.test-artifacts');
  await mkdir(root, { recursive: true });
  const install = await mkdtemp(join(root, 'installed-'));
  try {
    const { stdout } = await run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', install]);
    const [packed] = JSON.parse(stdout);
    assert.ok(packed.files.some(file => file.path === 'dist/index.js'));
    assert.ok(packed.files.some(file => file.path === 'dist/cli/main.js'));
    assert.ok(packed.files.every(file => file.path.startsWith('dist/') || ['package.json', 'README.md'].includes(file.path)));
    await run('npm', ['install', '--prefix', install, '--ignore-scripts', '--package-lock=false', '--no-audit', '--no-fund', join(install, packed.filename)]);
    const imported = await run(process.execPath, ['--input-type=module', '--eval', "import {createFriendsSdk} from '@cqu-moe/friends-cli'; const sdk = createFriendsSdk(); console.log(typeof sdk.inspectLocalSession);"], {cwd:install, env:{...process.env,PATH:''}});
    assert.equal(imported.stdout.trim(), 'function');
    assert.equal(imported.stderr, '');
    const cli = join(install, 'node_modules/.bin/friends');
    const version = await run(cli, ['--version']);
    assert.equal(version.stdout.trim(), '0.1.0');
    const env = {...process.env, FRIENDS_TEST_CLI:cli};
    delete env.NODE_TEST_CONTEXT;
    const flow = await run(process.execPath, ['--test', '--test-reporter=tap', 'tests/cli-flow.test.js'], {env});
    assert.match(flow.stdout, /# fail 0/);
  } finally {
    await rm(install, {recursive:true,force:true});
  }
});
