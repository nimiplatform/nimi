import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ATTESTATION_SCHEMA,
  CHILD_REGISTRATION_SCHEMA,
  CLEANUP_SCHEMA,
  CLOSE_CANDIDATE_SCHEMA,
  CURRENT_ACCESS_POLICY_DIGEST,
  CURRENT_OPENAPI_DIGEST,
  EXECUTION_RECEIPT_SCHEMA,
  FIXED_REALM_COMMIT,
  FIXED_REALM_TREE,
  LIVE_ENVIRONMENT_MODULE_BASENAMES,
  assertDisposableDatabaseName,
  assertAdmittedEvidenceOutput,
  assertSafeStateDirectoryTarget,
  buildCleanupReceipt,
  buildLiveEnvironmentAttestation,
  buildServerExportAttestationDigest,
  canonicalJSONStringify,
  cleanupLiveEnvironment,
  domainHash,
  sha256Hex,
  validateCloseCandidateBinding,
  validateLiveEnvironmentAttestation,
  validateLiveEnvironmentAttestationBinding,
  validateLiveEnvironmentCleanupReceipt,
  validateLiveEnvironmentExecutionReceipt,
  validateLiveChildRegistration,
  validateRunLockBinding,
  __test,
} from './realm-v3-full-data-live-environment.mjs';
import {
  buildDualSourceReceipt,
  buildSnapshotProof,
} from '../realm-v3-full-data-census-worker.mjs';

const disposableDatabase = 'nimi_realm_v3_n7_0123456789abcdef0123456789abcdef';
const containerIdentityDigest = sha256Hex('postgres-container-id');
const trustedToolNames = ['docker', 'git', 'go', 'pnpm', 'ps', 'tar'];
function resolveFixtureExecutable(name, fallback = '') {
  if (process.platform !== 'win32') {
    return execFileSync('/usr/bin/which', [name], { encoding: 'utf8' }).trim();
  }
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const whereExecutable = path.join(systemRoot, 'System32', 'where.exe');
  try {
    const [candidate] = execFileSync(whereExecutable, [name], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean);
    if (candidate) return candidate;
  } catch {
    // Tests that do not execute an unavailable POSIX-only tool bind it to the
    // already-attested Node executable instead of inventing a fake path.
  }
  return fallback;
}
const fixtureGitExecutable = await realpath(resolveFixtureExecutable('git'));
const fixturePSExecutable = await realpath(
  process.platform === 'win32'
    ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : resolveFixtureExecutable('ps'),
);
const fixtureGoExecutable = await realpath(resolveFixtureExecutable('go'));
__test.activateTrustedToolPaths({
  docker: process.execPath,
  git: fixtureGitExecutable,
  go: fixtureGoExecutable,
  pnpm: process.execPath,
  ps: fixturePSExecutable,
  tar: process.execPath,
});

const liveHarnessModuleURLs = [
  './realm-v3-full-data-live-contract.mjs',
  './realm-v3-full-data-live-attestation.mjs',
  './realm-v3-full-data-live-infrastructure.mjs',
  './realm-v3-full-data-live-services.mjs',
  './realm-v3-full-data-live-prepare.mjs',
  './realm-v3-full-data-live-cleanup.mjs',
  './realm-v3-full-data-live-environment.mjs',
].map((relativePath) => new URL(relativePath, import.meta.url));

async function readLiveHarnessSource() {
  return (await Promise.all(liveHarnessModuleURLs.map((url) => readFile(url, 'utf8')))).join('\n');
}

function world(index) {
  const id = `world-character-${String(index).padStart(3, '0')}`;
  const worldId = `world-${String(Math.floor(index / 100)).padStart(2, '0')}`;
  return {
    kind: 'worldCharacter',
    id,
    worldId,
    sourceHash: sha256Hex(`world-source-${index}`),
    worldEntityRef: {
      kind: 'worldEntity',
      worldId,
      entityId: `world-entity-${String(index).padStart(3, '0')}`,
    },
  };
}

function persona(index = 1) {
  return {
    kind: 'personaCharacter',
    id: `persona-${index}`,
    worldId: 'world-00',
    sourceHash: sha256Hex(`persona-source-${index}`),
    ownerAccountId: '01J00000000000000000000000',
  };
}

function fixedPersona() {
  return {
    kind: 'personaCharacter',
    id: 'persona-character-0716-fullchain-fixture',
    worldId: 'cbdb-yuan-literati-academy-world',
    sourceHash: '5f00937ee6d7ac325c77d5c07a0b6c30d2ee0380fa15a8761dda4528562ed3d1',
    ownerAccountId: '01J00000000000000000000000',
  };
}

