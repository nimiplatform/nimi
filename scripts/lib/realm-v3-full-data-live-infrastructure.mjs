import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
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
  writeFile,
} from 'node:fs/promises';
import { closeSync, createReadStream, openSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  buildSnapshotProof,
  canonicalJSONStringify,
  domainHash,
  sha256Hex,
  validateLiveEnvironmentAttestation,
} from '../realm-v3-full-data-census-worker.mjs';

import {
  ATTESTATION_SCHEMA,
  CHILD_REGISTRATION_SCHEMA,
  CLEANUP_SCHEMA,
  CLOSED_ENVIRONMENT_AUTHORITY_FIELDS,
  CLOSE_CANDIDATE_SCHEMA,
  DISPOSABLE_DATABASE_RE,
  EVIDENCE_RELATIVE_ROOT,
  EXECUTION_RECEIPT_SCHEMA,
  FIXED_PERSONA_ID,
  FIXED_REALM_COMMIT,
  FIXED_REALM_TREE,
  FIXTURE_SOURCE_PATH,
  MARKER_SCHEMA,
  MATERIALIZER_ACCOUNT_ID,
  MAX_CAPTURE_BYTES,
  MODULE_NIMI_ROOT,
  N6_FROZEN_EVIDENCE_RELATIVE_PATH,
  PERSISTENT_DATABASE,
  REDIS_CONTAINER_RE,
  SAFE_EXECUTION_PARTITION_RE,
  SAFE_NAME_RE,
  SHA256_RE,
  STATE_DIRECTORY_RE,
  STATE_SCHEMA,
  TRUSTED_TOOL_NAMES,
  activateTrustedToolPaths,
  activateWrapperToolClosure,
  assertAdmittedEvidenceOutput,
  assertAdmittedEvidencePath,
  assertClosedKeys,
  assertDirectoryChainHasNoSymlink,
  assertDisposableDatabaseName,
  assertNoAmbientChildInjection,
  assertPersistentMatchesFrozenN6,
  assertPrivateRegularFile,
  assertSHA256,
  assertSafeName,
  assertSafeStateDirectoryTarget,
  captureGoExecutableIdentity,
  captureTrustedFileIdentity,
  captureWrapperTrust,
  closedBootstrapEnvironment,
  closedProcessEnvironment,
  directoryManifest,
  durableRename,
  ensurePrivateDirectory,
  fail,
  hashFile,
  isInside,
  pathExists,
  readFrozenN6Baseline,
  readJSON,
  runCapture,
  sanitizedChildBaseEnvironment,
  syncDirectory,
  validateClosedArgs,
  validateLiveChildRegistration,
  validateLiveEnvironmentExecutionReceipt,
  verifyAndActivateStateToolClosure,
  writePrivateJSON,
} from './realm-v3-full-data-live-contract.mjs';
async function inspectDockerContainer(container, label) {
  assertSafeName(container, `${label} container`);
  const running = (await runCapture('docker', ['inspect', '--format', '{{.State.Running}}', container])).stdout.trim();
  if (running !== 'true') fail('container_not_running', `${label} container is not running`);
  const id = (await runCapture('docker', ['inspect', '--format', '{{.Id}}', container])).stdout.trim();
  if (!/^[0-9a-f]{64}$/u.test(id)) fail('invalid_container_identity', `${label} container identity is invalid`);
  return { id, digest: sha256Hex(id) };
}

function sourceRowsSQL() {
  return String.raw`
BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE;
SET LOCAL search_path TO pg_catalog;
SELECT pg_catalog.jsonb_build_object(
  'transactionReadOnly', pg_catalog.current_setting('transaction_read_only') = 'on',
  'transactionIsolation', pg_catalog.current_setting('transaction_isolation'),
  'searchPath', pg_catalog.current_setting('search_path'),
  'currentUser', CURRENT_USER,
  'sessionUser', SESSION_USER,
  'sources', (
    SELECT pg_catalog.jsonb_agg(
      source_ref ORDER BY kind COLLATE pg_catalog."C", source_id COLLATE pg_catalog."C", source_hash COLLATE pg_catalog."C"
    )
    FROM (
      SELECT 'worldCharacter'::text AS kind, id AS source_id, source_hash,
        pg_catalog.jsonb_build_object('kind','worldCharacter','id',id,'worldId',world_id,'sourceHash',source_hash,
          'worldEntityRef',pg_catalog.jsonb_build_object('kind','worldEntity','worldId',world_id,'entityId',world_entity_id)) AS source_ref
      FROM public.world_character_cores
      UNION ALL
      SELECT 'personaCharacter'::text AS kind, id AS source_id, source_hash,
        pg_catalog.jsonb_build_object('kind','personaCharacter','id',id,'worldId',world_id,'sourceHash',source_hash,
          'ownerAccountId',owner_account_id) AS source_ref
      FROM public.persona_character_cores
    ) source_rows
  )
);
COMMIT;
`;
}

