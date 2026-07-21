import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
import { REPO_ROOT, SIMULATOR_ROOT } from '../build/paths.mjs';
import { scenarioForQualifiedReports } from './scenario-fixture.mjs';

const APP_FIXTURE = path.join(REPO_ROOT, 'app-tools', 'test', 'fixtures', 'simulator-valid');
const DIRECTORY_LINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir';
const AUTHORITY_REFS = [{ owner: 'platform', rule_id: 'P-SIM-021' }];
const AUTHORITY_DIGEST = stableJsonDigest('nimi-simulator-hardening-authority-v1', AUTHORITY_REFS);

function git(repository, ...args) {
  return execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
}

function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'nimi-simulator-qualification-hardening-'));
  const appRoot = path.join(root, 'app');
  cpSync(APP_FIXTURE, appRoot, { recursive: true });
  const packagePath = path.join(appRoot, 'package.json');
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  packageJson.exports['./renderer'] = {
    browser: './src/renderer/factory.ts',
    default: './src/renderer/factory.ts',
  };
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '.');
  git(root, '-c', 'user.name=Nimi Simulator Test', '-c', 'user.email=simulator@example.invalid', 'commit', '-q', '-m', 'conditional exports');

  const simulatorRoot = path.join(root, 'simulator');
  mkdirSync(simulatorRoot);
  cpSync(path.join(SIMULATOR_ROOT, 'package.json'), path.join(simulatorRoot, 'package.json'));
  cpSync(path.join(SIMULATOR_ROOT, 'src'), path.join(simulatorRoot, 'src'), { recursive: true });
  symlinkSync(
    path.join(SIMULATOR_ROOT, 'node_modules'),
    path.join(simulatorRoot, 'node_modules'),
    DIRECTORY_LINK_TYPE,
  );
  return {
    root,
    appRoot,
    simulatorRoot,
    objectId: git(root, 'rev-parse', 'HEAD'),
    digest: buildSimulatorSourceInventory(appRoot).digest,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function descriptor(fixture) {
  const appProduction = {
    source_id: 'app',
    entries: ['src/main.ts'],
    inventory_digest: '',
    inventory_authority_refs: AUTHORITY_REFS,
  };
  appProduction.inventory_digest = appProductionInventoryDigest(appProduction);
  const hostInvocations = {
    entries: [{
      id: 'hardening-host',
      source_id: 'app',
      entry: 'src/main.ts',
      authority_refs: AUTHORITY_REFS,
    }],
    inventory_digest: '',
    inventory_authority_refs: AUTHORITY_REFS,
  };
  hostInvocations.inventory_digest = hostInvocationInventoryDigest(hostInvocations);
  return validateSelectedSourceDescriptor({
    schema: 'nimi.simulator.selected-source/v1',
    module_id: 'sample-app',
    source_app_id_ref: null,
    sources: [{
      id: 'app',
      kind: 'workspace',
      repository_key: 'hardening-fixture',
      object_format: 'git-sha1',
      object_id: fixture.objectId,
      root: 'app',
      expected_digest: fixture.digest,
      authority_refs: AUTHORITY_REFS,
      authority_index_digest: AUTHORITY_DIGEST,
    }],
    app_production: appProduction,
    host_invocations: hostInvocations,
    manifest: { source_id: 'app', path: 'nimi.simulator.yaml' },
  });
}

test('qualification rejects App-owned conditional package exports', () => {
  const fixture = createFixture();
  try {
    assert.throws(
      () => qualifySelectedModules({
        descriptors: [descriptor(fixture)],
        repositoryCatalog: { repositories: [] },
        scenario: scenarioForQualifiedReports([{
          moduleId: 'sample-app',
          report: validateSimulatorAppSource(fixture.appRoot).report,
        }]),
        repoRoot: REPO_ROOT,
        simulatorRoot: fixture.simulatorRoot,
        generatedRoot: path.join(fixture.simulatorRoot, '.generated'),
        workspaceRoot: fixture.root,
        workspaceRepositoryKey: 'hardening-fixture',
        release: true,
      }),
      (error) => error?.code === 'SIM_APP_OWNED_EXPORT_CONDITION',
    );
  } finally {
    fixture.cleanup();
  }
});
