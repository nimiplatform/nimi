import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { detectCiScope } from './detect-ci-scope.mjs';
import { spawnSyncCommand } from './lib/command-runner.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const workflow = YAML.parse(readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8'));
const authority = {
  format: 'nimicoding.authority/v2',
  owner: 'team.ci',
  scope: 'ci.subject',
  units: [
    { id: 'definition.ci.subject', kind: 'definition', title: 'Subject', meaning: 'A stable subject.' },
    { id: 'definition.ci.optional', kind: 'definition', title: 'Optional subject', meaning: 'An independent subject.' },
    { id: 'definition.ci.retired', kind: 'definition', lifecycle: 'removed', title: 'Retired subject', reason: 'Retired explicitly.' },
    {
      id: 'rule.ci.subject', kind: 'rule', title: 'Keep the subject', modality: 'must',
      statement: 'Preserve the subject.', condition: 'Always.', failure: 'Reject missing subjects.',
      relations: [{ type: 'applies_to', target: 'definition.ci.subject' }],
    },
  ],
};

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commit(root, message) {
  git(root, ['add', '.']);
  git(root, ['-c', 'user.name=CI Test', '-c', 'user.email=ci@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=.git/hooks', 'commit', '-qm', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function pnpm(root, args, status = 0) {
  const result = spawnSyncCommand('pnpm', ['--silent', ...args], {
    cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1', NIMICODING_LANG: 'en' },
  });
  assert.equal(result.status, status, result.stdout + result.stderr);
  return result.stdout;
}

function writeAuthority(root, value) {
  writeFileSync(path.join(root, '.nimi/spec/ci.authority.yaml'), YAML.stringify(value, { lineWidth: 0 }));
  pnpm(root, ['exec', 'nimicoding', 'authority', 'fmt', '.nimi/spec/ci.authority.yaml']);
}

function fixture(context) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nimi-ci-authority-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, '.nimi/spec'), { recursive: true });
  mkdirSync(path.join(root, '.nimi/config'), { recursive: true });
  symlinkSync(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'junction');
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'nimi-ci-authority-fixture', private: true,
    scripts: Object.fromEntries(Object.entries(packageJson.scripts).filter(([name]) => name.startsWith('spec:authority:'))),
  }));
  writeFileSync(path.join(root, '.gitignore'), 'node_modules/\nci-output\n');
  writeFileSync(path.join(root, '.nimi/config/authority-scope-bindings.yaml'), YAML.stringify({
    format: 'nimicoding.scope-bindings/v1',
    scopes: [{ scope: 'ci.subject', bindings: [{ kind: 'module', value: '@fixture/ci' }] }],
  }));
  writeFileSync(path.join(root, '.nimi/config/authority-verifiers.yaml'), YAML.stringify({
    format: 'nimicoding.authority-verifier-bindings/v2',
    bindings: [{ id: 'ci.lexical.stable', detector: 'exact-lexical-invariant/v1', term: 'stable', match: 'token', expectation: 'present', policy: 'blocking' }],
  }));
  git(root, ['init', '-q', '-b', 'main']);
  writeAuthority(root, authority);
  return { root, base: commit(root, 'base authority') };
}

test('CI selects immutable event baselines and exports the same SHA for authority review', (context) => {
  const { root, base } = fixture(context);
  mkdirSync(path.join(root, 'sdks/go/coreclient'), { recursive: true });
  writeFileSync(path.join(root, 'sdks/go/coreclient/client.go'), 'package coreclient\n');
  const head = commit(root, 'SDK change');
  writeFileSync(path.join(root, 'README.md'), 'Later branch tip.\n');
  commit(root, 'advance main');

  for (const eventName of ['push', 'pull_request', 'workflow_dispatch']) {
    const selected = detectCiScope({ repoRoot: root, eventName, baseSha: base, headSha: head });
    assert.equal(selected.comparison_base_sha, base);
    assert.equal(selected.sdk_conformance_changed, true);
    assert.equal(selected.authority_changed, eventName === 'workflow_dispatch');
  }
  for (const baseSha of [undefined, '0'.repeat(40), 'main', head]) {
    assert.throws(() => detectCiScope({ repoRoot: root, eventName: 'push', baseSha, headSha: head }), /comparison base/u);
  }
  assert.throws(() => detectCiScope({ repoRoot: root, eventName: 'push', baseSha: base, headSha: 'main' }), /comparison head/u);
  assert.throws(() => detectCiScope({ repoRoot: root, eventName: 'push', baseSha: 'f'.repeat(40), headSha: head }));
  assert.throws(() => detectCiScope({ repoRoot: root, eventName: 'workflow_dispatch', headSha: base }));

  execFileSync(process.execPath, [path.join(repoRoot, 'scripts/detect-ci-scope.mjs')], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, EVENT_NAME: 'push', BASE_SHA: base, HEAD_SHA: head, GITHUB_OUTPUT: path.join(root, 'ci-output') },
  });
  const outputs = Object.fromEntries(readFileSync(path.join(root, 'ci-output'), 'utf8').trim().split('\n').map((line) => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
  assert.equal(outputs.comparison_base_sha, base);
  assert.equal(outputs.sdk_conformance_changed, 'true');
  assert(JSON.parse(outputs.workspace_filters).includes('...@nimiplatform/sdk'));
});

