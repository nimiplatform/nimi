#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const RELEASE_MANIFEST_SCHEMA = 'nimi.release-artifacts/v1';
export const DEFAULT_MANIFEST_NAME = 'release-manifest.json';

const COMPONENTS = new Set([
  'runtime',
  'sdk',
  'kit',
  'app-tools',
  'nimi-shell-tauri',
  'nimi-shell-protected-local',
  'proto',
]);

const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const CHANNELS = new Set(['canary', 'rc']);

function requiredString(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new Error(`${label} must be a non-empty trimmed string`);
  }
  return value;
}

function normalizeComponent(value) {
  const component = requiredString(value, 'component');
  if (!COMPONENTS.has(component)) {
    throw new Error(`unsupported release component: ${component}`);
  }
  return component;
}

function normalizeVersion(value) {
  const version = requiredString(value, 'version');
  if (!STABLE_SEMVER.test(version)) {
    throw new Error(`version must be an exact stable semver without a v prefix: ${version}`);
  }
  return version;
}

function normalizeCommit(value) {
  const commit = requiredString(value, 'commit').toLowerCase();
  if (!COMMIT_SHA.test(commit)) {
    throw new Error(`commit must be a full 40-character Git SHA: ${value}`);
  }
  return commit;
}

function normalizeChannel(value) {
  const channel = requiredString(value, 'channel');
  if (!CHANNELS.has(channel)) {
    throw new Error(`channel must be canary or rc: ${channel}`);
  }
  return channel;
}

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function artifactRecords(artifactsDir, manifestPath) {
  const directory = path.resolve(artifactsDir);
  const normalizedManifestPath = path.resolve(manifestPath);
  if (!existsSync(directory) || !lstatSync(directory).isDirectory()) {
    throw new Error(`artifacts directory does not exist: ${directory}`);
  }

  const records = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (path.resolve(filePath) === normalizedManifestPath) continue;
    if (!entry.isFile()) {
      throw new Error(`release artifacts directory must be flat and contain regular files only: ${filePath}`);
    }
    const stat = lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`release artifact must be a regular non-symlink file: ${filePath}`);
    }
    if (stat.size === 0) {
      throw new Error(`release artifact must not be empty: ${filePath}`);
    }
    records.push({
      name: entry.name,
      size: stat.size,
      sha256: sha256File(filePath),
    });
  }
  records.sort((left, right) => left.name.localeCompare(right.name));
  if (records.length === 0) {
    throw new Error(`no release artifact files found in ${directory}`);
  }
  return records;
}

function releaseTrainFromRcTag(rcTag) {
  const normalized = requiredString(rcTag, 'rcTag');
  const match = normalized.match(/^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))-rc\.([1-9]\d*)$/);
  if (!match) {
    throw new Error(`RC tag must be an exact global release-train tag vX.Y.Z-rc.N: ${normalized}`);
  }
  return { tag: normalized, version: match[1], rcNumber: match[2] };
}

