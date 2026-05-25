import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const authSource = readFileSync(new URL('../src/shell/auth/runtime-platform.ts', import.meta.url), 'utf8');
const authGateSource = readFileSync(new URL('../src/shell/auth/auth-gate.tsx', import.meta.url), 'utf8');
const runtimeLoginSource = readFileSync(new URL('../src/shell/auth/runtime-login-page.tsx', import.meta.url), 'utf8');
const productSource = readFileSync(new URL('../src/shell/routes/product-area.tsx', import.meta.url), 'utf8');
const demoSource = readFileSync(new URL('../src/shell/routes/demo-surfaces.tsx', import.meta.url), 'utf8');
const appSource = [authSource, runtimeLoginSource, productSource, demoSource].join('\n');
const manifest = readFileSync(new URL('../nimi.app.yaml', import.meta.url), 'utf8');
const submission = readFileSync(new URL('../.nimi/admission/submission.yaml', import.meta.url), 'utf8');

test('auth glue uses Nimi App runtime platform helper', () => {
  assert.match(authSource, /createNimiAppRuntimePlatformClient/);
  assert.match(authSource, /mode: 'dev-standalone'/);
  assert.match(authSource, /mode: 'third-party-nimi-app'/);
  assert.match(runtimeLoginSource, /DesktopShellAuthPage/);
  assert.doesNotMatch(authSource, /createPlatformClient\s*\(/);
});

test('developer session does not require local account login', () => {
  assert.match(authGateSource, /projection\.mode === 'dev-standalone'/);
  assert.match(authGateSource, /runtime-developer-session/);
  assert.match(authGateSource, /loadRuntimeAccountUser/);
});

test('generated shell rejects placeholder and private Desktop imports', () => {
  assert.doesNotMatch(appSource, /Replace this route with app product behavior/);
  assert.doesNotMatch(appSource, /Open product action/);
  assert.doesNotMatch(appSource, /Add app-owned surfaces/);
  assert.doesNotMatch(appSource, /from ['\"]@renderer\//);
  assert.doesNotMatch(appSource, /from ['\"]@runtime\//);
});

test('manifest remains submitted input', () => {
  assert.match(manifest, /manifest_role: submitted-input/);
  assert.match(manifest, /declared_nimi_api_scopes/);
});

test('admission request remains submitted input', () => {
  assert.match(submission, /submission_role: developer-submitted-input/);
  assert.match(submission, /dev_shell_command: pnpm dev:shell/);
  assert.match(submission, /admission_truth: platform-owned-after-review/);
});
