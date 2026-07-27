import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { sha256Digest } from '@nimiplatform/app-tools/simulator-conformance';
import { createSelectedDependencyQualifier } from '../build/dependency-boundary.mjs';

function withPackage(run) {
  const root = mkdtempSync(path.join(tmpdir(), 'nimi-simulator-dependency-'));
  const packageRoot = path.join(root, 'node_modules', 'selected-safe');
  mkdirSync(packageRoot, { recursive: true });
  const packagePath = path.join(packageRoot, 'package.json');
  writeFileSync(packagePath, '{"name":"selected-safe","version":"1.2.3","type":"module"}\n');
  const entryPath = path.join(packageRoot, 'index.js');
  const internalPath = path.join(packageRoot, 'internal.js');
  writeFileSync(entryPath, "import { value } from './internal.js';\nexport { value };\n");
  writeFileSync(internalPath, 'export function value() { return 1; }\n');
  const resolver = {
    packages: [{
      name: 'selected-safe',
      version: '1.2.3',
      role: 'app-specific',
      lockIdentity: `sha256:${'1'.repeat(64)}`,
      packageJsonDigest: sha256Digest(readFileSync(packagePath)),
    }],
  };
  try {
    return run({ root, resolver, entryPath, internalPath });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function scanClosure(fixture) {
  const qualifier = createSelectedDependencyQualifier({
    simulatorRoot: fixture.root,
    resolver: fixture.resolver,
  });
  assert.equal(qualifier.markPackageTarget('selected-safe', fixture.entryPath, true), true);
  qualifier.validateTransform(readFileSync(fixture.entryPath, 'utf8'), fixture.entryPath);
  assert.equal(qualifier.markResolvedEdge(fixture.entryPath, fixture.internalPath), true);
  qualifier.validateTransform(readFileSync(fixture.internalPath, 'utf8'), fixture.internalPath);
  return qualifier;
}

test('selected dependency scan accepts the exact reached runtime closure', () => withPackage((fixture) => {
  assert.doesNotThrow(() => scanClosure(fixture).finalize());
}));

test('selected dependency scan rejects governed effects in a transitive file', () => withPackage((fixture) => {
  writeFileSync(fixture.internalPath, 'export function value() { return Math.random(); }\n');
  const qualifier = createSelectedDependencyQualifier({
    simulatorRoot: fixture.root,
    resolver: fixture.resolver,
  });
  qualifier.markPackageTarget('selected-safe', fixture.entryPath, true);
  qualifier.validateTransform(readFileSync(fixture.entryPath, 'utf8'), fixture.entryPath);
  assert.throws(
    () => qualifier.markResolvedEdge(fixture.entryPath, fixture.internalPath),
    (error) => error?.code === 'SIMULATOR_EFFECT_FORBIDDEN',
  );
}));

test('selected dependency finalization rejects post-scan byte drift', () => withPackage((fixture) => {
  const qualifier = scanClosure(fixture);
  writeFileSync(fixture.internalPath, 'export function value() { return 2; }\n');
  assert.throws(
    () => qualifier.finalize(),
    (error) => error?.code === 'SIM_DEPENDENCY_FILE_DRIFT',
  );
}));