export function createReleaseManifest({
  component,
  version,
  commit,
  channel,
  releaseTag = '',
  artifactsDir,
  outputPath,
}) {
  const normalizedComponent = normalizeComponent(component);
  const normalizedVersion = normalizeVersion(version);
  const normalizedCommit = normalizeCommit(commit);
  const normalizedChannel = normalizeChannel(channel);
  const normalizedReleaseTag = releaseTag
    ? releaseTrainFromRcTag(releaseTag).tag
    : '';
  if (normalizedChannel === 'rc' && !normalizedReleaseTag) {
    throw new Error('releaseTag is required when channel is rc');
  }
  if (normalizedChannel !== 'rc' && normalizedReleaseTag) {
    throw new Error('releaseTag is only valid when channel is rc');
  }

  const normalizedArtifactsDir = requiredString(artifactsDir, 'artifactsDir');
  const normalizedOutputPath = path.resolve(
    outputPath || path.join(normalizedArtifactsDir, DEFAULT_MANIFEST_NAME),
  );
  const manifest = {
    schema: RELEASE_MANIFEST_SCHEMA,
    component: normalizedComponent,
    version: normalizedVersion,
    commit: normalizedCommit,
    channel: normalizedChannel,
    ...(normalizedReleaseTag ? { releaseTag: normalizedReleaseTag } : {}),
    artifacts: artifactRecords(normalizedArtifactsDir, normalizedOutputPath),
  };
  mkdirSync(path.dirname(normalizedOutputPath), { recursive: true });
  writeFileSync(normalizedOutputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { manifest, outputPath: normalizedOutputPath };
}

function validateManifestShape(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('release manifest must be a JSON object');
  }
  if (manifest.schema !== RELEASE_MANIFEST_SCHEMA) {
    throw new Error(`unsupported release manifest schema: ${String(manifest.schema)}`);
  }
  const component = normalizeComponent(manifest.component);
  const version = normalizeVersion(manifest.version);
  const commit = normalizeCommit(manifest.commit);
  const channel = normalizeChannel(manifest.channel);
  if (channel === 'rc') {
    releaseTrainFromRcTag(requiredString(manifest.releaseTag, 'releaseTag'));
  } else if (manifest.releaseTag !== undefined) {
    throw new Error('releaseTag is only valid when channel is rc');
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    throw new Error('release manifest artifacts must be a non-empty array');
  }
  const seen = new Set();
  for (const artifact of manifest.artifacts) {
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      throw new Error('release manifest artifact must be an object');
    }
    const name = requiredString(artifact.name, 'artifact.name');
    if (name !== path.basename(name) || name === DEFAULT_MANIFEST_NAME) {
      throw new Error(`artifact name must be a plain file name: ${name}`);
    }
    if (seen.has(name)) throw new Error(`duplicate release artifact name: ${name}`);
    seen.add(name);
    if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0) {
      throw new Error(`artifact size must be a positive safe integer: ${name}`);
    }
    if (!/^[0-9a-f]{64}$/.test(String(artifact.sha256 || ''))) {
      throw new Error(`artifact sha256 is invalid: ${name}`);
    }
  }
  return { component, version, commit, channel };
}

export function readReleaseManifest(manifestPath) {
  const normalizedPath = path.resolve(manifestPath);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(normalizedPath, 'utf8'));
  } catch (error) {
    throw new Error(`failed to read release manifest ${normalizedPath}: ${String(error)}`);
  }
  validateManifestShape(parsed);
  return parsed;
}

export function verifyReleaseManifest({
  manifestPath,
  artifactsDir,
  component,
  version,
  commit,
  channel,
}) {
  const normalizedManifestPath = requiredString(manifestPath, 'manifestPath');
  const normalizedArtifactsDir = artifactsDir
    ? requiredString(artifactsDir, 'artifactsDir')
    : path.dirname(path.resolve(normalizedManifestPath));
  const manifest = readReleaseManifest(normalizedManifestPath);
  const expected = {
    ...(component ? { component: normalizeComponent(component) } : {}),
    ...(version ? { version: normalizeVersion(version) } : {}),
    ...(commit ? { commit: normalizeCommit(commit) } : {}),
    ...(channel ? { channel: normalizeChannel(channel) } : {}),
  };
  for (const [field, value] of Object.entries(expected)) {
    if (manifest[field] !== value) {
      throw new Error(`release manifest ${field} mismatch: expected ${value}, found ${manifest[field]}`);
    }
  }

  const actual = artifactRecords(normalizedArtifactsDir, path.resolve(normalizedManifestPath));
  if (JSON.stringify(actual) !== JSON.stringify(manifest.artifacts)) {
    throw new Error('release artifact files do not exactly match the manifest');
  }
  return manifest;
}

