import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { canPromoteWebBuild } from './web-promotion.mjs';

test('Web promotion binds security to the artifact source and skips superseded automatic builds', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'nimi-web-promotion-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const upstream = path.join(root, 'upstream');
  const runner = path.join(root, 'runner');
  mkdirSync(upstream);
  const git = (...args) => execFileSync('git', args, { cwd: upstream, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'CI Test');
  git('config', 'user.email', 'ci@example.invalid');
  function commit(file) {
    const target = path.join(upstream, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file);
    git('add', file);
    git('-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=.git/hooks', 'commit', '-qm', file);
    return git('rev-parse', 'HEAD');
  }
  const sourceSha = commit('apps/web/src/site.css');
  git('clone', '--quiet', upstream, runner);
  const build = { repoRoot: runner, sourceSha, securitySha: sourceSha, event: 'push' };
  assert.equal(canPromoteWebBuild(build), true);
  const desktop = commit('apps/desktop/src/renderer.ts');
  assert.equal(canPromoteWebBuild(build), true);
  assert.throws(() => canPromoteWebBuild({ ...build, securitySha: desktop }), /same commit/u);
  assert.throws(() => canPromoteWebBuild({ ...build, securitySha: '' }), /same commit/u);
  commit('runtime/catalog/providers/xai.yaml');
  assert.equal(canPromoteWebBuild(build), false);
  assert.equal(canPromoteWebBuild({ ...build, event: 'workflow_dispatch' }), true);
  git('-C', runner, 'remote', 'set-url', 'origin', path.join(root, 'unavailable'));
  assert.throws(() => canPromoteWebBuild({ ...build, event: 'workflow_dispatch' }), /git fetch/u);
});
