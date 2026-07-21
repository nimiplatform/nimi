import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import {
  buildSimulatorSourceInventory,
  stableJsonDigest,
  validateSimulatorAppSource,
} from '@nimiplatform/app-tools/simulator-conformance';
import {
  appProductionInventoryDigest,
  hostInvocationInventoryDigest,
  loadSimulatorConfig,
  parseSelectedSourceDescriptor,
  validateSimulatorScenario,
  validateExternalRepositoryCatalog,
  validateSelectedSourceDescriptor,
} from '../build/config.mjs';
import { materializeSourceLocation } from '../build/materialize.mjs';
import {
  assertFreshAppToolsReport,
  qualifySelectedModules,
} from '../build/registry.mjs';
import { resolveMandatorySingletons } from '../build/resolver.mjs';
import { readSimulatorPublicEnvironment } from '../build/public-env.mjs';
import {
  CONFIG_ROOT,
  REPO_ROOT,
  SIMULATOR_ROOT,
} from '../build/paths.mjs';
import { scenarioForQualifiedReports } from './scenario-fixture.mjs';

const APP_FIXTURE = path.join(REPO_ROOT, 'app-tools', 'test', 'fixtures', 'simulator-valid');
const DIRECTORY_LINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir';
const AUTHORITY_DIGEST = stableJsonDigest('fixture-authority-index-v1', [
  { owner: 'platform', rule_id: 'P-SIM-003' },
]);
const AUTHORITY_REFS = [{ owner: 'platform', rule_id: 'P-SIM-003' }];

function git(repository, ...args) {
  return execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
}

function createGitFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'nimi-simulator-source-fixture-'));
  const appRoot = path.join(root, 'app');
  cpSync(APP_FIXTURE, appRoot, { recursive: true });
  writeFileSync(path.join(appRoot, 'package.json'), `${JSON.stringify({
    name: 'simulator-source-fixture',
    version: '1.0.0',
    private: true,
    dependencies: {
      zod: '4.4.3',
    },
    exports: {
      './renderer': './src/renderer/factory.ts',
      './styles': './src/renderer/styles.css',
    },
    scripts: {
      install: 'node -e "require(\'node:fs\').writeFileSync(\'source-script-ran\',\'bad\')"',
      build: 'node -e "require(\'node:fs\').writeFileSync(\'source-build-ran\',\'bad\')"',
    },
  }, null, 2)}\n`);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '.');
  git(root, '-c', 'user.name=Nimi Simulator Test', '-c', 'user.email=simulator@example.invalid', 'commit', '-q', '-m', 'fixture');
  const objectId = git(root, 'rev-parse', 'HEAD');
  const expectedDigest = buildSimulatorSourceInventory(appRoot).digest;
  return {
    root,
    appRoot,
    objectId,
    expectedDigest,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function createSimulatorBuildFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'nimi-simulator-build-fixture-'));
  cpSync(path.join(SIMULATOR_ROOT, 'package.json'), path.join(root, 'package.json'));
  cpSync(path.join(SIMULATOR_ROOT, 'src'), path.join(root, 'src'), { recursive: true });
  symlinkSync(path.join(SIMULATOR_ROOT, 'node_modules'), path.join(root, 'node_modules'), DIRECTORY_LINK_TYPE);
  return {
    root,
    generatedRoot: path.join(root, '.generated'),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function descriptorValue(fixture, { kind = 'workspace', repositoryKey = 'fixture' } = {}) {
  const appProduction = {
    source_id: 'app',
    entries: ['src/main.ts'],
    inventory_digest: '',
    inventory_authority_refs: AUTHORITY_REFS,
  };
  appProduction.inventory_digest = appProductionInventoryDigest(appProduction);
  const hostInvocations = {
    entries: [{
      id: 'fixture-host',
      source_id: 'app',
      entry: 'src/main.ts',
      authority_refs: AUTHORITY_REFS,
    }],
    inventory_digest: '',
    inventory_authority_refs: AUTHORITY_REFS,
  };
  hostInvocations.inventory_digest = hostInvocationInventoryDigest(hostInvocations);
  return {
    schema: 'nimi.simulator.selected-source/v1',
    module_id: 'sample-app',
    source_app_id_ref: null,
    sources: [{
      id: 'app',
      kind,
      repository_key: repositoryKey,
      object_format: 'git-sha1',
      object_id: fixture.objectId,
      root: 'app',
      expected_digest: fixture.expectedDigest,
      authority_refs: AUTHORITY_REFS,
      authority_index_digest: AUTHORITY_DIGEST,
    }],
    app_production: appProduction,
    host_invocations: hostInvocations,
    manifest: { source_id: 'app', path: 'nimi.simulator.yaml' },
  };
}

function externalCatalog(repositoryRoot) {
  return validateExternalRepositoryCatalog({
    schema: 'nimi.simulator.external-repository-catalog/v1',
    repositories: [{
      key: 'fixture-external',
      object_format: 'git-sha1',
      canonical_fetch_uri: pathToFileURL(repositoryRoot).href,
      allowed_mirrors: [],
    }],
  }, { allowFileUri: true });
}

test('tracked Simulator configuration selects immutable Tester with one digest-bound Scenario', () => {
  const config = loadSimulatorConfig(CONFIG_ROOT);
  assert.deepEqual(config.descriptors.map((entry) => entry.module_id), ['tester']);
  assert.deepEqual(config.repositoryCatalog.repositories, []);
  assert.equal(config.scenario.schema, 'nimi.simulator.scenario/v1');
  assert.deepEqual(config.scenario.module_data.map((entry) => entry.module_id), ['tester']);
  assert.match(config.scenario.digest, /^sha256:[0-9a-f]{64}$/u);
});

function scenarioValue() {
  return {
    schema: 'nimi.simulator.scenario/v1',
    scenario_id: 'scenario-test',
    scenario_revision: 'test',
    seed: 'a5'.repeat(32),
    initial_logical_time: 0,
    state: { scenario: {}, ecosystem: {}, shell: {} },
    module_data: [{ module_id: 'sample-app', data: {} }],
    enabled_capabilities: [],
    launch: [{ launch_id: 'sample-launch', module_id: 'sample-app', surface_id: 'main', activate: true }],
    readiness: [],
  };
}

test('Simulator Scenario schema fails closed before registry qualification', () => {
  const valid = scenarioValue();
  assert.doesNotThrow(() => validateSimulatorScenario(valid));
  assert.throws(
    () => validateSimulatorScenario({ ...valid, future_mode: 'implicit' }),
    (error) => error?.code === 'SIM_DESCRIPTOR_UNKNOWN_FIELD',
  );
  assert.throws(
    () => validateSimulatorScenario({
      ...valid,
      launch: [...valid.launch, { ...valid.launch[0] }],
    }),
    (error) => error?.code === 'SIM_SCENARIO_DUPLICATE',
  );
  assert.throws(
    () => validateSimulatorScenario({
      ...valid,
      readiness: [{
        module_id: 'sample-app',
        surface_id: 'main',
        contract_id: 'sample.main.usable',
        root_content_semantic_id: 'sample-main-root',
        primary_control: { semantic_id: 'sample-action', aria_role: 'button', accessible_name: 'Run' },
        projection: { kind: 'json_pointer_equals', json_pointer: '/invalid~2token', expected: true },
        blocking: { kind: 'no_active_overlay_lease' },
      }],
    }),
    (error) => error?.code === 'SIM_SCENARIO_JSON_POINTER',
  );
});

test('selected-source descriptor keeps App and host inventories independent', () => {
  const fixture = createGitFixture();
  try {
    const descriptor = validateSelectedSourceDescriptor(descriptorValue(fixture));
    assert.deepEqual(descriptor.app_production.entries, ['src/main.ts']);
    assert.equal(descriptor.host_invocations.entries[0].id, 'fixture-host');
    assert.notEqual(descriptor.app_production.inventory_digest, descriptor.host_invocations.inventory_digest);

    const forged = structuredClone(descriptorValue(fixture));
    forged.host_invocations.entries[0].entry = 'src/other.ts';
    assert.throws(
      () => validateSelectedSourceDescriptor(forged),
      (error) => error?.code === 'SIM_DESCRIPTOR_HOST_INVENTORY_DIGEST',
    );
  } finally {
    fixture.cleanup();
  }
});

test('selected-source and repository config schemas fail closed', () => {
  const fixture = createGitFixture();
  try {
    const base = descriptorValue(fixture);
    assert.throws(
      () => validateSelectedSourceDescriptor({ ...base, branch: 'main' }),
      (error) => error?.code === 'SIM_DESCRIPTOR_UNKNOWN_FIELD',
    );
    assert.throws(
      () => validateSelectedSourceDescriptor({ ...base, sources: [{ ...base.sources[0], object_id: fixture.objectId.slice(0, 12) }] }),
      (error) => error?.code === 'SIM_DESCRIPTOR_STRING',
    );
    assert.throws(
      () => validateSelectedSourceDescriptor({ ...base, sources: [{ ...base.sources[0], authority_refs: [] }] }),
      (error) => error?.code === 'SIM_DESCRIPTOR_AUTHORITY_REFS',
    );
    assert.throws(
      () => parseSelectedSourceDescriptor('schema: &schema nimi.simulator.selected-source/v1\nmodule_id: *schema\n', 'fixture'),
      (error) => ['SIM_DESCRIPTOR_YAML_ANCHOR', 'SIM_DESCRIPTOR_YAML_ALIAS'].includes(error?.code),
    );
    assert.throws(
      () => validateExternalRepositoryCatalog({
        schema: 'nimi.simulator.external-repository-catalog/v1',
        repositories: [{
          key: 'fixture-external',
          object_format: 'git-sha1',
          canonical_fetch_uri: 'https://token@example.invalid/repository.git',
          allowed_mirrors: [],
        }],
      }),
      (error) => error?.code === 'SIM_REPOSITORY_URI',
    );
    assert.throws(
      () => validateExternalRepositoryCatalog({
        schema: 'nimi.simulator.external-repository-catalog/v1',
        repositories: [{
          key: 'fixture-external',
          object_format: 'git-sha1',
          canonical_fetch_uri: pathToFileURL(fixture.root).href,
          allowed_mirrors: [],
        }],
      }),
      (error) => error?.code === 'SIM_REPOSITORY_URI',
    );
  } finally {
    fixture.cleanup();
  }
});

test('workspace and external-repository sources materialize to identical bytes without source scripts', () => {
  const fixture = createGitFixture();
  const staging = mkdtempSync(path.join(tmpdir(), 'nimi-simulator-materialized-'));
  try {
    const workspaceDescriptor = validateSelectedSourceDescriptor(descriptorValue(fixture));
    const externalDescriptor = validateSelectedSourceDescriptor(descriptorValue(fixture, {
      kind: 'external-repository',
      repositoryKey: 'fixture-external',
    }));
    const workspace = materializeSourceLocation(workspaceDescriptor.sources[0], { repositories: [] }, {
      workspaceRoot: fixture.root,
      workspaceRepositoryKey: 'fixture',
      stagingRoot: staging,
      targetRoot: path.join(staging, 'workspace'),
      moduleId: 'sample-app',
      release: true,
    });
    const external = materializeSourceLocation(externalDescriptor.sources[0], externalCatalog(fixture.root), {
      workspaceRoot: fixture.root,
      stagingRoot: staging,
      targetRoot: path.join(staging, 'external'),
      moduleId: 'sample-app',
      release: true,
    });
    assert.equal(workspace.sourceDigest, external.sourceDigest);
    assert.equal(workspace.fileCount, external.fileCount);
    assert.equal(workspace.sourceInstallScriptsExecuted, 0);
    assert.equal(workspace.sourceBuildScriptsExecuted, 0);
    assert.equal(external.sourceInstallScriptsExecuted, 0);
    assert.equal(external.sourceBuildScriptsExecuted, 0);
    assert.equal(existsSync(path.join(staging, 'workspace', 'source-script-ran')), false);
    assert.equal(existsSync(path.join(staging, 'external', 'source-build-ran')), false);
    assert.equal(workspace.root, 'source/sample-app/app/');
  } finally {
    fixture.cleanup();
    rmSync(staging, { recursive: true, force: true });
  }
});

test('materialization rejects digest mismatch and dirty release source', () => {
  const fixture = createGitFixture();
  const staging = mkdtempSync(path.join(tmpdir(), 'nimi-simulator-materialized-negative-'));
  try {
    const badDigest = validateSelectedSourceDescriptor({
      ...descriptorValue(fixture),
      sources: [{ ...descriptorValue(fixture).sources[0], expected_digest: `sha256:${'0'.repeat(64)}` }],
    });
    assert.throws(
      () => materializeSourceLocation(badDigest.sources[0], { repositories: [] }, {
        workspaceRoot: fixture.root,
        workspaceRepositoryKey: 'fixture',
        stagingRoot: staging,
        targetRoot: path.join(staging, 'bad-digest'),
        moduleId: 'sample-app',
        release: true,
      }),
      (error) => error?.code === 'SIM_SOURCE_DIGEST_MISMATCH',
    );

    writeFileSync(path.join(fixture.appRoot, 'dirty.ts'), 'export const dirty = true;\n');
    const descriptor = validateSelectedSourceDescriptor(descriptorValue(fixture));
    assert.throws(
      () => materializeSourceLocation(descriptor.sources[0], { repositories: [] }, {
        workspaceRoot: fixture.root,
        workspaceRepositoryKey: 'fixture',
        stagingRoot: staging,
        targetRoot: path.join(staging, 'dirty'),
        moduleId: 'sample-app',
        release: true,
      }),
      (error) => error?.code === 'SIM_SOURCE_DIRTY_RELEASE',
    );
  } finally {
    fixture.cleanup();
    rmSync(staging, { recursive: true, force: true });
  }
});

test('materialization rejects non-commit objects, symlinks, LFS pointers, and unknown repositories', async (context) => {
  await context.test('non-commit object', () => {
    const fixture = createGitFixture();
    const staging = mkdtempSync(path.join(tmpdir(), 'nimi-simulator-object-kind-'));
    try {
      const treeId = git(fixture.root, 'rev-parse', 'HEAD^{tree}');
      const value = descriptorValue(fixture);
      value.sources[0].object_id = treeId;
      const descriptor = validateSelectedSourceDescriptor(value);
      assert.throws(
        () => materializeSourceLocation(descriptor.sources[0], { repositories: [] }, {
          workspaceRoot: fixture.root,
          workspaceRepositoryKey: 'fixture',
          stagingRoot: staging,
          targetRoot: path.join(staging, 'tree'),
          moduleId: 'sample-app',
          release: true,
        }),
        (error) => error?.code === 'SIM_SOURCE_OBJECT_KIND',
      );
    } finally {
      fixture.cleanup();
      rmSync(staging, { recursive: true, force: true });
    }
  });

  await context.test('symbolic link', () => {
    const fixture = createGitFixture();
    const staging = mkdtempSync(path.join(tmpdir(), 'nimi-simulator-git-symlink-'));
    try {
      const linkTarget = 'src/main.ts';
      const linkBlob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
        cwd: fixture.root,
        encoding: 'utf8',
        input: linkTarget,
      }).trim();
      git(fixture.root, 'update-index', '--add', '--cacheinfo', `120000,${linkBlob},app/linked-main.ts`);
      git(fixture.root, '-c', 'user.name=Nimi Simulator Test', '-c', 'user.email=simulator@example.invalid', 'commit', '-q', '-m', 'symlink');
      git(fixture.root, 'reset', '--hard', '-q', 'HEAD');
      const value = descriptorValue(fixture);
      value.sources[0].object_id = git(fixture.root, 'rev-parse', 'HEAD');
      const descriptor = validateSelectedSourceDescriptor(value);
      assert.throws(
        () => materializeSourceLocation(descriptor.sources[0], { repositories: [] }, {
          workspaceRoot: fixture.root,
          workspaceRepositoryKey: 'fixture',
          stagingRoot: staging,
          targetRoot: path.join(staging, 'symlink'),
          moduleId: 'sample-app',
          release: true,
        }),
        (error) => error?.code === 'SIM_SOURCE_SYMLINK',
      );
    } finally {
      fixture.cleanup();
      rmSync(staging, { recursive: true, force: true });
    }
  });

  await context.test('Git LFS pointer', () => {
    const fixture = createGitFixture();
    const staging = mkdtempSync(path.join(tmpdir(), 'nimi-simulator-lfs-'));
    try {
      writeFileSync(path.join(fixture.appRoot, 'model.bin'), [
        'version https://git-lfs.github.com/spec/v1',
        `oid sha256:${'0'.repeat(64)}`,
        'size 1',
        '',
      ].join('\n'));
      git(fixture.root, 'add', '.');
      git(fixture.root, '-c', 'user.name=Nimi Simulator Test', '-c', 'user.email=simulator@example.invalid', 'commit', '-q', '-m', 'lfs');
      const value = descriptorValue(fixture);
      value.sources[0].object_id = git(fixture.root, 'rev-parse', 'HEAD');
      const descriptor = validateSelectedSourceDescriptor(value);
      assert.throws(
        () => materializeSourceLocation(descriptor.sources[0], { repositories: [] }, {
          workspaceRoot: fixture.root,
          workspaceRepositoryKey: 'fixture',
          stagingRoot: staging,
          targetRoot: path.join(staging, 'lfs'),
          moduleId: 'sample-app',
          release: true,
        }),
        (error) => error?.code === 'SIM_SOURCE_LFS_POINTER',
      );
    } finally {
      fixture.cleanup();
      rmSync(staging, { recursive: true, force: true });
    }
  });

  await context.test('unknown external repository', () => {
    const fixture = createGitFixture();
    const staging = mkdtempSync(path.join(tmpdir(), 'nimi-simulator-repository-'));
    try {
      const descriptor = validateSelectedSourceDescriptor(descriptorValue(fixture, {
        kind: 'external-repository',
        repositoryKey: 'fixture-external',
      }));
      assert.throws(
        () => materializeSourceLocation(descriptor.sources[0], { repositories: [] }, {
          workspaceRoot: fixture.root,
          stagingRoot: staging,
          targetRoot: path.join(staging, 'unknown'),
          moduleId: 'sample-app',
          release: true,
        }),
        (error) => error?.code === 'SIM_REPOSITORY_UNKNOWN',
      );
    } finally {
      fixture.cleanup();
      rmSync(staging, { recursive: true, force: true });
    }
  });
});

