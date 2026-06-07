import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./run-runtime-dist.mjs', import.meta.url), 'utf8');

test('run-runtime-dist enables developer registration only before local runtime startup', () => {
  assert.match(source, /auth\.developerRegistration\.enabled=true/);
  assert.match(source, /command !== 'serve' && command !== 'start'/);
  assert.match(source, /enableLocalDeveloperRegistrationGate\(runtimeEnv\);\s*\n\s*const child = spawn/s);
  assert.doesNotMatch(source, /NIMI_RUNTIME_DEVELOPER_SESSION/);
});