async function readDatabaseSnapshot(container, user, database, expectedPersonas) {
  const identity = await inspectDockerContainer(container, 'PostgreSQL');
  const output = await runCapture(
    'docker',
    ['exec', '-i', container, 'psql', '-X', '-qAt', '--set', 'ON_ERROR_STOP=1', '-U', user, '-d', database],
    { input: sourceRowsSQL() },
  );
  const lines = output.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1) fail('database_census_failed', `database census returned ${lines.length} rows`);
  const result = JSON.parse(lines[0]);
  if (
    result.transactionReadOnly !== true ||
    result.transactionIsolation !== 'serializable' ||
    result.searchPath !== 'pg_catalog' ||
    result.currentUser !== user ||
    result.sessionUser !== user
  ) {
    fail('database_census_failed', 'database census was not SERIALIZABLE READ ONLY with fixed role/search_path');
  }
  const admittedPersonaCounts = Array.isArray(expectedPersonas) ? expectedPersonas : [expectedPersonas];
  if (
    !Array.isArray(result.sources) ||
    admittedPersonaCounts.some((count) => !Number.isSafeInteger(count) || count < 0 || count > 1)
  ) {
    fail('database_census_failed', 'database census Persona count contract is invalid');
  }
  const observedPersonaCount = result.sources.filter((source) => source?.kind === 'personaCharacter').length;
  if (!admittedPersonaCounts.includes(observedPersonaCount)) {
    fail(
      'database_census_failed',
      `database census Persona count ${observedPersonaCount} is outside the admitted ${admittedPersonaCounts.join('/')} recovery set`,
    );
  }
  const proof = buildSnapshotProof({
    containerIdentityDigest: identity.digest,
    databaseName: database,
    sources: result.sources,
    expectedPersonas: observedPersonaCount,
  });
  return { ...proof, containerIdentityDigest: identity.digest };
}

async function databaseExists(container, user, database) {
  const sql = `
SET search_path TO pg_catalog;
SELECT pg_catalog.json_build_object(
  'currentUser', CURRENT_USER,
  'sessionUser', SESSION_USER,
  'searchPath', pg_catalog.current_setting('search_path'),
  'exists', EXISTS(SELECT 1 FROM pg_catalog.pg_database WHERE datname = '${database}'),
  'marker', (
    SELECT pg_catalog.shobj_description(oid, 'pg_database')
    FROM pg_catalog.pg_database WHERE datname = '${database}'
  )
);`;
  const result = await runCapture(
    'docker',
    ['exec', '-i', container, 'psql', '-X', '-qAt', '--set', 'ON_ERROR_STOP=1', '-U', user, '-d', 'postgres'],
    { input: sql },
  );
  const rows = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  if (rows.length !== 1) fail('database_identity_invalid', 'database identity query returned an invalid row count');
  const value = JSON.parse(rows[0]);
  if (value.currentUser !== user || value.sessionUser !== user || value.searchPath !== 'pg_catalog') {
    fail('database_identity_invalid', 'database identity query role/search_path binding failed');
  }
  return { exists: value.exists === true, marker: value.marker ?? null };
}

