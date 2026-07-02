import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { transformSync } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

const fixture = {
  ownerUserId: 'user-live',
  runtimeSourceRef: 'runtime-source:worldCharacter:world-live:source-live:hash-live',
  sourceRef: {
    kind: 'worldCharacter',
    worldId: 'world-live',
    sourceId: 'source-live',
    sourceContentHash: 'hash-live',
  },
  route: {
    capability: 'text.generate',
    selectedTargetRefKind: 'local-runtime',
    resolvedBindingRef: 'local:text.generate:fixture',
    executionBinding: {
      route: 'local',
      modelId: 'local/live-runtime-fixture',
    },
  },
};

test('acceptance fixture projection is ignored outside the Electron SDK acceptance gate', async () => {
  installWindow(`file:///zhiyu/index.html?${fixtureParam()}`);
  const { readZhiyuLiveRuntimeFixtureProjection } = await loadModule();

  assert.equal(readZhiyuLiveRuntimeFixtureProjection(), null);
});

test('source and route probes consume acceptance fixture projection without app-local truth', async () => {
  installWindow(`file:///zhiyu/index.html?nimiElectronSdkAcceptance=1&${fixtureParam()}`);
  const {
    readZhiyuLiveRuntimeFixtureProjection,
    sourceStatusFromZhiyuLiveRuntimeFixture,
    routeStatusFromZhiyuLiveRuntimeFixture,
  } = await loadModule();

  const projection = readZhiyuLiveRuntimeFixtureProjection();
  const source = sourceStatusFromZhiyuLiveRuntimeFixture(projection);
  assert.equal(source.ready, true);
  assert.equal(source.reasonCode, 'runtime-source-projected');
  assert.equal(source.source, 'sdk-fixture');
  assert.equal(source.ownerUserId, fixture.ownerUserId);
  assert.equal(source.runtimeSourceRef, fixture.runtimeSourceRef);
  assert.deepEqual(source.sourceRef, fixture.sourceRef);

  const route = routeStatusFromZhiyuLiveRuntimeFixture(projection);
  assert.equal(route.ready, true);
  assert.equal(route.reasonCode, 'runtime-route-ready');
  assert.equal(route.source, 'sdk-fixture');
  assert.equal(route.selectedTargetRefKind, 'local-runtime');
  assert.equal(route.resolvedBindingRef, fixture.route.resolvedBindingRef);
  assert.deepEqual(route.executionBinding, fixture.route.executionBinding);
});

async function loadModule() {
  const sourcePath = path.join(root, 'src/shell/agent/live-runtime-fixture.ts');
  const source = readFileSync(sourcePath, 'utf8');
  const output = transformSync(source, {
    loader: 'ts',
    format: 'esm',
    target: 'es2022',
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`);
}

function installWindow(url) {
  globalThis.window = {
    location: {
      href: url,
    },
    __NIMI_ELECTRON_RUNTIME__: {
      invoke() {
        throw new Error('fixture projection test does not invoke Electron Runtime');
      },
    },
  };
}

function fixtureParam() {
  return `nimiZhiyuLiveRuntimeFixture=${Buffer.from(JSON.stringify(fixture), 'utf8').toString('base64url')}`;
}
