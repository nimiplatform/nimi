import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getShellBridgeUserMessageProjection,
  parseShellBridgeJsonPayload,
  toShellBridgeNimiError,
} from '../src/bridge/index.js';

const repoRoot = resolve(import.meta.dirname, '../../../..');

function readRepo(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

describe('shell bridge structured error normalization', () => {
  it('normalizes structured bridge payloads through the Kit bridge API', () => {
    const payload = {
      code: 'DESKTOP_HTTP_METHOD_INVALID',
      reasonCode: 'DESKTOP_HTTP_METHOD_INVALID',
      actionHint: 'review_request_config',
      traceId: 'trace-bridge-1',
      retryable: false,
      message: 'unsupported method',
      details: { method: 'TRACE' },
    };

    expect(parseShellBridgeJsonPayload(payload)).toEqual(payload);

    const error = toShellBridgeNimiError(JSON.stringify(payload));
    expect(error.reasonCode).toBe('DESKTOP_HTTP_METHOD_INVALID');
    expect(error.actionHint).toBe('review_request_config');
    expect(error.traceId).toBe('trace-bridge-1');
    expect(error.retryable).toBe(false);

    expect(getShellBridgeUserMessageProjection(error)).toEqual({
      key: 'BridgeErrors.codes.DESKTOP_HTTP_METHOD_INVALID',
      defaultValue: 'Unsupported request method. Please review the request configuration.',
    });
  });

  it('keeps lifecycle denial projection in Kit instead of Desktop-local maps', () => {
    expect(getShellBridgeUserMessageProjection(new Error('LOCAL_LIFECYCLE_WRITE_DENIED: caller=sideload'))).toEqual({
      key: 'BridgeErrors.codes.LOCAL_LIFECYCLE_WRITE_DENIED',
      defaultValue: 'The current source is not allowed to perform local model lifecycle writes.',
    });
  });

});