async function createDisposableClone(container, user, database, marker) {
  assertDisposableDatabaseName(database);
  const before = await databaseExists(container, user, database);
  if (before.exists) {
    if (before.marker === null) {
      await readDatabaseSnapshot(container, user, database, 1);
      const escapedMarker = marker.replaceAll("'", "''");
      await runCapture(
        'docker',
        ['exec', '-i', container, 'psql', '-X', '-qAt', '--set', 'ON_ERROR_STOP=1', '-U', user, '-d', 'postgres'],
        { input: `SET search_path TO pg_catalog; COMMENT ON DATABASE "${database}" IS '${escapedMarker}';` },
      );
    } else if (before.marker !== marker) {
      fail('database_target_exists', 'random disposable database exists with a foreign marker');
    }
    const recovered = await databaseExists(container, user, database);
    if (recovered.marker !== marker) fail('database_create_failed', 'interrupted database marker recovery failed');
    return;
  }
  const escapedMarker = marker.replaceAll("'", "''");
  const sql = `
SET search_path TO pg_catalog;
CREATE DATABASE "${database}" WITH TEMPLATE "${PERSISTENT_DATABASE}";
COMMENT ON DATABASE "${database}" IS '${escapedMarker}';`;
  await runCapture(
    'docker',
    ['exec', '-i', container, 'psql', '-X', '-qAt', '--set', 'ON_ERROR_STOP=1', '-U', user, '-d', 'postgres'],
    { input: sql },
  );
  const after = await databaseExists(container, user, database);
  if (!after.exists || after.marker !== marker) {
    fail('database_create_failed', 'disposable database marker was not durably established');
  }
}

async function dropDisposableDatabase(container, user, database, marker) {
  assertDisposableDatabaseName(database);
  const before = await databaseExists(container, user, database);
  if (!before.exists) return;
  if (before.marker === null) {
    await readDatabaseSnapshot(container, user, database, 1);
    const escapedMarker = marker.replaceAll("'", "''");
    await runCapture(
      'docker',
      ['exec', '-i', container, 'psql', '-X', '-qAt', '--set', 'ON_ERROR_STOP=1', '-U', user, '-d', 'postgres'],
      { input: `SET search_path TO pg_catalog; COMMENT ON DATABASE "${database}" IS '${escapedMarker}';` },
    );
  } else if (before.marker !== marker) {
    fail('cleanup_identity_mismatch', 'disposable database marker changed');
  }
  if ((await databaseExists(container, user, database)).marker !== marker) {
    fail('cleanup_identity_mismatch', 'disposable database marker recovery changed before drop');
  }
  const sql = `SET search_path TO pg_catalog; DROP DATABASE "${database}" WITH (FORCE);`;
  await runCapture(
    'docker',
    ['exec', '-i', container, 'psql', '-X', '-qAt', '--set', 'ON_ERROR_STOP=1', '-U', user, '-d', 'postgres'],
    { input: sql },
  );
  if ((await databaseExists(container, user, database)).exists) fail('database_cleanup_failed', 'disposable database still exists');
}

