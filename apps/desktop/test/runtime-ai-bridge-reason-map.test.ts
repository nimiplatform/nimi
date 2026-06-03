import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { readTesterSettingsSurface } from './helpers/read-tester-settings-surface';

const desktopDir = resolve(import.meta.dirname, '..');
const repoDir = resolve(desktopDir, '../..');

test('Runtime reason-code parsing is SDK-owned with no Desktop bridge wrapper', () => {
  assert.equal(existsSync(resolve(desktopDir, 'src/runtime/llm-adapter/execution/runtime-ai-bridge-output.ts')), false);

  const testerSettings = readTesterSettingsSurface(repoDir);

  assert.match(testerSettings, /extractRuntimeReasonCodeFromError/);
});
