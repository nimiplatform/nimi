import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  realpath,
  readdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import YAML from 'yaml';
import {
  validateLiveEnvironmentAttestationBinding,
  validateLiveEnvironmentCleanupReceipt,
  validateLiveEnvironmentExecutionReceipt,
} from './realm-v3-full-data-live-environment.mjs';

const HAS_POSIX_PERMISSION_BITS = process.platform !== 'win32' && typeof process.getuid === 'function';

import {
  ACCESS_POLICY_VERSION,
  AGGREGATE_SCHEMA,
  AUTHORIZATION_BOUNDARY,
  AUTHORIZATION_INPUTS,
  CAPTURE_INDEX_SCHEMA,
  CLOSE_CANDIDATE_SCHEMA,
  CONTRACT_EXACT_PATHS,
  CONTRACT_PATH_PATTERNS,
  FIRST_PARTY_AUTHORITY_CLASS,
  FIXED_PERSONA_SOURCE,
  FORBIDDEN_AUTHORIZATION_INPUTS,
  FullDataContractError,
  FULL_DATA_DENOMINATOR,
  FULL_DATA_STAGES,
  GIT_OBJECT_RE,
  MANIFEST_SCHEMA,
  PACKET_OPERATION,
  PACKET_SCHEMA,
  PARTITION_STAGES,
  PERSONA_CHARACTER_DENOMINATOR,
  PROGRESS_INTERVAL_MS,
  REASON_RE,
  RECEIPT_SCHEMA,
  RETIRED_AUTHORIZATION_ENDPOINTS,
  RETIRED_AUTHORIZATION_IDENTIFIERS,
  RUN_LOCK_SCHEMA,
  SAFE_ID_RE,
  SHA256_RE,
  SNAPSHOT_SCHEMA,
  SOURCE_CENSUS_SCHEMA,
  SOURCE_LANES,
  STAGE_REPORT_SCHEMA,
  WORLD_CHARACTER_DENOMINATOR,
  assertClosedObject,
  assertCount,
  assertEqual,
  assertExactKeys,
  assertGitObject,
  assertNoAmbientNodeInjection,
  assertSHA256,
  assertString,
  canonicalJSONStringify,
  canonicalPathThroughExistingAncestor,
  cleanupRuntimeDataRoot,
  cleanupRuntimeDataRootResumable,
  closedExecutionEnvironment,
  domainHash,
  ensurePrivateEvidenceDirectory,
  fail,
  git,
  gitBuffer,
  hashLengthFramed,
  hashUntrackedFiles,
  initializePreflightRuntimeDataRoot,
  initializeRuntimeDataRoot,
  readJSON,
  requireOwnedRuntimeDataRoot,
  sha256File,
  sha256Hex,
  syncDirectory,
  validateEvidenceDirectory,
  validateRuntimeDataRoot,
  writeJSONAtomic,
} from './realm-v3-full-data-contract.mjs';
function parseSourceRef(sourceRef, label = 'sourceRef') {
  assertClosedObject(
    sourceRef,
    ['kind', 'id', 'worldId', 'sourceHash'],
    ['worldEntityRef', 'ownerAccountId'],
    label,
  );
  const kind = assertString(sourceRef.kind, `${label}.kind`);
  const id = assertString(sourceRef.id, `${label}.id`);
  const worldId = assertString(sourceRef.worldId, `${label}.worldId`);
  const sourceHash = assertSHA256(sourceRef.sourceHash, `${label}.sourceHash`);
  if (kind === 'worldCharacter') {
    if (Object.hasOwn(sourceRef, 'ownerAccountId')) {
      fail('mixed_source_ref', `${label} mixes world and persona branches`);
    }
    assertClosedObject(
      sourceRef.worldEntityRef,
      ['kind', 'worldId', 'entityId'],
      [],
      `${label}.worldEntityRef`,
    );
    if (
      sourceRef.worldEntityRef.kind !== 'worldEntity' ||
      sourceRef.worldEntityRef.worldId !== worldId
    ) {
      fail('invalid_world_entity_ref', `${label}.worldEntityRef is invalid`);
    }
    assertString(sourceRef.worldEntityRef.entityId, `${label}.worldEntityRef.entityId`);
  } else if (kind === 'personaCharacter') {
    if (Object.hasOwn(sourceRef, 'worldEntityRef')) {
      fail('mixed_source_ref', `${label} mixes persona and world branches`);
    }
    assertString(sourceRef.ownerAccountId, `${label}.ownerAccountId`);
  } else {
    fail('invalid_source_kind', `${label}.kind is not admitted`);
  }
  return { kind, id, worldId, sourceHash, sourceRef };
}

