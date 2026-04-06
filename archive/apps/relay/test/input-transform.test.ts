// Unit tests for input-transform.ts — IPC input → SDK TextGenerateInput conversion
// Validates model/route resolution and field mapping

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
const TEST_REASON_CODE = 'TEST_CODE';
import {
  resolveModelAndRoute,
  toTextGenerateInput,
  toTextStreamInput,
  type IpcAiGenerateInput,
} from '../src/main/input-transform.js';

// ─── resolveModelAndRoute ─────────────────────────────────────────────────

describe('resolveModelAndRoute', () => {
  it('requires an explicit provider/model target when both are absent', () => {
    assert.throws(
      () => resolveModelAndRoute(undefined, undefined),
      /requires an explicit local model or provider \+ model/,
    );
  });

  it('treats empty strings as absent and rejects implicit defaults', () => {
    assert.throws(
      () => resolveModelAndRoute('', ''),
      /requires an explicit local model or provider \+ model/,
    );
  });

  it('model-only resolves to local/{model}', () => {
    const result = resolveModelAndRoute(undefined, 'llama3');
    assert.equal(result.model, 'local/llama3');
    assert.equal(result.route, 'local');
  });

  it('provider + model resolves to {provider}/{model} with cloud route', () => {
    const result = resolveModelAndRoute('openai', 'gpt-4o');
    assert.equal(result.model, 'openai/gpt-4o');
    assert.equal(result.route, 'cloud');
  });

  it('provider without model uses "default"', () => {
    const result = resolveModelAndRoute('gemini', undefined);
    assert.equal(result.model, 'gemini/default');
    assert.equal(result.route, 'cloud');
  });

  it('trims whitespace from provider and model', () => {
    const result = resolveModelAndRoute('  anthropic  ', '  claude-3-5-sonnet  ');
    assert.equal(result.model, 'anthropic/claude-3-5-sonnet');
    assert.equal(result.route, 'cloud');
  });

  it('rejects unsupported provider', () => {
    assert.throws(
      () => resolveModelAndRoute('fakeprovider', 'model'),
      /unsupported provider/,
    );
  });

  it('rejects fully-qualified remote model without provider', () => {
    assert.throws(
      () => resolveModelAndRoute(undefined, 'openai/gpt-4o'),
      /fully-qualified remote model/,
    );
  });

  it('rejects fully-qualified model with provider', () => {
    assert.throws(
      () => resolveModelAndRoute('openai', 'anthropic/claude'),
      /provider-scoped model id/,
    );
  });

  it('accepts all known remote providers', () => {
    const providers = [
      'anthropic', 'openai', 'gemini', 'deepseek', 'mistral',
      'groq', 'fireworks', 'together', 'xai', 'bedrock',
    ];
    for (const p of providers) {
      const result = resolveModelAndRoute(p, 'test-model');
      assert.equal(result.route, 'cloud', `${p} should route to cloud`);
      assert.equal(result.model, `${p}/test-model`);
    }
  });
});

// ─── toTextGenerateInput ──────────────────────────────────────────────────

describe('toTextGenerateInput', () => {
  it('maps prompt to input field', () => {
    const ipc: IpcAiGenerateInput = { prompt: 'Hello', model: 'llama3' };
    const result = toTextGenerateInput(ipc);
    assert.equal(result.input, 'Hello');
  });

  it('maps provider + model to resolved model', () => {
    const ipc: IpcAiGenerateInput = { prompt: 'Hi', provider: 'openai', model: 'gpt-4o' };
    const result = toTextGenerateInput(ipc);
    assert.equal(result.model, 'openai/gpt-4o');
    assert.equal(result.route, 'cloud');
  });

  it('defaults subjectUserId to local-user', () => {
    const ipc: IpcAiGenerateInput = { prompt: 'Hi', model: 'llama3' };
    const result = toTextGenerateInput(ipc);
    assert.equal(result.subjectUserId, 'local-user');
  });

  it('uses provided subjectUserId', () => {
    const ipc: IpcAiGenerateInput = { prompt: 'Hi', model: 'llama3', subjectUserId: 'user-123' };
    const result = toTextGenerateInput(ipc);
    assert.equal(result.subjectUserId, 'user-123');
  });

  it('passes through optional fields', () => {
    const ipc: IpcAiGenerateInput = {
      prompt: 'Hi',
      model: 'llama3',
      system: 'You are helpful',
      maxTokens: 1000,
      temperature: 0.7,
      topP: 0.9,
      timeoutMs: 30000,
      metadata: { key: 'value' },
    };
    const result = toTextGenerateInput(ipc);
    assert.equal(result.system, 'You are helpful');
    assert.equal(result.maxTokens, 1000);
    assert.equal(result.temperature, 0.7);
    assert.equal(result.topP, 0.9);
    assert.equal(result.timeoutMs, 30000);
    assert.deepEqual(result.metadata, { key: 'value' });
  });

  it('does not include agentId in TextGenerateInput (agentId is IPC-layer only)', () => {
    const ipc: IpcAiGenerateInput = { prompt: 'Hi', model: 'llama3', agentId: 'agent-1' };
    const result = toTextGenerateInput(ipc);
    assert.ok(!('agentId' in result), 'agentId should not be in TextGenerateInput');
  });
});

// ─── toTextStreamInput ────────────────────────────────────────────────────

describe('toTextStreamInput', () => {
  it('produces same shape as toTextGenerateInput', () => {
    const ipc: IpcAiGenerateInput = { prompt: 'Hi', provider: 'gemini', model: 'pro' };
    const genResult = toTextGenerateInput(ipc);
    const streamResult = toTextStreamInput(ipc);
    assert.deepEqual(streamResult, genResult);
  });
});

// ─── normalizeError (shared) ──────────────────────────────────────────────

describe('normalizeError (shared error-utils)', () => {
  // Import from error-utils to verify the shared module works
  let normalizeError: (error: unknown) => { reasonCode?: string; message: string; actionHint?: string };

  it('can be imported from error-utils', async () => {
    const mod = await import('../src/main/error-utils.js');
    normalizeError = mod.normalizeError;
    assert.equal(typeof normalizeError, 'function');
  });

  it('normalizes Error with reasonCode and actionHint', async () => {
    const mod = await import('../src/main/error-utils.js');
    const error = Object.assign(new Error('test'), {
      reasonCode: TEST_REASON_CODE,
      actionHint: 'try again',
    });
    const result = mod.normalizeError(error);
    assert.equal(result.message, 'test');
    assert.equal(result.reasonCode, TEST_REASON_CODE);
    assert.equal(result.actionHint, 'try again');
  });

  it('normalizes non-Error values', async () => {
    const mod = await import('../src/main/error-utils.js');
    assert.equal(mod.normalizeError('oops').message, 'oops');
    assert.equal(mod.normalizeError(42).message, '42');
  });
});
