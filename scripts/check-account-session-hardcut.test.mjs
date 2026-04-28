import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));

test('account-session hardcut guardrail fixtures distinguish forbidden local seams from fenced modes', async () => {
  const scriptPath = path.join(scriptDir, 'check-account-session-hardcut.mjs');
  const { stdout } = await execFileAsync(process.execPath, [scriptPath, '--self-test']);
  assert.match(stdout, /self-test passed/u);
});
