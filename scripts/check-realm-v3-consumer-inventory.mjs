#!/usr/bin/env node

import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const ledgerPath = path.join(repoRoot, 'config/realm-v3/consumer-inventory.tsv');
const sentinelPath = path.join(repoRoot, 'config/realm-v3/protected-sentinel.json');
const scanRoots = [
  '.nimi/spec',
  'config',
  'proto',
  'runtime',
  'sdks',
  'kit',
  'apps/desktop',
  'apps/web',
  'scripts',
  'tests',
];
const tokens = [
  'realm.source-materialization-packet/v2',
  'BundleTransportManifestV1',
  'RealmPersona',
  'realmPersona',
  'sourceContentHash',
];
const expandedTokens = [...tokens, 'SourceMaterializationPacketV2', 'source_materialization_v2'];
const expectedTokenCounts = [18, 27, 92, 93, 84];
const expectedNonTestTokenCounts = [18, 27, 87, 86, 79];
const expectedBucketCounts = {
  active_materialization_truth: 62,
  active_non_materialization_realm_consumer: 24,
  generated_projection: 22,
  fixture_or_test: 69,
  legal_non_target_text: 2,
};
const expectedPathListSha256 = 'd0a50f6df4538cfa3ec035191eb22fbaf5a0203febc757deb9c5c75657c55900';
const expectedLedgerDataSha256 = '92daf0d9088c58d5e4d8c7b4b495a378ae5d34372adb9f4d8caf1a5a9ac06904';
const expectedBucketPathProjectionSha256 = '8e3a048c472a9aa6f877ca3ca67714701a5357557d2f983a0502b6a78ac4c294';
const excludedSegment = /(^|\/)(archive|_archive|dist|node_modules|generated|gen|\.next|coverage|\.cache)(\/|$)/u;
const excludedLockfile = /(^|\/)(pnpm-lock\.yaml|yarn\.lock|package-lock\.json)$/u;

function fail(message) {
  throw new Error(`Realm v3 consumer inventory failed: ${message}`);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function git(...args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function parseArgs(argv) {
  const reportIndex = argv.indexOf('--report');
  const report = reportIndex >= 0 ? String(argv[reportIndex + 1] || '').trim() : '';
  if (reportIndex >= 0 && !report) fail('missing value after --report');
  return { reportPath: report ? path.resolve(report) : null };
}

function scanToken(ref, token) {
  const result = spawnSync('git', [
    'grep', '-I', '-l', '-F', '-e', token, ref, '--', ...scanRoots,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 && result.status !== 1) {
    fail(`git grep failed for ${token}: ${String(result.stderr).trim()}`);
  }
  const prefix = `${ref}:`;
  return String(result.stdout || '')
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.startsWith(prefix) ? entry.slice(prefix.length) : entry)
    .filter((entry) => !excludedSegment.test(entry) && !excludedLockfile.test(entry))
    .sort();
}

function scan(ref, scanTokens) {
  const byToken = Object.fromEntries(scanTokens.map((token) => [token, scanToken(ref, token)]));
  const paths = [...new Set(Object.values(byToken).flat())].sort();
  return { byToken, paths };
}

function parseLedger() {
  if (!fs.existsSync(ledgerPath)) fail('missing config/realm-v3/consumer-inventory.tsv');
  const source = fs.readFileSync(ledgerPath, 'utf8');
  const lines = source.replace(/\r\n/gu, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.shift() !== 'path\tbucket\towner_phase\tdisposition') {
    fail('consumer inventory ledger header mismatch');
  }
  const entries = lines.map((line, index) => {
    const fields = line.split('\t');
    if (fields.length !== 4 || fields.some((field) => !field)) {
      fail(`invalid ledger row ${index + 2}`);
    }
    const [entryPath, bucket, ownerPhase, disposition] = fields;
    return { path: entryPath, bucket, ownerPhase, disposition };
  });
  const data = `${lines.join('\n')}\n`;
  if (sha256(data) !== expectedLedgerDataSha256) {
    fail(`ledger data digest drift: expected=${expectedLedgerDataSha256} actual=${sha256(data)}`);
  }
  return entries;
}

function assertCounts(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} mismatch: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  }
}

