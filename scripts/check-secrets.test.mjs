import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterSecretScanFiles,
  generatedProtocolBaselineEntries,
  generatedProtocolSecretScanExclusion,
} from './lib/secret-scan-scope.mjs';

test('generated protocol stubs are excluded from secret scanning', () => {
  assert.equal(
    generatedProtocolSecretScanExclusion('runtime/gen/runtime/v1/account.pb.go')?.label,
    'runtime Go protobuf stubs',
  );
  assert.equal(
    generatedProtocolSecretScanExclusion('runtime/gen/runtime/v1/account_grpc.pb.go')?.label,
    'runtime Go protobuf stubs',
  );
  assert.equal(
    generatedProtocolSecretScanExclusion('sdk/src/runtime/generated/runtime/v1/account.ts')?.label,
    'SDK TypeScript protobuf stubs',
  );
  assert.equal(
    generatedProtocolSecretScanExclusion('sdk/src/runtime/generated/google/protobuf/timestamp.ts')?.label,
    'SDK TypeScript protobuf stubs',
  );
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

test('baseline hygiene rejects generated protocol stub entries', () => {
  const entries = generatedProtocolBaselineEntries({
    results: {
      'runtime/gen/runtime/v1/agent_service.pb.go': [],
      'sdk/src/runtime/generated/runtime/v1/account.ts': [],
      'runtime/internal/auditlog/store.go': [],
    },
  });

  assert.deepEqual(entries, [
    'runtime/gen/runtime/v1/agent_service.pb.go',
    'sdk/src/runtime/generated/runtime/v1/account.ts',
  ]);
});