test('source inventory rejects symbolic links before report generation', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'nimi-simulator-symlink-'));
  try {
    const target = path.join(root, 'target');
    mkdirSync(target);
    writeFileSync(path.join(target, 'main.ts'), 'export {};\n');
    symlinkSync(target, path.join(root, 'link'), DIRECTORY_LINK_TYPE);
    assert.throws(
      () => buildSimulatorSourceInventory(root),
      (error) => error?.code === 'SIM_SOURCE_SYMLINK',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Simulator rejects forged and stale app-tools reports', () => {
  const fresh = validateSimulatorAppSource(APP_FIXTURE).report;
  const forged = structuredClone(fresh);
  forged.style.digest = `sha256:${'0'.repeat(64)}`;
  assert.throws(
    () => assertFreshAppToolsReport(forged, fresh),
    (error) => error?.code === 'SIM_APP_TOOLS_REPORT_FORGED',
  );

  const stale = structuredClone(fresh);
  stale.source.app_source_digest = `sha256:${'1'.repeat(64)}`;
  const { report_digest: ignored, ...body } = stale;
  void ignored;
  stale.report_digest = stableJsonDigest('nimi-simulator-app-tools-report-v1', body);
  assert.throws(
    () => assertFreshAppToolsReport(stale, fresh),
    (error) => error?.code === 'SIM_APP_TOOLS_REPORT_STALE',
  );
});

