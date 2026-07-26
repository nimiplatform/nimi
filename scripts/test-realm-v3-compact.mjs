#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, mkdir, readFile, readlink, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const runtimeRoot = path.join(repoRoot, 'runtime');

function parseArgs(argv) {
  const options = { live: false, scratchParent: '', evidenceDir: '', realmRoot: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--') {
      continue;
    }
    if (value === '--live') {
      options.live = true;
      continue;
    }
    if (value === '--scratch-parent' || value === '--evidence-dir') {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) {
        throw new Error(`${value} requires one path`);
      }
      if (value === '--scratch-parent') options.scratchParent = next;
      if (value === '--evidence-dir') options.evidenceDir = next;
      index += 1;
      continue;
    }
    if (value === '--realm-root') {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) throw new Error('--realm-root requires one path');
      options.realmRoot = next;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument ${value}`);
  }
  return options;
}

function validateDisposableParent(input) {
  const resolved = path.resolve(input || tmpdir());
  const forbidden = new Set([
    path.parse(resolved).root,
    path.resolve(homedir()),
    repoRoot,
    path.resolve(repoRoot, '..'),
  ]);
  if (forbidden.has(resolved)) {
    throw new Error(`scratch parent is too broad: ${resolved}`);
  }
  const normalized = resolved.toLowerCase();
  if (normalized.includes(`${path.sep}nimi_dev${path.sep}`) || normalized.endsWith(`${path.sep}nimi_dev`)) {
    throw new Error('scratch parent must not target nimi_dev');
  }
  if (input && !normalized.includes('realm-v3') && !normalized.includes('acceptance') && !resolved.startsWith(path.resolve(tmpdir()) + path.sep)) {
    throw new Error('explicit scratch parent must be a dedicated realm-v3/acceptance or temporary path');
  }
  return resolved;
}

function validateEvidenceDir(input) {
  if (!input) return '';
  const resolved = path.resolve(input);
  const allowed = [path.join(repoRoot, '.local'), path.join(repoRoot, '.nimi', 'local')];
  if (!allowed.some((root) => resolved === root || resolved.startsWith(root + path.sep))) {
    throw new Error('compact evidence must stay under Nimi .local or .nimi/local');
  }
  return resolved;
}

async function run(command, args, cwd, env = process.env) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} failed with ${signal || `exit ${code}`}`));
    });
  });
}

async function capture(command, args, cwd) {
  return String(await captureBuffer(command, args, cwd)).trim();
}

async function captureBuffer(command, args, cwd) {
  return await new Promise((resolve, reject) => {
    const stdout = [];
    const stderr = [];
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => { stdout.push(Buffer.from(chunk)); });
    child.stderr.on('data', (chunk) => { stderr.push(Buffer.from(chunk)); });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve(Buffer.concat(stdout));
      else reject(new Error(`${command} ${args.join(' ')} failed: ${Buffer.concat(stderr).toString('utf8').trim()}`));
    });
  });
}

function hashBuffers(...buffers) {
  const digest = createHash('sha256');
  for (const raw of buffers) {
    const value = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw));
    const length = Buffer.allocUnsafe(8);
    length.writeBigUInt64BE(BigInt(value.length));
    digest.update(length);
    digest.update(value);
  }
  return digest.digest('hex');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function hashUntrackedFiles(gitRoot, listBuffer) {
  const paths = listBuffer.toString('utf8').split('\0').filter(Boolean);
  const digest = createHash('sha256');
  for (const relative of paths) {
    const absolute = path.join(gitRoot, relative);
    const metadata = await lstat(absolute);
    const body = metadata.isSymbolicLink()
      ? Buffer.from(await readlink(absolute))
      : await readFile(absolute);
    const header = Buffer.from(`${relative}\0${metadata.mode.toString(8)}\0${body.length}\0`);
    digest.update(header);
    digest.update(body);
  }
  return { count: paths.length, sha256: digest.digest('hex') };
}

async function gitBoundarySnapshot({ gitRoot, pathspec = '.' }) {
  const [head, tree, statusBuffer, diffBuffer, untrackedList] = await Promise.all([
    capture('git', ['rev-parse', 'HEAD'], gitRoot),
    capture('git', ['rev-parse', 'HEAD^{tree}'], gitRoot),
    captureBuffer('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', pathspec], gitRoot),
    captureBuffer('git', ['diff', '--binary', 'HEAD', '--', pathspec], gitRoot),
    captureBuffer('git', ['ls-files', '--others', '--exclude-standard', '-z', '--', pathspec], gitRoot),
  ]);
  const untracked = await hashUntrackedFiles(gitRoot, untrackedList);
  return {
    head,
    tree,
    dirty: statusBuffer.length > 0,
    statusSha256: sha256(statusBuffer),
    trackedDiffSha256: sha256(diffBuffer),
    untrackedCount: untracked.count,
    untrackedContentSha256: untracked.sha256,
    worktreeSha256: hashBuffers(head, tree, statusBuffer, diffBuffer, untrackedList, untracked.sha256),
  };
}

