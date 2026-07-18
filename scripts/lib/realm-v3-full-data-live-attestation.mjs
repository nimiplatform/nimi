import { lstat, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  ATTESTATION_SCHEMA,
  FIXED_REALM_COMMIT,
  FIXED_REALM_TREE,
  FIXTURE_SOURCE_PATH,
  PERSISTENT_DATABASE,
  SHA256_RE,
  assertDisposableDatabaseName,
  assertPersistentMatchesFrozenN6,
  assertSHA256,
  canonicalJSONStringify,
  domainHash,
  fail,
  hashFile,
  runCapture,
  sha256Hex,
  validateLiveEnvironmentAttestation,
} from './realm-v3-full-data-live-contract.mjs';

export async function captureRepositoryBoundary(repository, label) {
  const resolved = await realpath(repository);
  const [head, tree, branch, statusResult, trackedDiff, untrackedResult] = await Promise.all([
    runCapture('git', ['-C', resolved, 'rev-parse', 'HEAD']),
    runCapture('git', ['-C', resolved, 'rev-parse', 'HEAD^{tree}']),
    runCapture('git', ['-C', resolved, 'rev-parse', '--abbrev-ref', 'HEAD']),
    runCapture('git', ['-C', resolved, 'status', '--porcelain=v2', '--untracked-files=all', '-z']),
    runCapture('git', [
      '-C', resolved, 'diff', 'HEAD', '--binary', '--no-ext-diff', '--full-index',
      '--src-prefix=a/', '--dst-prefix=b/', '--',
    ]),
    runCapture('git', ['-C', resolved, 'ls-files', '--others', '--exclude-standard', '-z']),
  ]);
  const untrackedPaths = untrackedResult.stdout.split('\0').filter(Boolean);
  untrackedPaths.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  const untrackedRows = [];
  for (const relative of untrackedPaths) {
    if (path.isAbsolute(relative) || relative.split('/').includes('..')) {
      fail('write_boundary_invalid', `${label} untracked path is unsafe`);
    }
    const absolute = path.join(resolved, relative);
    const info = await lstat(absolute);
    const mode = info.mode & 0o7777;
    if (info.isFile()) {
      untrackedRows.push({ path: relative, type: 'file', mode, bytes: info.size, sha256: await hashFile(absolute) });
    } else if (info.isSymbolicLink()) {
      const target = await readlink(absolute);
      untrackedRows.push({ path: relative, type: 'symlink', mode, bytes: Buffer.byteLength(target), sha256: sha256Hex(target) });
    } else {
      fail('write_boundary_invalid', `${label} untracked entry is not a file/symlink: ${relative}`);
    }
  }
  const value = {
    label,
    rootPathHash: sha256Hex(resolved),
    branch: branch.stdout.trim(),
    head: head.stdout.trim(),
    tree: tree.stdout.trim(),
    statusDigest: sha256Hex(statusResult.stdout),
    trackedBinaryDiffDigest: sha256Hex(trackedDiff.stdout),
    untrackedCount: untrackedRows.length,
    untrackedPathContentModeDigest: domainHash(
      'nimi.realm-v3-full-data-untracked-path-content-mode/v1',
      untrackedRows,
    ),
  };
  value.snapshotDigest = domainHash('nimi.realm-v3-full-data-repository-boundary/v1', value);
  return value;
}

export async function captureWriteBoundary(rootRealm) {
  return {
    root: await captureRepositoryBoundary(rootRealm, 'Root Realm'),
    nimi: await captureRepositoryBoundary(path.join(rootRealm, 'nimi'), 'Nimi'),
    apps: await captureRepositoryBoundary(path.join(rootRealm, 'nimi-apps'), 'nimi-apps'),
  };
}

export function boundaryDigests(boundary) {
  return {
    rootSnapshotDigest: boundary.root.snapshotDigest,
    nimiSnapshotDigest: boundary.nimi.snapshotDigest,
    appsSnapshotDigest: boundary.apps.snapshotDigest,
    productWrites: 0,
  };
}

export function buildServerExportAttestationDigest(producer, exportProof, expectedIssuer) {
  return domainHash('nimi.realm-v3-full-data-server-export-attestation/v1', {
    producer: { commit: producer.commit, tree: producer.tree },
    archiveSha256: exportProof.archiveSha256,
    manifestDigest: exportProof.manifestDigest,
    buildArtifactDigest: exportProof.buildArtifactDigest,
    dependencyRootDigest: exportProof.dependencyRootDigest,
    offlineStoreDirectoryPathHash: exportProof.offlineStoreDirectoryPathHash,
    runtimeDependencyClosureDigest: exportProof.runtimeDependencyClosureDigest,
    runtimeDependencyFileCount: exportProof.runtimeDependencyFileCount,
    runtimeDependencySymlinkCount: exportProof.runtimeDependencySymlinkCount,
    expectedIssuer,
  });
}