test('final resolver proves every canonical singleton tuple without absolute paths', () => {
  const resolver = resolveMandatorySingletons({ repoRoot: REPO_ROOT, simulatorRoot: SIMULATOR_ROOT });
  assert.equal(resolver.packages.length, 10);
  assert.match(resolver.tupleDigest, /^sha256:[0-9a-f]{64}$/);
  const tuples = new Set();
  for (const row of resolver.packages) {
    assert.match(row.version, /^\d+\.\d+\.\d+/);
    assert.match(row.lockIdentity, /^sha256:[0-9a-f]{64}$/);
    assert.equal(row.packageRootPath.startsWith('package/'), true);
    for (const target of row.targets) {
      const tuple = JSON.stringify([
        row.packageRootPath,
        row.version,
        row.lockIdentity,
        target.exportSubpath,
        target.phase,
        target.orderedConditions,
        target.canonicalTarget,
      ]);
      assert.equal(tuples.has(tuple), false);
      tuples.add(tuple);
      assert.equal(target.canonicalTarget.startsWith('/'), false);
    }
    if (row.targets.some((target) => target.phase === 'runtime')) {
      assert.match(row.runtimeIdentityDigest, /^sha256:[0-9a-f]{64}$/);
    }
  }
  assert.equal(JSON.stringify(resolver).includes(REPO_ROOT), false);
});