function gitCommitForRef(repoRoot, ref) {
  const result = spawnSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Git ref does not resolve to a commit: ${ref}`);
  }
  return normalizeCommit(String(result.stdout || '').trim());
}

export function verifyStablePromotion({
  manifestPath,
  artifactsDir,
  rcTag,
  stableTag,
  repoRoot = process.cwd(),
}) {
  const manifest = verifyReleaseManifest({ manifestPath, artifactsDir });
  const releaseTrain = releaseTrainFromRcTag(rcTag);
  const normalizedRcTag = releaseTrain.tag;
  if (manifest.channel !== 'rc') {
    throw new Error(`stable promotion requires an rc manifest; found channel ${manifest.channel}`);
  }
  if (manifest.releaseTag !== normalizedRcTag) {
    throw new Error(
      `RC manifest releaseTag mismatch: expected ${normalizedRcTag}, found ${String(manifest.releaseTag)}`,
    );
  }
  const normalizedStableTag = requiredString(stableTag, 'stableTag');
  const expected = `v${releaseTrain.version}`;
  if (normalizedStableTag !== expected) {
    throw new Error(`stable tag must be exactly ${expected}: ${normalizedStableTag}`);
  }
  const rcCommit = gitCommitForRef(repoRoot, normalizedRcTag);
  const stableCommit = gitCommitForRef(repoRoot, normalizedStableTag);
  if (rcCommit !== manifest.commit) {
    throw new Error(`RC tag commit ${rcCommit} does not match manifest commit ${manifest.commit}`);
  }
  if (stableCommit !== manifest.commit) {
    throw new Error(`stable tag commit ${stableCommit} does not match manifest commit ${manifest.commit}`);
  }
  return manifest;
}

function parseCli(argv) {
  const [command, ...args] = argv;
  if (!command) throw new Error('missing command: create, verify, or promote');
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--') continue;
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${token} requires a value`);
    if (values[key] !== undefined) throw new Error(`duplicate argument: ${token}`);
    values[key] = value;
    index += 1;
  }
  return { command, values };
}

function main(argv) {
  const { command, values } = parseCli(argv);
  if (command === 'create') {
    assertOnlyArguments(values, [
      'component', 'version', 'commit', 'channel', 'releaseTag', 'artifactsDir', 'output',
    ]);
    const result = createReleaseManifest({
      component: values.component,
      version: values.version,
      commit: values.commit,
      channel: values.channel,
      releaseTag: values.releaseTag,
      artifactsDir: values.artifactsDir,
      outputPath: values.output,
    });
    process.stdout.write(`[release-manifest] wrote ${result.outputPath}\n`);
    return;
  }
  if (command === 'verify') {
    assertOnlyArguments(values, [
      'manifest', 'artifactsDir', 'component', 'version', 'commit', 'channel',
    ]);
    const manifest = verifyReleaseManifest({
      manifestPath: values.manifest,
      artifactsDir: values.artifactsDir,
      component: values.component,
      version: values.version,
      commit: values.commit,
      channel: values.channel,
    });
    process.stdout.write(
      `[release-manifest] verified ${manifest.component} ${manifest.version} at ${manifest.commit}\n`,
    );
    return;
  }
  if (command === 'promote') {
    assertOnlyArguments(values, ['manifest', 'artifactsDir', 'rcTag', 'stableTag', 'repoRoot']);
    const manifest = verifyStablePromotion({
      manifestPath: values.manifest,
      artifactsDir: values.artifactsDir,
      rcTag: values.rcTag,
      stableTag: values.stableTag,
      repoRoot: values.repoRoot,
    });
    process.stdout.write(
      `[release-manifest] verified stable promotion for ${manifest.component} ${manifest.version} at ${manifest.commit}\n`,
    );
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

function assertOnlyArguments(values, allowed) {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(values).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) throw new Error(`unsupported argument(s): ${unknown.join(', ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`[release-manifest] ${error.stack ?? error.message ?? String(error)}\n`);
    process.exit(1);
  }
}
