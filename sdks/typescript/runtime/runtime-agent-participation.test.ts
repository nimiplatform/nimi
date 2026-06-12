import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNimiRuntimeAgentParticipationSurface,
  type NimiRuntimeAgentParticipationClient,
} from './runtime-agent-participation';
import type { RuntimeTypedCallOptions } from '../core-generated/runtime-typed-client';

interface RecordedCall {
  readonly method: string;
  readonly request: unknown;
}

function createHarness() {
  const calls: RecordedCall[] = [];
  const scopeRuns: string[][] = [];
  const record = (method: string) =>
    (request: unknown, _options?: RuntimeTypedCallOptions) => {
      calls.push({ method, request });
      return Promise.resolve({ recordedFrom: method } as never);
    };
  const runtime = {
    appId: 'test-app',
    auth: { registerApp: () => Promise.reject(new Error('unused')) },
    appAuth: { authorizeExternalPrincipal: () => Promise.reject(new Error('unused')) },
    agent: {
      describeParticipationProfiles: record('describeParticipationProfiles'),
      describeParticipationContextBlocks: record('describeParticipationContextBlocks'),
      validateParticipation: record('validateParticipation'),
      executeParticipation: record('executeParticipation'),
      getParticipationCandidate: record('getParticipationCandidate'),
      getParticipationVerdicts: record('getParticipationVerdicts'),
      listParticipationAuditEvents: record('listParticipationAuditEvents'),
      getParticipationReplay: record('getParticipationReplay'),
    },
  } as unknown as NimiRuntimeAgentParticipationClient;
  const surface = createNimiRuntimeAgentParticipationSurface({
    getRuntime: () => runtime,
    getSubjectUserId: () => 'subject-1',
    withScopes: (scopes, operation) => {
      scopeRuns.push([...scopes]);
      return operation({});
    },
  });
  return { surface, calls, scopeRuns };
}

const SPEC = {
  profileKind: 6,
  agentId: 'agent-1',
  participantRef: 'participant-1',
  triggerRef: 'trigger-1',
  contextBlocks: [],
  requestId: 'req-1',
} as const;

test('read methods route to the matching RPC with read scope', async () => {
  const { surface, calls, scopeRuns } = createHarness();
  await surface.describeProfiles();
  await surface.describeContextBlocks();
  await surface.getCandidate({ participationId: 'p-1' });
  await surface.getVerdicts({ participationId: 'p-1' });
  await surface.listAuditEvents({ participationId: 'p-1', agentId: '', pageSize: 0, pageToken: '' });
  await surface.getReplay({ participationId: 'p-1' });
  assert.deepEqual(
    calls.map((call) => call.method),
    [
      'describeParticipationProfiles',
      'describeParticipationContextBlocks',
      'getParticipationCandidate',
      'getParticipationVerdicts',
      'listParticipationAuditEvents',
      'getParticipationReplay',
    ],
  );
  for (const scopes of scopeRuns) {
    assert.deepEqual(scopes, ['runtime.agent.participation.read']);
  }
});

test('validateRequest and execute route with command scope and verbatim spec', async () => {
  const { surface, calls, scopeRuns } = createHarness();
  await surface.validateRequest({ spec: { ...SPEC } });
  await surface.execute({ spec: { ...SPEC } });
  assert.deepEqual(
    calls.map((call) => call.method),
    ['validateParticipation', 'executeParticipation'],
  );
  for (const call of calls) {
    assert.deepEqual((call.request as { spec: typeof SPEC }).spec, SPEC);
  }
  for (const scopes of scopeRuns) {
    assert.deepEqual(scopes, ['runtime.agent.participation.write']);
  }
});

test('execute fails closed on missing spec, agentId, and requestId', async () => {
  const { surface, calls } = createHarness();
  await assert.rejects(
    () => surface.execute({ spec: undefined } as never),
    /participation spec is required/,
  );
  await assert.rejects(
    () => surface.execute({ spec: { ...SPEC, agentId: ' ' } }),
    /spec\.agentId is required/,
  );
  await assert.rejects(
    () => surface.execute({ spec: { ...SPEC, requestId: '' } }),
    /spec\.requestId is required/,
  );
  assert.equal(calls.length, 0);
});

test('reads fail closed on blank participationId before any transport call', async () => {
  const { surface, calls } = createHarness();
  await assert.rejects(
    () => surface.getCandidate({ participationId: '' }),
    /participationId is required/,
  );
  await assert.rejects(
    () => surface.getReplay({ participationId: '  ' }),
    /participationId is required/,
  );
  assert.equal(calls.length, 0);
});

test('input violations carry the typed SDK reason code', async () => {
  const { surface } = createHarness();
  try {
    await surface.getVerdicts({ participationId: '' });
    assert.fail('expected rejection');
  } catch (error) {
    assert.equal(
      (error as { reasonCode?: string }).reasonCode,
      'SDK_RUNTIME_PARTICIPATION_INPUT_INVALID',
    );
  }
});