test('final resolver admits only exact App-specific dependencies used by the renderer closure', () => {
  const moduleRequirements = [{
    moduleId: 'sample-app',
    appSourceKind: 'external-repository',
    imports: ['zod'],
    requirements: { zod: '4.4.3' },
  }];
  const resolver = resolveMandatorySingletons({
    repoRoot: REPO_ROOT,
    simulatorRoot: SIMULATOR_ROOT,
    moduleRequirements,
  });
  const zod = resolver.packages.find((row) => row.name === 'zod');
  assert.ok(zod);
  assert.equal(zod.role, 'app-specific');
  assert.equal(zod.version, '4.4.3');
  assert.deepEqual(
    zod.targets.map(({ exportSubpath, phase }) => ({ exportSubpath, phase })),
    [
      { exportSubpath: '.', phase: 'types' },
      { exportSubpath: '.', phase: 'runtime' },
    ],
  );

  assert.throws(
    () => resolveMandatorySingletons({
      repoRoot: REPO_ROOT,
      simulatorRoot: SIMULATOR_ROOT,
      moduleRequirements: [{ ...moduleRequirements[0], requirements: { zod: '^4.4.3' } }],
    }),
    (error) => error?.code === 'SIM_RESOLVER_APP_DEPENDENCY_RANGE',
  );
  assert.throws(
    () => resolveMandatorySingletons({
      repoRoot: REPO_ROOT,
      simulatorRoot: SIMULATOR_ROOT,
      moduleRequirements: [{
        moduleId: 'sample-app',
        imports: ['simulator-undeclared-package'],
        requirements: { 'simulator-undeclared-package': '1.0.0' },
      }],
    }),
    (error) => error?.code === 'SIM_RESOLVER_ROOT_DECLARATION',
  );
  assert.throws(
    () => resolveMandatorySingletons({
      repoRoot: REPO_ROOT,
      simulatorRoot: SIMULATOR_ROOT,
      moduleRequirements: [
        moduleRequirements[0],
        { moduleId: 'other-app', imports: ['zod'], requirements: { zod: '4.4.2' } },
      ],
    }),
    (error) => error?.code === 'SIM_RESOLVER_APP_DEPENDENCY_CONFLICT',
  );
});