function deriveDisposableDatabaseURL(persistentURL, database) {
  assertDisposableDatabaseName(database);
  let parsed;
  try {
    parsed = new URL(persistentURL);
  } catch {
    fail('invalid_database_url', 'persistent database URL is invalid');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) fail('invalid_database_url', 'database URL is not PostgreSQL');
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) fail('invalid_database_url', 'database URL must use loopback');
  if (decodeURIComponent(parsed.pathname.replace(/^\//u, '')) !== PERSISTENT_DATABASE) {
    fail('invalid_database_url', 'persistent database URL does not target nimi_dev');
  }
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function parseOfflineStoreDirectory(modulesText) {
  let candidate = null;
  try {
    const parsed = JSON.parse(modulesText);
    candidate = parsed?.storeDir;
  } catch {
    const matches = [...modulesText.matchAll(/^\s*storeDir:\s*(.+?)\s*$/gmu)];
    if (matches.length !== 1) {
      fail('offline_store_invalid', 'dependency .modules.yaml must declare exactly one storeDir');
    }
    candidate = matches[0][1].replace(/^['"]|['"]$/gu, '');
  }
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) {
    fail('offline_store_invalid', 'dependency .modules.yaml storeDir must be absolute');
  }
  return path.resolve(candidate);
}

async function readFrozenOfflineStoreDirectory(dependencyRoot) {
  const modulesPath = path.join(dependencyRoot, 'node_modules', '.modules.yaml');
  const modulesInfo = await lstat(modulesPath);
  if (!modulesInfo.isFile() || modulesInfo.isSymbolicLink()) {
    fail('offline_store_invalid', 'dependency .modules.yaml must be a regular non-symlink file');
  }
  const declared = parseOfflineStoreDirectory(await readFile(modulesPath, 'utf8'));
  const canonical = await realpath(declared);
  const info = await lstat(canonical);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('offline_store_invalid', 'declared pnpm storeDir is not a real directory');
  }
  return canonical;
}

async function dependencyRootDigest(dependencyRoot) {
  const files = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'node_modules/.modules.yaml'];
  const rows = [];
  for (const relative of files) {
    const absolute = path.join(dependencyRoot, relative);
    rows.push({ path: relative, sha256: await hashFile(absolute) });
  }
  const [nodeVersion, pnpmVersion] = await Promise.all([
    runCapture(process.execPath, ['--version']),
    runCapture('pnpm', ['--version'], { cwd: dependencyRoot }),
  ]);
  const storeDirectory = await readFrozenOfflineStoreDirectory(dependencyRoot);
  return {
    digest: domainHash('nimi.realm-v3-full-data-dependency-root/v1', {
      files: rows,
      nodeVersion: nodeVersion.stdout.trim(),
      pnpmVersion: pnpmVersion.stdout.trim(),
      offlineStoreDirectoryPathHash: sha256Hex(storeDirectory),
    }),
    storeDirectory,
    storeDirectoryPathHash: sha256Hex(storeDirectory),
  };
}

function relativeExecutionPath(exportRoot, candidate, label) {
  const relative = path.relative(exportRoot, candidate);
  if (
    relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    if (relative === '') return '.';
    fail('runtime_dependency_invalid', `${label} escapes the fixed Realm export`);
  }
  return relative.split(path.sep).join('/');
}

async function runtimeDependencyClosureManifest(rawExportRoot) {
  const exportRoot = await realpath(rawExportRoot);
  const roots = [
    path.join(exportRoot, 'nimi-backend', 'dist', 'apps', 'api'),
    path.join(exportRoot, 'node_modules'),
    path.join(exportRoot, 'nimi-backend', 'node_modules'),
  ];
  const visitedDirectories = new Set();
  const files = new Map();
  const symlinks = new Map();

  const captureFile = async (candidate) => {
    const canonical = await realpath(candidate);
    const relative = relativeExecutionPath(exportRoot, canonical, 'runtime dependency file');
    const info = await lstat(canonical);
    if (!info.isFile() || info.isSymbolicLink()) {
      fail('runtime_dependency_invalid', `runtime dependency target is not regular: ${relative}`);
    }
    const row = {
      type: 'file',
      path: relative,
      mode: info.mode & 0o7777,
      bytes: info.size,
      sha256: await hashFile(canonical),
    };
    const previous = files.get(relative);
    if (previous && canonicalJSONStringify(previous) !== canonicalJSONStringify(row)) {
      fail('runtime_dependency_invalid', `runtime dependency file identity is ambiguous: ${relative}`);
    }
    files.set(relative, row);
  };

  const walk = async (candidate) => {
    const lexical = path.resolve(candidate);
    relativeExecutionPath(exportRoot, lexical, 'runtime dependency entry');
    const info = await lstat(lexical);
    if (info.isSymbolicLink()) {
      const target = await readlink(lexical);
      const canonicalTarget = await realpath(lexical);
      const canonicalTargetPath = relativeExecutionPath(
        exportRoot,
        canonicalTarget,
        'runtime dependency symlink target',
      );
      const targetInfo = await lstat(canonicalTarget);
      if (!targetInfo.isDirectory() && !targetInfo.isFile()) {
        fail('runtime_dependency_invalid', `runtime dependency symlink has a special target: ${target}`);
      }
      symlinks.set(relativeExecutionPath(exportRoot, lexical, 'runtime dependency symlink'), {
        type: 'symlink',
        path: relativeExecutionPath(exportRoot, lexical, 'runtime dependency symlink'),
        mode: info.mode & 0o7777,
        target,
        canonicalTargetPath,
        targetType: targetInfo.isDirectory() ? 'directory' : 'file',
        targetMode: targetInfo.mode & 0o7777,
      });
      if (targetInfo.isDirectory()) await walk(canonicalTarget);
      else await captureFile(canonicalTarget);
      return;
    }
    if (info.isFile()) {
      await captureFile(lexical);
      return;
    }
    if (!info.isDirectory()) {
      fail('runtime_dependency_invalid', `runtime dependency entry is special: ${lexical}`);
    }
    const canonicalDirectory = await realpath(lexical);
    relativeExecutionPath(exportRoot, canonicalDirectory, 'runtime dependency directory');
    if (visitedDirectories.has(canonicalDirectory)) return;
    visitedDirectories.add(canonicalDirectory);
    const entries = await readdir(canonicalDirectory, { withFileTypes: true });
    entries.sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
    for (const entry of entries) await walk(path.join(canonicalDirectory, entry.name));
  };

  for (const root of roots) await walk(root);
  const fileRows = [...files.values()].sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
  for (const row of symlinks.values()) {
    const targetRows = row.targetType === 'file'
      ? fileRows.filter((entry) => entry.path === row.canonicalTargetPath)
      : fileRows.filter(
          (entry) => entry.path.startsWith(`${row.canonicalTargetPath}/`),
        );
    if (targetRows.length === 0) {
      fail('runtime_dependency_invalid', `runtime dependency symlink target is empty: ${row.path}`);
    }
    row.targetBytes = targetRows.reduce((total, entry) => total + entry.bytes, 0);
    row.targetSha256 = row.targetType === 'file'
      ? targetRows[0].sha256
      : domainHash('nimi.realm-v3-full-data-runtime-symlink-target/v1', targetRows);
  }
  const symlinkRows = [...symlinks.values()].sort(
    (left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)),
  );
  const requiredPackages = ['tsx', 'pg'];
  for (const packageName of requiredPackages) {
    const packageSuffix = `/node_modules/${packageName}/package.json`;
    if (!fileRows.some((entry) => entry.path.endsWith(packageSuffix))) {
      fail('runtime_dependency_invalid', `runtime dependency closure omits required ${packageName}`);
    }
  }
  const manifest = {
    schemaVersion: 'nimi.realm-v3-full-data-runtime-dependency-closure/v1',
    roots: roots.map((entry) => relativeExecutionPath(exportRoot, entry, 'runtime dependency root')),
    files: fileRows,
    symlinks: symlinkRows,
  };
  return {
    manifest,
    digest: domainHash(manifest.schemaVersion, manifest),
    fileCount: fileRows.length,
    symlinkCount: symlinkRows.length,
  };
}