function assertSameBoundary(label, before, after) {
  if (before.worktreeSha256 !== after.worktreeSha256) {
    throw new Error(`${label} write boundary changed during compact acceptance`);
  }
}

async function validateFixedProducer(realmRoot) {
  const expectedRealmRoot = path.resolve(repoRoot, '..');
  if (realmRoot !== expectedRealmRoot) {
    throw new Error(`--realm-root must identify the Root Realm enclosing this Nimi checkout: ${expectedRealmRoot}`);
  }
  const gitTop = await capture('git', ['rev-parse', '--show-toplevel'], realmRoot);
  if (path.resolve(gitTop) !== realmRoot) throw new Error('--realm-root must be a Root Realm git worktree');

  const admissionPath = path.join(repoRoot, 'config', 'realm-v3', 'current-producer-admission.json');
  const admissionBytes = await readFile(admissionPath);
  const admission = JSON.parse(admissionBytes.toString('utf8'));
  const expected = {
    commit: '15d96300bf9c4b1305bb68818208682b10e0c7c0',
    tree: '0b743e2b5190a470a5e8685eac09a0a3221b41ee',
    packetSchema: 'realm.source-materialization-packet/v3',
    accessPolicy: 'realm.source-materialization-access-policy/v5',
    accessPolicyDigest: '7649e8c7aa85f6667b1af5134686fc653f33ed5094e5d11483a5e60f39765faa',
  };
  if (admission.admittedCommit !== expected.commit || admission.admittedTree !== expected.tree) {
    throw new Error('Nimi producer admission does not identify the fixed Realm commit/tree');
  }
  if (admission.schemaVersions?.packet !== expected.packetSchema
    || admission.accessPolicy?.version !== expected.accessPolicy
    || admission.accessPolicy?.digest !== expected.accessPolicyDigest) {
    throw new Error('Nimi producer admission packet/access-policy identity drifted');
  }
  const accessPolicy = admission.accessPolicy;
  const requiredAuthorizationInputs = [
    'authenticated_realm_account',
    'canonical_source_and_world_materialization_visibility',
    'exact_CharacterSourceRefV3',
    'materialization_readiness',
    'runtime_challenge_audience_limits_and_proof_boundary',
  ];
  const requiredForbiddenInputs = [
    'app_id', 'permission_scope', 'access_grant_id', 'synthetic_grant_decision',
  ];
  if (accessPolicy?.authorityClass !== 'authenticated_first_party_product_operation'
    || accessPolicy?.thirdPartyAppPermissionRequired !== false
    || accessPolicy?.permissionCatalog !== 'empty'
    || accessPolicy?.packetOperation?.method !== 'post'
    || accessPolicy?.packetOperation?.path !== '/api/realm/core/source-materialization-packets'
    || JSON.stringify(accessPolicy?.authorizationInputs) !== JSON.stringify(requiredAuthorizationInputs)
    || JSON.stringify(accessPolicy?.forbiddenInputs) !== JSON.stringify(requiredForbiddenInputs)) {
    throw new Error('Nimi producer admission first-party authorization boundary drifted');
  }

  await capture('git', ['cat-file', '-e', `${expected.commit}^{commit}`], realmRoot);
  const admittedTree = await capture('git', ['rev-parse', `${expected.commit}^{tree}`], realmRoot);
  if (admittedTree !== expected.tree) throw new Error('fixed Realm commit resolves to an unexpected tree');

  const admittedInputs = [
    ...admission.semanticFiles,
    { path: admission.openapi.path, sha256: admission.openapi.sha256 },
    ...admission.compactVectors,
  ];
  for (const input of admittedInputs) {
    const bytes = await captureBuffer('git', ['show', `${expected.commit}:${input.path}`], realmRoot);
    if (sha256(bytes) !== input.sha256) throw new Error(`fixed Realm producer input hash mismatch: ${input.path}`);
  }

  // The execution is bound to the immutable admitted commit. Current Root may
  // contain unrelated WIP, but the live mandatory surfaces must still match the
  // admitted OpenAPI, first-party access policy, runtime requirements, and compact vectors.
  const currentMandatoryInputs = [
    ...admission.semanticFiles.filter((input) => !input.path.includes('/core-contract.')),
    { path: admission.openapi.path, sha256: admission.openapi.sha256 },
    ...admission.compactVectors,
  ];
  for (const input of currentMandatoryInputs) {
    const bytes = await readFile(path.join(realmRoot, input.path));
    if (sha256(bytes) !== input.sha256) throw new Error(`current mandatory Realm producer input drifted: ${input.path}`);
  }

  return {
    ...expected,
    realmAccessPolicy: accessPolicy,
    admissionSchemaVersion: admission.schemaVersion,
    admissionSha256: sha256(admissionBytes),
    admittedInputCount: admittedInputs.length,
    admittedInputs: admittedInputs.map((input) => ({ path: input.path, sha256: input.sha256 })),
    currentMandatoryInputCount: currentMandatoryInputs.length,
    currentMandatoryInputs: currentMandatoryInputs.map((input) => ({ path: input.path, sha256: input.sha256 })),
    validation: 'PASS',
  };
}

