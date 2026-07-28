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

test('generated Platform AI profile projection is excluded while sources remain scanned', () => {
  const generatedPaths = [
    'sdks/typescript/core/app/ai-profile-factory.generated.ts',
  ];

  for (const generatedPath of generatedPaths) {
    assert.equal(
      generatedSecretScanExclusion(generatedPath)?.label,
      'Platform AI profile catalog projection',
    );
  }

  const sourcePaths = [
    'config/platform-ai-profile-factory-catalog.yaml',
    'kit/shell/capabilities/src/platform-projection.ts',
  ];
  const { scanned, excluded } = filterSecretScanFiles([...sourcePaths, ...generatedPaths]);
  assert.deepEqual(scanned, sourcePaths);
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
      'runtime/gen/runtime/v1/agent_service.pb.go': [],
      'sdks/typescript/core-generated/runtime-protobuf/runtime/v1/account.ts': [],
      'sdks/typescript/core/app/ai-profile-factory.generated.ts': [],
      'runtime/internal/auditlog/store.go': [],
    },
  });

  assert.deepEqual(entries, [
    'kit/auth/src/logic/native-oauth-result-logo.ts',
    'runtime/gen/runtime/v1/agent_service.pb.go',
    'sdks/typescript/core-generated/runtime-protobuf/runtime/v1/account.ts',
    'sdks/typescript/core/app/ai-profile-factory.generated.ts',
  ]);
});
