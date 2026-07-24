import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterSecretScanFiles,
  generatedArtifactBaselineEntries,
  generatedSecretScanExclusion,
} from './lib/secret-scan-scope.mjs';

test('generated protocol stubs are excluded from secret scanning', () => {
  assert.equal(
    generatedSecretScanExclusion('runtime/gen/runtime/v1/account.pb.go')?.label,
    'runtime Go protobuf stubs',
  );
  assert.equal(
    generatedSecretScanExclusion('runtime/gen/runtime/v1/account_grpc.pb.go')?.label,
    'runtime Go protobuf stubs',
  );
  assert.equal(
    generatedSecretScanExclusion('sdks/typescript/core-generated/runtime-protobuf/runtime/v1/account.ts')?.label,
    'SDK vNext TypeScript protobuf stubs',
  );
  assert.equal(
    generatedSecretScanExclusion('sdks/typescript/core-generated/runtime-protobuf/google/protobuf/timestamp.ts')?.label,
    'SDK vNext TypeScript protobuf stubs',
  );
});

test('the generated OAuth logo module is narrowly excluded while its source asset remains scanned', () => {
  assert.equal(
    generatedSecretScanExclusion('kit/auth/src/logic/native-oauth-result-logo.ts')?.label,
    'native OAuth result logo data module',
  );

  const { scanned, excluded } = filterSecretScanFiles([
    'kit/auth/src/logic/native-oauth-result-logo.png',
    'kit/auth/src/logic/native-oauth-result-logo.ts',
    'kit/auth/src/logic/ordinary-base64-source.ts',
  ]);

  assert.deepEqual(scanned, [
    'kit/auth/src/logic/native-oauth-result-logo.png',
    'kit/auth/src/logic/ordinary-base64-source.ts',
  ]);
  assert.deepEqual(excluded.map((entry) => entry.file), [
    'kit/auth/src/logic/native-oauth-result-logo.ts',
  ]);
});

test('generated Platform catalog projections are excluded while their authority tables remain scanned', () => {
  const generatedPaths = [
    'kit/shell/capabilities/src/platform-projection.ts',
    'kit/shell/tauri/src/platform_catalog/nimi_app_registry.rs',
    'sdks/typescript/core/app/platform-catalog.generated.ts',
  ];

  for (const generatedPath of generatedPaths) {
    assert.equal(
      generatedSecretScanExclusion(generatedPath)?.label,
      'Platform app catalog projections',
    );
  }

  const sourcePath = 'config/platform-nimi-app-release-descriptors.yaml';
  const { scanned, excluded } = filterSecretScanFiles([sourcePath, ...generatedPaths]);
  assert.deepEqual(scanned, [sourcePath]);
  assert.deepEqual(excluded.map((entry) => entry.file), generatedPaths);
});

test('source proto files and ordinary source files remain in secret scan scope', () => {
  const { scanned, excluded } = filterSecretScanFiles([
    'proto/runtime/v1/account.proto',
    'runtime/internal/auditlog/store.go',
    'runtime/gen/runtime/v1/account.pb.go',
  ]);

  assert.deepEqual(scanned, [
    'proto/runtime/v1/account.proto',
    'runtime/internal/auditlog/store.go',
  ]);
  assert.deepEqual(excluded.map((entry) => entry.file), ['runtime/gen/runtime/v1/account.pb.go']);
});

test('baseline hygiene rejects generated artifact entries', () => {
  const entries = generatedArtifactBaselineEntries({
    results: {
      'kit/auth/src/logic/native-oauth-result-logo.ts': [],
      'kit/shell/capabilities/src/platform-projection.ts': [],
      'runtime/gen/runtime/v1/agent_service.pb.go': [],
      'sdks/typescript/core-generated/runtime-protobuf/runtime/v1/account.ts': [],
      'runtime/internal/auditlog/store.go': [],
    },
  });

  assert.deepEqual(entries, [
    'kit/auth/src/logic/native-oauth-result-logo.ts',
    'kit/shell/capabilities/src/platform-projection.ts',
    'runtime/gen/runtime/v1/agent_service.pb.go',
    'sdks/typescript/core-generated/runtime-protobuf/runtime/v1/account.ts',
  ]);
});
