import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { candidateSourceTreeSha256, sourceTreeSha256 } from './source-state.mjs';

test('candidate source digest excludes generated native carriers while generic source digest retains working bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-source-state-test-'));
  const carrier = path.join(root, 'apps', 'desktop', 'product-control-node', 'npm', 'win32-x64', 'nimi_desktop_product_control.node');
  const source = path.join(root, 'apps', 'desktop', 'src', 'source.ts');
  try {
    fs.mkdirSync(path.dirname(carrier), { recursive: true });
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(carrier, 'committed-carrier');
    fs.writeFileSync(source, 'export const source = true;\n');
    execFileSync('git', ['init'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'source-state@example.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Source State Test'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root });
    const genericCommitted = sourceTreeSha256(root);
    const candidateCommitted = candidateSourceTreeSha256(root, 'nimi');
    fs.writeFileSync(carrier, 'rebuilt-execution-carrier');
    assert.notEqual(sourceTreeSha256(root), genericCommitted);
    assert.equal(candidateSourceTreeSha256(root, 'nimi'), candidateCommitted);
    fs.writeFileSync(source, 'export const source = false;\n');
    assert.notEqual(candidateSourceTreeSha256(root, 'nimi'), candidateCommitted);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('candidate source digest excludes workflow, harness, and acceptance bookkeeping bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-candidate-scope-test-'));
  const desktopSource = path.join(root, 'apps', 'desktop', 'src', 'source.ts');
  const workflow = path.join(root, '.github', 'workflows', 'release.yml');
  const harness = path.join(root, 'tests', 'local-agent-product', 'harness', 'runner.mjs');
  const catalog = path.join(root, 'config', 'local-agent-product-acceptance-points.yaml');
  const tauri = path.join(root, 'apps', 'desktop', 'src-tauri', 'src', 'main.rs');
  const desktopTest = path.join(root, 'apps', 'desktop', 'test', 'shell.test.ts');
  try {
    for (const file of [desktopSource, workflow, harness, catalog, tauri, desktopTest]) fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(desktopSource, 'export const source = true;\n');
    fs.writeFileSync(workflow, 'name: release\n');
    fs.writeFileSync(harness, 'export const runner = true;\n');
    fs.writeFileSync(catalog, 'point_count: 1\n');
    fs.writeFileSync(tauri, 'fn main() {}\n');
    fs.writeFileSync(desktopTest, 'export const testOnly = true;\n');
    execFileSync('git', ['init'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'source-state@example.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Source State Test'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root });
    const candidate = candidateSourceTreeSha256(root, 'nimi');
    fs.appendFileSync(workflow, '# bookkeeping\n');
    fs.appendFileSync(harness, '// harness-only\n');
    fs.appendFileSync(catalog, '# acceptance-only\n');
    fs.appendFileSync(tauri, '// Tauri-only\n');
    fs.appendFileSync(desktopTest, '// test-only\n');
    assert.equal(candidateSourceTreeSha256(root, 'nimi'), candidate);
    fs.writeFileSync(desktopSource, 'export const source = false;\n');
    assert.notEqual(candidateSourceTreeSha256(root, 'nimi'), candidate);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('candidate source digest includes the Runtime workspace and local nimi-cognition dependency', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-runtime-source-scope-test-'));
  const runtimeSource = path.join(root, 'runtime', 'source.go');
  const cognitionSource = path.join(root, 'nimi-cognition', 'source.go');
  const workspace = path.join(root, 'go.work');
  try {
    fs.mkdirSync(path.dirname(runtimeSource), { recursive: true });
    fs.mkdirSync(path.dirname(cognitionSource), { recursive: true });
    fs.writeFileSync(runtimeSource, 'package runtime\n');
    fs.writeFileSync(cognitionSource, 'package cognition\n');
    fs.writeFileSync(workspace, 'go 1.26.4\n');
    execFileSync('git', ['init'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'source-state@example.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Source State Test'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root });
    const candidate = candidateSourceTreeSha256(root, 'nimi');
    fs.appendFileSync(cognitionSource, '// changed local dependency\n');
    assert.notEqual(candidateSourceTreeSha256(root, 'nimi'), candidate);
    fs.writeFileSync(cognitionSource, 'package cognition\n');
    fs.appendFileSync(workspace, 'use ./runtime\n');
    assert.notEqual(candidateSourceTreeSha256(root, 'nimi'), candidate);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
