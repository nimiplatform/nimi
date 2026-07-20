#!/usr/bin/env node

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  sha256Digest,
  stableJsonDigest,
  SimulatorConformanceError,
} from '@nimiplatform/app-tools/simulator-conformance';
import { readSimulatorPublicEnvironment, SIMULATOR_PUBLIC_ENV_KEYS } from './public-env.mjs';
import { DIST_ROOT, GENERATED_ROOT, REPO_ROOT, SIMULATOR_ROOT } from './paths.mjs';
import {
  assetClassesFromFileList,
  generateSimulatorCsp,
  simulatorCspSatisfiesFloor,
} from '../src/effects/csp.ts';

const ARTIFACT_MANIFEST = 'simulator-artifact-manifest.json';
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{20,}\b/,
  /NIMI_[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY)/,
];

function fail(code, message, fieldPath = '') {
  throw new SimulatorConformanceError(code, message, fieldPath);
}

function collectFiles(rootDir, relativeDir = '') {
  const rows = [];
  for (const entry of readdirSync(path.join(rootDir, relativeDir), { withFileTypes: true })) {
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    if (relativePath === ARTIFACT_MANIFEST) continue;
    if (entry.isDirectory()) {
      rows.push(...collectFiles(rootDir, relativePath));
    } else if (entry.isFile()) {
      rows.push(relativePath);
    } else {
      fail('SIM_ARTIFACT_FILE_KIND', 'artifact contains a non-file entry', relativePath);
    }
  }
  return rows.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

function assertCredentialFree(relativePath, bytes) {
  const text = bytes.toString('utf8');
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) fail('SIM_ARTIFACT_SECRET', `credential-shaped output matched ${pattern}`, relativePath);
  }
  if (/import\.meta\.env\s*\[|process\.env\s*\[/.test(text)) {
    fail('SIM_ARTIFACT_WILDCARD_ENV', 'artifact contains wildcard environment access', relativePath);
  }
}

const registry = JSON.parse(readFileSync(path.join(GENERATED_ROOT, 'registry.json'), 'utf8'));
const finalGraph = JSON.parse(readFileSync(path.join(DIST_ROOT, 'evidence', 'final-graph.json'), 'utf8'));
if (finalGraph.schema !== 'nimi.simulator.final-graph/v1'
  || finalGraph.resolverTupleDigest !== registry.resolverTupleDigest
  || !Array.isArray(finalGraph.selectedModules)
  || !Array.isArray(finalGraph.packageTargets)
  || finalGraph.selectedDependencyClosure?.schema !== 'nimi.simulator.selected-dependency-closure/v1'
  || !Array.isArray(finalGraph.selectedDependencyClosure?.packages)) {
  fail('SIM_ARTIFACT_FINAL_GRAPH', 'final graph evidence is missing, malformed, or resolver-stale');
}
const { digest: dependencyClosureDigest, ...dependencyClosureBody } = finalGraph.selectedDependencyClosure;
if (dependencyClosureDigest !== stableJsonDigest(
  'nimi-simulator-selected-dependency-closure-v1',
  dependencyClosureBody,
)) {
  fail('SIM_ARTIFACT_DEPENDENCY_CLOSURE', 'selected dependency closure digest is invalid');
}
const resolverPackages = new Map(
  registry.modules.flatMap((moduleRow) => moduleRow.resolvedPackages || []).map((row) => [row.name, row]),
);
for (const row of finalGraph.selectedDependencyClosure.packages) {
  const resolverRow = resolverPackages.get(row.name);
  const { closureDigest, ...closureBody } = row || {};
  if (!resolverRow
    || resolverRow.role !== 'app-specific'
    || resolverRow.version !== row.version
    || resolverRow.lockIdentity !== row.lockIdentity
    || resolverRow.packageJsonDigest !== row.packageJsonDigest
    || !Array.isArray(row.files)
    || row.files.length === 0
    || closureDigest !== stableJsonDigest('nimi-simulator-selected-dependency-package-v1', closureBody)) {
    fail('SIM_ARTIFACT_DEPENDENCY_CLOSURE', `selected dependency closure is malformed or resolver-stale for ${JSON.stringify(row?.name)}`);
  }
}
const selectedModuleIds = registry.modules.map((row) => row.moduleId).sort();
const finalModuleIds = finalGraph.selectedModules.map((row) => row.moduleId).sort();
if (JSON.stringify(finalModuleIds) !== JSON.stringify(selectedModuleIds)) {
  fail('SIM_ARTIFACT_FINAL_GRAPH', 'final graph selected modules differ from the generated registry');
}
for (const row of finalGraph.selectedModules) {
  if (JSON.stringify(row.entries) !== JSON.stringify(['adapter', 'renderer', 'style'])) {
    fail('SIM_ARTIFACT_FINAL_GRAPH', `selected module ${JSON.stringify(row.moduleId)} lacks an exact renderer/Adapter/style graph`);
  }
}
const materialization = JSON.parse(readFileSync(path.join(GENERATED_ROOT, 'evidence', 'materialization.json'), 'utf8'));
const publicWebIsolation = JSON.parse(readFileSync(path.join(GENERATED_ROOT, 'evidence', 'public-web-isolation.json'), 'utf8'));
const { digest: publicWebIsolationDigest, ...publicWebIsolationProof } = publicWebIsolation;
if (
  publicWebIsolation.schema !== 'nimi.simulator.public-web-isolation/v1'
  || publicWebIsolation.simulatorEdgeCount !== 0
  || publicWebIsolationDigest !== stableJsonDigest('nimi-simulator-public-web-isolation-v1', publicWebIsolationProof)
) {
  fail('SIM_ARTIFACT_WEB_GRAPH', 'public Web isolation evidence is missing, stale, or contains a Simulator edge');
}
if (!Array.isArray(materialization) || materialization.length !== registry.moduleCount) {
  fail('SIM_ARTIFACT_MATERIALIZATION', 'materialization evidence must contain exactly one row per selected module');
}
const sourceLocations = materialization.flatMap((entry) => Array.isArray(entry.sourceLocations) ? entry.sourceLocations : []);
const sourceProvidedInstallScriptsExecuted = sourceLocations.reduce((sum, entry) => {
  if (!Number.isSafeInteger(entry.sourceInstallScriptsExecuted) || entry.sourceInstallScriptsExecuted < 0) {
    fail('SIM_ARTIFACT_MATERIALIZATION', 'invalid install-script execution count in materialization evidence');
  }
  return sum + entry.sourceInstallScriptsExecuted;
}, 0);
const sourceProvidedBuildScriptsExecuted = sourceLocations.reduce((sum, entry) => {
  if (!Number.isSafeInteger(entry.sourceBuildScriptsExecuted) || entry.sourceBuildScriptsExecuted < 0) {
    fail('SIM_ARTIFACT_MATERIALIZATION', 'invalid build-script execution count in materialization evidence');
  }
  return sum + entry.sourceBuildScriptsExecuted;
}, 0);
if (sourceProvidedInstallScriptsExecuted !== 0 || sourceProvidedBuildScriptsExecuted !== 0) {
  fail('SIM_ARTIFACT_SOURCE_SCRIPT', 'selected-source materialization executed source-provided scripts');
}
const publicEnvironment = readSimulatorPublicEnvironment();
const assetClasses = assetClassesFromFileList(collectFiles(DIST_ROOT));
const generatedCspPolicy = generateSimulatorCsp(assetClasses);
const indexHtml = readFileSync(path.join(SIMULATOR_ROOT, 'index.html'), 'utf8');
const CSP_META_PREFIX = '<meta http-equiv="Content-Security-Policy" content="';
const cspMetaStart = indexHtml.indexOf(CSP_META_PREFIX);
if (cspMetaStart === -1) {
  fail('SIM_ARTIFACT_CSP_MISSING', 'index.html must carry the generated CSP meta policy');
}
const cspValueStart = cspMetaStart + CSP_META_PREFIX.length;
const metaCspValue = indexHtml.slice(cspValueStart, indexHtml.indexOf('"', cspValueStart));
if (!simulatorCspSatisfiesFloor(metaCspValue)) {
  fail('SIM_ARTIFACT_CSP_FLOOR', 'index.html CSP meta does not satisfy the restrictive floor');
}
if (metaCspValue !== generatedCspPolicy) {
  fail(
    'SIM_ARTIFACT_CSP_DRIFT',
    `index.html CSP meta differs from the policy generated from the emitted artifact inventory: ${generatedCspPolicy}`,
  );
}
const files = collectFiles(DIST_ROOT).map((relativePath) => {
  const absolutePath = path.join(DIST_ROOT, ...relativePath.split('/'));
  const bytes = readFileSync(absolutePath);
  assertCredentialFree(relativePath, bytes);
  return {
    path: relativePath,
    mediaType: relativePath.endsWith('.html')
      ? 'text/html'
      : relativePath.endsWith('.js')
        ? 'text/javascript'
        : relativePath.endsWith('.css')
          ? 'text/css'
          : relativePath.endsWith('.json')
            ? 'application/json'
            : 'application/octet-stream',
    bytes: statSync(absolutePath).size,
    digest: sha256Digest(bytes),
  };
});

// Guard-first boundary: the entry chunk may statically contain only guard
// implementation and catalog data; the Shell graph is dynamic-import-only.
const viteManifest = JSON.parse(readFileSync(path.join(DIST_ROOT, 'vite-manifest.json'), 'utf8'));
const entryChunk = viteManifest['index.html'];
if (!entryChunk?.isEntry) {
  fail('SIM_ARTIFACT_ENTRY', 'vite manifest has no entry chunk');
}
if (Array.isArray(entryChunk.imports) && entryChunk.imports.length > 0) {
  fail('SIM_ARTIFACT_GUARD_BOUNDARY', `entry chunk statically imports ${entryChunk.imports.join(', ')}`);
}
const dynamicImports = entryChunk.dynamicImports ?? [];
const dynamicImportSources = dynamicImports.map((entry) => {
  const manifestRow = viteManifest[entry]
    ?? Object.values(viteManifest).find((candidate) => candidate?.file === entry);
  if (manifestRow?.src) return manifestRow.src;
  if (manifestRow?.isDynamicEntry === true && manifestRow?.name === 'mount') {
    return 'src/shell/mount.ts';
  }
  return entry;
});
if (dynamicImportSources.length !== 1 || dynamicImportSources[0] !== 'src/shell/mount.ts') {
  fail('SIM_ARTIFACT_GUARD_BOUNDARY', `entry chunk dynamic imports drifted: ${dynamicImportSources.join(', ')}`);
}
const manifest = {
  schema: 'nimi.simulator.artifact-manifest/v1',
  product: '@nimiplatform/simulator',
  selectedModuleCount: registry.moduleCount,
  selectedModuleRegistryDigest: registry.digest,
  selectedAppGraphCount: finalGraph.selectedModules.length,
  finalGraphResolverTupleDigest: finalGraph.resolverTupleDigest,
  finalGraphQualifiedPackageTargetCount: finalGraph.packageTargets.length,
  selectedDependencyPackageCount: finalGraph.selectedDependencyClosure.packages.length,
  selectedDependencyClosureDigest: dependencyClosureDigest,
  emptyGraphAppSourceEvaluationCount: registry.moduleCount === 0 ? 0 : null,
  publicWebGraphEdge: publicWebIsolation.simulatorEdgeCount > 0,
  publicWebIsolationDigest,
  browserPublicEnvironment: {
    allowlist: [...SIMULATOR_PUBLIC_ENV_KEYS],
    values: publicEnvironment,
    wildcardExposure: false,
  },
  csp: {
    policy: generatedCspPolicy,
    floorSatisfied: true,
  },
  guardBoundary: {
    entryChunk: entryChunk.file,
    staticShellImports: 0,
    dynamicShellEntries: dynamicImportSources,
  },
  buildInputs: {
    package: sha256Digest(readFileSync(path.join(SIMULATOR_ROOT, 'package.json'))),
    lockfile: sha256Digest(readFileSync(path.join(REPO_ROOT, 'pnpm-lock.yaml'))),
    registry: sha256Digest(readFileSync(path.join(GENERATED_ROOT, 'registry.json'))),
    vite: sha256Digest(readFileSync(path.join(SIMULATOR_ROOT, 'vite.config.ts'))),
  },
  sourceProvidedInstallScriptsExecuted,
  sourceProvidedBuildScriptsExecuted,
  files,
};
const output = {
  ...manifest,
  artifactRootDigest: stableJsonDigest('nimi-simulator-artifact-manifest-v1', manifest),
};
writeFileSync(path.join(DIST_ROOT, ARTIFACT_MANIFEST), `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`simulator-artifact: OK (${files.length} files, root ${output.artifactRootDigest})\n`);
