#!/usr/bin/env node

import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const expectedBranch = 'refactory/third-party';
const expectedRemote = 'https://github.com/nimiplatform/nimi.git';
const expectedPredecessor = '9af53374df8f324f6f3a98f8335953448fd7d804';
const expectedAncestry = [
  '68a1a6afc3bd69c67e6d2269f39786e718796914',
  'd19eec84433f05da6b563c153fef518b12d5d540',
  'dc9bb67ca486e6a60f1874603b91bf2cb3b9d2dc',
  '41d2b2b0e074bb54cadcb41eea0414d34f5ede83',
  '842e53a3720c87e26d8c884ad23f31073d00f156',
  '90270996b8213d699f754ece6060a10821ed7558',
];

function fail(message) {
  throw new Error(`Realm v3 baseline admission failed: ${message}`);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function git(root, ...args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function normalizeRepository(value) {
  const source = String(value || '').trim();
  if (source.startsWith('git@github.com:')) {
    return `https://github.com/${source.slice('git@github.com:'.length)}`;
  }
  if (source.startsWith('ssh://git@github.com/')) {
    return `https://github.com/${source.slice('ssh://git@github.com/'.length)}`;
  }
  return source;
}

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  const value = index >= 0 ? String(argv[index + 1] || '').trim() : '';
  if (!value) fail(`missing ${flag}`);
  return value;
}

function parseArgs(argv) {
  return {
    realmRoot: path.resolve(valueAfter(argv, '--realm-root')),
    expectedCommit: valueAfter(argv, '--expected-nimi-commit'),
    expectedTree: valueAfter(argv, '--expected-nimi-tree'),
    deltaReport: path.resolve(valueAfter(argv, '--delta-report')),
  };
}

function assertExactArray(actual, expected, label) {
  if (!Array.isArray(actual) || JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} mismatch`);
  }
}

function assertDeltaReport(report, expectedCommit, expectedTree) {
  if (report.schemaVersion !== 'nimi.realm-v3-consumer-baseline-delta-preflight/v1') {
    fail('unsupported delta preflight schema');
  }
  if (report.verdict !== 'PASS' || report.allowsN0TrackedWrites !== true) {
    fail('delta preflight does not allow N0 tracked writes');
  }
  if (!Array.isArray(report.productBlockers) || report.productBlockers.length !== 0) {
    fail('delta preflight contains product blockers');
  }
  if (report.previousA0?.baselineCommit !== expectedPredecessor
    || report.previousA0?.verdict?.result !== 'PASS'
    || report.previousA0?.verdict?.allowsN0 !== true
    || report.previousA0?.verdict?.productBlockers !== 0) {
    fail('A0 admission facts drift');
  }
  if (report.nimi?.commit !== expectedCommit || report.nimi?.tree !== expectedTree) {
    fail('delta preflight Nimi identity mismatch');
  }
  assertExactArray(
    report.nimi?.ancestry?.map((entry) => entry.commit),
    expectedAncestry,
    'six-commit ancestry',
  );
  if (report.nimi?.ancestryCount !== 6 || report.nimi?.ancestryExact !== true) {
    fail('six-commit ancestry was not accepted');
  }
  if (report.nimi?.changedFileCount !== 20 || report.nimi?.changedFileSetExact !== true) {
    fail('20-file changed set was not accepted');
  }
  if (report.nimi?.materializationCriticalPathCount !== 10
    || report.nimi?.materializationCriticalPathsByteIdentical !== true) {
    fail('materialization-critical path equivalence was not accepted');
  }
  if (report.nimi?.protectedObjectsExact !== true
    || !Array.isArray(report.nimi?.protectedObjects)
    || report.nimi.protectedObjects.length !== 8
    || report.nimi.protectedObjects.some((entry) => entry.expected !== entry.actual)) {
    fail('protected implementation objects were not accepted');
  }
  const validators = new Map(
    (report.nimi?.validators || []).map((entry) => [entry.command, entry]),
  );
  for (const command of [
    'pnpm check:protected-local-authority',
    'pnpm check:kit-runtime-account-broker-parity',
  ]) {
    const result = validators.get(command);
    if (result?.exitCode !== 0 || result?.result !== 'PASS') {
      fail(`protected validator was not accepted: ${command}`);
    }
  }
  if (report.realm?.semanticOpenApiVectorHandoffDigestsUnchanged !== true
    || report.rootDirtyIsolation?.overlapCount !== 0
    || report.rootDirtyIsolation?.result !== 'PASS') {
    fail('Realm semantic inputs or Root dirty isolation were not accepted');
  }
}

function runCurrentAdmission(realmRoot) {
  const result = spawnSync(process.execPath, [
    path.join(scriptDir, 'check-realm-contract-current.mjs'),
    '--realm-root',
    realmRoot,
    '--admission-only',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if ((result.status ?? 1) !== 0) {
    fail(`current Realm producer admission failed: ${String(result.stderr || result.stdout).trim()}`);
  }
  return JSON.parse(result.stdout);
}

function check({ realmRoot, expectedCommit, expectedTree, deltaReport }) {
  const commit = git(repoRoot, 'rev-parse', `${expectedCommit}^{commit}`);
  const tree = git(repoRoot, 'rev-parse', `${expectedCommit}^{tree}`);
  if (commit !== expectedCommit || tree !== expectedTree) {
    fail(`expected Nimi commit/tree mismatch: commit=${commit} tree=${tree}`);
  }
  if (git(repoRoot, 'rev-parse', 'HEAD') !== expectedCommit
    || git(repoRoot, 'rev-parse', 'HEAD^{tree}') !== expectedTree) {
    fail('N0 must run on the exact admitted Nimi HEAD/tree before its first semantic commit');
  }
  if (git(repoRoot, 'branch', '--show-current') !== expectedBranch) {
    fail(`branch mismatch; expected ${expectedBranch}`);
  }
  if (normalizeRepository(git(repoRoot, 'remote', 'get-url', 'origin')) !== expectedRemote) {
    fail(`repository mismatch; expected ${expectedRemote}`);
  }
  if (!fs.existsSync(deltaReport) || !fs.statSync(deltaReport).isFile()) {
    fail(`delta report does not exist: ${deltaReport}`);
  }
  const reportBytes = fs.readFileSync(deltaReport);
  const report = JSON.parse(reportBytes.toString('utf8'));
  assertDeltaReport(report, expectedCommit, expectedTree);

  return {
    schemaVersion: 'nimi.realm-v3-baseline-admission-result/v1',
    verdict: 'PASS',
    nimi: {
      branch: expectedBranch,
      repository: expectedRemote,
      commit,
      tree,
      trackedProductWritesBeforePreflight: 0,
    },
    deltaPreflight: {
      path: deltaReport,
      sha256: sha256(reportBytes),
      ancestryCount: 6,
      changedFileCount: 20,
      materializationCriticalPathCount: 10,
      protectedObjectCount: 8,
      rootDirtyOverlapCount: 0,
    },
    realm: runCurrentAdmission(realmRoot).realm,
  };
}

try {
  const result = check(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`[check:realm-v3:baseline] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
