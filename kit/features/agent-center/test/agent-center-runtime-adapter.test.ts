import { createNimiAIScopeRef } from '@nimiplatform/sdk/ai';
import { describe, expect, it } from 'vitest';
import {
  createFirstPartyAgentCenterSession,
  createPermissionedAgentCenterSession,
  projectAgentCenterActionAvailability,
  sealAgentCenterPermissionedSdkSurface,
} from '../src/session.js';
import type {
  AgentCenterAutonomyProjection,
  AgentCenterOpaqueHandle,
  AgentCenterPermissionedSdkSurface,
  AgentCenterPermissionedSdkSurfaceInput,
  AgentCenterProductAction,
  AgentCenterSession,
  AgentCenterStateInput,
  AgentCenterTransportActionProjection,
  AgentCenterTransportActionReason,
} from '../src/types.js';

const ACTIONS: readonly AgentCenterProductAction[] = [
  'readModelSettings', 'updateModelSettings', 'readAutonomy', 'updateAutonomy',
  'readMemorySummary', 'replaceAppearance', 'restorePreviousAppearance',
  'requestPermission', 'openPermissionSettings',
];
const scopeRef = createNimiAIScopeRef({ kind: 'feature', ownerId: 'runtime.agent.model-settings', surfaceId: 'agent' });

function transportProjection(reason: AgentCenterTransportActionReason | null = null): AgentCenterTransportActionProjection {
  return Object.fromEntries(ACTIONS.map((action) => [action, {
    state: reason ? 'unavailable' : 'available', reason,
  }])) as AgentCenterTransportActionProjection;
}

function recoveryProjection(
  reason: AgentCenterTransportActionReason,
): AgentCenterTransportActionProjection {
  const recoveryAction = reason === 'not_granted' || reason === 'grant_denied' || reason === 'grant_revoked'
    ? 'requestPermission'
    : null;
  return Object.fromEntries(ACTIONS.map((action) => [action, action === recoveryAction
    ? { state: 'available', reason: null }
    : { state: 'unavailable', reason }])) as AgentCenterTransportActionProjection;
}

function emptyProjection(revision = '1'): AgentCenterStateInput {
  return {
    modelSettings: {
      scopeRef, capabilities: [], routeIntents: [], readiness: [], configurationRevision: revision,
    },
    autonomy: {
      revision: `autonomy:${revision}`, enabled: true, mode: 'low', budgetExhausted: false,
      usedTokensInWindow: 0, dailyTokenBudget: 100, maxTokensPerHook: 10,
      windowStartedAt: null, suspendedUntil: null,
    },
    appearance: { status: 'not_configured', presentationRevision: `presentation:${revision}` },
  };
}