async function assertRuntimeDependencyClosure(exportProof) {
  const observed = await runtimeDependencyClosureManifest(exportProof.exportRoot);
  if (
    observed.digest !== exportProof.runtimeDependencyClosureDigest ||
    observed.fileCount !== exportProof.runtimeDependencyFileCount ||
    observed.symlinkCount !== exportProof.runtimeDependencySymlinkCount
  ) {
    fail('runtime_dependency_drift', 'fixed Realm runtime dependency closure changed');
  }
  return observed;
}

async function exportAndBuildFixedRealm(state, options) {
  const archivePath = path.join(options.stateDirectory, 'realm-current.tar');
  const exportRoot = path.join(options.stateDirectory, 'realm-current-export');
  await runCapture('git', [
    '-C', options.rootRealm,
    'archive', '--format=tar', `--output=${archivePath}`, FIXED_REALM_COMMIT,
  ]);
  await mkdir(exportRoot, { mode: 0o700 });
  await runCapture('tar', ['-xf', archivePath, '-C', exportRoot]);
  const [archiveSha256, treeManifest, dependency] = await Promise.all([
    hashFile(archivePath),
    runCapture('git', ['-C', options.rootRealm, 'ls-tree', '-r', '--full-tree', '--long', FIXED_REALM_COMMIT]),
    dependencyRootDigest(options.dependencyRoot),
  ]);
  const storeArguments = ['--store-dir', dependency.storeDirectory];
  await runCapture('pnpm', [...storeArguments, 'install', '--offline', '--frozen-lockfile'], { cwd: exportRoot });
  await runCapture('pnpm', [...storeArguments, '--filter', '@nimi/forge', '--fail-if-no-match', 'build'], { cwd: exportRoot });
  await runCapture('pnpm', [...storeArguments, '--dir', 'nimi-backend', 'build:api'], { cwd: exportRoot });
  const artifactRoot = path.join(exportRoot, 'nimi-backend', 'dist', 'apps', 'api');
  const artifactManifest = await directoryManifest(artifactRoot);
  if (artifactManifest.length === 0) fail('build_failed', 'fixed Realm API build artifact is empty');
  const runtimeClosure = await runtimeDependencyClosureManifest(exportRoot);
  const runtimeDependencyClosureManifestPath = path.join(
    state.stateDirectory,
    'runtime-dependency-closure.json',
  );
  await writePrivateJSON(runtimeDependencyClosureManifestPath, runtimeClosure.manifest);
  return {
    archivePath,
    exportRoot,
    archiveSha256,
    manifestDigest: domainHash('nimi.realm-v3-full-data-fixed-export-manifest/v1', treeManifest.stdout),
    buildArtifactDigest: domainHash('nimi.realm-v3-full-data-server-build/v1', artifactManifest),
    dependencyRootDigest: dependency.digest,
    offlineStoreDirectoryPathHash: dependency.storeDirectoryPathHash,
    runtimeDependencyClosureDigest: runtimeClosure.digest,
    runtimeDependencyFileCount: runtimeClosure.fileCount,
    runtimeDependencySymlinkCount: runtimeClosure.symlinkCount,
    runtimeDependencyClosureManifestPath,
    fixtureSourceSha256: await hashFile(path.join(exportRoot, FIXTURE_SOURCE_PATH)),
  };
}