test('final resolver rejects selected Apps that drift from mandatory singleton versions', () => {
  assert.throws(
    () => resolveMandatorySingletons({
      repoRoot: REPO_ROOT,
      simulatorRoot: SIMULATOR_ROOT,
      moduleRequirements: [{
        moduleId: 'react-drift',
        appSourceKind: 'external-repository',
        imports: ['react'],
        requirements: { react: '18.3.1' },
      }],
    }),
    (error) => error?.code === 'SIM_RESOLVER_MANDATORY_DEPENDENCY_VERSION',
  );
  assert.throws(
    () => resolveMandatorySingletons({
      repoRoot: REPO_ROOT,
      simulatorRoot: SIMULATOR_ROOT,
      moduleRequirements: [{
        moduleId: 'react-range',
        appSourceKind: 'external-repository',
        imports: ['react'],
        requirements: { react: '^19.2.6' },
      }],
    }),
    (error) => error?.code === 'SIM_RESOLVER_MANDATORY_DEPENDENCY_RANGE',
  );
  assert.doesNotThrow(() => resolveMandatorySingletons({
    repoRoot: REPO_ROOT,
    simulatorRoot: SIMULATOR_ROOT,
    moduleRequirements: [{
      moduleId: 'workspace-kit',
      appSourceKind: 'workspace',
      imports: ['@nimiplatform/kit/ui'],
      requirements: { '@nimiplatform/kit': 'workspace:*' },
    }],
  }));
  assert.throws(
    () => resolveMandatorySingletons({
      repoRoot: REPO_ROOT,
      simulatorRoot: SIMULATOR_ROOT,
      moduleRequirements: [{
        moduleId: 'external-kit',
        appSourceKind: 'external-repository',
        imports: ['@nimiplatform/kit/ui'],
        requirements: { '@nimiplatform/kit': 'workspace:*' },
      }],
    }),
    (error) => error?.code === 'SIM_RESOLVER_MANDATORY_DEPENDENCY_RANGE',
  );
});

