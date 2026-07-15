import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { sourceTreeSha256 } from './source-state.mjs';

test('source digest normalizes rebuilt native execution carriers to committed source', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-source-state-test-'));
  const carrier = path.join(root, 'apps', 'desktop', 'product-control-node', 'npm', 'win32-x64', 'nimi_desktop_product_control.node');
  try {
    fs.mkdirSync(path.dirname(carrier), { recursive: true });
    fs.writeFileSync(carrier, 'committed-carrier');
    fs.writeFileSync(path.join(root, 'source.ts'), 'export const source = true;\n');
    execFileSync('git', ['init'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'source-state@example.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Source State Test'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root });
    const committed = sourceTreeSha256(root);
    fs.writeFileSync(carrier, 'rebuilt-execution-carrier');
    assert.equal(sourceTreeSha256(root), committed);
    fs.writeFileSync(path.join(root, 'source.ts'), 'export const source = false;\n');
    assert.notEqual(sourceTreeSha256(root), committed);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