async function reserveLoopbackPort() {
  const { createServer } = await import('node:net');
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer();
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        rejectPromise(new Error('loopback port reservation failed'));
        return;
      }
      server.close((error) => (error ? rejectPromise(error) : resolvePromise(address.port)));
    });
  });
}

async function buildRedisIntent(environmentId, image) {
  if (typeof image !== 'string' || !image.includes('@sha256:')) {
    fail('unsafe_redis_image', 'Redis image must be content-addressed with @sha256');
  }
  const name = `nimi-realm-v3-n7-redis-${environmentId}`;
  const imageIdentity = (await runCapture('docker', ['image', 'inspect', '--format', '{{.Id}}', image])).stdout.trim();
  if (!/^sha256:[0-9a-f]{64}$/u.test(imageIdentity)) fail('invalid_redis_identity', 'Redis image identity is invalid');
  return {
    name,
    image,
    imageIdentity,
    environmentId,
    intentDigest: domainHash('nimi.realm-v3-full-data-redis-resource/v1', {
      name,
      imageIdentity,
      environmentId,
    }),
  };
}

async function observeRedis(intent) {
  try {
    const inspection = await runCapture('docker', [
      'inspect',
      '--format', '{{.Id}}|{{.State.Running}}|{{.Image}}|{{ index .Config.Labels "nimi.realm-v3-full-data-environment" }}',
      intent.name,
    ]);
    const [id, running, imageIdentity, label] = inspection.stdout.trim().split('|');
    const portOutput = running === 'true'
      ? (await runCapture('docker', ['port', intent.name, '6379/tcp'])).stdout.trim()
      : '';
    const match = running === 'true' ? /^127\.0\.0\.1:(\d{1,5})$/u.exec(portOutput) : null;
    return {
      id,
      running: running === 'true',
      imageIdentity,
      label,
      port: match ? Number(match[1]) : null,
    };
  } catch (error) {
    if (error?.result?.stderr?.includes('No such object')) return null;
    throw error;
  }
}

function classifyPreparedRedisObservation(observation, intent, recorded) {
  if (!observation) return 'absent';
  if (
    !/^[0-9a-f]{64}$/u.test(observation.id || '') ||
    observation.imageIdentity !== intent.imageIdentity ||
    observation.label !== intent.environmentId ||
    observation.id !== recorded?.id
  ) return 'foreign';
  if (!observation.running) return 'restart';
  if (observation.port !== recorded.port) return 'foreign';
  return 'healthy';
}

