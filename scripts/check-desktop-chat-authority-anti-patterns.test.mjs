import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));

test('desktop chat authority anti-pattern script self-test passes', async () => {
  const scriptPath = path.join(scriptDir, 'check-desktop-chat-authority-anti-patterns.mjs');
  const { stdout } = await execFileAsync(process.execPath, [scriptPath, '--self-test']);
  assert.match(stdout, /self-test passed/u);
});
