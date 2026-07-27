import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

test('Zhiyu owns neither auth credentials nor a private Runtime connection', () => {
  const authGateSource = read('src/shell/auth/auth-gate.tsx');
  const runtimeAccountAuthSource = read('src/shell/auth/runtime-account-auth.ts');
  const runtimeLoginSource = read('src/shell/auth/runtime-login-page.tsx');
  const runtimePlatformSource = read('src/shell/auth/runtime-platform.ts');
  const electronMainSource = read('src-electron/main.ts');

  for (const source of [authGateSource, runtimeAccountAuthSource, runtimeLoginSource, runtimePlatformSource]) {
    assert.doesNotMatch(
      source,
      /\b(?:accessToken|refreshToken|getAccessToken|persistAccessToken)\b|localStorage|sessionStorage|indexedDB/,
    );
    assert.doesNotMatch(source, /runtime\/internal|apps\/desktop/);
    assert.doesNotMatch(source, /\/api\/auth\/|passwordLogin\s*\(|fetch\s*\(/);
  }
  assert.doesNotMatch(electronMainSource, /NIMI_[A-Z_]*RUNTIME_[A-Z_]*(?:ADDR|ENDPOINT)|runtimeEndpoint/);
});
