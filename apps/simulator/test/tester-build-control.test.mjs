import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildSimulatorSourceInventory,
  stableJsonDigest,
  validateSimulatorAppSource,
} from '@nimiplatform/app-tools/simulator-conformance';
import {
  appProductionInventoryDigest,
  hostInvocationInventoryDigest,
  validateSelectedSourceDescriptor,
} from '../build/config.mjs';
import { qualifySelectedModules } from '../build/registry.mjs';
import {
  REPO_ROOT,
  SIMULATOR_ROOT,
} from '../build/paths.mjs';

const TESTER_SOURCE = path.join(REPO_ROOT, 'apps', 'tester');

function git(repository, ...args) {
  return execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
}

function createTesterGitFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'nimi-simulator-tester-fixture-'));
  const appRoot = path.join(root, 'app');
  mkdirSync(appRoot, { recursive: true });
  const inventory = buildSimulatorSourceInventory(TESTER_SOURCE);
  for (const file of inventory.files) {
    const target = path.join(appRoot, ...file.path.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.bytes);
  }
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '.');
  git(root, '-c', 'user.name=Nimi Simulator Test', '-c', 'user.email=simulator@example.invalid', 'commit', '-q', '-m', 'tester fixture');
  return {
    root,
    appRoot,
    objectId: git(root, 'rev-parse', 'HEAD'),
    expectedDigest: buildSimulatorSourceInventory(appRoot).digest,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function createSimulatorProductBuildFixture() {
  const root = mkdtempSync(path.join(REPO_ROOT, 'apps', '.simulator-product-fixture-'));
  for (const entry of ['index.html', 'package.json', 'tsconfig.json', 'vite.config.ts']) {
    cpSync(path.join(SIMULATOR_ROOT, entry), path.join(root, entry));
  }
  for (const entry of ['build', 'src']) {
    cpSync(path.join(SIMULATOR_ROOT, entry), path.join(root, entry), { recursive: true });
  }
  symlinkSync(path.join(SIMULATOR_ROOT, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    process.removeListener('exit', cleanup);
    rmSync(root, { recursive: true, force: true });
  };
  process.once('exit', cleanup);
  return {
    root,
    generatedRoot: path.join(root, '.generated'),
    distRoot: path.join(root, 'dist'),
    cleanup,
  };
}

function testerDescriptorValue(fixture) {
  const authorityRefs = [{ owner: 'tester', rule_id: 'T-SIM-008' }];
  const appProduction = {
    source_id: 'app',
    entries: ['src/main.tsx'],
    inventory_digest: '',
    inventory_authority_refs: authorityRefs,
  };
  appProduction.inventory_digest = appProductionInventoryDigest(appProduction);
  const hostInvocations = {
    entries: [{
      id: 'tester-renderer',
      source_id: 'app',
      entry: 'src/main.tsx',
      authority_refs: authorityRefs,
    }],
    inventory_digest: '',
    inventory_authority_refs: authorityRefs,
  };
  hostInvocations.inventory_digest = hostInvocationInventoryDigest(hostInvocations);
  return {
    schema: 'nimi.simulator.selected-source/v1',
    module_id: 'tester',
    source_app_id_ref: 'nimi.tester',
    sources: [{
      id: 'app',
      kind: 'workspace',
      repository_key: 'tester-fixture',
      object_format: 'git-sha1',
      object_id: fixture.objectId,
      root: 'app',
      expected_digest: fixture.expectedDigest,
      authority_refs: authorityRefs,
      authority_index_digest: stableJsonDigest('nimi-simulator-tester-authority-v1', authorityRefs),
    }],
    app_production: appProduction,
    host_invocations: hostInvocations,
    manifest: { source_id: 'app', path: 'nimi.simulator.yaml' },
  };
}

function writePublicWebIsolationEvidence(generatedRoot) {
  const proof = {
    schema: 'nimi.simulator.public-web-isolation/v1',
    simulatorEdgeCount: 0,
    inventory: [],
  };
  const evidence = {
    ...proof,
    digest: stableJsonDigest('nimi-simulator-public-web-isolation-v1', proof),
  };
  mkdirSync(path.join(generatedRoot, 'evidence'), { recursive: true });
  writeFileSync(
    path.join(generatedRoot, 'evidence', 'public-web-isolation.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
}

function buildSelectedTesterArtifact(fixture, simulator) {
  const descriptor = validateSelectedSourceDescriptor(testerDescriptorValue(fixture));
  const registry = qualifySelectedModules({
    descriptors: [descriptor],
    repositoryCatalog: { repositories: [] },
    repoRoot: REPO_ROOT,
    simulatorRoot: simulator.root,
    generatedRoot: simulator.generatedRoot,
    workspaceRoot: fixture.root,
    workspaceRepositoryKey: 'tester-fixture',
    release: true,
  });
  writePublicWebIsolationEvidence(simulator.generatedRoot);
  execFileSync(
    path.join(SIMULATOR_ROOT, 'node_modules', '.bin', 'vite'),
    ['build', '--config', path.join(simulator.root, 'vite.config.ts')],
    { cwd: simulator.root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  execFileSync(
    process.execPath,
    [path.join(simulator.root, 'build', 'write-artifact-manifest.mjs')],
    { cwd: simulator.root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return registry;
}

function artifactSnapshot(rootDir, relativeDir = '') {
  const rows = [];
  for (const entry of readdirSync(path.join(rootDir, relativeDir), { withFileTypes: true })) {
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) rows.push(...artifactSnapshot(rootDir, relativePath));
    else if (entry.isFile()) rows.push([relativePath, readFileSync(path.join(rootDir, relativePath)).toString('base64')]);
    else throw new Error(`unsupported artifact entry ${relativePath}`);
  }
  return rows.sort(([left], [right]) => left.localeCompare(right));
}

test('real Tester source qualifies, builds through the final graph, and matches production CSS identity', () => {
  const fixture = createTesterGitFixture();
  const simulator = createSimulatorProductBuildFixture();
  try {
    const sourceReport = validateSimulatorAppSource(fixture.appRoot).report;
    const descriptor = validateSelectedSourceDescriptor(testerDescriptorValue(fixture));
    const registry = qualifySelectedModules({
      descriptors: [descriptor],
      repositoryCatalog: { repositories: [] },
      repoRoot: REPO_ROOT,
      simulatorRoot: simulator.root,
      generatedRoot: simulator.generatedRoot,
      workspaceRoot: fixture.root,
      workspaceRepositoryKey: 'tester-fixture',
      release: true,
    });
    assert.equal(registry.moduleCount, 1);
    assert.equal(registry.modules[0].moduleId, 'tester');
    assert.equal(registry.modules[0].factoryExport, 'testerCanonicalRendererFactory');
    assert.equal(registry.modules[0].rendererExport, 'testerSimulatorRenderer');
    assert.equal(registry.modules[0].adapterExport, 'testerSimulatorAdapterFactory');
    assert.match(registry.modules[0].canonicalStyleInputDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.match(registry.moduleCatalogDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.match(registry.readinessDeclarationDigest, /^sha256:[0-9a-f]{64}$/u);

    const catalogs = readFileSync(path.join(simulator.generatedRoot, 'runtime-catalogs.ts'), 'utf8');
    assert.match(catalogs, /tester\.capability\.execute/u);
    assert.match(catalogs, /tester-main-root/u);
    assert.equal(catalogs.includes('simulatorConformanceFixture'), false);
    assert.equal(catalogs.includes('src/simulator/fixture.ts'), false);
    assert.equal(catalogs.includes('Nimi connects apps through one shared'), false);

    const registrySource = readFileSync(path.join(simulator.generatedRoot, 'registry.ts'), 'utf8');
    assert.match(registrySource, /virtual:nimi-simulator\/tester\/renderer/u);
    assert.match(registrySource, /virtual:nimi-simulator\/tester\/adapter/u);
    assert.equal(registrySource.includes('fixture.ts'), false);
    const cssEvidence = JSON.parse(readFileSync(
      path.join(simulator.generatedRoot, 'evidence', 'css-profile', 'tester.json'),
      'utf8',
    ));
    assert.equal(cssEvidence.canonical_style_input_digest, registry.modules[0].canonicalStyleInputDigest);
    const appToolsEvidence = JSON.parse(readFileSync(
      path.join(simulator.generatedRoot, 'evidence', 'app-tools', 'tester.json'),
      'utf8',
    ));
    assert.equal(cssEvidence.identity.app.style_digest, appToolsEvidence.style.digest);
    assert.equal(cssEvidence.identity.app.style_digest, sourceReport.style.digest);
    assert.equal(validateSimulatorAppSource(fixture.appRoot).report.style.digest, sourceReport.style.digest);
    assert.equal(cssEvidence.identity.foundation.package.package, '@nimiplatform/kit');
    assert.equal(appToolsEvidence.style.production.app_selector_count_outside_canonical, 0);
    assert.deepEqual(
      appToolsEvidence.style.production.host_foundation_inputs.map((entry) => entry.path),
      ['src/styles.css'],
    );

    execFileSync(
      path.join(SIMULATOR_ROOT, 'node_modules', '.bin', 'vite'),
      ['build', '--config', path.join(simulator.root, 'vite.config.ts')],
      { cwd: simulator.root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    writePublicWebIsolationEvidence(simulator.generatedRoot);
    execFileSync(
      process.execPath,
      [path.join(simulator.root, 'build', 'write-artifact-manifest.mjs')],
      { cwd: simulator.root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    const artifact = JSON.parse(readFileSync(
      path.join(simulator.distRoot, 'simulator-artifact-manifest.json'),
      'utf8',
    ));
    assert.equal(artifact.selectedModuleCount, 1);
    assert.equal(artifact.selectedDependencyPackageCount > 0, true);
    assert.match(artifact.selectedDependencyClosureDigest, /^sha256:[0-9a-f]{64}$/u);
    const finalGraph = JSON.parse(readFileSync(
      path.join(simulator.distRoot, 'evidence', 'final-graph.json'),
      'utf8',
    ));
    assert.equal(finalGraph.selectedDependencyClosure.packages.length, artifact.selectedDependencyPackageCount);
    assert.equal(finalGraph.selectedDependencyClosure.digest, artifact.selectedDependencyClosureDigest);
    for (const dependency of finalGraph.selectedDependencyClosure.packages) {
      assert.match(dependency.lockIdentity, /^sha256:[0-9a-f]{64}$/u);
      assert.match(dependency.packageJsonDigest, /^sha256:[0-9a-f]{64}$/u);
      assert.equal(dependency.files.length > 0, true);
    }
    const buildCssEvidence = JSON.parse(readFileSync(
      path.join(simulator.distRoot, 'evidence', 'css-profile', 'tester.json'),
      'utf8',
    ));
    assert.equal(buildCssEvidence.canonical_style_input_digest, registry.modules[0].canonicalStyleInputDigest);
    assert.equal(buildCssEvidence.transformed.utility_selector_count > 0, true);
    const productionDist = path.join(simulator.root, 'tester-production-dist');
    execFileSync(
      path.join(SIMULATOR_ROOT, 'node_modules', '.bin', 'vite'),
      [
        'build',
        '--config', path.join(TESTER_SOURCE, 'vite.config.ts'),
        '--outDir', productionDist,
        '--emptyOutDir',
      ],
      { cwd: TESTER_SOURCE, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    const productionCssEvidence = JSON.parse(readFileSync(
      path.join(productionDist, 'evidence', 'css-profile', 'tester.json'),
      'utf8',
    ));
    assert.equal(productionCssEvidence.canonical_style_input_digest, buildCssEvidence.canonical_style_input_digest);
    assert.equal(productionCssEvidence.transformed.utility_selector_digest, buildCssEvidence.transformed.utility_selector_digest);
    assert.equal(productionCssEvidence.transformed.canonical_selector_count, buildCssEvidence.transformed.canonical_selector_count);
    assert.equal(productionCssEvidence.transformed.canonical_selector_digest, buildCssEvidence.transformed.canonical_selector_digest);
    assert.equal(productionCssEvidence.transformed.outside_canonical_asset_selector_count, 0);
    assert.equal(buildCssEvidence.transformed.outside_canonical_asset_selector_count, 0);
    assert.equal(productionCssEvidence.transformed.transformed_css_digest, buildCssEvidence.transformed.transformed_css_digest);
    const moduleCss = readdirSync(path.join(simulator.distRoot, 'assets'))
      .filter((entry) => entry.endsWith('.css'))
      .map((entry) => readFileSync(path.join(simulator.distRoot, 'assets', entry), 'utf8'))
      .find((source) => source.includes('simulator.module.tester'));
    assert.ok(moduleCss);
    assert.equal(moduleCss.includes('@property --tw-'), false);
    assert.equal(moduleCss.includes('.nimi-ui-module--tester .nimi-ui-module--tester'), false);
  } finally {
    simulator.cleanup();
    fixture.cleanup();
  }
});

test('non-empty Tester selection is byte-identical across two clean temporary roots', () => {
  const fixture = createTesterGitFixture();
  const first = createSimulatorProductBuildFixture();
  const second = createSimulatorProductBuildFixture();
  try {
    buildSelectedTesterArtifact(fixture, first);
    buildSelectedTesterArtifact(fixture, second);
    assert.deepEqual(artifactSnapshot(first.distRoot), artifactSnapshot(second.distRoot));
    const artifact = JSON.parse(readFileSync(
      path.join(first.distRoot, 'simulator-artifact-manifest.json'),
      'utf8',
    ));
    assert.equal(artifact.selectedModuleCount, 1);
    assert.equal(artifact.selectedDependencyPackageCount > 0, true);
  } finally {
    second.cleanup();
    first.cleanup();
    fixture.cleanup();
  }
});