function assertFixedPersonaSource(parsed, label) {
  assertEqual(
    parsed.sourceRef,
    FIXED_PERSONA_SOURCE,
    'persona_source_mismatch',
    label,
  );
}

function validateLiveEnvironmentProjection(environment) {
  assertClosedObject(
    environment,
    [
      'canonicalRealmBaseURL',
      'canonicalTokenURL',
      'expectedIssuer',
      'materializerAccountIdHash',
      'serverExportAttestationDigest',
      'disposableSourceInstanceDigest',
      'apiProcessIntentDigest',
      'apiEntrySha256',
      'runtimeDependencyClosureDigest',
    ],
    [],
    'live environment projection',
  );
  for (const field of [
    'materializerAccountIdHash',
    'serverExportAttestationDigest',
    'disposableSourceInstanceDigest',
    'apiProcessIntentDigest',
    'apiEntrySha256',
    'runtimeDependencyClosureDigest',
  ]) {
    assertSHA256(environment[field], `live environment projection.${field}`);
  }
  let base;
  let token;
  try {
    base = new URL(environment.canonicalRealmBaseURL);
    token = new URL(environment.canonicalTokenURL);
  } catch (error) {
    fail('invalid_live_environment', `live environment URL is invalid: ${error.message}`);
  }
  const canonicalBase = base.origin;
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username !== '' ||
    base.password !== '' ||
    base.pathname !== '/' ||
    base.search !== '' ||
    base.hash !== '' ||
    environment.canonicalRealmBaseURL !== canonicalBase ||
    token.origin !== base.origin ||
    token.username !== '' ||
    token.password !== '' ||
    token.pathname !== '/api/auth/oauth/token' ||
    token.search !== '' ||
    token.hash !== '' ||
    environment.canonicalTokenURL !== `${canonicalBase}/api/auth/oauth/token` ||
    environment.expectedIssuer !== canonicalBase
  ) {
    fail('invalid_live_environment', 'live environment authority URLs and issuer are not canonical and same-origin');
  }
  return environment;
}

function parseLock(lock) {
  assertClosedObject(
    lock,
    [
      'schema_version',
      'generated_by',
      'realm',
      'openapi',
      'schema_versions',
      'source_ref',
      'published_limits',
      'access_policy',
      'compact_vectors',
      'producer_admission',
    ],
    [],
    'realm contract lock',
  );
  if (lock.schema_version !== 'nimi.realm-contract-lock/v4') {
    fail('wrong_contract_lock_schema', 'Realm contract lock is not v4');
  }
  assertGitObject(lock.realm.commit, 'lock.realm.commit');
  assertGitObject(lock.realm.tree, 'lock.realm.tree');
  assertSHA256(lock.openapi.document_sha256, 'lock.openapi.document_sha256');
  assertSHA256(lock.openapi.fragment_sha256, 'lock.openapi.fragment_sha256');
  assertSHA256(lock.openapi.operation_inventory_sha256, 'lock.openapi.operation_inventory_sha256');
  if (lock.schema_versions.packet !== PACKET_SCHEMA) {
    fail('wrong_packet_schema', 'Realm contract lock does not admit Packet v3');
  }
  if (lock.access_policy.version !== ACCESS_POLICY_VERSION) {
    fail('wrong_access_policy_version', 'Realm access policy version is not current');
  }
  assertSHA256(lock.access_policy.digest, 'lock.access_policy.digest');
  if (
    lock.access_policy.authority_class !== FIRST_PARTY_AUTHORITY_CLASS ||
    lock.access_policy.third_party_app_permission_required !== false ||
    lock.access_policy.permission_catalog !== 'empty'
  ) {
    fail('wrong_authorization_boundary', 'Realm access policy is not the admitted first-party no-permission operation');
  }
  assertEqual(lock.access_policy.packet_operation, PACKET_OPERATION, 'wrong_packet_operation', 'Realm Packet operation');
  assertEqual(lock.access_policy.authorization_inputs, AUTHORIZATION_INPUTS, 'wrong_authorization_inputs', 'Realm authorization inputs');
  assertEqual(lock.access_policy.forbidden_inputs, FORBIDDEN_AUTHORIZATION_INPUTS, 'wrong_forbidden_inputs', 'Realm forbidden authorization inputs');
  if (
    lock.producer_admission?.tracked_only !== true ||
    lock.producer_admission?.head_policy !== 'identical_admitted_inputs'
  ) {
    fail('wrong_producer_admission', 'Realm producer admission is not tracked-only identical-input authority');
  }
  assertSHA256(
    lock.producer_admission.semantic_file_bundle_sha256,
    'lock.producer_admission.semantic_file_bundle_sha256',
  );
  for (const [name, digest] of Object.entries(lock.compact_vectors)) {
    assertSHA256(digest, `lock.compact_vectors.${name}`);
  }
  return lock;
}