function sortedSources(sources) {
  return [...sources].sort((left, right) => {
    const a = `${left.kind}\0${left.id}\0${left.sourceHash}`;
    const b = `${right.kind}\0${right.id}\0${right.sourceHash}`;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function fixtureSnapshots() {
  const worlds = Array.from({ length: 470 }, (_entry, index) => world(index));
  const persistentSources = sortedSources([...worlds, fixedPersona()]);
  const disposableSources = sortedSources([...worlds, fixedPersona()]);
  return {
    persistentSources,
    disposableSources,
    persistent: buildSnapshotProof({
      containerIdentityDigest,
      databaseName: 'nimi_dev',
      sources: persistentSources,
      expectedPersonas: 1,
    }),
    disposable: buildSnapshotProof({
      containerIdentityDigest,
      databaseName: disposableDatabase,
      sources: disposableSources,
      expectedPersonas: 1,
    }),
  };
}

function producer() {
  return {
    commit: FIXED_REALM_COMMIT,
    tree: FIXED_REALM_TREE,
    openapiDigest: CURRENT_OPENAPI_DIGEST,
    policyDigest: CURRENT_ACCESS_POLICY_DIGEST,
  };
}

function trustedFileIdentity(seed, mode = 0o500) {
  const identity = {
    pathHash: sha256Hex(`${seed}:path`),
    sha256: sha256Hex(`${seed}:content`),
    bytes: Buffer.byteLength(seed),
    mode,
    uid: typeof process.getuid === 'function' ? process.getuid() : 501,
  };
  identity.identityDigest = domainHash('nimi.realm-v3-full-data-trusted-file-identity/v1', identity);
  return identity;
}

function wrapperTrust() {
  const node = trustedFileIdentity('node', 0o500);
  const census = {
    stage: 'census',
    kind: 'node_script',
    command: node,
    script: trustedFileIdentity('census-script', 0o400),
    argsDigest: sha256Hex('census-args'),
    argsCount: 1,
  };
  census.childIdentityDigest = domainHash('nimi.realm-v3-full-data-live-child-identity/v1', census);
  const partition = {
    stage: 'partition',
    kind: 'native',
    command: trustedFileIdentity('partition-native', 0o500),
    goBuildInfoDigest: sha256Hex('partition-go-build-info'),
    argsDigest: sha256Hex('partition-args'),
    argsCount: 0,
  };
  partition.childIdentityDigest = domainHash('nimi.realm-v3-full-data-live-child-identity/v1', partition);
  const wrapper = {
    modules: LIVE_ENVIRONMENT_MODULE_BASENAMES.map((name) => ({
      name,
      identity: trustedFileIdentity(`live-module:${name}`, 0o400),
    })),
    cli: trustedFileIdentity('live-cli', 0o500),
    node,
    tools: Object.fromEntries(
      trustedToolNames.map((name) => [name, trustedFileIdentity(`tool-${name}`, 0o500)]),
    ),
    childRegistrationDigest: sha256Hex('child-registration'),
    allowedChildren: [census, partition],
  };
  wrapper.wrapperIdentityDigest = domainHash('nimi.realm-v3-full-data-live-wrapper-identity/v1', wrapper);
  return wrapper;
}

function liveAttestation(overrides = {}) {
  const snapshots = fixtureSnapshots();
  const baseURL = 'http://127.0.0.1:43127';
  const apiAuthority = {
    entryPathHash: sha256Hex('/private/export/producer-api/dist/apps/api/main.js'),
    workingDirectoryHash: sha256Hex('/private/export/producer-api'),
    entrySha256: sha256Hex('api-entry'),
    logPathHash: sha256Hex('/private/state/realm-api.log'),
    markerHash: sha256Hex('private-environment-marker'),
    canonicalRealmBaseURLHash: sha256Hex(baseURL),
    loopbackPort: 43127,
    buildArtifactDigest: sha256Hex('api-build'),
    runtimeDependencyClosureDigest: sha256Hex('runtime-dependency-closure'),
  };
  return buildLiveEnvironmentAttestation({
    environmentId: '0123456789abcdef0123456789abcdef',
    producer: producer(),
    export: {
      archiveSha256: sha256Hex('archive'),
      manifestDigest: sha256Hex('manifest'),
      buildArtifactDigest: sha256Hex('api-build'),
      dependencyRootDigest: sha256Hex('dependencies'),
      offlineStoreDirectoryPathHash: sha256Hex('/absolute/pnpm/store'),
      runtimeDependencyClosureDigest: sha256Hex('runtime-dependency-closure'),
      runtimeDependencyFileCount: 123,
      runtimeDependencySymlinkCount: 17,
    },
    canonicalRealmBaseURL: baseURL,
    canonicalTokenURL: `${baseURL}/api/auth/oauth/token`,
    expectedIssuer: baseURL,
    materializerAccountIdHash: sha256Hex('01J00000000000000000000000'),
    persistent: snapshots.persistent,
    disposable: snapshots.disposable,
    disposableDatabase,
    persistentContainerIdentityDigest: containerIdentityDigest,
    disposableContainerIdentityDigest: containerIdentityDigest,
    fixtureSourceSha256: sha256Hex('current-realm-fixture-source'),
    n6Baseline: {
      sha256: sha256Hex('frozen-n6-evidence'),
      personaSourceRef: fixedPersona(),
      personaSourceRefHash: domainHash('nimi.realm-v3-full-data-source-ref/v1', fixedPersona()),
    },
    redis: {
      containerIdentityDigest: sha256Hex('redis-container'),
      containerNameHash: sha256Hex('redis-name'),
      imageIdentityDigest: sha256Hex('redis-image'),
      initialKeyCount: 0,
      isolationLabelDigest: sha256Hex('0123456789abcdef0123456789abcdef'),
    },
    api: {
      processIntentDigest: domainHash('nimi.realm-v3-full-data-api-resource/v3', apiAuthority),
      entryPathHash: apiAuthority.entryPathHash,
      workingDirectoryHash: apiAuthority.workingDirectoryHash,
      entrySha256: apiAuthority.entrySha256,
      logPathHash: apiAuthority.logPathHash,
      markerHash: apiAuthority.markerHash,
    },
    custody: {
      directoryDigest: sha256Hex('/tmp/realm-v3-full-data-fixture'),
      mode: 'state-dir:0700/files:0600',
      secretFieldsInAttestation: false,
    },
    wrapper: wrapperTrust(),
    writeBoundary: {
      root: { snapshotDigest: sha256Hex('root-boundary') },
      nimi: { snapshotDigest: sha256Hex('nimi-boundary') },
      apps: { snapshotDigest: sha256Hex('apps-boundary') },
    },
    ...overrides,
  });
}

function rehashAttestation(value) {
  const result = structuredClone(value);
  delete result.contentHash;
  result.contentHash = domainHash(ATTESTATION_SCHEMA, result);
  return result;
}

function censusRequest(attestation) {
  return {
    schemaVersion: 'nimi.realm-v3-full-data-source-census-request/v1',
    producer: attestation.producer,
    nimi: {
      commit: 'a'.repeat(40),
      tree: 'b'.repeat(40),
      contractDigest: sha256Hex('contract'),
      worktreeDigest: sha256Hex('worktree'),
    },
    denominator: { total: 471, worldCharacters: 470, personaCharacters: 1 },
    persistentDatabase: 'nimi_dev',
    sourceDatabaseAccess: 'read_only_census',
    sourceOrder: 'kind_id_source_hash_lexicographic',
    secretFieldsInReceipt: 'forbidden',
  };
}

function runLock() {
  const value = {
    schemaVersion: 'nimi.realm-v3-full-data-run-lock/v1',
    evidenceClass: 'final_candidate',
    sourceInput: { mode: 'current_realm_live_census' },
  };
  value.inputDigest = domainHash(value.schemaVersion, value);
  return value;
}

function closeCandidate(lock, attestation) {
  const value = {
    schemaVersion: CLOSE_CANDIDATE_SCHEMA,
    status: 'PASS',
    reasonCode: 'passed',
    inputDigest: lock.inputDigest,
    liveEnvironmentAttestationDigest: attestation.contentHash,
    aggregateCandidateDigest: sha256Hex('aggregate-candidate'),
    acceptance: {
      total: 471,
      passed: 471,
      failed: 0,
      skipped: 0,
      orphanProductRecords: 0,
      rawTransportResidue: 0,
      externalCleanup: 'pending',
    },
  };
  value.contentHash = domainHash(CLOSE_CANDIDATE_SCHEMA, value);
  return value;
}


export {
  censusRequest,
  closeCandidate,
  containerIdentityDigest,
  disposableDatabase,
  fixedPersona,
  fixtureGoExecutable,
  fixtureSnapshots,
  liveAttestation,
  persona,
  producer,
  readLiveHarnessSource,
  rehashAttestation,
  runLock,
  sortedSources,
  trustedFileIdentity,
  trustedToolNames,
  world,
  wrapperTrust,
};