test('authority review is wired into the selected CI job with available Git history', () => {
  const changes = workflow.jobs.changes;
  const detect = changes.steps.find((step) => step.id === 'detect');
  assert.equal(detect.run, 'node scripts/detect-ci-scope.mjs');
  assert.equal(detect.env.BASE_SHA, '${{ github.event.pull_request.base.sha || github.event.before }}');
  assert.equal(detect.env.HEAD_SHA, '${{ github.event.pull_request.head.sha || github.sha }}');
  assert.equal(changes.outputs.comparison_base_sha, '${{ steps.detect.outputs.comparison_base_sha }}');
  const core = workflow.jobs['core-static'];
  assert.equal(core.steps.find((step) => step.uses?.startsWith('actions/checkout@')).with['fetch-depth'], 0);
  const review = core.steps.find((step) => step.name === 'authority.history-review');
  assert.equal(review.if, "needs.changes.outputs.authority_changed == 'true'");
  assert.equal(review.env.AUTHORITY_BASE_SHA, '${{ needs.changes.outputs.comparison_base_sha }}');
  assert.equal(review.run, 'pnpm spec:authority:review --base "$AUTHORITY_BASE_SHA"');
  assert.equal(core.steps.find((step) => step.name === 'authority.canonical.check').run, 'pnpm spec:authority:check');
});

test('the CI package command rejects invalid identity transitions between otherwise valid corpora', async (context) => {
  const { root, base } = fixture(context);
  pnpm(root, ['run', 'spec:authority:check', '--json']);
  const cases = [
    ['physical deletion', (value) => { value.units = value.units.filter((unit) => unit.id !== 'definition.ci.retired'); }],
    ['retired ID revival', (value) => { value.units[2] = { id: 'definition.ci.retired', kind: 'definition', title: 'Revived subject', meaning: 'A revived subject.' }; }],
    ['same ID kind change', (value) => { value.units[1] = { ...structuredClone(value.units[3]), id: 'definition.ci.optional' }; }],
  ];
  for (const [name, mutate] of cases) {
    await context.test(name, () => {
      const value = structuredClone(authority);
      mutate(value);
      writeAuthority(root, value);
      pnpm(root, ['run', 'spec:authority:check', '--json']);
      pnpm(root, ['run', 'spec:authority:audit', '--json']);
      const result = JSON.parse(pnpm(root, ['run', 'spec:authority:review', '--base', base, '--json'], 1));
      assert.equal(result.review, null);
      assert(result.diagnostics.some((diagnostic) => diagnostic.code === 'AUTH_DIFF_TRANSITION_INVALID'));
    });
  }
  const retired = structuredClone(authority);
  retired.units[1] = { id: 'definition.ci.optional', kind: 'definition', lifecycle: 'removed', title: 'Optional subject', reason: 'Retired explicitly.' };
  writeAuthority(root, retired);
  const valid = JSON.parse(pnpm(root, ['run', 'spec:authority:review', '--base', base, '--json']));
  assert.equal(valid.review.snapshots.base.commitOid, base);
  assert.equal(valid.review.components.configuredAudit.blockingStatus, 'clear');
  assert.equal(valid.review.businessSemanticStatus, 'not_evaluated');
  assert.equal(valid.review.implementationConformanceStatus, 'not_evaluated');

  retired.units[0].meaning = 'A subject without the required keyword.';
  writeAuthority(root, retired);
  const blocked = JSON.parse(pnpm(root, ['run', 'spec:authority:review', '--base', base, '--json'], 1));
  assert.equal(blocked.review.components.configuredAudit.blockingStatus, 'blocked');
});