function permissionedSurface(overrides: Partial<AgentCenterPermissionedSdkSurface> = {}): AgentCenterPermissionedSdkSurface {
  return sealAgentCenterPermissionedSdkSurface({
    async actionPosture() { return transportProjection(); },
    async read() { return emptyProjection(); },
    async updateConfiguration(_handle, input) {
      const revision = String(BigInt(input.expectedConfigurationRevision) + 1n);
      return { ...emptyProjection(revision), modelSettings: {
        ...emptyProjection(revision).modelSettings!, routeIntents: input.routeIntents,
      } };
    },
    async updateAutonomy(_handle, input) {
      return { ...emptyProjection('2'), autonomy: {
        ...emptyProjection('2').autonomy!, revision: 'autonomy:2',
        enabled: input.enabled ?? null,
        mode: input.mode as AgentCenterAutonomyProjection['mode'],
        dailyTokenBudget: Number(input.dailyTokenBudget),
        maxTokensPerHook: Number(input.maxTokensPerHook),
      } };
    },
    async replaceAppearance() { return emptyProjection('2'); },
    async restorePreviousAppearance() { return emptyProjection('3'); },
    ...overrides,
  });
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('AgentCenterSession', () => {
  it('awaits the committed dedicated model-settings projection before write-back', async () => {
    const calls: string[] = [];
    let modelSettings = emptyProjection().modelSettings!;
    const session = createFirstPartyAgentCenterSession({
      identity: { ownerUserId: 'owner', runtimeSourceRef: 'source', localAgentRef: 'agent' },
      modelSettings: {
        async snapshot() { calls.push('model.read'); return modelSettings; },
        async update(input) {
          calls.push(`model.write:${input.expectedConfigurationRevision}`);
          await Promise.resolve();
          modelSettings = { ...modelSettings, configurationRevision: '2', routeIntents: input.routeIntents };
          return modelSettings;
        },
      },
      autonomy: {
        async load() { return emptyProjection().autonomy!; },
        async update(_identity, input) {
          calls.push(`autonomy.write:${input.expectedRevision}`);
          return { ...emptyProjection('2').autonomy!, enabled: input.enabled ?? null };
        },
      },
      appearance: {
        async load() { return emptyProjection().appearance!; },
        async replaceAppearance(input) { calls.push(`appearance.replace:${input.expectedRevision}`); return { status: 'ready', presentationRevision: '4' }; },
        async restorePreviousAppearance() { return { status: 'ready', presentationRevision: '3' }; },
      },
    });
    await session.refresh();
    await session.updateModelSettings({
      expectedConfigurationRevision: '1',
      routeIntents: [{ capability: 'text.generate', provider: '', model: 'm2', routePolicy: 'local' }],
    });
    expect(session.getSnapshot().state.configRevision).toBe('2');
    expect(session.getSnapshot().state.modelSettings?.routeIntents[0]?.model).toBe('m2');
    expect(calls).toContain('model.write:1');
  });

  it.each([
    ['not_granted', 'needs-grant', 'requestPermission'],
    ['request_pending', 'request-pending', 'wait'],
    ['grant_denied', 'denied', 'requestPermission'],
    ['grant_revoked', 'revoked', 'requestPermission'],
    ['runtime_offline', 'runtime-offline', 'retry'],
    ['reserved_not_admitted', 'reserved-not-admitted', 'wait'],
    ['unknown', 'unknown', 'retry'],
  ] as const)('maps transport reason %s without collapse', (transportReason, reason, nextStep) => {
    expect(projectAgentCenterActionAvailability(transportProjection(transportReason)).updateAutonomy)
      .toEqual({ state: 'unavailable', reason, nextStep });
  });

  it('routes permissioned writes and readiness through the same session snapshot', async () => {
    const calls: string[] = [];
    let emit!: (value: AgentCenterStateInput) => void;
    const waiters: Array<(value: IteratorResult<AgentCenterStateInput>) => void> = [];
    const session = createPermissionedAgentCenterSession({
      handle: 'opaque' as AgentCenterOpaqueHandle,
      surface: permissionedSurface({
        async updateConfiguration(handle, input) {
          calls.push(`model:${handle}:${input.expectedConfigurationRevision}`);
          return permissionedSurface().updateConfiguration(handle, input);
        },
        subscribeReadiness() {
          return {
            [Symbol.asyncIterator]() { return this; },
            next() { return new Promise((resolve) => waiters.push(resolve)); },
            return() { return Promise.resolve({ done: true, value: undefined }); },
          } as AsyncIterableIterator<AgentCenterStateInput>;
        },
      }),
    });
    const unsubscribe = session.subscribe(() => undefined);
    await flush();
    await session.updateModelSettings({ expectedConfigurationRevision: '1', routeIntents: [] });
    expect(calls).toEqual(['model:opaque:1']);
    emit = (value) => waiters.shift()?.({ done: false, value });
    emit(emptyProjection('9007199254740993'));
    await flush();
    expect(session.getSnapshot().state.configRevision).toBe('9007199254740993');
    unsubscribe();
  });

  it('recomputes granted posture live as prompt and requestable without remounting', async () => {
    let emit!: (projection: AgentCenterTransportActionProjection) => void;
    let unsubscribed = false;
    const session = createPermissionedAgentCenterSession({
      handle: 'opaque' as AgentCenterOpaqueHandle,
      surface: permissionedSurface({
        subscribeActionPosture(_handle, listener) {
          emit = listener;
          return () => { unsubscribed = true; };
        },
      }),
    });
    await session.refresh();
    const unsubscribe = session.subscribe(() => undefined);
    await flush();
    expect(session.getSnapshot().availability.updateAutonomy.state).toBe('available');

    emit(recoveryProjection('not_granted'));
    expect(session.getSnapshot().availability.updateAutonomy)
      .toEqual({ state: 'unavailable', reason: 'needs-grant', nextStep: 'requestPermission' });
    expect(session.getSnapshot().availability.requestPermission.state).toBe('available');
    expect(session.getSnapshot().state.autonomy.controlsDisabled).toBe(true);
    expect(session.getSnapshot().state.autonomy.disabledReason).toBe('needs-grant');
    unsubscribe();
    expect(unsubscribed).toBe(true);
  });

  it('does not allow hand-assembled transports or state to impersonate trusted factory outputs', () => {
    const structuralSurface = {} as AgentCenterPermissionedSdkSurfaceInput;
    // @ts-expect-error Permissioned transport surfaces require the Kit sealer's private brand.
    const fabricatedSurface: AgentCenterPermissionedSdkSurface = structuralSurface;
    // @ts-expect-error Manager Sessions are nominal factory outputs, not structural caller state.
    const fabricated: AgentCenterSession = {
      getSnapshot() { throw new Error('fabricated'); }, subscribe() { return () => undefined; },
      async refresh() {}, async updateModelSettings() {}, async updateAutonomy() {},
      async replaceAppearance() {}, async restorePreviousAppearance() {},
      async requestPermission() {}, async openPermissionSettings() {}, modelConfig: null, appearance: {},
    };
    expect(fabricatedSurface).toBeTruthy();
    expect(fabricated).toBeTruthy();
  });
});