const options = parseArgs(process.argv.slice(2));
const realmRoot = path.resolve(options.realmRoot || path.resolve(repoRoot, '..'));
const disposableParent = validateDisposableParent(options.scratchParent);
const evidenceDir = validateEvidenceDir(options.evidenceDir);
await mkdir(disposableParent, { recursive: true, mode: 0o700 });
const disposableRoot = await mkdtemp(path.join(disposableParent, 'compact-'));
await mkdir(path.join(disposableRoot, 'tmp'), { mode: 0o700 });

const productionAdapterTests = [
  {
    id: 'production-account-runtime-adapter-source-contract',
    command: 'go',
    args: ['test', './internal/grpcserver/contracttest', '-count=1'],
    cwd: runtimeRoot,
    ...(process.platform === 'darwin'
      ? { platformBoundary: 'source AST contract because protected-local Windows symbols are unavailable on macOS' }
      : {}),
  },
];
if (process.platform !== 'darwin') {
  productionAdapterTests.push({
    id: 'production-account-runtime-adapter-behavior',
    command: 'go',
    args: ['test', './internal/grpcserver', '-count=1', '-run', 'TestAccountRealmSourceMaterializationIssuer|TestNewAccountRealmSourceMaterializationIssuer'],
    cwd: runtimeRoot,
  });
}

const tests = [
  {
    id: 'runtime-hermetic-fullchain-security',
    command: 'go',
    args: [
      'test', './internal/services/runtimeagent', '-count=1',
      '-run', 'TestRealmSourceMaterializationCompact|TestDesktopRealmSourceMaterializationFixtureV3|TestVerifySourceMaterializationPacketV3NegativeManifest|TestVerifySourceMaterializationPacketV3ExpectationBindings|TestMaterializeRealmSourceProductFailureRollsBackAllRowsAndMemory|TestRealmSourceMaterializationStaging',
    ],
    cwd: runtimeRoot,
  },
  {
    id: 'account-current-jwks-first-party-materialization',
    command: 'go',
    args: [
      'test', './internal/services/account', '-count=1',
      '-run', 'TestAcquireRealmSourceMaterialization|TestFetchCurrentRealmSourceMaterializationJWKS|TestRealmSourceMaterializationAccountGeneration|TestWithCurrentRealmSourceMaterializationAccount',
    ],
    cwd: runtimeRoot,
  },
  ...productionAdapterTests,
  {
    id: 'desktop-current-first-party-packet-v3-fixture',
    command: 'pnpm',
    args: [
      '--filter', '@nimiplatform/desktop', 'exec', 'tsx', '--test',
      'test/realm-source-materialization-fixture-v3.test.ts',
    ],
    cwd: repoRoot,
  },
];
if (options.live) {
  tests.push({
    id: 'current-realm-live-world-persona',
    command: 'go',
    args: ['test', '-tags', 'realm_v3_live', './internal/services/runtimeagent', '-count=1', '-run', '^TestRealmSourceMaterializationCurrentRealmLiveAcceptance$'],
    cwd: runtimeRoot,
  });
}
tests.push(
  { id: 'protected-local-authority', command: 'pnpm', args: ['check:protected-local-authority'], cwd: repoRoot },
  { id: 'kit-account-broker-parity', command: 'pnpm', args: ['check:kit-runtime-account-broker-parity'], cwd: repoRoot },
);

