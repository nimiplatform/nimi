import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
  sha256Digest,
  stableJson,
  stableJsonDigest,
} from '@nimiplatform/app-tools/simulator-conformance';

import { createMaterializedIntegrityVerifier } from './materialized-integrity.mjs';
import { resolveMandatorySingletons } from './resolver.mjs';

export const QUALIFICATION_CACHE_SCHEMA = 'nimi.simulator.qualification-cache/v1';
const CACHE_RELATIVE_PATH = 'evidence/qualification-cache.json';

export class QualificationCacheMiss extends Error {
  constructor(reason, detail = '') {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = 'QualificationCacheMiss';
    this.reason = reason;
  }
}

function canonicalPath(value) {
  return value.split(path.sep).join('/');
}

function readJson(filePath, reason) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new QualificationCacheMiss(reason, error instanceof Error ? error.message : String(error));
  }
}

function inventoryFiles(rootDir, { filter = () => true, prefix = '' } = {}) {
  const rows = [];
  const walk = (directory, relativeDirectory = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);
      const stat = lstatSync(absolutePath);
      if (stat.isSymbolicLink()) throw new QualificationCacheMiss('unsupported-control-entry', relativePath);
      if (stat.isDirectory()) {
        walk(absolutePath, relativePath);
      } else if (stat.isFile() && filter(relativePath)) {
        rows.push({
          path: prefix ? `${prefix}/${relativePath}` : relativePath,
          digest: sha256Digest(readFileSync(absolutePath)),
        });
      } else if (!stat.isFile()) {
        throw new QualificationCacheMiss('unsupported-control-entry', relativePath);
      }
    }
  };
  walk(rootDir);
  return rows;
}

function buildToolchainInventory({ repoRoot, simulatorRoot }) {
  const buildRoot = path.join(simulatorRoot, 'build');
  const appToolsRoot = path.join(repoRoot, 'app-tools', 'lib');
  const rows = [
    ...inventoryFiles(buildRoot, {
      prefix: 'apps/simulator/build',
      filter: (relativePath) => relativePath.endsWith('.mjs'),
    }),
    ...inventoryFiles(appToolsRoot, {
      prefix: 'app-tools/lib',
      filter: (relativePath) => path.posix.basename(relativePath).startsWith('simulator-') && relativePath.endsWith('.mjs'),
    }),
  ];
  for (const relativePath of [
    'apps/simulator/index.html',
    'apps/simulator/package.json',
    'apps/simulator/vite.config.ts',
    'app-tools/package.json',
    'pnpm-lock.yaml',
  ]) {
    rows.push({ path: relativePath, digest: sha256Digest(readFileSync(path.join(repoRoot, ...relativePath.split('/')))) });
  }
  return rows.sort((left, right) => left.path.localeCompare(right.path));
}