export function buildLiveEnvironmentAttestation(input) {
  if (input.producer.commit !== FIXED_REALM_COMMIT || input.producer.tree !== FIXED_REALM_TREE) {
    fail('producer_mismatch', 'live environment producer is not the admitted current Realm');
  }
  for (const field of ['openapiDigest', 'policyDigest']) assertSHA256(input.producer[field], `producer.${field}`);
  const expectedIssuer = input.expectedIssuer;
  if (expectedIssuer !== input.canonicalRealmBaseURL) {
    fail('issuer_mismatch', 'fixed Realm expected issuer differs from its actual canonical startup issuer');
  }
  const exportProof = {
    archiveSha256: input.export.archiveSha256,
    manifestDigest: input.export.manifestDigest,
    buildArtifactDigest: input.export.buildArtifactDigest,
    dependencyRootDigest: input.export.dependencyRootDigest,
    offlineStoreDirectoryPathHash: input.export.offlineStoreDirectoryPathHash,
    runtimeDependencyClosureDigest: input.export.runtimeDependencyClosureDigest,
    runtimeDependencyFileCount: input.export.runtimeDependencyFileCount,
    runtimeDependencySymlinkCount: input.export.runtimeDependencySymlinkCount,
  };
  for (const field of [
    'archiveSha256',
    'manifestDigest',
    'buildArtifactDigest',
    'dependencyRootDigest',
    'offlineStoreDirectoryPathHash',
    'runtimeDependencyClosureDigest',
  ]) assertSHA256(exportProof[field], `export.${field}`);
  if (
    !Number.isSafeInteger(exportProof.runtimeDependencyFileCount) ||
    exportProof.runtimeDependencyFileCount < 1 ||
    !Number.isSafeInteger(exportProof.runtimeDependencySymlinkCount) ||
    exportProof.runtimeDependencySymlinkCount < 0
  ) {
    fail('runtime_dependency_invalid', 'runtime dependency closure counts are invalid');
  }
  exportProof.serverExportAttestationDigest = buildServerExportAttestationDigest(
    input.producer,
    exportProof,
    expectedIssuer,
  );
  const persistent = input.persistent;
  const disposable = input.disposable;
  if (
    persistent.worlds.length !== 470 ||
    persistent.personas.length !== 1 ||
    disposable.worlds.length !== 470 ||
    disposable.personas.length !== 1
  ) {
    fail('denominator_mismatch', 'live environment snapshots are not persistent 470/1 and disposable 470/1');
  }
  if (
    !input.n6Baseline || !SHA256_RE.test(input.n6Baseline.sha256 || '') ||
    !SHA256_RE.test(input.n6Baseline.personaSourceRefHash || '')
  ) {
    fail('n6_baseline_invalid', 'live environment omitted the frozen N6 baseline identity');
  }
  assertPersistentMatchesFrozenN6(persistent, input.n6Baseline);
  if (canonicalJSONStringify(persistent.worlds) !== canonicalJSONStringify(disposable.worlds)) {
    fail('world_parity_mismatch', 'disposable World source refs/hashes differ from persistent nimi_dev');
  }
  if (persistent.worldSourceSetDigest !== disposable.worldSourceSetDigest) {
    fail('world_parity_mismatch', 'World source-set digests differ');
  }
  assertDisposableDatabaseName(input.disposableDatabase);
  const service = {
    canonicalRealmBaseURL: input.canonicalRealmBaseURL,
    canonicalTokenURL: input.canonicalTokenURL,
    expectedIssuer,
    loopbackOnly: true,
  };
  const persona = disposable.personas[0];
  const personaSourceRefHash = domainHash('nimi.realm-v3-full-data-source-ref/v1', persona);
  const personaProofInput = {
    method: 'current_realm_admitted_fullchain_fixture',
    fixtureSourcePath: FIXTURE_SOURCE_PATH,
    fixtureSourceSha256: input.fixtureSourceSha256,
    sourceRefHash: personaSourceRefHash,
    sourceHash: persona.sourceHash,
    ownerAccountIdHash: sha256Hex(persona.ownerAccountId),
    producerCommit: FIXED_REALM_COMMIT,
    producerTree: FIXED_REALM_TREE,
    disposableDatabaseNameHash: sha256Hex(input.disposableDatabase),
  };
  const personaProvisioning = {
    method: personaProofInput.method,
    fixtureSourcePath: personaProofInput.fixtureSourcePath,
    fixtureSourceSha256: personaProofInput.fixtureSourceSha256,
    sourceRefHash: personaProofInput.sourceRefHash,
    sourceHash: personaProofInput.sourceHash,
    ownerAccountIdHash: personaProofInput.ownerAccountIdHash,
    attestationDigest: domainHash('nimi.realm-v3-full-data-persona-provisioning-attestation/v1', personaProofInput),
  };
  if (personaProvisioning.ownerAccountIdHash !== input.materializerAccountIdHash) {
    fail('account_mismatch', 'provisioned Persona owner differs from the materializer account');
  }
  const value = {
    schemaVersion: ATTESTATION_SCHEMA,
    status: 'PASS',
    reasonCode: 'passed',
    environmentIdHash: sha256Hex(input.environmentId),
    producer: input.producer,
    export: exportProof,
    service,
    materializerAccountIdHash: input.materializerAccountIdHash,
    persistent: {
      containerIdentityDigest: input.persistentContainerIdentityDigest,
      database: PERSISTENT_DATABASE,
      sourceDatabase: PERSISTENT_DATABASE,
      snapshotDigest: persistent.snapshotDigest,
      instanceDigest: persistent.instanceDigest,
      worldCharacters: persistent.worlds.length,
      personaCharacters: persistent.personas.length,
      readOnly: true,
      worldSourceSetDigest: persistent.worldSourceSetDigest,
      n6FrozenEvidenceSha256: input.n6Baseline.sha256,
      personaSourceRefHash: input.n6Baseline.personaSourceRefHash,
    },
    disposable: {
      containerIdentityDigest: input.disposableContainerIdentityDigest,
      databaseNameHash: sha256Hex(input.disposableDatabase),
      sourceDatabase: PERSISTENT_DATABASE,
      snapshotDigest: disposable.snapshotDigest,
      instanceDigest: disposable.instanceDigest,
      worldCharacters: disposable.worlds.length,
      personaCharacters: disposable.personas.length,
      readOnly: true,
      worldSourceSetDigest: disposable.worldSourceSetDigest,
    },
    worldParity: {
      count: 470,
      sourceRefsExact: true,
      sourceHashesExact: true,
      persistentWorldSourceSetDigest: persistent.worldSourceSetDigest,
      disposableWorldSourceSetDigest: disposable.worldSourceSetDigest,
    },
    personaProvisioning,
    redis: input.redis,
    api: {
      ...input.api,
      buildArtifactDigest: exportProof.buildArtifactDigest,
      runtimeDependencyClosureDigest: exportProof.runtimeDependencyClosureDigest,
      canonicalRealmBaseURLHash: sha256Hex(input.canonicalRealmBaseURL),
      loopbackPort: Number(new URL(input.canonicalRealmBaseURL).port),
      loopbackOnly: true,
    },
    custody: input.custody,
    wrapper: input.wrapper,
    writeBoundary: boundaryDigests(input.writeBoundary),
  };
  value.contentHash = domainHash(ATTESTATION_SCHEMA, value);
  validateLiveEnvironmentAttestation(value);
  if (value.api.buildArtifactDigest !== value.export.buildArtifactDigest) {
    fail('build_identity_mismatch', 'API build identity differs from fixed server export');
  }
  return value;
}

export function validateLiveEnvironmentAttestationBinding(value) {
  const attestation = validateLiveEnvironmentAttestation(value);
  return {
    attestation,
    attestationDigest: attestation.contentHash,
    liveEnvironmentProjection: {
      canonicalRealmBaseURL: attestation.service.canonicalRealmBaseURL,
      canonicalTokenURL: attestation.service.canonicalTokenURL,
      expectedIssuer: attestation.service.expectedIssuer,
      materializerAccountIdHash: attestation.materializerAccountIdHash,
      serverExportAttestationDigest: attestation.export.serverExportAttestationDigest,
      apiProcessIntentDigest: attestation.api.processIntentDigest,
      apiEntrySha256: attestation.api.entrySha256,
      runtimeDependencyClosureDigest: attestation.export.runtimeDependencyClosureDigest,
      disposableSourceInstanceDigest: attestation.disposable.instanceDigest,
    },
    wrapperRegistrationDigest: attestation.wrapper.childRegistrationDigest,
  };
}
