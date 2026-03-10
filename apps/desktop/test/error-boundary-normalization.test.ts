import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INSTALL_ACTIONS_PATH = resolve(
  import.meta.dirname,
  '../src/shell/renderer/features/runtime-config/runtime-config-panel-controller-install-actions-models.ts',
);
const installActionsSource = readFileSync(INSTALL_ACTIONS_PATH, 'utf-8');

const DOWNLOADS_PATH = resolve(
  import.meta.dirname,
  '../src/shell/renderer/features/runtime-config/runtime-config-use-local-model-center-downloads.ts',
);
const downloadsSource = readFileSync(DOWNLOADS_PATH, 'utf-8');

const INVOKE_PATH = resolve(
  import.meta.dirname,
  '../src/shell/renderer/bridge/runtime-bridge/invoke.ts',
);
const invokeSource = readFileSync(INVOKE_PATH, 'utf-8');

describe('D-ERR-009: silent catch elimination in runtime-config install-actions', () => {
  test('D-ERR-009: runtime-config install-actions has no silent .catch(() => null) patterns', () => {
    assert.ok(
      !installActionsSource.includes('.catch(() => null)'),
      'install-actions must not contain .catch(() => null) — silent swallow violates D-ERR-009',
    );
  });

  test('D-ERR-009: runtime-config install-actions has no silent .catch(() => {}) patterns', () => {
    assert.ok(
      !installActionsSource.includes('.catch(() => {})'),
      'install-actions must not contain .catch(() => {}) — silent swallow violates D-ERR-009',
    );
  });

  test('D-ERR-009: runtime-config downloads has no silent .catch(() => {}) patterns', () => {
    assert.ok(
      !downloadsSource.includes('.catch(() => {})'),
      'downloads must not contain .catch(() => {}) — silent swallow violates D-ERR-009',
    );
  });

  test('D-ERR-009: runtime-config install-actions logs errors in catch blocks', () => {
    assert.match(
      installActionsSource,
      /emitRuntimeLog\s*\(/,
      'install-actions catch blocks must call emitRuntimeLog for error observability (D-ERR-009)',
    );
  });

  test('D-ERR-009: runtime-config downloads logs errors in catch blocks', () => {
    assert.match(
      downloadsSource,
      /emitRuntimeLog\s*\(/,
      'downloads catch blocks must call emitRuntimeLog for error observability (D-ERR-009)',
    );
  });
});

describe('D-ERR-011: toBridgeNimiError structured field extraction in invoke.ts', () => {
  test('D-ERR-011: invoke.ts toBridgeNimiError extracts reasonCode', () => {
    assert.match(
      invokeSource,
      /reasonCode/,
      'toBridgeNimiError must extract reasonCode field (D-ERR-011)',
    );
  });

  test('D-ERR-011: invoke.ts toBridgeNimiError extracts actionHint', () => {
    assert.match(
      invokeSource,
      /actionHint/,
      'toBridgeNimiError must extract actionHint field (D-ERR-011)',
    );
  });

  test('D-ERR-011: invoke.ts toBridgeNimiError extracts traceId', () => {
    assert.match(
      invokeSource,
      /traceId/,
      'toBridgeNimiError must extract traceId field (D-ERR-011)',
    );
  });

  test('D-ERR-011: invoke.ts toBridgeNimiError extracts retryable', () => {
    assert.match(
      invokeSource,
      /retryable/,
      'toBridgeNimiError must extract retryable field (D-ERR-011)',
    );
  });

  test('D-ERR-011: invoke.ts toBridgeNimiError extracts rawMessage', () => {
    assert.match(
      invokeSource,
      /rawMessage/,
      'toBridgeNimiError must extract rawMessage field (D-ERR-011)',
    );
  });
});
