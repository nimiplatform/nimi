#!/usr/bin/env node

import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

function fail(message) {
  throw new Error(`Realm v3 protected sentinel failed: ${message}`);
}

function git(...args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseArgs(argv) {
  const index = argv.indexOf('--manifest');
  const relative = index >= 0 ? String(argv[index + 1] || '').trim() : 'config/realm-v3/protected-sentinel.json';
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/u).includes('..')) {
    fail('manifest must be a repository-relative path');
  }
  return { manifestPath: path.join(repoRoot, relative) };
}

function assertNoDiff(baseline, target) {
  const result = spawnSync('git', ['diff', '--quiet', baseline, '--', target], { cwd: repoRoot });
  if (result.status !== 0) fail(`protected path changed from baseline: ${target}`);
  const untracked = git('ls-files', '--others', '--exclude-standard', '--', target);
  if (untracked) fail(`protected path contains untracked files: ${target}: ${untracked}`);
  return {
    path: target,
    baselineObject: git('rev-parse', `${baseline}:${target}`),
    currentHeadObject: git('rev-parse', `HEAD:${target}`),
  };
}

function normalizeBrokerInventory(source) {
  const pattern = /const expectedOperationIDs = \[[\s\S]*?\n  \];/u;
  const matches = source.match(new RegExp(pattern.source, 'gu')) || [];
  if (matches.length !== 1) fail(`shared broker validator expected one operation inventory, found ${matches.length}`);
  return source.replace(pattern, 'const expectedOperationIDs = [\n    /* realm-v3-operation-inventory */\n  ];');
}

function check({ manifestPath }) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 'nimi.realm-v3-protected-sentinel/v1') {
    fail('unsupported manifest schema');
  }
  const baselineCommit = git('rev-parse', `${manifest.baselineCommit}^{commit}`);
  const baselineTree = git('rev-parse', `${manifest.baselineCommit}^{tree}`);
  if (baselineCommit !== manifest.baselineCommit || baselineTree !== manifest.baselineTree) {
    fail(`baseline commit/tree mismatch: commit=${baselineCommit} tree=${baselineTree}`);
  }
  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', baselineCommit, 'HEAD'], { cwd: repoRoot });
  if (ancestor.status !== 0) fail('current Nimi HEAD does not descend from protected baseline');

  const immutable = manifest.immutablePaths.map((target) => assertNoDiff(baselineCommit, target));
  const authorityAndValidators = manifest.protectedAuthorityAndValidatorPaths
    .map((target) => assertNoDiff(baselineCommit, target));

  const exception = manifest.narrowException;
  const baselineObject = git('rev-parse', `${baselineCommit}:${exception.path}`);
  if (baselineObject !== exception.baselineObject) {
    fail(`shared broker baseline object mismatch: expected=${exception.baselineObject} actual=${baselineObject}`);
  }
  const baselineSource = execFileSync('git', ['show', `${baselineCommit}:${exception.path}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const currentSource = fs.readFileSync(path.join(repoRoot, exception.path), 'utf8');
  const baselineProtectedHash = sha256(normalizeBrokerInventory(baselineSource));
  const currentProtectedHash = sha256(normalizeBrokerInventory(currentSource));
  if (currentProtectedHash !== baselineProtectedHash) {
    fail(`${exception.path} changed outside ${exception.allowedSection}`);
  }

  return {
    schemaVersion: 'nimi.realm-v3-protected-sentinel-result/v1',
    verdict: 'PASS',
    baselineCommit,
    baselineTree,
    currentCommit: git('rev-parse', 'HEAD'),
    currentTree: git('rev-parse', 'HEAD^{tree}'),
    immutable,
    authorityAndValidators,
    narrowException: {
      path: exception.path,
      allowedSection: exception.allowedSection,
      baselineObject,
      currentHeadObject: git('rev-parse', `HEAD:${exception.path}`),
      protectedSemanticHash: currentProtectedHash,
      requiredUnchangedSemantics: exception.requiredUnchangedSemantics,
    },
    protectedDiffs: 0,
  };
}

try {
  const result = check(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`[check:realm-v3:protected-sentinel] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