async function contractPathInventory(nimiRoot) {
  const listed = git(nimiRoot, ['ls-files', '--cached', '--others', '--exclude-standard'])
    .split('\n')
    .filter(Boolean);
  const selected = listed
    .filter((entry) =>
      CONTRACT_EXACT_PATHS.includes(entry) || CONTRACT_PATH_PATTERNS.some((pattern) => pattern.test(entry)),
    )
    .sort();
  for (const required of CONTRACT_EXACT_PATHS) {
    if (!selected.includes(required)) {
      fail('missing_contract_input', `consumer contract input ${required} is missing`);
    }
  }
  const rows = [];
  for (const relativePath of selected) {
    const absolutePath = path.join(nimiRoot, relativePath);
    const info = await stat(absolutePath);
    if (!info.isFile()) {
      fail('invalid_contract_input', `${relativePath} is not a regular file`);
    }
    rows.push({ path: relativePath, sha256: await sha256File(absolutePath), bytes: info.size });
  }
  return rows;
}

async function currentGitIdentity(nimiRoot) {
  const status = gitBuffer(nimiRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']);
  const trackedDiff = gitBuffer(nimiRoot, ['diff', '--binary', 'HEAD', '--', '.']);
  const untrackedList = gitBuffer(nimiRoot, ['ls-files', '--others', '--exclude-standard', '-z', '--', '.']);
  const untracked = await hashUntrackedFiles(nimiRoot, untrackedList);
  const commit = git(nimiRoot, ['rev-parse', 'HEAD']);
  const tree = git(nimiRoot, ['rev-parse', 'HEAD^{tree}']);
  return {
    branch: git(nimiRoot, ['branch', '--show-current']),
    commit,
    tree,
    statusDigest: sha256Hex(status),
    trackedDiffDigest: sha256Hex(trackedDiff),
    untrackedCount: untracked.count,
    untrackedContentDigest: untracked.digest,
    worktreeDigest: hashLengthFramed(
      commit,
      tree,
      status,
      trackedDiff,
      untrackedList,
      untracked.digest,
    ),
    clean: status.length === 0,
  };
}

async function resolveWorkerExecutable(nimiRoot, command, label) {
  void nimiRoot;
  if (
    typeof command !== 'string' ||
    command.trim() !== command ||
    command.length === 0 ||
    command.includes('\0') ||
    !path.isAbsolute(command)
  ) {
    fail('invalid_worker_identity', `${label} executable must be an absolute canonical path`);
  }
  const selected = path.resolve(command);
  let info;
  let resolved;
  try {
    info = await lstat(selected);
    resolved = await realpath(selected);
  } catch (error) {
    fail('missing_worker_executable', `${label} executable is unavailable: ${error.message}`);
  }
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    resolved !== selected ||
    (HAS_POSIX_PERMISSION_BITS && (info.mode & 0o111) === 0) ||
    (HAS_POSIX_PERMISSION_BITS && (info.mode & 0o022) !== 0) ||
    (HAS_POSIX_PERMISSION_BITS && ![0, process.getuid()].includes(info.uid))
  ) {
    fail(
      'invalid_worker_identity',
      `${label} executable must be trusted, non-writable by group/other, regular, executable, and free of symlink traversal`,
    );
  }
  return { path: resolved, info };
}

