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
} from './lib/realm-v3-full-data-live-environment.mjs';
import {
  buildDualSourceReceipt,
  buildSnapshotProof,
} from './realm-v3-full-data-census-worker.mjs';


import {
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
} from './lib/realm-v3-full-data-live-test-fixtures.mjs';
test('dual source census proves persistent 470/1 while selecting only the disposable fixed Persona', () => {
  const attestation = liveAttestation();
  const snapshots = fixtureSnapshots();
  const receipt = buildDualSourceReceipt(
    censusRequest(attestation),
    attestation,
    {
      containerIdentityDigest,
      databaseName: 'nimi_dev',
      sources: snapshots.persistentSources,
    },
    {
      containerIdentityDigest,
      databaseName: disposableDatabase,
      sources: snapshots.disposableSources,
    },
  );
  assert.equal(receipt.sourceCount, 471);
  assert.equal(receipt.persistentWorldCharacters, 470);
  assert.equal(receipt.persistentPersonaCharacters, 1);
  assert.equal(receipt.disposableWorldCharacters, 470);
  assert.equal(receipt.disposablePersonaCharacters, 1);
  assert.equal(receipt.worldParity.sourceRefsExact, true);
  assert.match(receipt.persistentInstanceDigest, /^[0-9a-f]{64}$/u);
  assert.match(receipt.disposableInstanceDigest, /^[0-9a-f]{64}$/u);
});

test('persistent/disposable missing or multiple Persona rows fail closed', () => {
  const worlds = Array.from({ length: 470 }, (_entry, index) => world(index));
  assert.throws(
    () => buildSnapshotProof({
      containerIdentityDigest,
      databaseName: 'nimi_dev',
      sources: sortedSources(worlds),
      expectedPersonas: 1,
    }),
    /470 WorldCharacters \+ 1 PersonaCharacters/u,
  );
  assert.throws(
    () => buildSnapshotProof({
      containerIdentityDigest,
      databaseName: disposableDatabase,
      sources: sortedSources(worlds),
      expectedPersonas: 1,
    }),
    /470 WorldCharacters \+ 1 PersonaCharacters/u,
  );
  assert.throws(
    () => buildSnapshotProof({
      containerIdentityDigest,
      databaseName: disposableDatabase,
      sources: sortedSources([...worlds, persona(1), persona(2)]),
      expectedPersonas: 1,
    }),
    /470 WorldCharacters \+ 1 PersonaCharacters/u,
  );
});

test('World source-ref or sourceHash drift is rejected', () => {
  const attestation = liveAttestation();
  const snapshots = fixtureSnapshots();
  const drifted = structuredClone(snapshots.disposableSources);
  const index = drifted.findIndex((entry) => entry.kind === 'worldCharacter');
  drifted[index].sourceHash = sha256Hex('drift');
  const sorted = sortedSources(drifted);
  assert.throws(
    () => buildDualSourceReceipt(
      censusRequest(attestation),
      attestation,
      { containerIdentityDigest, databaseName: 'nimi_dev', sources: snapshots.persistentSources },
      { containerIdentityDigest, databaseName: disposableDatabase, sources: sorted },
    ),
    /snapshots do not match|drifted/u,
  );
});

