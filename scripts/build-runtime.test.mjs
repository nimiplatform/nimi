import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const buildRuntimeSource = readFileSync(new URL('./build-runtime.mjs', import.meta.url), 'utf8');
const goTestSignerSource = readFileSync(new URL('./windows-go-test-exec-signer.ps1', import.meta.url), 'utf8');

test('build-runtime uses the unified Windows dev signing helper only', () => {
  assert.match(buildRuntimeSource, /windows-dev-signing\.ps1/);
  assert.match(buildRuntimeSource, /'-Mode',\s*'Sign'/);
  assert.doesNotMatch(buildRuntimeSource, /New-SelfSignedCertificate/);
  assert.doesNotMatch(buildRuntimeSource, /TrustedPublisher/);
  assert.doesNotMatch(buildRuntimeSource, /certutil\.exe/);
});

test('build-runtime signs only the current runtime binary', () => {
  assert.match(buildRuntimeSource, /signWindowsDevBinary\(outputPath\)/);
  assert.doesNotMatch(buildRuntimeSource, /nimi-dev\.exe/);
  assert.doesNotMatch(buildRuntimeSource, /signTargets/);
});

test('windows go test signer shares the runtime development signing helper', () => {
  assert.match(goTestSignerSource, /windows-dev-signing\.ps1/);
  assert.match(goTestSignerSource, /-Mode Sign/);
  assert.match(goTestSignerSource, /-Json \| Out-Null/);
  assert.doesNotMatch(goTestSignerSource, /Nimi Local Go Test Code Signing/);
  assert.doesNotMatch(goTestSignerSource, /New-SelfSignedCertificate/);
});