async function buildWorkerInputIdentity(inputPaths, label) {
  if (!Array.isArray(inputPaths)) {
    fail('invalid_worker_identity', `${label} input files are invalid`);
  }
  const rows = [];
  const seen = new Set();
  for (const value of inputPaths) {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value.trim() !== value ||
      value.includes('\0') ||
      !path.isAbsolute(value)
    ) {
      fail('invalid_worker_identity', `${label} input file must be an absolute canonical path`);
    }
    const resolved = path.resolve(value);
    let info;
    let canonical;
    try {
      info = await lstat(resolved);
      canonical = await realpath(resolved);
    } catch (error) {
      fail('missing_worker_input', `${label} input file is unavailable: ${error.message}`);
    }
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      canonical !== resolved ||
      seen.has(canonical) ||
      (HAS_POSIX_PERMISSION_BITS && (info.mode & 0o022) !== 0) ||
      (HAS_POSIX_PERMISSION_BITS && ![0, process.getuid()].includes(info.uid))
    ) {
      fail(
        'invalid_worker_identity',
        `${label} input file must be trusted, non-writable by group/other, unique, regular, and free of symlink traversal`,
      );
    }
    seen.add(canonical);
    rows.push({
      path: canonical,
      sha256: await sha256File(canonical),
      bytes: info.size,
      mode: info.mode & 0o777,
      uid: info.uid,
    });
  }
  return rows.sort((left, right) => left.path.localeCompare(right.path));
}

async function buildWorkerIdentity({
  nimiRoot,
  command,
  args,
  childExecutablePath = null,
  inputPaths = [],
  label,
  implementationSourceDigest,
}) {
  if (!Array.isArray(args) || args.some((value) => typeof value !== 'string' || value.includes('\0'))) {
    fail('invalid_worker_identity', `${label} arguments are invalid`);
  }
  const executable = await resolveWorkerExecutable(nimiRoot, command, label);
  let childExecutable = null;
  let childArgumentsDigest = null;
  if (childExecutablePath !== null) {
    childExecutable = await resolveWorkerExecutable(
      nimiRoot,
      childExecutablePath,
      `${label} child`,
    );
    const separators = args
      .map((value, index) => (value === '--' ? index : -1))
      .filter((index) => index >= 0);
    if (
      separators.length !== 1 ||
      separators[0] + 1 >= args.length ||
      args[separators[0] + 1] !== childExecutable.path
    ) {
      fail(
        'invalid_worker_identity',
        `${label} arguments do not execute the frozen child immediately after the unique -- separator`,
      );
    }
    const childArguments = args.slice(separators[0] + 2);
    for (const inputPath of inputPaths) {
      if (!childArguments.includes(inputPath)) {
        fail('invalid_worker_identity', `${label} frozen input is not present in the actual child arguments`);
      }
    }
    childArgumentsDigest = domainHash(
      'nimi.realm-v3-full-data-worker-child-args/v1',
      childArguments,
    );
  } else if (inputPaths.length > 0) {
    fail('invalid_worker_identity', `${label} transitive inputs require an explicit child executable`);
  }
  return {
    executablePath: executable.path,
    executableSha256: await sha256File(executable.path),
    executableBytes: executable.info.size,
    executableMode: executable.info.mode & 0o777,
    executableUID: executable.info.uid,
    argsCount: args.length,
    argsDigest: domainHash('nimi.realm-v3-full-data-worker-args/v1', args),
    childExecutable: childExecutable
      ? {
          path: childExecutable.path,
          sha256: await sha256File(childExecutable.path),
          bytes: childExecutable.info.size,
          mode: childExecutable.info.mode & 0o777,
          uid: childExecutable.info.uid,
          argumentsDigest: childArgumentsDigest,
        }
      : null,
    inputFiles: await buildWorkerInputIdentity(inputPaths, label),
    implementationSourceDigest,
  };
}