test('attestation rejects producer, export, URL, issuer, account, and API build mismatch', () => {
  const admitted = liveAttestation();
  assert.equal(validateLiveEnvironmentAttestation(admitted), admitted);
  const binding = validateLiveEnvironmentAttestationBinding(admitted);
  assert.deepEqual(binding.liveEnvironmentProjection, {
    canonicalRealmBaseURL: admitted.service.canonicalRealmBaseURL,
    canonicalTokenURL: admitted.service.canonicalTokenURL,
    expectedIssuer: admitted.service.expectedIssuer,
    materializerAccountIdHash: admitted.materializerAccountIdHash,
    serverExportAttestationDigest: admitted.export.serverExportAttestationDigest,
    apiProcessIntentDigest: admitted.api.processIntentDigest,
    apiEntrySha256: admitted.api.entrySha256,
    runtimeDependencyClosureDigest: admitted.export.runtimeDependencyClosureDigest,
    disposableSourceInstanceDigest: admitted.disposable.instanceDigest,
  });
  assert.equal(binding.attestation, admitted);
  assert.equal(binding.attestationDigest, admitted.contentHash);
  assert.equal(binding.wrapperRegistrationDigest, admitted.wrapper.childRegistrationDigest);

  const producerDrift = structuredClone(admitted);
  producerDrift.producer.commit = 'f'.repeat(40);
  assert.throws(() => validateLiveEnvironmentAttestation(rehashAttestation(producerDrift)), /current Realm producer/u);

  const openapiDrift = structuredClone(admitted);
  openapiDrift.producer.openapiDigest = sha256Hex('other-openapi');
  assert.throws(() => validateLiveEnvironmentAttestation(rehashAttestation(openapiDrift)), /OpenAPI digest/u);

  const policyDrift = structuredClone(admitted);
  policyDrift.producer.policyDigest = sha256Hex('other-policy');
  assert.throws(() => validateLiveEnvironmentAttestation(rehashAttestation(policyDrift)), /access policy digest/u);

  const exportDrift = structuredClone(admitted);
  exportDrift.export.archiveSha256 = sha256Hex('other-archive');
  assert.throws(() => validateLiveEnvironmentAttestation(rehashAttestation(exportDrift)), /server export attestation digest/u);

  const urlDrift = structuredClone(admitted);
  urlDrift.service.canonicalTokenURL = 'http://127.0.0.1:43128/api/auth/oauth/token';
  assert.throws(() => validateLiveEnvironmentAttestation(rehashAttestation(urlDrift)), /Realm\/token\/issuer/u);

  const issuerDrift = structuredClone(admitted);
  issuerDrift.service.expectedIssuer = 'urn:nimi:realm:other';
  issuerDrift.export.serverExportAttestationDigest = buildServerExportAttestationDigest(
    issuerDrift.producer,
    issuerDrift.export,
    issuerDrift.service.expectedIssuer,
  );
  assert.throws(() => validateLiveEnvironmentAttestation(rehashAttestation(issuerDrift)), /Realm\/token\/issuer/u);

  const accountDrift = structuredClone(admitted);
  accountDrift.materializerAccountIdHash = sha256Hex('other-account');
  assert.throws(() => validateLiveEnvironmentAttestation(rehashAttestation(accountDrift)), /Persona provisioning account/u);

  const apiDrift = structuredClone(admitted);
  apiDrift.api.buildArtifactDigest = sha256Hex('other-build');
  assert.throws(() => validateLiveEnvironmentAttestation(rehashAttestation(apiDrift)), /API identity/u);
});

test('unsafe persistent/disposable cleanup targets fail closed', async () => {
  assert.throws(() => assertDisposableDatabaseName('nimi_dev'), /random N7 target/u);
  assert.throws(() => assertDisposableDatabaseName('nimi_realm_v3_n7_shared'), /random N7 target/u);
  await assert.rejects(
    () => assertSafeStateDirectoryTarget('/tmp/not-random', []),
    /basename is not an admitted random N7 target/u,
  );
  const safeParent = await mkdtemp(path.join(tmpdir(), 'realm-v3-safe-state-parent-'));
  try {
    const safe = path.join(safeParent, 'realm-v3-full-data-0011223344556677');
    assert.equal(await assertSafeStateDirectoryTarget(safe, []), path.join(await realpath(safeParent), path.basename(safe)));
  } finally {
    await rm(safeParent, { recursive: true, force: true });
  }
});

