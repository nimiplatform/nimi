import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  collectMissingRuntimeCapabilityPairs,
  collectMissingRuntimeGenerateProviders,
  collectRetiredSdkLiveAuthorityRefs,
  collectRetiredSdkLiveFixtureImports,
} from './check-live-provider-invariants.mjs';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, '..');

function definitions(input) {
  return new Map(
    Object.entries(input).map(([provider, capabilities]) => [
      provider,
      new Map(capabilities.map((capability) => [capability, new Set([`${provider}:${capability}`])])),
    ]),
  );
}

function sourceMatrix(input) {
  return new Map(
    Object.entries(input).map(([provider, capabilities]) => [provider, new Set(capabilities)]),
  );
}

test('Runtime-owned provider matrix accepts real provider-capability definitions', () => {
  const source = sourceMatrix({ dashscope: ['generate', 'embed'], local: ['generate'] });
  const runtime = definitions({ dashscope: ['generate', 'embed'], local: ['generate'] });

  assert.deepEqual(collectMissingRuntimeGenerateProviders(source, runtime), []);
  assert.deepEqual(collectMissingRuntimeCapabilityPairs(source, runtime), []);
});

test('Runtime-owned provider matrix fails when a declared capability has no definition', () => {
  const source = sourceMatrix({ dashscope: ['generate', 'embed'] });
  const runtime = definitions({ dashscope: ['generate'] });

  assert.deepEqual(collectMissingRuntimeCapabilityPairs(source, runtime), ['dashscope:embed']);
});

test('Runtime-owned provider matrix fails when a generate provider has no definition', () => {
  const source = sourceMatrix({ dashscope: ['generate'] });
  const runtime = definitions({});

  assert.deepEqual(collectMissingRuntimeGenerateProviders(source, runtime), ['dashscope']);
});

test('SDK carrier hardcut fixture has no retired live authority', () => {
  const refs = collectRetiredSdkLiveAuthorityRefs(repoRoot, [
    'scripts/fixtures/live-provider-invariants/sdk-carrier-positive.ts',
  ]);

  assert.deepEqual(refs, []);
});

test('Zhiyu active tests contain no retired SDK live-fixture imports', () => {
  assert.deepEqual(collectRetiredSdkLiveFixtureImports(repoRoot), []);
});

test('SDK daemon diagnostics retain no direct startup authority', () => {
  const refs = collectRetiredSdkLiveAuthorityRefs(repoRoot, [
    'sdks/typescript/runtime/live-runtime-daemon.test-helper.ts',
  ]);

  assert.deepEqual(refs, []);
});

test('SDK live acceptance retains the real fixed-service product carrier', () => {
  const journey = fs.readFileSync(path.join(repoRoot, 'config/local-agent-product-journeys.yaml'), 'utf8');
  assert.match(journey, /fixed_windows_service_local_development_cross_app/u);
  assert.match(journey, /fixed_windows_runtime_service/u);

  const driver = fs.readFileSync(
    path.join(repoRoot, 'tests/local-agent-product/harness/dev-kernel-cross-app-driver.mjs'),
    'utf8',
  );
  const hostDriver = fs.readFileSync(
    path.join(repoRoot, 'tests/local-agent-product/harness/dev-kernel-host-driver.mjs'),
    'utf8',
  );
  const fixedServiceContract = fs.readFileSync(
    path.join(repoRoot, 'tests/local-agent-product/harness/dev-kernel-fixed-service-contract.mjs'),
    'utf8',
  );
  assert.match(driver, /readFixedServiceStatus\(\)/u);
  assert.match(hostDriver, /assertFixedServiceStatus\(status\)/u);
  assert.match(fixedServiceContract, /status\?\.serviceName !== 'NimiRuntime'/u);
  assert.match(fixedServiceContract, /status\?\.serviceAccountMatches !== true/u);
  for (const field of ['serviceSidMatches', 'runtimeBinaryMatchesCandidate']) {
    assert.match(fixedServiceContract, new RegExp(`'${field}'`, 'u'));
  }
  assert.match(fixedServiceContract, /status\?\.\[field\] !== true/u);
  assert.doesNotMatch(driver, /\bwithRuntimeDaemon\b|go run \.\/cmd\/nimi|NIMI_RUNTIME_GRPC_ADDR/u);
});

test('SDK direct-daemon fixture is rejected', () => {
  const refs = collectRetiredSdkLiveAuthorityRefs(repoRoot, [
    'scripts/fixtures/live-provider-invariants/sdk-carrier-negative-direct-daemon.ts',
  ]);

  assert.deepEqual(refs.map((ref) => ref.token), ['direct_daemon']);
});

test('SDK public-grant fixture is rejected', () => {
  const refs = collectRetiredSdkLiveAuthorityRefs(repoRoot, [
    'scripts/fixtures/live-provider-invariants/sdk-carrier-negative-public-grant.ts',
  ]);

  assert.deepEqual(refs.map((ref) => ref.token).sort(), ['public_grant_facade', 'public_grant_rpc']);
});

test('SDK test-name-only matrix fixture is rejected', () => {
  const refs = collectRetiredSdkLiveAuthorityRefs(repoRoot, [
    'scripts/fixtures/live-provider-invariants/sdk-carrier-negative-test-name.ts',
  ]);

  assert.deepEqual(refs.map((ref) => ref.token), ['sdk_test_name_matrix']);
});