function buildPolicyInventory(repoRoot) {
  const policyRoot = path.join(repoRoot, 'config');
  return readdirSync(policyRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith('platform-simulator-') && entry.name.endsWith('.yaml'))
    .map((entry) => ({
      path: `config/${entry.name}`,
      digest: sha256Digest(readFileSync(path.join(policyRoot, entry.name))),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function descriptorWire(descriptor) {
  const { descriptor_label: ignored, ...wire } = descriptor;
  void ignored;
  return wire;
}

function scenarioWire(scenario) {
  const { descriptor_label: ignoredLabel, ...wire } = scenario;
  void ignoredLabel;
  return wire;
}

export function buildQualificationInput({
  descriptors,
  repositoryCatalog,
  scenario,
  resolver,
  publicWebIsolation,
  repoRoot,
  simulatorRoot,
}) {
  const body = {
    descriptors: descriptors.map(descriptorWire),
    repositoryCatalog,
    scenario: scenarioWire(scenario),
    resolver,
    publicWebIsolation,
    policies: buildPolicyInventory(repoRoot),
    toolchain: buildToolchainInventory({ repoRoot, simulatorRoot }),
  };
  return {
    body,
    digest: stableJsonDigest('nimi-simulator-qualification-input-v1', body),
  };
}

export function buildGeneratedControlInventory(generatedRoot) {
  return inventoryFiles(generatedRoot, {
    filter: (relativePath) => relativePath !== CACHE_RELATIVE_PATH
      && relativePath !== 'materialized'
      && !relativePath.startsWith('materialized/'),
  });
}

function readResolver(generatedRoot) {
  return readJson(path.join(generatedRoot, 'evidence', 'resolver.json'), 'resolver-evidence-missing');
}

export function writeQualificationCache({
  descriptors,
  repositoryCatalog,
  scenario,
  publicWebIsolation,
  generatedRoot,
  repoRoot,
  simulatorRoot,
}) {
  const resolver = readResolver(generatedRoot);
  const input = buildQualificationInput({
    descriptors,
    repositoryCatalog,
    scenario,
    resolver,
    publicWebIsolation,
    repoRoot,
    simulatorRoot,
  });
  const controlFiles = buildGeneratedControlInventory(generatedRoot);
  const registry = readJson(path.join(generatedRoot, 'registry.json'), 'registry-missing');
  const cache = {
    schema: QUALIFICATION_CACHE_SCHEMA,
    inputDigest: input.digest,
    controlDigest: stableJsonDigest('nimi-simulator-generated-controls-v1', controlFiles),
    controlFiles,
    registryDigest: registry.digest,
    resolverTupleDigest: resolver.tupleDigest,
    scenarioDigest: scenario.digest,
  };
  writeFileSync(path.join(generatedRoot, ...CACHE_RELATIVE_PATH.split('/')), `${JSON.stringify(cache, null, 2)}\n`);
  return cache;
}

function assertMaterializationMatchesDescriptors(descriptors, materialization) {
  const expected = [...descriptors]
    .sort((left, right) => left.module_id.localeCompare(right.module_id))
    .map((descriptor) => ({
      moduleId: descriptor.module_id,
      sourceLocations: descriptor.sources.map((source) => ({
        sourceId: source.id,
        kind: source.kind,
        repositoryKey: source.repository_key,
        objectFormat: source.object_format,
        objectId: source.object_id,
        root: `source/${descriptor.module_id}/${source.id}/`,
        sourceDigest: source.expected_digest,
        authorityRefs: source.authority_refs,
        authorityIndexDigest: source.authority_index_digest,
      })),
    }));
  const actual = materialization.map((moduleRow) => ({
    moduleId: moduleRow.moduleId,
    sourceLocations: (moduleRow.sourceLocations || []).map((source) => ({
      sourceId: source.sourceId,
      kind: source.kind,
      repositoryKey: source.repositoryKey,
      objectFormat: source.objectFormat,
      objectId: source.objectId,
      root: source.root,
      sourceDigest: source.sourceDigest,
      authorityRefs: source.authorityRefs,
      authorityIndexDigest: source.authorityIndexDigest,
    })),
  }));
  if (stableJson(actual) !== stableJson(expected)) {
    throw new QualificationCacheMiss('selected-source-input-drift');
  }
}

function freshResolverFromCache({ descriptors, generatedRoot, repoRoot, simulatorRoot }) {
  const moduleRequirements = descriptors.map((descriptor) => {
    const report = readJson(
      path.join(generatedRoot, 'evidence', 'app-tools', `${descriptor.module_id}.json`),
      'app-tools-report-missing',
    );
    return {
      moduleId: descriptor.module_id,
      appSourceKind: descriptor.sources.find((source) => source.id === 'app')?.kind,
      imports: report.dependencies?.imports,
      requirements: report.dependencies?.requirements,
    };
  });
  return resolveMandatorySingletons({ repoRoot, simulatorRoot, moduleRequirements });
}

export function validateQualificationCache({
  descriptors,
  repositoryCatalog,
  scenario,
  publicWebIsolation,
  generatedRoot,
  repoRoot,
  simulatorRoot,
}) {
  if (!existsSync(generatedRoot)) throw new QualificationCacheMiss('generated-root-missing');
  const cache = readJson(path.join(generatedRoot, ...CACHE_RELATIVE_PATH.split('/')), 'cache-record-missing');
  if (cache.schema !== QUALIFICATION_CACHE_SCHEMA) throw new QualificationCacheMiss('cache-schema-mismatch');

  const controlFiles = buildGeneratedControlInventory(generatedRoot);
  const controlDigest = stableJsonDigest('nimi-simulator-generated-controls-v1', controlFiles);
  if (controlDigest !== cache.controlDigest || stableJson(controlFiles) !== stableJson(cache.controlFiles)) {
    throw new QualificationCacheMiss('generated-control-drift');
  }

  const materialization = readJson(
    path.join(generatedRoot, 'evidence', 'materialization.json'),
    'materialization-evidence-missing',
  );
  assertMaterializationMatchesDescriptors(descriptors, materialization);
  try {
    createMaterializedIntegrityVerifier({ generatedRoot }).verifyAll();
  } catch (error) {
    throw new QualificationCacheMiss('materialized-source-drift', error instanceof Error ? error.message : String(error));
  }

  let resolver;
  try {
    resolver = freshResolverFromCache({ descriptors, generatedRoot, repoRoot, simulatorRoot });
  } catch (error) {
    throw new QualificationCacheMiss('resolver-drift', error instanceof Error ? error.message : String(error));
  }
  if (resolver.tupleDigest !== cache.resolverTupleDigest) throw new QualificationCacheMiss('resolver-tuple-drift');

  const input = buildQualificationInput({
    descriptors,
    repositoryCatalog,
    scenario,
    resolver,
    publicWebIsolation,
    repoRoot,
    simulatorRoot,
  });
  if (input.digest !== cache.inputDigest) throw new QualificationCacheMiss('qualification-input-drift');
  if (scenario.digest !== cache.scenarioDigest) throw new QualificationCacheMiss('scenario-drift');

  const registry = readJson(path.join(generatedRoot, 'registry.json'), 'registry-missing');
  if (registry.digest !== cache.registryDigest || registry.resolverTupleDigest !== resolver.tupleDigest) {
    throw new QualificationCacheMiss('registry-drift');
  }
  return cache;
}

export function qualificationCachePath(generatedRoot) {
  return path.join(generatedRoot, ...canonicalPath(CACHE_RELATIVE_PATH).split('/'));
}
