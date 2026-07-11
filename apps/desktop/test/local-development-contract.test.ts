import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(root, '..', '..');

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function readRepo(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('Desktop approval UI exposes the complete user decision and project identity', () => {
  const source = read('src/shell/renderer/features/local-development/local-development-approval-center.tsx');
  for (const marker of [
    'approval.displayName',
    'approval.appId',
    'approval.canonicalProjectRoot',
    'approval.shell',
    'approval.accountId',
    'approval.requestedCapabilities',
    "submit('deny')",
    "submit('allow-run-once')",
    "submit('allow-remember-project')",
  ]) {
    assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(source, /closeOnBackdrop=\{false\}/);
  assert.match(source, /dataTestId="local-development-approval-dialog"/);
});

test('renderer bridge rejects technical material and projects only management state', () => {
  const source = read('src/shell/renderer/features/local-development/local-development-bridge.ts');
  assert.match(source, /requireExactRecord\(value, \[/);
  assert.match(source, /response contains forbidden fields/);
  assert.doesNotMatch(source, /sessionProof|sessionSecret|launchTicket|runtimeBootEpoch|controlNonce|credential|accessToken|refreshToken/);
  assert.match(source, /local_development_authorization_revoke/);
  assert.match(source, /local_development_runs_list/);
});

test('Desktop owns Tauri build and launch without a project-visible runner secret', () => {
  const supervisor = read('src-tauri/src/desktop_local_development/supervisor.rs');
  const http = read('src-tauri/src/desktop_local_development/http.rs');
  assert.match(supervisor, /build_tauri_host/);
  assert.match(supervisor, /CARGO_TARGET_DIR/);
  assert.match(supervisor, /launch_local_development_host/);
  assert.match(supervisor, /status = renderer\.wait\(\)/);
  assert.match(supervisor, /local-development-dev-server-exited/);
  assert.doesNotMatch(supervisor, /NIMI_DEV_CONTROL|control_nonce/);
  assert.doesNotMatch(http, /tauri-host-ready|tauri-host-stopped|control_nonce/);
  assert.equal(readRepo('app-tools/package.json').includes('nimi-tauri-dev-runner'), false);
});

test('Desktop independently requires official launcher scripts and exposes fail-closed run states', () => {
  const plan = read('src-tauri/src/desktop_local_development/plan.rs');
  const activity = read('src/shell/renderer/features/local-development/local-development-authorizations.tsx');
  assert.match(plan, /nimi-app dev --shell tauri/);
  assert.match(plan, /vite --host 127\.0\.0\.1 --port \{port\} --strictPort/);
  assert.match(activity, /local-development-activity/);
  assert.match(activity, /data-state=\{run\.state\}/);
  for (const state of ['denied', 'runtime-unavailable', 'revoked', 'project-changed']) {
    assert.match(activity, new RegExp(state));
  }
});

test('local-development copy is complete and readable in English and Chinese', () => {
  const english = JSON.parse(read('src/shell/renderer/locales/en/63-LocalDevelopment.json'));
  const chinese = JSON.parse(read('src/shell/renderer/locales/zh/63-LocalDevelopment.json'));
  assert.deepEqual(Object.keys(chinese).sort(), Object.keys(english).sort());
  for (const document of [english, chinese]) {
    assert.equal(typeof document.approval.title, 'string');
    assert.equal(typeof document.approval.warning, 'string');
    assert.equal(typeof document.action.allowOnce, 'string');
    assert.equal(typeof document.action.remember, 'string');
    assert.equal(typeof document.action.deny, 'string');
    assert.equal(typeof document.management.revokeConfirm, 'string');
  }
  assert.match(chinese.approval.title, /[\u4e00-\u9fff]/u);
  assert.match(chinese.action.remember, /[\u4e00-\u9fff]/u);
});
