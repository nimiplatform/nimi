import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterSecretScanFiles,
  excludedArtifactBaselineEntries,
  secretScanExclusion,
} from './lib/secret-scan-scope.mjs';
import { shouldApplySecretBaselineUpdate } from './lib/secret-scan-result.mjs';

test('explicit baseline update never applies a partial scanner result', () => {
  assert.equal(shouldApplySecretBaselineUpdate({ status: 3, baselineUpdated: true }, true), true);
  assert.equal(shouldApplySecretBaselineUpdate({ status: 1, baselineUpdated: true }, true), false);
  assert.equal(shouldApplySecretBaselineUpdate({ status: 3, baselineUpdated: true }, false), false);
});

test('generated protocol stubs are excluded from secret scanning', () => {
  assert.equal(
    secretScanExclusion('runtime/gen/runtime/v1/account.pb.go')?.label,
    'runtime Go protobuf stubs',
  );
  assert.equal(
    secretScanExclusion('runtime/gen/runtime/v1/account_grpc.pb.go')?.label,
    'runtime Go protobuf stubs',
  );
  assert.equal(
    secretScanExclusion('sdks/typescript/core-generated/runtime-protobuf/runtime/v1/account.ts')?.label,
    'SDK vNext TypeScript protobuf stubs',
  );
  assert.equal(
    secretScanExclusion('sdks/typescript/core-generated/runtime-protobuf/google/protobuf/timestamp.ts')?.label,
    'SDK vNext TypeScript protobuf stubs',
  );
  assert.equal(
    secretScanExclusion('runtime/gen/realm/v1/source_materialization_openapi.go')?.label,
    'Realm source-materialization OpenAPI projection',
  );
});

test('the generated OAuth logo module is narrowly excluded while its source asset remains scanned', () => {
  assert.equal(
    secretScanExclusion('kit/auth/src/logic/native-oauth-result-logo.ts')?.label,
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
      secretScanExclusion(generatedPath)?.label,
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

test('generated Runtime provider catalogs are excluded while catalog sources remain scanned', () => {
  assert.equal(
    secretScanExclusion('runtime/catalog/providers/local.yaml')?.label,
    'Runtime provider catalog projection',
  );

  const { scanned, excluded } = filterSecretScanFiles([
    'runtime/catalog/source/providers/local/50-models-embedding-and-asr.yaml',
    'runtime/catalog/source/providers/openai_codex.source.yaml',
    'runtime/catalog/providers/local.yaml',
    'runtime/catalog/providers/openai_codex.yaml',
  ]);

  assert.deepEqual(scanned, [
    'runtime/catalog/source/providers/local/50-models-embedding-and-asr.yaml',
    'runtime/catalog/source/providers/openai_codex.source.yaml',
  ]);
  assert.deepEqual(excluded.map((entry) => entry.file), [
    'runtime/catalog/providers/local.yaml',
    'runtime/catalog/providers/openai_codex.yaml',
  ]);
});

test('generated managed image packages are excluded while their source remains scanned', () => {
  const generatedPath = 'runtime/internal/engine/generated/managed-image-backend-packages.yaml';
  assert.equal(
    secretScanExclusion(generatedPath)?.label,
    'managed image backend package projection',
  );

  const { scanned, excluded } = filterSecretScanFiles([
    'config/runtime-managed-image-backend-packages.yaml',
    generatedPath,
  ]);
  assert.deepEqual(scanned, ['config/runtime-managed-image-backend-packages.yaml']);
  assert.deepEqual(excluded.map((entry) => entry.file), [generatedPath]);
});

test('signed reference vectors are narrowly excluded while ordinary testdata stays scanned', () => {
  const { scanned, excluded } = filterSecretScanFiles([
    'runtime/internal/services/runtimeagent/testdata/source-materialization-v3/persona-character.json',
    'runtime/internal/services/runtimeagent/testdata/source-materialization-v3/world-character.json',
    'runtime/internal/services/runtimeagent/testdata/source-materialization-v3/negative-mutations.json',
  ]);
  assert.deepEqual(scanned, [
    'runtime/internal/services/runtimeagent/testdata/source-materialization-v3/negative-mutations.json',
  ]);
  assert.deepEqual(excluded.map((entry) => entry.file), [
    'runtime/internal/services/runtimeagent/testdata/source-materialization-v3/persona-character.json',
    'runtime/internal/services/runtimeagent/testdata/source-materialization-v3/world-character.json',
  ]);
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

test('baseline hygiene rejects entries for excluded artifacts', () => {
  const entries = excludedArtifactBaselineEntries({
    results: {
      'kit/auth/src/logic/native-oauth-result-logo.ts': [],
      'runtime/gen/runtime/v1/agent_service.pb.go': [],
      'runtime/internal/services/runtimeagent/testdata/source-materialization-v3/persona-character.json': [],
      'sdks/typescript/core-generated/runtime-protobuf/runtime/v1/account.ts': [],
      'sdks/typescript/core/app/ai-profile-factory.generated.ts': [],
      'runtime/internal/auditlog/store.go': [],
    },
  });

  assert.deepEqual(entries, [
    'kit/auth/src/logic/native-oauth-result-logo.ts',
    'runtime/gen/runtime/v1/agent_service.pb.go',
    'runtime/internal/services/runtimeagent/testdata/source-materialization-v3/persona-character.json',
    'sdks/typescript/core-generated/runtime-protobuf/runtime/v1/account.ts',
    'sdks/typescript/core/app/ai-profile-factory.generated.ts',
  ]);
});
