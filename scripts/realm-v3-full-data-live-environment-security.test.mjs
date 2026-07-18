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
test('resource intents precede creates and cleanup pending receipt precedes state removal', async () => {
  const source = await readLiveHarnessSource();
  for (const [intent, create] of [
    ['state.resources.databaseIntent ??= declaredDatabaseIntent', 'await createDisposableClone('],
    ['state.resources.redisIntent ??= redisIntent', 'const observedRedis = await startRedis('],
    ['state.resources.apiIntent ??= apiIntent', 'state.api = await startAPI('],
  ]) {
    assert.ok(source.indexOf(intent) >= 0, `${intent} missing`);
    const createIndex = source.indexOf(create, source.indexOf(intent));
    assert.ok(createIndex > source.indexOf(intent), `${create} must follow durable ${intent}`);
    const persisted = source.indexOf('await writePrivateJSON(statePath, state);', source.indexOf(intent));
    assert.ok(persisted > source.indexOf(intent) && persisted < createIndex);
  }
  const pending = source.indexOf('await writePrivateJSON(pendingReceipt, receipt);');
  const destructiveRevalidation = source.indexOf(
    'await revalidateStateDirectoryBeforeRemoval(options, state);',
    pending,
  );
  const remove = source.indexOf('await rm(options.stateDirectory', pending);
  const publish = source.indexOf('await durableRename(pendingReceipt, options.receiptOutput);', remove);
  assert.ok(
    pending >= 0 && destructiveRevalidation > pending &&
    remove > destructiveRevalidation && publish > remove,
  );
  const fileSync = source.indexOf('await handle.sync();');
  const atomicRename = source.indexOf('await durableRename(temporary, filePath);', fileSync);
  const parentSync = source.indexOf('await syncDirectory(path.dirname(target));', atomicRename);
  assert.ok(fileSync >= 0 && atomicRename > fileSync && parentSync > atomicRename);
  assert.match(source, /cleanupPartialLiveEnvironment/u);
});

test('census SQL fixes pg_catalog search_path/role and schema-qualifies all product tables', async () => {
  const census = await readFile(new URL('./realm-v3-full-data-census-worker.mjs', import.meta.url), 'utf8');
  const harness = await readLiveHarnessSource();
  for (const source of [census, harness]) {
    assert.match(source, /SET LOCAL search_path TO pg_catalog;/u);
    assert.match(source, /public\.world_character_cores/u);
    assert.match(source, /public\.persona_character_cores/u);
    assert.doesNotMatch(source, /FROM world_character_cores/u);
    assert.doesNotMatch(source, /FROM persona_character_cores/u);
    assert.match(source, /currentUser/u);
    assert.match(source, /sessionUser/u);
  }
});