async function startRedis(intent, options = {}) {
  let id;
  const observation = await observeRedis(intent);
  if (observation) {
    if (
      !/^[0-9a-f]{64}$/u.test(observation.id) ||
      observation.imageIdentity !== intent.imageIdentity || observation.label !== intent.environmentId
    ) {
      fail('resume_identity_mismatch', 'existing Redis does not match its durable intent');
    }
    id = observation.id;
    if (!observation.running) await runCapture('docker', ['start', intent.name]);
  } else {
    if (options.allowCreate !== true) {
      fail('resume_identity_mismatch', 'durably created Redis container is absent');
    }
    id = (await runCapture('docker', [
      'run', '-d', '--name', intent.name,
      '--label', `nimi.realm-v3-full-data-environment=${intent.environmentId}`,
    '--publish', '127.0.0.1::6379/tcp',
      intent.image,
    'redis-server', '--save', '', '--appendonly', 'no',
    ])).stdout.trim();
  }
  if (!/^[0-9a-f]{64}$/u.test(id)) fail('invalid_redis_identity', 'Redis container identity is invalid');
  const portOutput = (await runCapture('docker', ['port', intent.name, '6379/tcp'])).stdout.trim();
  const match = /^127\.0\.0\.1:(\d{1,5})$/u.exec(portOutput);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535) fail('invalid_redis_port', 'Redis loopback port is invalid');
  const keys = Number((await runCapture('docker', ['exec', intent.name, 'redis-cli', 'DBSIZE'])).stdout.trim());
  if (keys !== 0) fail('redis_not_empty', 'new isolated Redis is not empty');
  return {
    name: intent.name,
    id,
    port: Number(match[1]),
    proof: {
      containerIdentityDigest: sha256Hex(id),
      containerNameHash: sha256Hex(intent.name),
      imageIdentityDigest: sha256Hex(intent.imageIdentity),
      initialKeyCount: 0,
      isolationLabelDigest: sha256Hex(intent.environmentId),
    },
  };
}

async function reconcilePreparedRedis(state, statePath) {
  const intent = state.resources?.redisIntent;
  if (
    !intent || !state.redis || state.resources.redisCreated !== true ||
    state.redis.name !== intent.name || !Number.isSafeInteger(state.redis.port) ||
    state.redis.port < 1 || state.redis.port > 65535 ||
    state.redis.proof?.containerIdentityDigest !== sha256Hex(state.redis.id || '') ||
    state.redis.proof?.containerNameHash !== sha256Hex(intent.name) ||
    state.redis.proof?.imageIdentityDigest !== sha256Hex(intent.imageIdentity) ||
    state.redis.proof?.isolationLabelDigest !== sha256Hex(intent.environmentId)
  ) fail('resume_identity_mismatch', 'prepared Redis identity is missing');
  let observation = await observeRedis(intent);
  const classification = classifyPreparedRedisObservation(observation, intent, state.redis);
  if (classification === 'absent') {
    fail('resume_identity_mismatch', 'prepared Redis container is absent');
  }
  if (classification === 'foreign') {
    fail('resume_identity_mismatch', 'prepared Redis container has a foreign identity');
  }
  if (classification === 'restart') {
    await runCapture('docker', ['start', intent.name]);
    observation = await observeRedis(intent);
    if (classifyPreparedRedisObservation(observation, intent, state.redis) !== 'healthy') {
      fail('resume_identity_mismatch', 'prepared Redis did not recover with the same identity/port');
    }
    state.redis.restartCount = (state.redis.restartCount ?? 0) + 1;
    await writePrivateJSON(statePath, state);
  }
  const keys = Number((await runCapture('docker', ['exec', intent.name, 'redis-cli', 'DBSIZE'])).stdout.trim());
  if (!Number.isSafeInteger(keys) || keys < 0) fail('redis_identity_invalid', 'prepared Redis key count is invalid');
  return { classification, keys };
}