test('cleanup cannot delete arbitrary, symlinked, or renamed same-UID 0700 directories', async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'realm-v3-destructive-target-'));
  try {
    const arbitrary = path.join(fixtureRoot, 'arbitrary-private-directory');
    await mkdir(arbitrary, { mode: 0o700 });
    await assert.rejects(
      () => cleanupLiveEnvironment({ stateDirectory: arbitrary }),
      /basename is not an admitted random N7 target/u,
    );
    assert.equal((await lstat(arbitrary)).isDirectory(), true);

    const realTarget = path.join(fixtureRoot, 'real-target');
    await mkdir(realTarget, { mode: 0o700 });
    const linked = path.join(fixtureRoot, 'realm-v3-full-data-1111222233334444');
    await symlink(realTarget, linked, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(
      () => cleanupLiveEnvironment({ stateDirectory: linked }),
      /state-dir identity\/mode is invalid/u,
    );
    assert.equal((await lstat(realTarget)).isDirectory(), true);

    const original = path.join(fixtureRoot, 'realm-v3-full-data-5555666677778888');
    const renamed = path.join(fixtureRoot, 'realm-v3-full-data-9999aaaabbbbcccc');
    await mkdir(original, { mode: 0o700 });
    await writeFile(path.join(original, 'state.json'), '{}\n', { mode: 0o600 });
    await rename(original, renamed);
    await assert.rejects(() => cleanupLiveEnvironment({ stateDirectory: renamed }));
    assert.equal((await lstat(renamed)).isDirectory(), true);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('historical N6 baseline proves only immutable persistent 470/1 and fixed Persona identity', async () => {
  const nimiRoot = await mkdtemp(path.join(tmpdir(), 'realm-v3-n6-baseline-'));
  try {
    const evidencePath = path.join(
      nimiRoot,
      '.nimi',
      'local',
      'acceptance',
      '0717-realm-v3-consumer-hardcut',
      'N6',
      'current-realm-live.json',
    );
    await mkdir(path.dirname(evidencePath), { recursive: true });
    const databaseCounts = { worldCharacters: 470, personaCharacters: 1 };
    await writeFile(evidencePath, JSON.stringify({
      schemaVersion: 'nimi.realm-v3-current-realm-live-acceptance/v1',
      verdict: 'PASS',
      productFailures: 0,
      authority: {
        producerCommit: 'a30b2f488806e967ccba9ab8b81fe93935bdf474',
        producerTree: '3516b4727cbb17602d276e02755aeb36811ed2f2',
        accessPolicyDigest: '34f338ae76cbd85de58054cd6fc4d0ee18500030a0bc12f091e88d46f2fc572f',
      },
      sourceDatabase: {
        name: 'nimi_dev',
        unchanged: true,
        before: databaseCounts,
        after: databaseCounts,
      },
      isolationAndCleanup: {
        persistentSharedDatabaseWrites: 0,
        rootProductWrites: 0,
        nimiProductWritesByLiveHarness: 0,
      },
      sources: {
        personaCharacter: {
          sourceId: 'persona-character-0716-fullchain-fixture',
          ownerAccountId: '01J00000000000000000000000',
          worldId: 'cbdb-yuan-literati-academy-world',
          sourceHash: '5f00937ee6d7ac325c77d5c07a0b6c30d2ee0380fa15a8761dda4528562ed3d1',
          status: 'PASS',
        },
      },
    }));
    const baseline = await __test.readFrozenN6Baseline(await realpath(nimiRoot));
    assert.equal(baseline.evidenceClass, 'historical_dataset_identity_only');
    assert.match(baseline.sha256, /^[0-9a-f]{64}$/u);
    assert.equal(baseline.personaSourceRef.id, 'persona-character-0716-fullchain-fixture');
    assert.equal(baseline.personaSourceRef.ownerAccountId, '01J00000000000000000000000');
    assert.equal(
      baseline.personaSourceRefHash,
      domainHash('nimi.realm-v3-full-data-source-ref/v1', baseline.personaSourceRef),
    );
  } finally {
    await rm(nimiRoot, { recursive: true, force: true });
  }
});

test('prepared API/Redis recovery admits only stable generations and exact stopped Redis identity', () => {
  const intent = { imageIdentity: 'sha256:' + 'a'.repeat(64), environmentId: 'environment' };
  const recordedRedis = { id: 'b'.repeat(64), port: 43100 };
  assert.equal(__test.classifyPreparedRedisObservation({
    id: recordedRedis.id,
    running: true,
    imageIdentity: intent.imageIdentity,
    label: intent.environmentId,
    port: recordedRedis.port,
  }, intent, recordedRedis), 'healthy');
  assert.equal(__test.classifyPreparedRedisObservation({
    id: recordedRedis.id,
    running: false,
    imageIdentity: intent.imageIdentity,
    label: intent.environmentId,
    port: null,
  }, intent, recordedRedis), 'restart');
  assert.equal(__test.classifyPreparedRedisObservation(null, intent, recordedRedis), 'absent');
  assert.equal(__test.classifyPreparedRedisObservation({
    id: 'c'.repeat(64), running: true, imageIdentity: intent.imageIdentity,
    label: intent.environmentId, port: recordedRedis.port,
  }, intent, recordedRedis), 'foreign');

  const recordedAPI = { pid: 1234 };
  assert.equal(__test.classifyPreparedAPIObservation({
    recorded: recordedAPI,
    launch: { status: 'running', generation: 1 },
    markerPID: 1234,
    recordedProcessExists: true,
    identityMatches: true,
  }), 'healthy');
  assert.equal(__test.classifyPreparedAPIObservation({
    recorded: null,
    launch: { status: 'starting', generation: 2, pid: null, processIdentityDigest: null },
    markerPID: 5678,
    recordedProcessExists: false,
    identityMatches: false,
  }), 'adopt');
  assert.equal(__test.classifyPreparedAPIObservation({
    recorded: recordedAPI,
    launch: { status: 'running', generation: 1 },
    markerPID: 5678,
    recordedProcessExists: false,
    identityMatches: false,
  }), 'foreign');
  assert.equal(__test.classifyPreparedAPIObservation({
    recorded: recordedAPI,
    launch: { status: 'running', generation: 1 },
    markerPID: null,
    recordedProcessExists: false,
    identityMatches: false,
  }), 'restart');
});

test('runtime dependency closure binds same-path bytes and rejects export-escaping symlinks', async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'realm-v3-runtime-closure-'));
  try {
    const exportRoot = path.join(fixtureRoot, 'export');
    const producerAPIPackageRelativeRoot = 'producer-api';
    const producerAPIPackageRoot = path.join(exportRoot, producerAPIPackageRelativeRoot);
    const apiRoot = path.join(producerAPIPackageRoot, 'dist', 'apps', 'api');
    const backendModulesRoot = path.join(producerAPIPackageRoot, 'node_modules');
    const modulesRoot = path.join(exportRoot, 'node_modules');
    const tsxRoot = path.join(modulesRoot, '.pnpm', 'tsx@fixture', 'node_modules', 'tsx');
    const pgRoot = path.join(modulesRoot, '.pnpm', 'pg@fixture', 'node_modules', 'pg');
    await mkdir(apiRoot, { recursive: true });
    await mkdir(backendModulesRoot, { recursive: true });
    await mkdir(tsxRoot, { recursive: true });
    await mkdir(pgRoot, { recursive: true });
    await writeFile(
      path.join(producerAPIPackageRoot, 'package.json'),
      '{"name":"@nimi/backend"}\n',
    );
    await writeFile(path.join(apiRoot, 'main.js'), 'export const build = 1;\n');
    await writeFile(path.join(tsxRoot, 'package.json'), '{"name":"tsx"}\n');
    await writeFile(path.join(pgRoot, 'package.json'), '{"name":"pg"}\n');
    await symlink(
      process.platform === 'win32' ? tsxRoot : path.relative(modulesRoot, tsxRoot),
      path.join(modulesRoot, 'tsx'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const first = await __test.runtimeDependencyClosureManifest(
      exportRoot,
      producerAPIPackageRelativeRoot,
    );
    await writeFile(path.join(apiRoot, 'main.js'), 'export const build = 2;\n');
    const second = await __test.runtimeDependencyClosureManifest(
      exportRoot,
      producerAPIPackageRelativeRoot,
    );
    assert.notEqual(first.digest, second.digest);
    assert.ok(first.fileCount >= 3);
    assert.equal(first.symlinkCount, 1);

    if (process.platform !== 'win32') {
      const outside = path.join(fixtureRoot, 'outside.js');
      await writeFile(outside, 'outside\n');
      await symlink(outside, path.join(modulesRoot, 'escape'));
      await assert.rejects(
        () => __test.runtimeDependencyClosureManifest(
          exportRoot,
          producerAPIPackageRelativeRoot,
        ),
        /escapes the fixed Realm export/u,
      );
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('run-lock and close-candidate bindings reject wrong run/candidate digests', () => {
  const attestation = liveAttestation();
  const lock = runLock();
  assert.equal(validateRunLockBinding(lock), lock);
  const candidate = closeCandidate(lock, attestation);
  assert.equal(validateCloseCandidateBinding(candidate, lock.inputDigest, attestation.contentHash), candidate);

  const wrongRun = structuredClone(candidate);
  wrongRun.inputDigest = sha256Hex('wrong-run');
  delete wrongRun.contentHash;
  wrongRun.contentHash = domainHash(CLOSE_CANDIDATE_SCHEMA, wrongRun);
  assert.throws(
    () => validateCloseCandidateBinding(wrongRun, lock.inputDigest, attestation.contentHash),
    /identity\/verdict binding/u,
  );

  const wrongAggregate = structuredClone(candidate);
  wrongAggregate.aggregateCandidateDigest = 'not-a-digest';
  assert.throws(
    () => validateCloseCandidateBinding(wrongAggregate, lock.inputDigest, attestation.contentHash),
    /aggregateCandidateDigest/u,
  );
});

test('cleanup receipt is closed, content-hashed, and proves zero residue', () => {
  const attestation = liveAttestation();
  const lock = runLock();
  const candidate = closeCandidate(lock, attestation);
  const boundaryDigest = sha256Hex('write-boundary');
  const receipt = buildCleanupReceipt({
    attestation,
    runInputDigest: lock.inputDigest,
    closeCandidateDigest: candidate.contentHash,
    api: { stopped: true, pidAbsent: true, processIdentityDigest: sha256Hex('api-process') },
    disposableDatabase: { databaseNameHash: sha256Hex(disposableDatabase), deleted: true, residue: 0 },
    redis: { keysBeforeCleanup: 3, keysAfterCleanup: 0, removed: true, containerResidue: 0 },
    temporaryResidue: { export: 0, state: 0, custody: 0, keyMaterial: 0, apiProcess: 0 },
    persistentParity: {
      database: 'nimi_dev',
      snapshotDigestBefore: sha256Hex('persistent'),
      snapshotDigestAfter: sha256Hex('persistent'),
      worldCharactersBefore: 470,
      worldCharactersAfter: 470,
      personaCharactersBefore: 1,
      personaCharactersAfter: 1,
      unchanged: true,
      readOnly: true,
    },
    writeBoundary: {
      rootWrites: 0,
      nimiWrites: 0,
      appsWrites: 0,
      beforeDigest: boundaryDigest,
      afterDigest: boundaryDigest,
      unchanged: true,
    },
  });
  assert.equal(receipt.schemaVersion, CLEANUP_SCHEMA);
  assert.equal(
    validateLiveEnvironmentCleanupReceipt(receipt, {
      environmentAttestationDigest: attestation.contentHash,
      runInputDigest: lock.inputDigest,
      closeCandidateDigest: candidate.contentHash,
    }),
    receipt,
  );
  assert.throws(
    () => validateLiveEnvironmentCleanupReceipt(receipt, {
      environmentAttestationDigest: attestation.contentHash,
      runInputDigest: sha256Hex('wrong-run'),
      closeCandidateDigest: candidate.contentHash,
    }),
    /identity binding/u,
  );
  const tampered = structuredClone(receipt);
  tampered.temporaryResidue.state = 1;
  delete tampered.contentHash;
  tampered.contentHash = domainHash(CLEANUP_SCHEMA, tampered);
  assert.throws(
    () => validateLiveEnvironmentCleanupReceipt(tampered, {
      environmentAttestationDigest: attestation.contentHash,
      runInputDigest: lock.inputDigest,
      closeCandidateDigest: candidate.contentHash,
    }),
    /zero residue/u,
  );
});

test('canonical helper remains deterministic for runner reuse', () => {
  assert.equal(canonicalJSONStringify({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(domainHash('fixture/v1', { b: 2, a: 1 }), domainHash('fixture/v1', { a: 1, b: 2 }));
});

test('private state directory resumes without EEXIST and rejects mode/symlink targets', async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'realm-v3-state-fixture-'));
  try {
    const state = path.join(fixtureRoot, 'realm-v3-full-data-0123456789abcdef');
    await __test.ensurePrivateDirectory(state);
    await __test.ensurePrivateDirectory(state);
    if (process.platform !== 'win32') {
      await chmod(state, 0o755);
      await assert.rejects(() => __test.ensurePrivateDirectory(state), /mode must be exactly 0700/u);
    }

    const target = path.join(fixtureRoot, 'real-target');
    await mkdir(target, { mode: 0o700 });
    const linked = path.join(fixtureRoot, 'realm-v3-full-data-fedcba9876543210');
    await symlink(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(() => __test.ensurePrivateDirectory(linked), /not a real directory/u);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('private durable JSON writes enforce 0600 and refuse a mode-drifted target', async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'realm-v3-durable-json-'));
  try {
    await chmod(fixtureRoot, 0o700);
    const target = path.join(fixtureRoot, 'state.json');
    await __test.writePrivateJSON(target, { sequence: 1 });
    await __test.writePrivateJSON(target, { sequence: 2 });
    const info = await lstat(target);
    if (process.platform !== 'win32') assert.equal(info.mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), { sequence: 2 });
    if (process.platform !== 'win32') {
      await chmod(target, 0o644);
      await assert.rejects(() => __test.writePrivateJSON(target, { sequence: 3 }), /mode must be exactly 0600/u);
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('cleanup refuses an unbound marker process when recorded API PID disappeared', async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'realm-v3-api-recovery-'));
  let child;
  try {
    const entry = path.join(fixtureRoot, 'marker-api.mjs');
    await writeFile(entry, 'setInterval(() => {}, 1000);\n');
    const marker = 'realm-v3-full-data-api-0123456789abcdef0123456789abcdef';
    child = spawn(process.execPath, [entry, `--realm-v3-full-data-environment=${marker}`], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    await assert.rejects(() => __test.cleanupAPIFromDurableIntent({
      api: {
        pid: 2_147_483_000,
        processIdentity: { digest: sha256Hex('lost-recorded-api') },
      },
      resources: {
        apiIntent: {
          entry,
          marker,
          intentDigest: sha256Hex('api-intent'),
        },
      },
    }), /not an adoptable durable launch/u);
    assert.doesNotThrow(() => process.kill(child.pid, 0));
  } finally {
    if (child?.pid) {
      try {
        process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL');
      } catch { /* already absent */ }
    }
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('attestation/cleanup outputs are confined to canonical Nimi N7 evidence with no symlink ancestors', async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'realm-v3-output-fixture-'));
  try {
    const rootRealm = path.join(fixtureRoot, 'root-realm');
    const evidence = path.join(
      rootRealm,
      'nimi',
      '.nimi',
      'local',
      'acceptance',
      '0717-realm-v3-consumer-hardcut',
      'N7',
      'run-001',
    );
    await mkdir(evidence, { recursive: true, mode: 0o700 });
    const admitted = path.join(evidence, 'live-environment-attestation.json');
    assert.equal(
      await assertAdmittedEvidenceOutput(rootRealm, admitted, 'live-environment-attestation.json'),
      path.join(await realpath(evidence), 'live-environment-attestation.json'),
    );
    await assert.rejects(
      () => assertAdmittedEvidenceOutput(
        rootRealm,
        path.join(rootRealm, 'nimi', 'package.json'),
        'live-environment-attestation.json',
      ),
      /must be live-environment-attestation.json/u,
    );
    await assert.rejects(
      () => assertAdmittedEvidenceOutput(
        rootRealm,
        path.join(rootRealm, 'nimi-apps', 'live-environment-attestation.json'),
        'live-environment-attestation.json',
      ),
      /below/u,
    );

    const foreign = path.join(fixtureRoot, 'foreign');
    await mkdir(foreign);
    const link = path.join(path.dirname(evidence), 'linked-run');
    await symlink(foreign, link, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(
      () => assertAdmittedEvidenceOutput(
        rootRealm,
        path.join(link, 'live-environment-attestation.json'),
        'live-environment-attestation.json',
      ),
      /symlink\/non-directory ancestor/u,
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
