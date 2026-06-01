import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const desktopDir = resolve(import.meta.dirname, '..');
const repoDir = resolve(desktopDir, '../..');

function readRepo(relativePath: string): string {
  return readFileSync(resolve(repoDir, relativePath), 'utf8');
}

test('Runtime reason-code parsing is SDK-owned with no Desktop bridge wrapper', () => {
  assert.equal(existsSync(resolve(desktopDir, 'src/runtime/llm-adapter/execution/runtime-ai-bridge-output.ts')), false);

  const sdkReasonMessages = readRepo('sdk/src/runtime/reason-code-messages.ts');
  const sdkReasonTest = readRepo('sdk/test/runtime/reason-code-messages.test.ts');
  const testerSettings = readRepo('apps/tester/src/shell/routes/settings.tsx');

  assert.match(sdkReasonMessages, /extractRuntimeReasonCodeFromError/);
  assert.match(sdkReasonMessages, /mapRuntimeErrorToLocalAiReasonCode/);
  assert.match(sdkReasonTest, /reason=351/);
  assert.match(testerSettings, /extractRuntimeReasonCodeFromError/);
});
