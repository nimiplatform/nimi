import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { evaluateAiStructureBudget } from './ai-structure-budget-core.mjs';

function writeFile(targetPath, source) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, source, 'utf8');
}

test('evaluateAiStructureBudget computes depth from depth_base when configured', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-ai-structure-budget-'));

  writeFile(path.join(tempDir, 'dev/config/ai-structure-budget.yaml'), `
version: 1
allowed_forwarding_shells:
  - index.ts
rules:
  - id: desktop_src
    include:
      - "apps/desktop/src/**"
    depth_base: "apps/desktop/src"
    warning_depth: 4
    error_depth: 5
exclude: []
waivers: []
`);
  writeFile(path.join(tempDir, 'apps/desktop/src/shell/renderer/features/home-panel.tsx'), 'export const home = 1;\n');
  writeFile(path.join(tempDir, 'apps/desktop/src/shell/renderer/features/home/post-card.tsx'), 'export const card = 1;\n');

  execFileSync('git', ['init', '-q'], { cwd: tempDir });
  execFileSync('git', ['add', '.'], { cwd: tempDir });

  const report = evaluateAiStructureBudget({ cwd: tempDir });
  const shallowRow = report.rows.find((row) => row.file.endsWith('home-panel.tsx'));
  const nestedRow = report.rows.find((row) => row.file.endsWith('post-card.tsx'));

  assert.ok(shallowRow);
  assert.equal(shallowRow.depthBase, 'apps/desktop/src');
  assert.equal(shallowRow.depthSubject, 'shell/renderer/features/home-panel.tsx');
  assert.equal(shallowRow.depth, 4);
  assert.equal(shallowRow.severity, 'warning');

  assert.ok(nestedRow);
  assert.equal(nestedRow.depthSubject, 'shell/renderer/features/home/post-card.tsx');
  assert.equal(nestedRow.depth, 5);
  assert.equal(nestedRow.severity, 'error');
});

test('evaluateAiStructureBudget falls back to repo-relative depth when no depth_base is configured', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-ai-structure-budget-'));

  writeFile(path.join(tempDir, 'dev/config/ai-structure-budget.yaml'), `
version: 1
allowed_forwarding_shells:
  - index.ts
rules:
  - id: scripts
    include:
      - "scripts/**"
    warning_depth: 3
    error_depth: 4
exclude: []
waivers: []
`);
  writeFile(path.join(tempDir, 'scripts/lib/core.mjs'), 'export const value = 1;\n');

  execFileSync('git', ['init', '-q'], { cwd: tempDir });
  execFileSync('git', ['add', '.'], { cwd: tempDir });

  const report = evaluateAiStructureBudget({ cwd: tempDir });
  const row = report.rows.find((entry) => entry.file === 'scripts/lib/core.mjs');

  assert.ok(row);
  assert.equal(row.depthBase, '.');
  assert.equal(row.depthSubject, 'scripts/lib/core.mjs');
  assert.equal(row.depth, 3);
  assert.equal(row.severity, 'warning');
});