test('generated registry has resolved facts only and no hand-authored App row', () => {
  const fixture = createGitFixture();
  const simulator = createSimulatorBuildFixture();
  try {
    const descriptor = validateSelectedSourceDescriptor(descriptorValue(fixture, {
      kind: 'external-repository',
      repositoryKey: 'fixture-external',
    }));
    const report = validateSimulatorAppSource(fixture.appRoot).report;
    const registry = qualifySelectedModules({
      descriptors: [descriptor],
      repositoryCatalog: externalCatalog(fixture.root),
      scenario: scenarioForQualifiedReports([{ moduleId: 'sample-app', report }]),
      repoRoot: REPO_ROOT,
      simulatorRoot: simulator.root,
      generatedRoot: simulator.generatedRoot,
      workspaceRoot: fixture.root,
      workspaceRepositoryKey: 'fixture',
      release: true,
    });
    assert.equal(registry.moduleCount, 1);
    assert.equal(registry.modules[0].moduleId, 'sample-app');
    assert.equal(registry.modules[0].factoryPath, 'source/sample-app/app/src/renderer/factory.ts');
    assert.equal(registry.modules[0].rendererExport, 'sampleSimulatorRenderer');
    assert.equal(registry.modules[0].adapterExport, 'sampleSimulatorAdapterFactory');
    assert.match(registry.modules[0].canonicalStyleInputDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(registry.modules[0].hostInvocations[0].path, 'source/sample-app/app/src/main.ts');
    const zod = registry.modules[0].resolvedPackages.find((row) => row.name === 'zod');
    assert.ok(zod);
    assert.equal(zod.role, 'app-specific');
    assert.deepEqual(zod.targets.map((target) => target.exportSubpath), ['.', '.']);
    assert.equal(JSON.stringify(registry).includes(fixture.root), false);
    const generatedSource = readFileSync(path.join(simulator.generatedRoot, 'registry.ts'), 'utf8');
    assert.match(generatedSource, /virtual:nimi-simulator\/sample-app\/renderer/);
    assert.match(generatedSource, /virtual:nimi-simulator\/sample-app\/adapter/);
    assert.match(generatedSource, /loadAdapter/);
    assert.equal(generatedSource.includes(fixture.root), false);
    const materializationEvidence = readFileSync(
      path.join(simulator.generatedRoot, 'evidence', 'materialization.json'),
      'utf8',
    );
    assert.equal(materializationEvidence.includes(fixture.root), false);
    assert.equal(materializationEvidence.includes('file:'), false);
    assert.match(materializationEvidence, /"fetchIdentityDigest": "sha256:[0-9a-f]{64}"/);
    const cssEvidence = JSON.parse(readFileSync(
      path.join(simulator.generatedRoot, 'evidence', 'css-profile', 'sample-app.json'),
      'utf8',
    ));
    assert.equal(cssEvidence.canonical_style_input_digest, registry.modules[0].canonicalStyleInputDigest);
    assert.equal(cssEvidence.resolver_tuple_digest, registry.resolverTupleDigest);
  } finally {
    simulator.cleanup();
    fixture.cleanup();
  }
});


test('a host invocation in its own selected source reaches the exact App package factory and style exports', () => {
  const fixture = createGitFixture();
  const simulator = createSimulatorBuildFixture();
  try {
    const hostRoot = path.join(fixture.root, 'host');
    const hostSource = path.join(hostRoot, 'src');
    mkdirSync(hostSource, { recursive: true });
    writeFileSync(path.join(hostSource, 'main.ts'), [
      "import { sampleCanonicalRendererFactory } from 'simulator-source-fixture/renderer';",
      "import 'simulator-source-fixture/styles';",
      'export const invokeSelectedHost = sampleCanonicalRendererFactory;',
      '',
    ].join('\n'));
    git(fixture.root, 'add', '.');
    git(fixture.root, '-c', 'user.name=Nimi Simulator Test', '-c', 'user.email=simulator@example.invalid', 'commit', '-q', '-m', 'host');
    const objectId = git(fixture.root, 'rev-parse', 'HEAD');
    const hostDigest = buildSimulatorSourceInventory(hostRoot).digest;
    const value = descriptorValue(fixture);
    value.sources[0].object_id = objectId;
    value.sources.push({
      id: 'web-host',
      kind: 'workspace',
      repository_key: 'fixture',
      object_format: 'git-sha1',
      object_id: objectId,
      root: 'host',
      expected_digest: hostDigest,
      authority_refs: AUTHORITY_REFS,
      authority_index_digest: AUTHORITY_DIGEST,
    });
    value.host_invocations.entries = [{
      id: 'fixture-host',
      source_id: 'web-host',
      entry: 'src/main.ts',
      authority_refs: AUTHORITY_REFS,
    }];
    value.host_invocations.inventory_digest = hostInvocationInventoryDigest(value.host_invocations);
    const descriptor = validateSelectedSourceDescriptor(value);
    const report = validateSimulatorAppSource(fixture.appRoot).report;
    const registry = qualifySelectedModules({
      descriptors: [descriptor],
      repositoryCatalog: { repositories: [] },
      scenario: scenarioForQualifiedReports([{ moduleId: 'sample-app', report }]),
      repoRoot: REPO_ROOT,
      simulatorRoot: simulator.root,
      generatedRoot: simulator.generatedRoot,
      workspaceRoot: fixture.root,
      workspaceRepositoryKey: 'fixture',
      release: true,
    });
    assert.equal(registry.modules[0].sourceLocations.length, 2);
    assert.equal(registry.modules[0].hostInvocations[0].path, 'source/sample-app/web-host/src/main.ts');
  } finally {
    simulator.cleanup();
    fixture.cleanup();
  }
});

test('browser-public environment is an exact HTTPS-origin allowlist', () => {
  assert.deepEqual(readSimulatorPublicEnvironment({}), { publicOrigin: null });
  assert.deepEqual(
    readSimulatorPublicEnvironment({ NIMI_SIMULATOR_PUBLIC_ORIGIN: 'https://simulator.nimi.example' }),
    { publicOrigin: 'https://simulator.nimi.example' },
  );
  assert.throws(() => readSimulatorPublicEnvironment({ NIMI_SIMULATOR_PUBLIC_ORIGIN: 'http://localhost:3000' }));
  assert.deepEqual(readSimulatorPublicEnvironment({ VITE_SECRET_TOKEN: 'forbidden-but-not-read' }), { publicOrigin: null });
});