function validateLiveWorkerArgumentTemplate(args, stage, label) {
  const separator = args.indexOf('--');
  if (separator < 0 || args.indexOf('--', separator + 1) >= 0) {
    fail('invalid_worker_identity', `${label} must contain one child separator`);
  }
  const wrapperArgs = args.slice(0, separator);
  const readOption = (name) => {
    const indexes = wrapperArgs
      .map((value, index) => (value === name ? index : -1))
      .filter((index) => index >= 0);
    if (indexes.length !== 1 || indexes[0] + 1 >= wrapperArgs.length) {
      fail('invalid_worker_identity', `${label} ${name} binding is not exact`);
    }
    return wrapperArgs[indexes[0] + 1];
  };
  if (
    wrapperArgs[0] !== 'exec' ||
    readOption('--stage') !== stage ||
    readOption('--partition') !== '{partition}' ||
    readOption('--execution-receipt-out') !== '{executionReceipt}' ||
    wrapperArgs.filter((value) => value === '{partition}').length !== 1 ||
    wrapperArgs.filter((value) => value === '{executionReceipt}').length !== 1
  ) {
    fail('invalid_worker_identity', `${label} wrapper template is not closed over execution evidence`);
  }
  return args;
}

function liveExecutionReceiptBindingDigest(receipt) {
  return domainHash('nimi.realm-v3-full-data-live-execution-binding/v1', {
    environmentAttestationDigest: receipt.environmentAttestationDigest,
    wrapperIdentityDigest: receipt.wrapperIdentityDigest,
    childRegistrationDigest: receipt.childRegistrationDigest,
    stage: receipt.stage,
    partitionIdHash: receipt.partitionIdHash,
    childIdentityDigest: receipt.childIdentityDigest,
    argsDigest: receipt.argsDigest,
  });
}

function liveExecutionStableAuthority(liveEnvironment) {
  if (!liveEnvironment) {
    fail('invalid_live_environment', 'live execution authority is unavailable');
  }
  return {
    apiProcessIntentDigest: liveEnvironment.apiProcessIntentDigest,
    runtimeDependencyClosureDigest: liveEnvironment.runtimeDependencyClosureDigest,
  };
}

function materializeLiveWorkerArguments(template, partitionID, executionReceiptPath) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/u.test(partitionID)) {
    fail('invalid_worker_identity', 'live worker partition identity is unsafe');
  }
  return template.map((value) => {
    if (value === '{partition}') return partitionID;
    if (value === '{executionReceipt}') return executionReceiptPath;
    return value;
  });
}

async function loadLiveExecutionReceipt(receiptPath, expected) {
  const info = await lstat(receiptPath).catch((error) => {
    fail('missing_execution_receipt', `live wrapper execution receipt is unavailable: ${error.message}`);
  });
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (HAS_POSIX_PERMISSION_BITS && (info.mode & 0o077) !== 0) ||
    (HAS_POSIX_PERMISSION_BITS && info.uid !== process.getuid())
  ) {
    fail('invalid_execution_receipt', 'live wrapper execution receipt is not a private regular file');
  }
  let receipt;
  try {
    receipt = validateLiveEnvironmentExecutionReceipt(
      await readJSON(receiptPath, 'live wrapper execution receipt'),
      {
        ...expected,
        executionReceiptPathHash: sha256Hex(receiptPath),
      },
    );
  } catch (error) {
    if (error instanceof FullDataContractError) throw error;
    fail('invalid_execution_receipt', `live wrapper execution receipt failed validation: ${error.message}`);
  }
  return receipt;
}

