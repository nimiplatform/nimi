import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const desktopDir = resolve(import.meta.dirname, '..');

test('Runtime reason-code parsing is SDK-owned with no Desktop bridge wrapper', () => {
  assert.equal(existsSync(resolve(desktopDir, 'src/runtime/llm-adapter/execution/runtime-ai-bridge-output.ts')), false);
});