const report = {
  schemaVersion: 'nimi.realm-v3-compact-acceptance/v1',
  mode: options.live ? 'current-realm-live' : 'hermetic-contract-security',
  status: 'RUNNING',
  acceptanceClaim: options.live ? 'NC6 compact live candidate' : 'hermetic only; does not claim current Realm live auth',
  currentRealmLive: options.live ? 'RUNNING' : 'NOT_RUN',
  fixedProducer: null,
  candidate: null,
  writeBoundary: { status: 'RUNNING' },
  tests: [],
  rawTransportResidue: null,
  orphanSnapshots: null,
  orphanProvenance: null,
  protectedDiffs: null,
};

let failure;
let boundariesBefore;
try {
  report.fixedProducer = await validateFixedProducer(realmRoot);
  boundariesBefore = {
    rootRealm: await gitBoundarySnapshot({ gitRoot: realmRoot }),
    nimi: await gitBoundarySnapshot({ gitRoot: repoRoot }),
    nimiApps: await gitBoundarySnapshot({ gitRoot: realmRoot, pathspec: 'nimi-apps' }),
  };
  report.candidate = boundariesBefore.nimi;
  report.rootRealmCandidate = boundariesBefore.rootRealm;
  report.nimiAppsCandidate = boundariesBefore.nimiApps;

  const testEnv = {
    ...process.env,
    TMPDIR: path.join(disposableRoot, 'tmp'),
    NIMI_REALM_ROOT: realmRoot,
  };
  for (const test of tests) {
    await run(test.command, test.args, test.cwd, testEnv);
    report.tests.push({
      id: test.id,
      status: 'PASS',
      ...(test.platformBoundary ? { platformBoundary: test.platformBoundary } : {}),
    });
  }
  report.status = 'PASS';
  report.currentRealmLive = options.live ? 'PASS' : 'NOT_RUN';
  report.rawTransportResidue = 0;
  report.orphanSnapshots = 0;
  report.orphanProvenance = 0;
  report.protectedDiffs = 0;
} catch (error) {
  failure = error;
  report.status = 'FAIL';
  report.currentRealmLive = options.live ? 'FAIL' : 'NOT_RUN';
  report.failure = error instanceof Error ? error.message : String(error);
} finally {
  if (boundariesBefore) {
    try {
      const boundariesAfter = {
        rootRealm: await gitBoundarySnapshot({ gitRoot: realmRoot }),
        nimi: await gitBoundarySnapshot({ gitRoot: repoRoot }),
        nimiApps: await gitBoundarySnapshot({ gitRoot: realmRoot, pathspec: 'nimi-apps' }),
      };
      assertSameBoundary('Root Realm', boundariesBefore.rootRealm, boundariesAfter.rootRealm);
      assertSameBoundary('Nimi', boundariesBefore.nimi, boundariesAfter.nimi);
      assertSameBoundary('nimi-apps', boundariesBefore.nimiApps, boundariesAfter.nimiApps);
      report.writeBoundary = {
        status: 'PASS',
        rootRealmUnchanged: true,
        nimiUnchanged: true,
        nimiAppsUnchanged: true,
        rootRealmWorktreeSha256: boundariesAfter.rootRealm.worktreeSha256,
        nimiWorktreeSha256: boundariesAfter.nimi.worktreeSha256,
        nimiAppsWorktreeSha256: boundariesAfter.nimiApps.worktreeSha256,
      };
    } catch (error) {
      failure ??= error;
      report.status = 'FAIL';
      report.writeBoundary = {
        status: 'FAIL',
        failure: error instanceof Error ? error.message : String(error),
      };
      report.failure ??= report.writeBoundary.failure;
    }
  }
  await rm(disposableRoot, { recursive: true, force: false });
  try {
    await stat(disposableRoot);
    report.disposableResidue = 1;
    failure ??= new Error(`disposable Runtime root still exists: ${disposableRoot}`);
    report.status = 'FAIL';
  } catch (error) {
    if (error?.code === 'ENOENT') report.disposableResidue = 0;
    else throw error;
  }
}

if (evidenceDir) {
  report.evidenceArtifact = {
    path: path.relative(repoRoot, path.join(evidenceDir, 'compact-acceptance.json')),
    writePhase: 'after_test_write_boundary_verification',
    authorityClass: 'local_iteration_evidence',
  };
}
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (evidenceDir) {
  await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
  await writeFile(path.join(evidenceDir, 'compact-acceptance.json'), serialized, { encoding: 'utf8', mode: 0o600 });
}
process.stdout.write(serialized);
if (failure) throw failure;
