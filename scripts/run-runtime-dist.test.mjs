import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./run-runtime-dist.mjs', import.meta.url), 'utf8');

test('run-runtime-dist diagnoses Windows application-control style spawn failures', () => {
  assert.match(source, /windows-dev-signing\.ps1/);
  assert.match(source, /'-Mode',\s*'Diagnose'/);
  assert.match(source, /UNKNOWN.*EPERM.*EACCES/s);
  assert.match(source, /application control\|code integrity\|blocked this file\|enterprise signing/i);
  assert.match(source, /failed to start[\s\S]*writeWindowsSigningDiagnostic/);
});

test('run-runtime-dist forces Windows runtime stop after identity validation', () => {
  assert.match(source, /function runtimeCommandArgs\(\)/);
  assert.match(source, /process\.platform !== 'win32' \|\| args\[0\] !== 'stop'/);
  assert.match(source, /return \['stop', '--force', \.\.\.args\.slice\(1\)\]/);
  assert.match(source, /spawn\(binaryPath, runtimeCommandArgs\(\)/);
});