async function findCaptureIndex(realmEvidence) {
  const packetWork = path.join(realmEvidence, 'packet-work');
  const firstLevel = (await readdir(packetWork, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packetWork, entry.name))
    .sort();
  const matches = [];
  for (const outer of firstLevel) {
    const secondLevel = (await readdir(outer, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(outer, entry.name))
      .sort();
    for (const inner of secondLevel) {
      const candidate = path.join(inner, 'packet-capture-index.json');
      try {
        const info = await stat(candidate);
        if (info.isFile()) matches.push(candidate);
      } catch {
        // Non-matching attempt directories are not capture indexes.
      }
    }
  }
  if (matches.length !== 1) {
    fail('capture_index_ambiguous', `expected exactly one capture index, found ${matches.length}`);
  }
  return matches[0];
}

export function validateSourceCensus(census, expectedIdentity) {
  assertClosedObject(
    census,
    [
      'schemaVersion',
      'status',
      'reasonCode',
      'producer',
      'nimi',
      'instanceDigest',
      'liveEnvironmentAttestationDigest',
      'persistentInstanceDigest',
      'disposableInstanceDigest',
      'persistentDatabase',
      'readOnlyPersistentCensus',
      'persistentMutationCount',
      'persistentWorldCharacters',
      'persistentPersonaCharacters',
      'disposableWorldCharacters',
      'disposablePersonaCharacters',
      'worldParity',
      'personaProvisioningAttestationDigest',
      'sourceCount',
      'worldCharacters',
      'personaCharacters',
      'sources',
      'contentHash',
    ],
    [],
    'live source census',
  );
  if (census.schemaVersion !== SOURCE_CENSUS_SCHEMA || census.status !== 'PASS' || census.reasonCode !== 'passed') {
    fail('live_census_failed', 'live source census is not a passing current receipt');
  }
  assertEqual(census.producer, expectedIdentity.realm, 'identity_mismatch', 'live census Realm identity');
  assertEqual(census.nimi, expectedIdentity.nimi, 'identity_mismatch', 'live census Nimi identity');
  assertSHA256(census.instanceDigest, 'live census instanceDigest');
  for (const field of [
    'liveEnvironmentAttestationDigest',
    'persistentInstanceDigest',
    'disposableInstanceDigest',
    'personaProvisioningAttestationDigest',
  ]) {
    assertSHA256(census[field], `live census ${field}`);
  }
  if (
    expectedIdentity.liveEnvironmentAttestationDigest &&
    census.liveEnvironmentAttestationDigest !== expectedIdentity.liveEnvironmentAttestationDigest
  ) {
    fail('identity_mismatch', 'live census does not belong to the frozen environment attestation');
  }
  assertClosedObject(
    census.worldParity,
    [
      'count',
      'sourceRefsExact',
      'sourceHashesExact',
      'persistentWorldSourceSetDigest',
      'disposableWorldSourceSetDigest',
    ],
    [],
    'live census worldParity',
  );
  assertSHA256(census.worldParity.persistentWorldSourceSetDigest, 'live census persistent World set digest');
  assertSHA256(census.worldParity.disposableWorldSourceSetDigest, 'live census disposable World set digest');
  if (
    census.persistentDatabase !== 'nimi_dev' ||
    census.readOnlyPersistentCensus !== true ||
    census.persistentMutationCount !== 0 ||
    census.persistentWorldCharacters !== WORLD_CHARACTER_DENOMINATOR ||
    census.persistentPersonaCharacters !== PERSONA_CHARACTER_DENOMINATOR ||
    census.disposableWorldCharacters !== WORLD_CHARACTER_DENOMINATOR ||
    census.disposablePersonaCharacters !== PERSONA_CHARACTER_DENOMINATOR ||
    census.worldParity.count !== WORLD_CHARACTER_DENOMINATOR ||
    census.worldParity.sourceRefsExact !== true ||
    census.worldParity.sourceHashesExact !== true ||
    census.worldParity.persistentWorldSourceSetDigest !== census.worldParity.disposableWorldSourceSetDigest ||
    census.persistentInstanceDigest === census.disposableInstanceDigest
  ) {
    fail(
      'live_census_mutated_persistent_state',
      'live census did not prove immutable persistent 470/1, selected disposable 470/1, and exact World parity',
    );
  }
  if (
    census.sourceCount !== FULL_DATA_DENOMINATOR ||
    census.worldCharacters !== WORLD_CHARACTER_DENOMINATOR ||
    census.personaCharacters !== PERSONA_CHARACTER_DENOMINATOR ||
    !Array.isArray(census.sources) ||
    census.sources.length !== FULL_DATA_DENOMINATOR
  ) {
    fail('denominator_mismatch', 'live source census is not exactly 470 WorldCharacters + 1 Persona');
  }
  const sourceHashes = new Set();
  const canonicalKeys = [];
  let worlds = 0;
  let personas = 0;
  for (const [index, row] of census.sources.entries()) {
    assertClosedObject(row, ['ordinal', 'sourceRef'], [], `live census source ${index}`);
    if (row.ordinal !== index) fail('ordinal_gap', `live census source ordinal ${row.ordinal} does not match ${index}`);
    const parsed = parseSourceRef(row.sourceRef, `live census source ${index}.sourceRef`);
    if (parsed.kind === 'worldCharacter') worlds += 1;
    if (parsed.kind === 'personaCharacter') {
      personas += 1;
      assertFixedPersonaSource(parsed, 'live census selected Persona source');
    }
    const sourceRefHash = domainHash('nimi.realm-v3-full-data-source-ref/v1', parsed.sourceRef);
    if (sourceHashes.has(sourceRefHash)) fail('duplicate_partition', `live census source ${index} is duplicated`);
    sourceHashes.add(sourceRefHash);
    canonicalKeys.push(`${parsed.kind}\0${parsed.id}\0${parsed.sourceHash}`);
  }
  if (worlds !== WORLD_CHARACTER_DENOMINATOR || personas !== PERSONA_CHARACTER_DENOMINATOR) {
    fail('denominator_mismatch', `live source census kinds are ${worlds} world + ${personas} persona`);
  }
  const sortedKeys = [...canonicalKeys].sort();
  if (canonicalJSONStringify(canonicalKeys) !== canonicalJSONStringify(sortedKeys)) {
    fail('census_order_mismatch', 'live source census is not in deterministic canonical order');
  }
  assertSHA256(census.contentHash, 'live census contentHash');
  const digestInput = { ...census };
  delete digestInput.contentHash;
  const computed = domainHash('nimi.realm-v3-full-data-source-census/v1', digestInput);
  if (computed !== census.contentHash) {
    fail('census_digest_mismatch', 'live source census content hash does not match its rows');
  }
  return census;
}

function liveSourceInputFromEvidence(sourceCensus, censusExecutionReceipt) {
  return {
    mode: 'current_realm_live_census',
    schemaVersion: sourceCensus.schemaVersion,
    contentHash: sourceCensus.contentHash,
    instanceDigest: sourceCensus.instanceDigest,
    liveEnvironmentAttestationDigest: sourceCensus.liveEnvironmentAttestationDigest,
    persistentInstanceDigest: sourceCensus.persistentInstanceDigest,
    disposableInstanceDigest: sourceCensus.disposableInstanceDigest,
    persistentDatabase: sourceCensus.persistentDatabase,
    persistentWorldCharacters: sourceCensus.persistentWorldCharacters,
    persistentPersonaCharacters: sourceCensus.persistentPersonaCharacters,
    disposableWorldCharacters: sourceCensus.disposableWorldCharacters,
    disposablePersonaCharacters: sourceCensus.disposablePersonaCharacters,
    worldParity: sourceCensus.worldParity,
    personaProvisioningAttestationDigest: sourceCensus.personaProvisioningAttestationDigest,
    censusExecutionBindingDigest: liveExecutionReceiptBindingDigest(censusExecutionReceipt),
    sourceCount: sourceCensus.sourceCount,
    worldCharacters: sourceCensus.worldCharacters,
    personaCharacters: sourceCensus.personaCharacters,
    readOnlyPersistentCensus: sourceCensus.readOnlyPersistentCensus,
    persistentMutationCount: sourceCensus.persistentMutationCount,
  };
}

function validateFrozenLiveSourceInput(sourceInput, liveEnvironmentAttestationDigest) {
  assertClosedObject(
    sourceInput,
    [
      'mode',
      'schemaVersion',
      'contentHash',
      'instanceDigest',
      'liveEnvironmentAttestationDigest',
      'persistentInstanceDigest',
      'disposableInstanceDigest',
      'persistentDatabase',
      'persistentWorldCharacters',
      'persistentPersonaCharacters',
      'disposableWorldCharacters',
      'disposablePersonaCharacters',
      'worldParity',
      'personaProvisioningAttestationDigest',
      'censusExecutionBindingDigest',
      'sourceCount',
      'worldCharacters',
      'personaCharacters',
      'readOnlyPersistentCensus',
      'persistentMutationCount',
    ],
    [],
    'frozen live source input',
  );
  for (const field of [
    'contentHash',
    'instanceDigest',
    'liveEnvironmentAttestationDigest',
    'persistentInstanceDigest',
    'disposableInstanceDigest',
    'personaProvisioningAttestationDigest',
    'censusExecutionBindingDigest',
  ]) {
    assertSHA256(sourceInput[field], `frozen live source input.${field}`);
  }
  assertClosedObject(
    sourceInput.worldParity,
    [
      'count',
      'sourceRefsExact',
      'sourceHashesExact',
      'persistentWorldSourceSetDigest',
      'disposableWorldSourceSetDigest',
    ],
    [],
    'frozen live source input.worldParity',
  );
  if (
    sourceInput.mode !== 'current_realm_live_census' ||
    sourceInput.schemaVersion !== SOURCE_CENSUS_SCHEMA ||
    sourceInput.liveEnvironmentAttestationDigest !== liveEnvironmentAttestationDigest ||
    sourceInput.persistentDatabase !== 'nimi_dev' ||
    sourceInput.persistentWorldCharacters !== WORLD_CHARACTER_DENOMINATOR ||
    sourceInput.persistentPersonaCharacters !== PERSONA_CHARACTER_DENOMINATOR ||
    sourceInput.disposableWorldCharacters !== WORLD_CHARACTER_DENOMINATOR ||
    sourceInput.disposablePersonaCharacters !== PERSONA_CHARACTER_DENOMINATOR ||
    sourceInput.sourceCount !== FULL_DATA_DENOMINATOR ||
    sourceInput.worldCharacters !== WORLD_CHARACTER_DENOMINATOR ||
    sourceInput.personaCharacters !== PERSONA_CHARACTER_DENOMINATOR ||
    sourceInput.readOnlyPersistentCensus !== true ||
    sourceInput.persistentMutationCount !== 0 ||
    sourceInput.worldParity.count !== WORLD_CHARACTER_DENOMINATOR ||
    sourceInput.worldParity.sourceRefsExact !== true ||
    sourceInput.worldParity.sourceHashesExact !== true ||
    sourceInput.worldParity.persistentWorldSourceSetDigest !==
      sourceInput.worldParity.disposableWorldSourceSetDigest ||
    sourceInput.persistentInstanceDigest === sourceInput.disposableInstanceDigest
  ) {
    fail('invalid_frozen_source_input', 'frozen live source input is not the admitted dual-instance census');
  }
  return sourceInput;
}

async function buildCensusExpectation(nimiRoot) {
  const resolvedNimiRoot = path.resolve(nimiRoot);
  const lock = parseLock(
    YAML.parse(await readFile(path.join(resolvedNimiRoot, 'config', 'realm-contract-lock.yaml'), 'utf8')),
  );
  if ((await sha256File(path.join(resolvedNimiRoot, lock.openapi.synced_path))) !== lock.openapi.document_sha256) {
    fail('openapi_digest_mismatch', 'synced Realm OpenAPI does not match the current lock');
  }
  const contractPaths = await contractPathInventory(resolvedNimiRoot);
  const gitIdentity = await currentGitIdentity(resolvedNimiRoot);
  return {
    realm: {
      commit: lock.realm.commit,
      tree: lock.realm.tree,
      openapiDigest: lock.openapi.document_sha256,
      policyDigest: lock.access_policy.digest,
    },
    nimi: {
      commit: gitIdentity.commit,
      tree: gitIdentity.tree,
      contractDigest: domainHash('nimi.realm-v3-full-data-consumer-contract/v1', contractPaths),
      worktreeDigest: gitIdentity.worktreeDigest,
    },
  };
}


export {
  assertFixedPersonaSource,
  buildCensusExpectation,
  buildWorkerIdentity,
  buildWorkerInputIdentity,
  contractPathInventory,
  currentGitIdentity,
  findCaptureIndex,
  liveExecutionReceiptBindingDigest,
  liveExecutionStableAuthority,
  liveSourceInputFromEvidence,
  loadLiveExecutionReceipt,
  materializeLiveWorkerArguments,
  parseLock,
  parseSourceRef,
  resolveWorkerExecutable,
  validateFrozenLiveSourceInput,
  validateLiveEnvironmentProjection,
  validateLiveWorkerArgumentTemplate,
};
