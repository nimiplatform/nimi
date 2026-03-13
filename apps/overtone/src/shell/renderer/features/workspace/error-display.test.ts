import { describe, it, expect } from 'vitest';
import { classifyError } from './error-display.js';

function makeNimiError(reasonCode: string): unknown {
  return {
    message: 'test error',
    reasonCode,
    actionHint: 'test',
    traceId: 'trace-1',
    retryable: false,
    source: 'runtime',
  };
}

describe('classifyError', () => {
  it('classifies AI_PROVIDER_UNAVAILABLE as retry', () => {
    const result = classifyError(makeNimiError('AI_PROVIDER_UNAVAILABLE'));
    expect(result.actionType).toBe('retry');
    expect(result.retryable).toBe(true);
    expect(result.reasonCode).toBe('AI_PROVIDER_UNAVAILABLE');
  });

  it('classifies AI_PROVIDER_AUTH_FAILED as setup_connector', () => {
    const result = classifyError(makeNimiError('AI_PROVIDER_AUTH_FAILED'));
    expect(result.actionType).toBe('setup_connector');
    expect(result.retryable).toBe(false);
  });

  it('classifies AI_MEDIA_SPEC_INVALID as validation', () => {
    const result = classifyError(makeNimiError('AI_MEDIA_SPEC_INVALID'));
    expect(result.actionType).toBe('validation');
    expect(result.retryable).toBe(false);
  });

  it('classifies AI_MEDIA_OPTION_UNSUPPORTED as validation', () => {
    const result = classifyError(makeNimiError('AI_MEDIA_OPTION_UNSUPPORTED'));
    expect(result.actionType).toBe('validation');
    expect(result.retryable).toBe(false);
  });

  it('classifies AI_PROVIDER_RATE_LIMITED as cooldown with cooldownMs', () => {
    const result = classifyError(makeNimiError('AI_PROVIDER_RATE_LIMITED'));
    expect(result.actionType).toBe('cooldown');
    expect(result.retryable).toBe(true);
    expect(result.cooldownMs).toBe(30_000);
  });

  it('classifies AI_CONTENT_FILTER_BLOCKED as content_warning', () => {
    const result = classifyError(makeNimiError('AI_CONTENT_FILTER_BLOCKED'));
    expect(result.actionType).toBe('content_warning');
    expect(result.retryable).toBe(false);
  });

  it('classifies AI_PROVIDER_TIMEOUT as timeout_retry', () => {
    const result = classifyError(makeNimiError('AI_PROVIDER_TIMEOUT'));
    expect(result.actionType).toBe('timeout_retry');
    expect(result.retryable).toBe(true);
  });

  it('classifies AI_JOB_TIMEOUT as timeout_retry', () => {
    const result = classifyError(makeNimiError('AI_JOB_TIMEOUT'));
    expect(result.actionType).toBe('timeout_retry');
    expect(result.retryable).toBe(true);
  });

  it('classifies unknown reason code as generic', () => {
    const result = classifyError(makeNimiError('SOME_UNKNOWN_CODE'));
    expect(result.actionType).toBe('generic');
    expect(result.retryable).toBe(false);
  });

  it('handles plain Error objects', () => {
    const result = classifyError(new Error('something broke'));
    expect(result.actionType).toBe('generic');
    expect(result.message).toBe('something broke');
    expect(result.reasonCode).toBe('UNKNOWN');
  });

  it('handles string errors', () => {
    const result = classifyError('a string error');
    expect(result.actionType).toBe('generic');
    expect(result.message).toBe('a string error');
  });

  it('handles null/undefined errors', () => {
    const result = classifyError(null);
    expect(result.actionType).toBe('generic');
    expect(result.reasonCode).toBe('UNKNOWN');
  });
});