function check({ reportPath }) {
  const sentinel = JSON.parse(fs.readFileSync(sentinelPath, 'utf8'));
  const ref = sentinel.baselineCommit;
  if (git('rev-parse', `${ref}^{tree}`) !== sentinel.baselineTree) {
    fail('protected sentinel baseline commit/tree drift');
  }
  const inventory = scan(ref, tokens);
  const tokenCounts = tokens.map((token) => inventory.byToken[token].length);
  assertCounts(tokenCounts, expectedTokenCounts, 'five-token counts including tests');
  const nonTestTokenCounts = tokens.map((token) =>
    inventory.byToken[token].filter((entry) => !entry.startsWith('tests/')).length);
  assertCounts(nonTestTokenCounts, expectedNonTestTokenCounts, 'five-token counts excluding tests');
  if (inventory.paths.length !== 179) fail(`expected 179 five-token files, got ${inventory.paths.length}`);
  const pathListSha256 = sha256(`${inventory.paths.join('\n')}\n`);
  if (pathListSha256 !== expectedPathListSha256) {
    fail(`path-list digest drift: expected=${expectedPathListSha256} actual=${pathListSha256}`);
  }

  const ledger = parseLedger();
  const ledgerPaths = ledger.map((entry) => entry.path);
  if (new Set(ledgerPaths).size !== ledgerPaths.length) fail('consumer inventory ledger has duplicate paths');
  if (JSON.stringify(ledgerPaths) !== JSON.stringify(inventory.paths)) {
    const missing = inventory.paths.filter((entry) => !ledgerPaths.includes(entry));
    const extra = ledgerPaths.filter((entry) => !inventory.paths.includes(entry));
    fail(`ledger/scan path mismatch: missing=${missing.join(',')} extra=${extra.join(',')}`);
  }
  const bucketCounts = Object.fromEntries(Object.keys(expectedBucketCounts).map((bucket) => [
    bucket,
    ledger.filter((entry) => entry.bucket === bucket).length,
  ]));
  assertCounts(bucketCounts, expectedBucketCounts, 'bucket counts');
  const unknownBuckets = ledger.filter((entry) => !(entry.bucket in expectedBucketCounts));
  if (unknownBuckets.length > 0) fail(`ledger contains unknown bucket ${unknownBuckets[0].bucket}`);
  const bucketPathProjection = ledger
    .map((entry) => `${entry.bucket}\t${entry.path}`)
    .sort();
  const bucketPathProjectionSha256 = sha256(`${bucketPathProjection.join('\n')}\n`);
  if (bucketPathProjectionSha256 !== expectedBucketPathProjectionSha256) {
    fail(`bucket/path projection digest drift: expected=${expectedBucketPathProjectionSha256} actual=${bucketPathProjectionSha256}`);
  }

  const expanded = scan(ref, expandedTokens);
  const expandedNonTestPaths = expanded.paths.filter((entry) => !entry.startsWith('tests/'));
  if (expandedNonTestPaths.length !== 173 || expanded.paths.length !== 182) {
    fail(`expanded plan inventory mismatch: non-test=${expandedNonTestPaths.length} all=${expanded.paths.length}`);
  }
  const addedByExpandedTokens = expandedNonTestPaths.filter((entry) => !inventory.paths.includes(entry));
  assertCounts(addedByExpandedTokens, [
    'config/test-inventories/runtime/shard-08.yaml',
    'sdks/generators/lib/realm-openapi.mjs',
    'sdks/typescript/realm/social-types.ts',
  ], 'three extended-token-only files');

  const result = {
    schemaVersion: 'nimi.realm-v3-consumer-inventory-result/v1',
    verdict: 'PASS',
    baseline: {
      commit: ref,
      tree: sentinel.baselineTree,
      scanMode: 'tracked_text_at_commit',
    },
    tokenCounts: Object.fromEntries(tokens.map((token, index) => [token, tokenCounts[index]])),
    fiveTokenFilesIncludingTests: inventory.paths.length,
    fiveTokenFilesExcludingTests: inventory.paths.filter((entry) => !entry.startsWith('tests/')).length,
    expandedPlanFilesExcludingTests: expandedNonTestPaths.length,
    expandedHardcutFilesIncludingTests: expanded.paths.length,
    pathListSha256,
    ledgerDataSha256: expectedLedgerDataSha256,
    bucketPathProjectionSha256,
    bucketCounts,
    ownerAssigned: ledger.length,
    ownerUnassigned: 0,
    blockedOutsideCurrentWriteDomain: ledger.filter((entry) => entry.disposition.startsWith('BLOCKED_')),
    binaryGeneratedProjection: 'runtime/proto/runtime-v1.baseline.binpb',
    reportPath,
    entries: ledger,
  };
  if (reportPath) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  return result;
}

try {
  const result = check(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({
    schemaVersion: result.schemaVersion,
    verdict: result.verdict,
    baseline: result.baseline,
    tokenCounts: result.tokenCounts,
    fiveTokenFilesIncludingTests: result.fiveTokenFilesIncludingTests,
    expandedPlanFilesExcludingTests: result.expandedPlanFilesExcludingTests,
    expandedHardcutFilesIncludingTests: result.expandedHardcutFilesIncludingTests,
    bucketCounts: result.bucketCounts,
    ownerAssigned: result.ownerAssigned,
    ownerUnassigned: result.ownerUnassigned,
    blockedOutsideCurrentWriteDomain: result.blockedOutsideCurrentWriteDomain.length,
    reportPath: result.reportPath,
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`[check:realm-v3:consumer-inventory] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
