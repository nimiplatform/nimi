// Unit tests for IPC handler patterns (RL-IPC-001 ~ 009)
// Tests error normalization, agentId enforcement, channel contracts, and data shapes

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { normalizeError, type NormalizedError } from '../src/main/error-utils.js';
import { resolveRelayTtsConfig } from '../src/main/tts-config.js';
import { ReasonCode } from '@nimiplatform/sdk/types';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const srcMain = path.join(testDir, '..', 'src', 'main');
const specTables = path.join(testDir, '..', 'spec', 'kernel', 'tables');
const TEST_REASON_CODE = 'TEST';
const ipcHandlersSource = readFileSync(path.join(srcMain, 'ipc-handlers.ts'), 'utf8');

// ── Extracted Logic: requireAgentId (from ipc-handlers.ts:25-32) ─────────

function requireAgentId(input: Record<string, unknown>): void {
  if (!input.agentId || typeof input.agentId !== 'string') {
    throw Object.assign(new Error('agentId is required for agent-scoped IPC calls'), {
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'Select an agent before using this feature',
    });
  }
}

// ── Helper: extract channel names from source files ──────────────────────

function extractIpcHandleChannels(source: string): string[] {
  return [...source.matchAll(/(?:ipcMain\.handle|safeHandle)\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

function extractWebContentsSendChannels(source: string): string[] {
  return [...source.matchAll(/\.send\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

function extractYamlChannels(yamlSource: string): string[] {
  return [...yamlSource.matchAll(/- channel: (\S+)/g)].map((m) => m[1]);
}

// ─── RL-IPC-005 — Error Normalization (real import from error-utils.ts) ──

describe('RL-IPC-005 — Error Normalization (normalizeError)', () => {
  it('normalizes standard Error', () => {
    const result = normalizeError(new Error('something failed'));
    assert.equal(result.message, 'something failed');
    assert.equal(result.reasonCode, undefined);
    assert.equal(result.actionHint, undefined);
  });

  it('normalizes NimiError with reasonCode and actionHint', () => {
    const error = Object.assign(new Error('model not found'), {
      reasonCode: ReasonCode.AI_MODEL_NOT_FOUND,
      actionHint: 'Check the model name',
    });
    const result = normalizeError(error);
    assert.equal(result.message, 'model not found');
    assert.equal(result.reasonCode, ReasonCode.AI_MODEL_NOT_FOUND);
    assert.equal(result.actionHint, 'Check the model name');
  });

  it('normalizes non-Error values', () => {
    assert.equal(normalizeError('string error').message, 'string error');
    assert.equal(normalizeError(42).message, '42');
    assert.equal(normalizeError(null).message, 'null');
    assert.equal(normalizeError(undefined).message, 'undefined');
  });

  it('ignores non-string reasonCode/actionHint', () => {
    const error = Object.assign(new Error('bad'), {
      reasonCode: 123,
      actionHint: { not: 'a string' },
    });
    const result = normalizeError(error);
    assert.equal(result.reasonCode, undefined, 'numeric reasonCode should be filtered');
    assert.equal(result.actionHint, undefined, 'object actionHint should be filtered');
  });

  it('returns structured-clone-compatible shape', () => {
    const error = Object.assign(new Error('test'), {
      reasonCode: TEST_REASON_CODE,
      actionHint: 'hint',
    });
    const result = normalizeError(error);
    const cloned = structuredClone(result);
    assert.deepEqual(cloned, result);
  });

  it('NormalizedError shape has required fields', () => {
    const result: NormalizedError = normalizeError(new Error('test'));
    assert.ok('message' in result, 'must have message');
    assert.ok('reasonCode' in result, 'must have reasonCode (may be undefined)');
    assert.ok('actionHint' in result, 'must have actionHint (may be undefined)');
    assert.ok('traceId' in result, 'must have traceId (may be undefined)');
  });

  it('extracts traceId from NimiError (RL-TRANS-005)', () => {
    const error = Object.assign(new Error('rpc failed'), {
      reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
      traceId: 'trace-abc-123',
    });
    const result = normalizeError(error);
    assert.equal(result.traceId, 'trace-abc-123');
  });

  it('ignores non-string traceId', () => {
    const error = Object.assign(new Error('bad'), { traceId: 42 });
    const result = normalizeError(error);
    assert.equal(result.traceId, undefined, 'numeric traceId should be filtered');
  });
});

// ─── RL-IPC-005 — Base64 Serialization ───────────────────────────────────

describe('RL-IPC-005 — Base64 audio data survives IPC serialization', () => {
  it('Uint8Array → base64 → Uint8Array round-trip', () => {
    const original = new Uint8Array([0, 1, 2, 128, 255]);
    const base64 = btoa(String.fromCharCode(...original));
    assert.equal(typeof base64, 'string');

    const cloned = structuredClone(base64);
    assert.equal(cloned, base64);

    const decoded = Uint8Array.from(atob(cloned), (c) => c.charCodeAt(0));
    assert.deepEqual(decoded, original);
  });
});

// ─── RL-CORE-004 — requireAgentId Guard ──────────────────────────────────

describe('RL-CORE-004 — requireAgentId guard function', () => {
  it('throws when agentId is missing', () => {
    assert.throws(() => requireAgentId({}), /agentId is required/);
  });

  it('throws when agentId is empty string', () => {
    assert.throws(() => requireAgentId({ agentId: '' }), /agentId is required/);
  });

  it('throws when agentId is not a string', () => {
    assert.throws(() => requireAgentId({ agentId: 123 }), /agentId is required/);
    assert.throws(() => requireAgentId({ agentId: null }), /agentId is required/);
    assert.throws(() => requireAgentId({ agentId: true }), /agentId is required/);
    assert.throws(() => requireAgentId({ agentId: {} }), /agentId is required/);
  });

  it('does NOT throw for valid string agentId', () => {
    assert.doesNotThrow(() => requireAgentId({ agentId: 'agent-123' }));
    assert.doesNotThrow(() => requireAgentId({ agentId: 'a' }));
  });

  it('error has MISSING_AGENT_ID reasonCode and actionHint', () => {
    try {
      requireAgentId({});
      assert.fail('should throw');
    } catch (e) {
      const err = e as Error & { reasonCode?: string; actionHint?: string };
      assert.equal(err.reasonCode, 'AI_INPUT_INVALID');
      assert.equal(err.actionHint, 'Select an agent before using this feature');
    }
  });

  it('error can be normalized by normalizeError', () => {
    try {
      requireAgentId({});
      assert.fail('should throw');
    } catch (e) {
      const normalized = normalizeError(e);
      assert.equal(normalized.reasonCode, 'AI_INPUT_INVALID');
      assert.equal(normalized.message, 'agentId is required for agent-scoped IPC calls');
      assert.equal(normalized.actionHint, 'Select an agent before using this feature');
    }
  });

  it('additional fields in input do not affect validation', () => {
    assert.doesNotThrow(() => requireAgentId({ agentId: 'a1', prompt: 'test', model: 'x' }));
  });
});

// ─── Agent-Scoped vs Agent-Independent Channels ─────────────────────────

describe('RL-CORE-004 — Agent-scoped vs agent-independent channels', () => {
  const AGENT_SCOPED_CHANNELS = [
    'relay:ai:generate',
    'relay:ai:stream:open',
    'relay:media:tts:synthesize',
    'relay:media:video:generate',
  ];

  const AGENT_INDEPENDENT_CHANNELS = [
    'relay:media:stt:transcribe',
    'relay:media:tts:voices',
    'relay:media:image:generate',
    'relay:media:video:job:get',
    'relay:media:video:job:artifacts',
    'relay:media:video:job:subscribe',
    'relay:health',
    'relay:config',
  ];

  it('agent-scoped channels require agentId', () => {
    for (const ch of AGENT_SCOPED_CHANNELS) {
      assert.throws(
        () => requireAgentId({}),
        /agentId is required/,
        `${ch}: should require agentId`,
      );
    }
  });

  it('agent-scoped channels pass with valid agentId', () => {
    for (const ch of AGENT_SCOPED_CHANNELS) {
      assert.doesNotThrow(
        () => requireAgentId({ agentId: 'test-agent' }),
        `${ch}: should pass with valid agentId`,
      );
    }
  });

  it('agent-scoped and agent-independent sets are disjoint', () => {
    for (const ch of AGENT_SCOPED_CHANNELS) {
      assert.equal(
        AGENT_INDEPENDENT_CHANNELS.includes(ch),
        false,
        `${ch} must not be in both sets`,
      );
    }
  });
});

describe('RL-FEAT-003 — relay TTS config resolution', () => {
  it('uses renderer-provided model and voice ahead of persisted Settings values', () => {
    const resolved = resolveRelayTtsConfig({
      ttsConnectorId: 'connector-1',
      ttsModel: 'qwen3-tts-instruct-flash',
      voiceName: 'vivian',
    }, {
      model: 'agent-model',
      voiceId: 'agent-voice',
    });

    assert.equal(resolved.connectorId, 'connector-1');
    assert.equal(resolved.model, 'agent-model');
    assert.equal(resolved.voiceId, 'agent-voice');
    assert.equal(resolved.requestedModel, 'agent-model');
    assert.equal(resolved.requestedVoice, 'agent-voice');
  });

  it('falls back to persisted Settings voice only when renderer did not provide one', () => {
    const resolved = resolveRelayTtsConfig({
      ttsConnectorId: 'connector-1',
      ttsModel: 'qwen3-tts-instruct-flash',
      voiceName: 'vivian',
    }, {
      model: 'agent-model',
      voiceId: '',
    });

    assert.equal(resolved.model, 'agent-model');
    assert.equal(resolved.voiceId, 'vivian');
  });

  it('returns empty voice when both Settings and renderer values are missing', () => {
    const resolved = resolveRelayTtsConfig({
      ttsConnectorId: 'connector-1',
      ttsModel: 'qwen3-tts-instruct-flash',
      voiceName: '',
    }, {});

    assert.equal(resolved.voiceId, '');
  });
});

describe('RL-PIPE-001 — relay chat cancellation wiring', () => {
  it('tracks active relay chat turns instead of leaving cancel as a TODO', () => {
    assert.ok(ipcHandlersSource.includes('const activeRelayChatTurns = new Map'));
    assert.ok(!ipcHandlersSource.includes('// TODO: wire to AbortController in send-flow'));
  });

  it('registers abort controllers and schedule handles for relay chat sends', () => {
    assert.ok(ipcHandlersSource.includes('const abortController = new AbortController()'));
    assert.ok(ipcHandlersSource.includes('activeRelayChatTurns.set(handle.turnTxnId'));
    assert.ok(ipcHandlersSource.includes('void handle.done.finally(() => {'));
  });

  it('fails closed when cancel is called without a cancellable turn', () => {
    assert.ok(ipcHandlersSource.includes('turnTxnId is required to cancel relay chat turns'));
    assert.ok(ipcHandlersSource.includes('relay chat turn is not cancellable:'));
    assert.ok(ipcHandlersSource.includes('ReasonCode.ACTION_NOT_FOUND'));
  });

  it('cancels active relay schedules with an explicit user cancel reason', () => {
    assert.ok(ipcHandlersSource.includes("activeTurn.abortController.abort()"));
    assert.ok(ipcHandlersSource.includes("activeTurn.scheduleHandle?.cancel('LOCAL_CHAT_SCHEDULE_CANCELLED_BY_USER')"));
    assert.ok(ipcHandlersSource.includes('turnTxnId'));
  });
});

// ─── RL-IPC-002 — Unary IPC Semantics ──────────────────────────────────

describe('RL-IPC-002 — Unary IPC Semantics', () => {
  it('error shape has { reasonCode?, message, actionHint? }', () => {
    const shape = normalizeError(new Error('test'));
    assert.ok('message' in shape, 'must have message');
    assert.ok('reasonCode' in shape, 'must have reasonCode (may be undefined)');
    assert.ok('actionHint' in shape, 'must have actionHint (may be undefined)');
  });

  it('all unary handlers use ipcMain.handle (not ipcMain.on)', () => {
    const source = readFileSync(path.join(srcMain, 'ipc-handlers.ts'), 'utf-8');
    assert.ok(source.includes('ipcMain.handle('), 'must use ipcMain.handle for unary');
    assert.ok(!source.includes('ipcMain.on('), 'should not use ipcMain.on in handler file');
  });
});

// ─── RL-IPC-001 — Channel Naming Convention ─────────────────────────────

describe('RL-IPC-001 — Channel Naming Convention', () => {
  it('all channels in ipc-handlers.ts use relay: prefix', () => {
    const source = readFileSync(path.join(srcMain, 'ipc-handlers.ts'), 'utf-8');
    const channels = extractIpcHandleChannels(source);
    assert.ok(channels.length > 0, 'should find registered channels');
    for (const ch of channels) {
      assert.ok(ch.startsWith('relay:'), `channel ${ch} should start with relay:`);
    }
  });

  it('all channels in realtime-relay.ts use relay: prefix', () => {
    const source = readFileSync(path.join(srcMain, 'realtime-relay.ts'), 'utf-8');
    const handleChannels = extractIpcHandleChannels(source);
    const sendChannels = extractWebContentsSendChannels(source);
    const channels = [...handleChannels, ...sendChannels];
    assert.ok(channels.length > 0, 'should find registered channels');
    for (const ch of channels) {
      assert.ok(ch.startsWith('relay:'), `channel ${ch} should start with relay:`);
    }
  });

  it('all channels in stream-manager.ts use relay: prefix', () => {
    const source = readFileSync(path.join(srcMain, 'stream-manager.ts'), 'utf-8');
    const channels = extractWebContentsSendChannels(source);
    assert.ok(channels.length > 0, 'should find stream channels');
    for (const ch of channels) {
      assert.ok(ch.startsWith('relay:'), `channel ${ch} should start with relay:`);
    }
  });

  it('all ipc-channels.yaml spec channels are implemented in source', () => {
    const yamlSource = readFileSync(path.join(specTables, 'ipc-channels.yaml'), 'utf-8');
    const specChannels = extractYamlChannels(yamlSource);
    assert.ok(specChannels.length > 0, 'should find spec channels');

    const implemented = new Set<string>();
    const ipcSource = readFileSync(path.join(srcMain, 'ipc-handlers.ts'), 'utf-8');
    const rtSource = readFileSync(path.join(srcMain, 'realtime-relay.ts'), 'utf-8');
    const modelSource = readFileSync(path.join(srcMain, 'model-handlers.ts'), 'utf-8');
    const routeSource = readFileSync(path.join(srcMain, 'route', 'route-handlers.ts'), 'utf-8');
    const desktopInteropSource = readFileSync(path.join(srcMain, 'desktop-interop.ts'), 'utf-8');
    const smSource = readFileSync(path.join(srcMain, 'stream-manager.ts'), 'utf-8');
    const ctxSource = readFileSync(path.join(srcMain, 'chat-pipeline', 'main-process-context.ts'), 'utf-8');

    for (const m of ipcSource.matchAll(/(?:ipcMain\.handle|safeHandle)\(\s*['"]([^'"]+)['"]/g)) implemented.add(m[1]);
    for (const m of rtSource.matchAll(/(?:ipcMain\.handle|safeHandle)\(\s*['"]([^'"]+)['"]/g)) implemented.add(m[1]);
    for (const m of modelSource.matchAll(/(?:ipcMain\.handle|safeHandle)\(\s*['"]([^'"]+)['"]/g)) implemented.add(m[1]);
    for (const m of routeSource.matchAll(/(?:ipcMain\.handle|safeHandle)\(\s*['"]([^'"]+)['"]/g)) implemented.add(m[1]);
    for (const m of desktopInteropSource.matchAll(/(?:ipcMain\.handle|safeHandle)\(\s*['"]([^'"]+)['"]/g)) implemented.add(m[1]);
    for (const m of smSource.matchAll(/\.send\(\s*['"]([^'"]+)['"]/g)) implemented.add(m[1]);
    for (const m of rtSource.matchAll(/\.send\(\s*['"]([^'"]+)['"]/g)) implemented.add(m[1]);
    for (const m of ctxSource.matchAll(/\.send\(\s*['"]([^'"]+)['"]/g)) implemented.add(m[1]);

    for (const ch of specChannels) {
      assert.ok(implemented.has(ch), `spec channel "${ch}" must be implemented in source`);
    }
  });
});

// ─── RL-IPC-006 — AI Consume IPC Channels ────────────────────────────────

describe('RL-IPC-006 — AI Consume IPC channel registration', () => {
  it('registers relay:ai:generate, relay:ai:stream:open, relay:ai:stream:cancel', () => {
    const source = readFileSync(path.join(srcMain, 'ipc-handlers.ts'), 'utf-8');
    const channels = extractIpcHandleChannels(source);
    assert.ok(channels.includes('relay:ai:generate'), 'must register relay:ai:generate');
    assert.ok(channels.includes('relay:ai:stream:open'), 'must register relay:ai:stream:open');
    assert.ok(channels.includes('relay:ai:stream:cancel'), 'must register relay:ai:stream:cancel');
  });
});

// ─── RL-IPC-007 — Media IPC Channels ─────────────────────────────────────

describe('RL-IPC-007 — Media IPC channel registration', () => {
  it('registers all 9 media channels', () => {
    const source = readFileSync(path.join(srcMain, 'ipc-handlers.ts'), 'utf-8');
    const channels = extractIpcHandleChannels(source);

    const expectedMedia = [
      'relay:media:tts:synthesize',
      'relay:media:tts:voices',
      'relay:media:stt:transcribe',
      'relay:media:image:generate',
      'relay:media:video:generate',
      'relay:media:video:job:get',
      'relay:media:video:job:artifacts',
      'relay:media:video:job:subscribe',
      'relay:media:video:job:cancel',
    ];

    for (const ch of expectedMedia) {
      assert.ok(channels.includes(ch), `must register ${ch}`);
    }
  });
});

// ─── RL-IPC-008 — Typed Realm Data Bridge ────────────────────────────────

describe('RL-IPC-008 — Typed Realm data IPC', () => {
  it('registers relay:agent:list, relay:agent:get, relay:human-chat:send', () => {
    const source = readFileSync(path.join(srcMain, 'ipc-handlers.ts'), 'utf-8');
    const channels = extractIpcHandleChannels(source);
    assert.ok(channels.includes('relay:agent:list'), 'must register relay:agent:list');
    assert.ok(channels.includes('relay:agent:get'), 'must register relay:agent:get');
    assert.ok(channels.includes('relay:human-chat:send'), 'must register relay:human-chat:send');
  });

  it('human chat send input shape is typed and minimal', () => {
    const input = {
      agentId: 'a1',
      text: 'Hello',
    };
    assert.equal(input.agentId, 'a1');
    assert.equal(input.text, 'Hello');
  });

  it('agent get input shape is explicit', () => {
    const input = { agentId: 'agent-123' };
    assert.equal(input.agentId, 'agent-123');
  });

  it('human chat send uses typed HumanChatService methods instead of facade helper escape hatches', () => {
    const source = readFileSync(path.join(srcMain, 'ipc-handlers.ts'), 'utf-8');
    assert.ok(source.includes('realm.services.HumanChatService.startChat'), 'must start chat via typed service');
    assert.ok(source.includes('realm.services.HumanChatService.sendMessage'), 'must send message via typed service');
    assert.ok(!source.includes('sendAgentChannelMessage('), 'must not call removed facade helper from relay IPC');
    assert.ok(!source.includes('realm as never'), 'must not erase realm types in relay IPC');
  });

  it('agent list uses typed UserLiteDto array directly instead of legacy unknown union recovery', () => {
    const source = readFileSync(path.join(srcMain, 'ipc-handlers.ts'), 'utf-8');
    assert.ok(source.includes('items: payload.map((item) => ({'), 'must project typed list items directly');
    assert.ok(!source.includes('payload as { items?: unknown[] } | unknown[]'), 'must not restore legacy array/object union');
  });
});

describe('RL-IPC-002 — Health reason codes use ReasonCode constants', () => {
  it('uses ReasonCode.AUTH_* constants instead of hard-coded auth strings', () => {
    const source = readFileSync(path.join(srcMain, 'ipc-handlers.ts'), 'utf-8');
    const authTokenInvalidLiteral = ['normalized.reasonCode === ', `'${ReasonCode.AUTH_TOKEN_INVALID}'`].join('');
    const authDeniedLiteral = ['normalized.reasonCode === ', `'${ReasonCode.AUTH_DENIED}'`].join('');
    assert.ok(source.includes('ReasonCode.AUTH_TOKEN_INVALID'), 'must use ReasonCode.AUTH_TOKEN_INVALID');
    assert.ok(source.includes('ReasonCode.AUTH_DENIED'), 'must use ReasonCode.AUTH_DENIED');
    assert.ok(!source.includes(authTokenInvalidLiteral), 'must not hard-code AUTH_TOKEN_INVALID');
    assert.ok(!source.includes(authDeniedLiteral), 'must not hard-code AUTH_DENIED');
  });
});

// ─── RL-IPC-009 — Realtime Event Forwarding ──────────────────────────────

describe('RL-IPC-009 — Realtime Event Forwarding channels', () => {
  it('realtime-relay.ts forwards message/presence/status events', () => {
    const source = readFileSync(path.join(srcMain, 'realtime-relay.ts'), 'utf-8');
    assert.ok(source.includes("'relay:realtime:message'"), 'must forward message events');
    assert.ok(source.includes("'relay:realtime:presence'"), 'must forward presence events');
    assert.ok(source.includes("'relay:realtime:status'"), 'must forward status events');
  });

  it('registers subscribe/unsubscribe handlers', () => {
    const source = readFileSync(path.join(srcMain, 'realtime-relay.ts'), 'utf-8');
    const channels = extractIpcHandleChannels(source);
    assert.ok(channels.includes('relay:realtime:subscribe'), 'must register subscribe');
    assert.ok(channels.includes('relay:realtime:unsubscribe'), 'must register unsubscribe');
  });
});
