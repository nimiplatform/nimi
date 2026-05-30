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
const admission = readFileSync(new URL('../ADMISSION.md', import.meta.url), 'utf8');

test('auth glue uses Nimi App runtime platform helper', () => {
  assert.match(authSource, /createNimiAppRuntimePlatformClient/);
  assert.match(authSource, /mode: 'local-first-party'/);
  assert.match(authSource, /mode: 'third-party-nimi-app'/);
  assert.doesNotMatch(authSource, /dev-standalone/);
  assert.match(runtimeLoginSource, /DesktopShellAuthPage/);
  assert.doesNotMatch(authSource, /createPlatformClient\s*\(/);
});

test('single login model requires runtime account login (no dev-standalone bypass)', () => {
  // The app connects exactly like a shipped app: through runtime account login.
  // There is no standalone developer-session bypass; the runtime
  // developer-registration gate admits a not-yet-admitted local app instead.
  assert.doesNotMatch(authGateSource, /dev-standalone/);
  assert.doesNotMatch(authGateSource, /runtime-developer-session/);
  assert.doesNotMatch(authSource, /VITE_NIMI_RUNTIME_DEVELOPER_SESSION/);
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
  assert.match(admission, /developer-submitted listing request/);
  assert.match(admission, /not an approval, release descriptor, permission grant, or install truth/);
  assert.match(admission, /Nimi Platform review owns final admission/);
});