test('write boundary detects same-path tracked content and untracked content/mode mutation', async () => {
  const repository = await mkdtemp(path.join(tmpdir(), 'nimi-realm-v3-boundary-'));
  try {
    execFileSync('git', ['init', '-q', repository]);
    execFileSync('git', ['-C', repository, 'config', 'user.name', 'N7 Fixture']);
    execFileSync('git', ['-C', repository, 'config', 'user.email', 'n7@example.invalid']);
    await writeFile(path.join(repository, 'tracked.txt'), 'baseline\n');
    execFileSync('git', ['-C', repository, 'add', 'tracked.txt']);
    execFileSync('git', ['-C', repository, 'commit', '-qm', 'fixture baseline']);

    await writeFile(path.join(repository, 'tracked.txt'), 'dirty-one\n');
    await writeFile(path.join(repository, 'untracked.txt'), 'untracked-one\n', { mode: 0o600 });
    const first = await __test.captureRepositoryBoundary(repository, 'fixture');
    await writeFile(path.join(repository, 'tracked.txt'), 'dirty-two\n');
    await writeFile(path.join(repository, 'untracked.txt'), 'untracked-two\n');
    const contentChanged = await __test.captureRepositoryBoundary(repository, 'fixture');
    assert.equal(first.statusDigest, contentChanged.statusDigest);
    assert.notEqual(first.trackedBinaryDiffDigest, contentChanged.trackedBinaryDiffDigest);
    assert.notEqual(first.untrackedPathContentModeDigest, contentChanged.untrackedPathContentModeDigest);

    await chmod(path.join(repository, 'untracked.txt'), 0o644);
    const modeChanged = await __test.captureRepositoryBoundary(repository, 'fixture');
    assert.equal(contentChanged.statusDigest, modeChanged.statusDigest);
    assert.notEqual(contentChanged.untrackedPathContentModeDigest, modeChanged.untrackedPathContentModeDigest);
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test('closed child registration binds CLI, module closure, census, native, Node, and tool identities', async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'nimi-realm-v3-wrapper-trust-'));
  try {
    const nimiRoot = path.join(fixtureRoot, 'nimi');
    const scripts = path.join(nimiRoot, 'scripts');
    const libraryRoot = path.join(scripts, 'lib');
    await mkdir(libraryRoot, { recursive: true, mode: 0o700 });
    const cli = path.join(scripts, 'realm-v3-full-data-live-environment.mjs');
    const census = path.join(scripts, 'realm-v3-full-data-census-worker.mjs');
    const native = path.join(fixtureRoot, 'partition-worker');
    const nativeSourcePath = path.join(fixtureRoot, 'partition-worker.go');
    const registrationPath = path.join(fixtureRoot, 'children.json');
    const cliSource = '#!/usr/bin/env node\n// fixture live CLI\n';
    const censusSource = '// fixture census worker\n';
    const nativeSource = 'package main\nfunc main() {}\n';
    await writeFile(cli, cliSource, { mode: 0o700 });
    await writeFile(census, censusSource, { mode: 0o600 });
    for (const name of LIVE_ENVIRONMENT_MODULE_BASENAMES) {
      await writeFile(path.join(libraryRoot, name), `// fixture ${name}\n`, { mode: 0o600 });
    }
    await writeFile(nativeSourcePath, nativeSource, { mode: 0o600 });
    execFileSync('go', ['build', '-o', native, nativeSourcePath], { stdio: 'pipe' });
    const canonicalNode = await realpath(process.execPath);
    const canonicalNative = await realpath(native);
    const registration = {
      schemaVersion: CHILD_REGISTRATION_SCHEMA,
      tools: Object.fromEntries(
        trustedToolNames.map((name) => [name, name === 'go' ? fixtureGoExecutable : canonicalNative]),
      ),
      children: [
        {
          stage: 'census',
          kind: 'node_script',
          command: canonicalNode,
          script: await realpath(census),
          args: ['--fixture-census'],
        },
        {
          stage: 'partition',
          kind: 'native',
          command: canonicalNative,
          args: ['--fixture-partition'],
        },
      ],
    };
    registration.contentHash = domainHash(CHILD_REGISTRATION_SCHEMA, registration);
    await writeFile(registrationPath, `${canonicalJSONStringify(registration)}\n`, { mode: 0o600 });

    const initial = await __test.captureWrapperTrust(nimiRoot, registrationPath);
    assert.equal(initial.registration.children.length, 2);
    assert.doesNotMatch(canonicalJSONStringify(initial.sanitized), new RegExp(fixtureRoot, 'u'));

    await writeFile(cli, `${cliSource}// drift\n`);
    const cliDrift = await __test.captureWrapperTrust(nimiRoot, registrationPath);
    assert.notEqual(initial.sanitized.wrapperIdentityDigest, cliDrift.sanitized.wrapperIdentityDigest);
    await writeFile(cli, cliSource);

    await writeFile(census, `${censusSource}// drift\n`);
    const censusDrift = await __test.captureWrapperTrust(nimiRoot, registrationPath);
    assert.notEqual(initial.sanitized.wrapperIdentityDigest, censusDrift.sanitized.wrapperIdentityDigest);
    await writeFile(census, censusSource);

    const driftedModuleName = LIVE_ENVIRONMENT_MODULE_BASENAMES[2];
    const driftedModulePath = path.join(libraryRoot, driftedModuleName);
    await writeFile(driftedModulePath, `// drifted ${driftedModuleName}\n`);
    const moduleDrift = await __test.captureWrapperTrust(nimiRoot, registrationPath);
    assert.notEqual(initial.sanitized.wrapperIdentityDigest, moduleDrift.sanitized.wrapperIdentityDigest);
    await writeFile(driftedModulePath, `// fixture ${driftedModuleName}\n`);

    const nativeBytes = await readFile(native);
    await writeFile(native, Buffer.concat([nativeBytes, Buffer.from('drift')]));
    const nativeDrift = await __test.captureWrapperTrust(nimiRoot, registrationPath);
    assert.notEqual(initial.sanitized.wrapperIdentityDigest, nativeDrift.sanitized.wrapperIdentityDigest);
    await writeFile(native, nativeBytes);

    const wrongNode = structuredClone(registration);
    wrongNode.children[0].command = await realpath(native);
    delete wrongNode.contentHash;
    wrongNode.contentHash = domainHash(CHILD_REGISTRATION_SCHEMA, wrongNode);
    await assert.rejects(
      () => validateLiveChildRegistration(wrongNode, {
        wrapper: initial,
        nimiRoot,
      }),
      /canonical Node executable/u,
    );

    await chmod(native, 0o722);
    await assert.rejects(
      () => __test.captureWrapperTrust(nimiRoot, registrationPath),
      /group\/world writable/u,
    );

    const libraryFixture = path.join(fixtureRoot, 'library.mjs');
    await writeFile(libraryFixture, '// library one\n', { mode: 0o600 });
    const libraryBefore = await __test.captureTrustedFileIdentity(libraryFixture, 'fixture library');
    await writeFile(libraryFixture, '// library two\n');
    const libraryAfter = await __test.captureTrustedFileIdentity(libraryFixture, 'fixture library');
    assert.notEqual(libraryBefore.sanitized.identityDigest, libraryAfter.sanitized.identityDigest);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('execution receipt is sanitized, content-hashed, and closed over pre/post identity', () => {
  const wrapperIdentityDigest = sha256Hex('wrapper');
  const childIdentityDigest = sha256Hex('child');
  const receipt = {
    schemaVersion: EXECUTION_RECEIPT_SCHEMA,
    status: 'PASS',
    reasonCode: 'passed',
    environmentAttestationDigest: sha256Hex('attestation'),
    wrapperIdentityDigest,
    childRegistrationDigest: sha256Hex('registration'),
    stage: 'partition',
    partitionIdHash: sha256Hex('live-materialize:0:partition-key'),
    executionReceiptPathHash: sha256Hex('/sanitized/path'),
    childIdentityDigest,
    argsDigest: sha256Hex('args'),
    exitCode: 0,
    signal: null,
    preExecutionWrapperIdentityDigest: wrapperIdentityDigest,
    postExecutionWrapperIdentityDigest: wrapperIdentityDigest,
    preExecutionChildIdentityDigest: childIdentityDigest,
    postExecutionChildIdentityDigest: childIdentityDigest,
    apiProcessIntentDigest: sha256Hex('api-process-intent'),
    apiGeneration: 3,
    apiProcessIdentityDigest: sha256Hex('api-process-identity'),
    postExecutionAPIProcessIdentityDigest: sha256Hex('api-process-identity'),
    apiIdentityUnchanged: true,
    runtimeDependencyClosureDigest: sha256Hex('runtime-dependency-closure'),
    identityUnchanged: true,
  };
  receipt.contentHash = domainHash(EXECUTION_RECEIPT_SCHEMA, receipt);
  assert.equal(
    validateLiveEnvironmentExecutionReceipt(receipt, {
      environmentAttestationDigest: receipt.environmentAttestationDigest,
      stage: 'partition',
      partitionIdHash: receipt.partitionIdHash,
    }),
    receipt,
  );
  assert.doesNotMatch(canonicalJSONStringify(receipt), /sanitized\/path/u);

  const drift = structuredClone(receipt);
  drift.postExecutionChildIdentityDigest = sha256Hex('changed-child');
  drift.identityUnchanged = false;
  drift.status = 'FAIL';
  drift.reasonCode = 'identity_drift';
  drift.exitCode = 1;
  delete drift.contentHash;
  drift.contentHash = domainHash(EXECUTION_RECEIPT_SCHEMA, drift);
  assert.equal(validateLiveEnvironmentExecutionReceipt(drift), drift);

  const leaked = { ...receipt, commandPath: '/tmp/raw-worker' };
  assert.throws(() => validateLiveEnvironmentExecutionReceipt(leaked), /not a closed object/u);
});

test('exec verifies wrapper closure before custody and writes only an admitted durable receipt', async () => {
  const source = await readLiveHarnessSource();
  const execStart = source.indexOf('export async function execInLiveEnvironment');
  const trust = source.indexOf('const preTrust = await captureWrapperTrust', execStart);
  const custody = source.indexOf("await readJSON(state.credentials.custodyPath, 'credential custody')", execStart);
  const writeReceipt = source.indexOf('await writePrivateJSON(receiptOutput, receipt);', execStart);
  assert.ok(execStart >= 0 && trust > execStart && custody > trust && writeReceipt > custody);
  const execSource = source.slice(execStart, source.indexOf('export const __test', execStart));
  assert.match(execSource, /stdio: \['ignore', 'ignore', 'inherit'\]/u);
  assert.match(execSource, /exec refuses to overwrite an existing execution receipt/u);
  assert.match(execSource, /sanitizedChildBaseEnvironment\(\)/u);
  assert.doesNotMatch(execSource, /\.\.\.process\.env/u);
});

test('interrupted Persona recovery reruns 0 and replaces inherited/existing fixed Persona', async () => {
  assert.equal(__test.classifyInterruptedPersonaRecovery([]), 'rerun');
  assert.equal(
    __test.classifyInterruptedPersonaRecovery([{
      kind: 'personaCharacter',
      id: 'persona-character-0716-fullchain-fixture',
      worldId: 'world-fixture',
      sourceHash: sha256Hex('persona-source'),
      ownerAccountId: '01J00000000000000000000000',
    }]),
    'replace',
  );
  assert.throws(
    () => __test.classifyInterruptedPersonaRecovery([persona(1), persona(2)]),
    /conflicting rows/u,
  );
  assert.throws(
    () => __test.classifyInterruptedPersonaRecovery([{
      ...fixedPersona(),
      sourceHash: sha256Hex('wrong-fixed-persona'),
    }], fixedPersona()),
    /frozen N6 identity/u,
  );
  const source = await readLiveHarnessSource();
  const recoveryRead = source.indexOf('? [0, 1]');
  const replacementBranch = source.indexOf("['rerun', 'replace'].includes(interruptedPersonaRecovery)");
  assert.ok(recoveryRead >= 0 && replacementBranch > recoveryRead);
  assert.match(source, /state\.resources\.personaIntent \?\?= personaIntent/u);
  assert.match(source, /deletePersonaFixture/u);
});

test('new state directory and census receipt durably sync their publication parent', async () => {
  const harness = await readLiveHarnessSource();
  const census = await readFile(new URL('./realm-v3-full-data-census-worker.mjs', import.meta.url), 'utf8');
  const ensureStart = harness.indexOf('async function ensurePrivateDirectory');
  const ensureEnd = harness.indexOf('async function writePrivateJSON', ensureStart);
  assert.match(
    harness.slice(ensureStart, ensureEnd),
    /await syncDirectory\(path\.dirname\(directory\)\);/u,
  );
  assert.match(census, /await parent\.sync\(\);/u);
});

test('ambient injection is rejected and helper/API/census tools use the attested closed environment', async () => {
  for (const environment of [
    { NODE_OPTIONS: '--import=/tmp/evil.mjs' },
    { NODE_PATH: '/tmp/modules' },
    { DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib' },
    { HTTPS_PROXY: 'http://127.0.0.1:9' },
    { DATABASE_URL: 'postgresql://ambient.invalid/nimi' },
  ]) {
    assert.throws(() => __test.assertNoAmbientChildInjection(environment), /ambient child injection/u);
  }
  assert.doesNotThrow(() => __test.assertNoAmbientChildInjection({ LANG: 'C' }));

  const harness = await readLiveHarnessSource();
  const census = await readFile(new URL('./realm-v3-full-data-census-worker.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(harness, /env:\s*process\.env/u);
  assert.doesNotMatch(harness, /env:\s*\{\s*\.\.\.process\.env/u);
  assert.match(
    harness,
    /closedProcessEnvironment\(credentials\.custody\.apiEnvironment, \{ allowDatabase: true \}\)/u,
  );
  assert.match(harness, /preTrust\.registration\.tools\.docker\.canonicalPath/u);
  assert.doesNotMatch(census, /execFileSync\('docker'/u);
  assert.match(census, /NIMI_REALM_V3_FULL_DOCKER_EXECUTABLE/u);
  assert.match(census, /attestation\.wrapper\.tools\.docker\.pathHash/u);
  for (const binding of [
    "HOME: '/var/empty'",
    "XDG_CONFIG_HOME: '/var/empty'",
    "GIT_CONFIG_GLOBAL: '/dev/null'",
    "GIT_CONFIG_NOSYSTEM: '1'",
    "NPM_CONFIG_USERCONFIG: '/dev/null'",
    "GOENV: 'off'",
  ]) assert.match(harness, new RegExp(binding.replaceAll('/', '\\/'), 'u'));
  assert.match(harness, /const storeArguments = \['--store-dir', dependency\.storeDirectory\]/u);
  assert.doesNotMatch(harness, /pnpmStoreDir|PNPM_HOME/u);
});

test('offline pnpm store is parsed only from absolute dependency .modules.yaml authority', () => {
  assert.equal(
    __test.parseOfflineStoreDirectory('{"storeDir":"/absolute/pnpm/store"}'),
    '/absolute/pnpm/store',
  );
  assert.equal(
    __test.parseOfflineStoreDirectory("storeDir: '/absolute/yaml/store'\n"),
    '/absolute/yaml/store',
  );
  assert.throws(
    () => __test.parseOfflineStoreDirectory('storeDir: relative/store\n'),
    /must be absolute/u,
  );
  assert.throws(
    () => __test.parseOfflineStoreDirectory('virtualStoreDir: /tmp/not-authority\n'),
    /exactly one storeDir/u,
  );
});