function fixedFixtureHelperSource(fixedModuleURL) {
  return `
import { readFile, writeFile } from 'node:fs/promises';
import { Client } from 'pg';
import {
  MATERIALIZER_ACCOUNT_ID,
  buildBackendEnvironment,
  createPersonaFixture,
  createRuntimeKeyMaterial,
  deletePersonaFixture,
  prepareFullchainMaterializerAccount,
} from ${JSON.stringify(fixedModuleURL)};

const [mode, inputPath, outputPath] = process.argv.slice(2);
const input = JSON.parse(await readFile(inputPath, 'utf8'));
if (mode === 'credentials') {
  const client = new Client({ connectionString: input.databaseURL });
  await client.connect();
  try { await prepareFullchainMaterializerAccount(client); } finally { await client.end(); }
  const keyMaterial = createRuntimeKeyMaterial(input.apiBaseURL);
  const generated = buildBackendEnvironment(input.databaseURL, input.apiPort, input.apiBaseURL, keyMaterial);
  const admitted = {};
  for (const name of [
    'JWT_PRIVATE_KEY_PEM','JWT_PUBLIC_KEY_PEM','JWT_REFRESH_PRIVATE_KEY_PEM','JWT_REFRESH_PUBLIC_KEY_PEM',
    'JWT_KID','JWT_REFRESH_KID','JWT_ISSUER','JWT_AUDIENCE','JWT_DURATION','JWT_2FA_SECRET',
    'SOURCE_MATERIALIZATION_ACTIVE_KID','SOURCE_MATERIALIZATION_PRIVATE_KEY_PEM',
    'SOURCE_MATERIALIZATION_PUBLIC_KEY_PEM','SOURCE_MATERIALIZATION_RETIRING_KEYS_JSON',
    'SOURCE_MATERIALIZATION_REVOKED_KIDS','SOURCE_MATERIALIZATION_PACKET_TTL_MS',
    'DATABASE_URL','TEST_DATABASE_URL','PORT','NODE_ENV','CORS_ORIGINS','THROTTLE_LIMIT','THROTTLE_TTL_MS',
    'ENABLE_SWAGGER_DOCS'
  ]) admitted[name] = generated[name];
  Object.assign(admitted, input.environmentOverrides);
  await writeFile(outputPath, JSON.stringify({
    accountID: MATERIALIZER_ACCOUNT_ID,
    bootstrapAccessToken: keyMaterial.accessToken,
    apiEnvironment: admitted,
  }) + '\\n', { mode: 0o600 });
} else if (mode === 'persona') {
  const client = new Client({ connectionString: input.databaseURL });
  await client.connect();
  let row;
  let inheritedPersonas;
  try {
    const inherited = await client.query(
      'SELECT id, world_id AS "worldId", source_hash AS "sourceHash", owner_account_id AS "ownerAccountId" FROM public.persona_character_cores ORDER BY id COLLATE pg_catalog."C"'
    );
    inheritedPersonas = inherited.rows;
    const result = await client.query(
      'SELECT world_id AS "worldId", profile FROM public.world_character_cores ORDER BY id COLLATE pg_catalog."C" LIMIT 1'
    );
    row = result.rows[0];
  } finally { await client.end(); }
  if (!row) throw new Error('current_realm_persona_fixture_world_source_missing');
  if (!Array.isArray(inheritedPersonas) || inheritedPersonas.length > 1) {
    throw new Error('current_realm_inherited_persona_set_invalid');
  }
  if (inheritedPersonas.length === 1) {
    const inherited = inheritedPersonas[0];
    const expected = input.expectedInheritedPersona;
    if (
      expected?.kind !== 'personaCharacter' || inherited.id !== expected.id ||
      inherited.worldId !== expected.worldId || inherited.sourceHash !== expected.sourceHash ||
      inherited.ownerAccountId !== expected.ownerAccountId
    ) {
      throw new Error('current_realm_inherited_persona_identity_mismatch');
    }
    await deletePersonaFixture(
      { apiBaseUrl: input.apiBaseURL, accessToken: input.accessToken },
      inheritedPersonas[0].id,
    );
  }
  const persona = await createPersonaFixture(
    { apiBaseUrl: input.apiBaseURL, accessToken: input.accessToken },
    row,
  );
  await writeFile(outputPath, JSON.stringify({
    kind: 'personaCharacter', id: persona.id, worldId: persona.worldId,
    sourceHash: persona.sourceHash, ownerAccountId: persona.ownerAccountId,
  }) + '\\n', { mode: 0o600 });
} else {
  throw new Error('current_realm_fixture_helper_mode_invalid');
}
`;
}


export {
  assertRuntimeDependencyClosure,
  buildRedisIntent,
  classifyPreparedRedisObservation,
  createDisposableClone,
  databaseExists,
  dependencyRootDigest,
  deriveDisposableDatabaseURL,
  dropDisposableDatabase,
  exportAndBuildFixedRealm,
  fixedFixtureHelperSource,
  inspectDockerContainer,
  observeRedis,
  parseOfflineStoreDirectory,
  readDatabaseSnapshot,
  readFrozenOfflineStoreDirectory,
  reconcilePreparedRedis,
  relativeExecutionPath,
  reserveLoopbackPort,
  runtimeDependencyClosureManifest,
  sourceRowsSQL,
  startRedis,
};
