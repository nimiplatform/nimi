import { describe, expect, test } from 'vitest';
import { ReasonCode } from '@nimiplatform/kit/core/sdk-contract';
import {
  getShellBridgeUserMessageProjection,
  parseShellBridgeJsonPayload,
  toShellBridgeNimiError,
} from '../shell/renderer/src/bridge/index.js';

describe('shell bridge Nimi error normalization', () => {
  test('preserves structured runtime bridge payload fields', () => {
    const error = toShellBridgeNimiError(JSON.stringify({
      reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
      actionHint: 'retry_or_switch_route',
      traceId: 'trace-kit-bridge-001',
      retryable: true,
      message: 'provider timeout',
      details: { provider: 'test' },
    }));

    expect(error.reasonCode).toBe(ReasonCode.AI_PROVIDER_TIMEOUT);
    expect(error.actionHint).toBe('retry_or_switch_route');
    expect(error.traceId).toBe('trace-kit-bridge-001');
    expect(error.retryable).toBe(true);
    expect(error.message).toBe('provider timeout');
    expect(error.details?.provider).toBe('test');
    expect(error.details?.userMessage).toBe('AI provider request timed out.');
  });

  test('maps shell bridge reason codes before generic fallback', () => {
    const projection = getShellBridgeUserMessageProjection(
      new Error('DESKTOP_HTTP_METHOD_INVALID: unsupported request method: TRACE'),
    );

    expect(projection).toEqual({
      key: 'BridgeErrors.codes.DESKTOP_HTTP_METHOD_INVALID',
      defaultValue: 'Unsupported request method. Please review the request configuration.',
    });
  });

  test('parses structured JSON embedded in bridge error text', () => {
    const parsed = parseShellBridgeJsonPayload(
      'bridge failed: {"reason_code":"DESKTOP_HTTP_PAYLOAD_INVALID","action_hint":"review_payload","trace_id":"trace-json"}',
    );

    expect(parsed).toEqual({
      reasonCode: 'DESKTOP_HTTP_PAYLOAD_INVALID',
      actionHint: 'review_payload',
      traceId: 'trace-json',
      retryable: undefined,
      message: undefined,
      code: undefined,
      details: {},
    });
  });

  test('allows apps to translate projected user messages', () => {
    const error = toShellBridgeNimiError(
      new Error('LOCAL_LIFECYCLE_WRITE_DENIED: caller=sideload'),
      { translate: (key, defaultValue) => `${key} => ${defaultValue}` },
    );

    expect(error.reasonCode).toBe('LOCAL_LIFECYCLE_WRITE_DENIED');
    expect(error.details?.userMessage).toBe(
      'BridgeErrors.codes.LOCAL_LIFECYCLE_WRITE_DENIED => The current source is not allowed to perform local model lifecycle writes.',
    );
  });
});
