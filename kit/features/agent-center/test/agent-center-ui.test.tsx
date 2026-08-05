import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runtimeAIConfigStructToJson } from '@nimiplatform/kit/core/sdk-contract';
import { AgentCenter } from '../src/components/AgentCenter.js';
import {
  createPermissionedAgentCenterSession,
  sealAgentCenterPermissionedSdkSurface,
} from '../src/session.js';
import type {
  AgentCenterOpaqueHandle,
  AgentCenterProductAction,
  AgentCenterTransportActionProjection,
  AgentCenterTransportActionReason,
} from '../src/types.js';
import { sessionFor } from './session-fixture.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(element: ReactNode): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(element));
  return container;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const PRODUCT_ACTIONS: readonly AgentCenterProductAction[] = [
  'getSharedAIConfig', 'overwriteSharedAIConfig', 'applySharedAIProfile', 'readAutonomy', 'updateAutonomy',
  'readMemorySummary', 'replaceAppearance', 'restorePreviousAppearance',
  'requestPermission', 'openPermissionSettings',
];

function actionProjection(
  reason: AgentCenterTransportActionReason | null,
): AgentCenterTransportActionProjection {
  const recoveryAction = reason === 'not_granted' || reason === 'grant_denied' || reason === 'grant_revoked'
    ? 'requestPermission'
    : null;
  return Object.fromEntries(PRODUCT_ACTIONS.map((action) => [action, !reason || action === recoveryAction
    ? { state: 'available', reason: null }
    : { state: 'unavailable', reason }])) as AgentCenterTransportActionProjection;
}

function permissionedSession(input: {
  readonly initialReason: AgentCenterTransportActionReason | null;
  readonly onRequest?: () => void;
  readonly onOpenSettings?: () => void;
  readonly onSubscribe?: (listener: (projection: AgentCenterTransportActionProjection) => void) => void;
}) {
  return createPermissionedAgentCenterSession({
    handle: 'opaque' as AgentCenterOpaqueHandle,
    surface: sealAgentCenterPermissionedSdkSurface({
      async actionPosture() { return actionProjection(input.initialReason); },
      async read() {
        return {
          autonomy: {
            revision: '1', enabled: true, mode: 'low', budgetExhausted: false,
            usedTokensInWindow: 0, dailyTokenBudget: 100, maxTokensPerHook: 10,
            windowStartedAt: null, suspendedUntil: null,
          },
        };
      },
      async overwriteSharedAIConfig() {
        return {
          aiConfig: {
            owner: {
              owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} },
            },
            capabilities: [],
          },
          capabilities: [],
          intents: [],
        };
      },
      async updateAutonomy() { return {}; },
      async replaceAppearance() { return {}; },
      async restorePreviousAppearance() { return {}; },
      async requestPermission() { input.onRequest?.(); },
      async openPermissionSettings() { input.onOpenSettings?.(); },
      ...(input.onSubscribe ? {
        subscribeActionPosture(_handle, listener) {
          input.onSubscribe?.(listener);
          return () => undefined;
        },
      } : {}),
    }),
  });
}

describe('AgentCenter UI session contract', () => {
  it('renders from the Manager Session and exposes only UI composition props', async () => {
    const intent = {
      capabilityContract: 'text.generate',
      route: { oneofKind: 'local' as const, local: {} },
      requiredFeatures: [] as string[],
    };
    const session = await sessionFor({
      sharedAIConfig: {
        aiConfig: {
          owner: {
            owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} },
          },
          capabilities: [intent],
        },
        capabilities: ['text.generate'],
        intents: [{ capability: 'text.generate', route: 'local', requiredFeatures: [] }],
      },
    });
    const node = render(
      <AgentCenter
        chrome="standalone"
        density="compact"
        identity={{ displayName: 'Nimi', avatarFallback: 'N' }}
        layout="split"
        session={session}
      />,
    );
    await flush();
    expect(node.querySelector('[data-chat-agent-center="true"]')).not.toBeNull();
    expect(node.querySelector('[data-agent-center-density="compact"]')).not.toBeNull();
    expect(node.querySelector('[data-agent-center-layout="split"]')).not.toBeNull();
    expect(node.textContent).toContain('Nimi');
  });

  it('uses controlled active-section and placement callbacks', async () => {
    const session = await sessionFor();
    let closed = 0;
    const node = render(
      <AgentCenter
        activeSection="cognition"
        placementActions={{ close: () => { closed += 1; } }}
        session={session}
      />,
    );
    await flush();
    expect(node.querySelector('#agent-center-panel-cognition')).not.toBeNull();
    const close = node.querySelector('button[aria-label="Close Agent Center"]');
    act(() => (close as HTMLButtonElement).click());
    expect(closed).toBe(1);
  });

  it('uses the canonical i18n seam without copy-object props', async () => {
    const session = await sessionFor();
    const node = render(
      <AgentCenter
        i18n={{
          language: 'en',
          t(key) { return key === 'AgentCenter.cognition.title' ? 'Mind projection' : key; },
        }}
        activeSection="cognition"
        session={session}
      />,
    );
    await flush();
    expect(node.textContent).toContain('Mind projection');
  });

  it('routes section changes without exposing a carrier distinction', async () => {
    const session = await sessionFor();
    const changes: string[] = [];
    const node = render(<AgentCenter onSectionChange={(section) => changes.push(section)} session={session} />);
    await flush();
    const behavior = node.querySelector('[data-testid="chat-agent-center-section:behavior"]') as HTMLButtonElement;
    act(() => behavior.click());
    expect(changes).toEqual(['behavior']);
    expect(node.querySelector('#agent-center-panel-behavior')).not.toBeNull();
    expect(node.innerHTML).not.toMatch(/carrier|permission-posture|posture-group/u);
  });

  it('renders the needs-grant request entry, invokes it, and keeps reserved posture on wait', async () => {
    let requests = 0;
    const needsGrant = permissionedSession({
      initialReason: 'not_granted',
      onRequest: () => { requests += 1; },
    });
    let node = render(<AgentCenter activeSection="ai-config" session={needsGrant} />);
    await flush();
    const request = node.querySelector('[data-agent-center-next-step-action="requestPermission"]') as HTMLButtonElement;
    expect(request).not.toBeNull();
    await act(async () => { request.click(); await Promise.resolve(); });
    expect(requests).toBe(1);

    act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
    const reserved = permissionedSession({ initialReason: 'reserved_not_admitted' });
    node = render(<AgentCenter activeSection="ai-config" session={reserved} />);
    await flush();
    expect(node.querySelector('[data-agent-center-next-step="wait"]')).not.toBeNull();
    expect(node.querySelector('[data-agent-center-next-step-action="requestPermission"]')).toBeNull();
    expect(node.textContent).toContain('Wait for permission availability');
  });

  it('re-renders live grant removal as prompt with request affordance', async () => {
    let emit!: (projection: AgentCenterTransportActionProjection) => void;
    let requestCalls = 0;
    const session = permissionedSession({
      initialReason: null,
      onRequest: () => { requestCalls += 1; },
      onSubscribe: (listener) => { emit = listener; },
    });
    const node = render(<AgentCenter activeSection="behavior" session={session} />);
    await flush();
    expect(node.querySelector('[data-agent-center-proactive-toggle="true"]')).not.toBeNull();

    act(() => emit(actionProjection('not_granted')));
    expect(node.querySelector('[data-agent-center-action-reason="needs-grant"]')).not.toBeNull();
    const request = node.querySelector('[data-agent-center-next-step-action="requestPermission"]') as HTMLButtonElement;
    expect(request).not.toBeNull();
    expect(node.querySelector('[data-agent-center-next-step-action="openPermissionSettings"]')).toBeNull();
    await act(async () => { request.click(); await Promise.resolve(); });
    expect(requestCalls).toBe(1);
  });

  it('renders AIConfig, behavior, and appearance sections through session-owned state', async () => {
    const session = await sessionFor({
      autonomy: {
        revision: 'a1', enabled: true, mode: 'low', budgetExhausted: false,
        usedTokensInWindow: 1, dailyTokenBudget: 100, maxTokensPerHook: 10,
        windowStartedAt: null, suspendedUntil: null,
      },
      appearance: { status: 'not_configured', presentationRevision: 'p1' },
    });
    for (const section of ['ai-config', 'behavior', 'appearance'] as const) {
      const node = render(<AgentCenter activeSection={section} chrome="embedded" session={session} />);
      await flush();
      expect(node.querySelector(`#agent-center-panel-${section}`)).not.toBeNull();
      act(() => root?.unmount());
      root = null;
      container?.remove();
      container = null;
    }
  });

  it('writes a Local text.generate intent without exposing model targets', async () => {
    const session = await sessionFor();
    const node = render(<AgentCenter activeSection="ai-config" session={session} />);
    await flush();
    const configure = Array.from(node.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Use Local')) as HTMLButtonElement;
    expect(configure).toBeTruthy();
    await act(async () => { configure.click(); await Promise.resolve(); });
    await flush();

    const config = session.getSnapshot().state.sharedAIConfig?.aiConfig;
    expect(config?.owner?.owner.oneofKind).toBe('runtimeLocalAgentSubsystem');
    expect(config?.capabilities).toEqual([expect.objectContaining({
      capabilityContract: 'text.generate',
      route: { oneofKind: 'local', local: {} },
    })]);
    expect(JSON.stringify(config)).not.toContain('targetRef');
  });

  it('keeps target confirmation and shared account authorization as explicit Cloud steps', async () => {
    let grants: Array<{
      grantId: string;
      connectorId: string;
      status: 'active' | 'revoked';
      createdAt: string;
      revokedAt: string | null;
    }> = [];
    const createGrant = vi.fn(async (connectorId: string) => {
      const grant = {
        grantId: 'grant-1',
        connectorId,
        status: 'active' as const,
        createdAt: '2026-08-05T00:00:00.000Z',
        revokedAt: null,
      };
      grants = [grant];
      return grant;
    });
    const session = await sessionFor({}, null, {
      async listImplementations() {
        return [{
          optionId: 'openai',
          label: 'OpenAI',
          provider: 'openai',
          implementation: {
            implementationId: 'openai',
            driverId: 'nimillm',
            driverDialect: 'openai',
          },
        }];
      },
      async listTargets() {
        return [{
          targetId: '["openai","gpt-test"]',
          label: 'gpt-test',
          provider: 'openai',
          providerModelTarget: { provider: 'openai', providerModelId: 'gpt-test' },
        }];
      },
      async listAuthorizationOptions() {
        return {
          connectors: [{ connectorId: 'connector-1', label: 'Work account', provider: 'openai' }],
          grants,
        };
      },
      createGrant,
    });
    const node = render(<AgentCenter activeSection="ai-config" session={session} />);
    await flush();

    const start = node.querySelector('[data-agent-center-cloud-start="true"]') as HTMLButtonElement;
    await act(async () => { start.click(); await Promise.resolve(); });
    await flush();
    expect(node.textContent).toContain('1. Confirm Cloud implementation and target');
    expect(node.textContent).toContain('2. Select account authorization');
    expect(node.textContent).toContain('applies to all LocalAgents and their proactive tasks');

    const implementation = node.querySelector('select[aria-label="Cloud implementation"]') as HTMLSelectElement;
    act(() => {
      implementation.value = 'openai';
      implementation.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    const target = node.querySelector('select[aria-label="Provider-model target"]') as HTMLSelectElement;
    act(() => {
      target.value = '["openai","gpt-test"]';
      target.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const confirmations = Array.from(node.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    expect(confirmations).toHaveLength(2);
    act(() => {
      for (const confirmation of confirmations) confirmation.click();
    });
    expect(node.textContent).toContain('You may save this information state and choose one later.');
    let save = node.querySelector('[data-agent-center-cloud-save="true"]') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await act(async () => { save.click(); await Promise.resolve(); });
    await flush();
    let savedIntent = session.getSnapshot().state.sharedAIConfig?.aiConfig.capabilities[0];
    expect(savedIntent?.route.oneofKind).toBe('cloud');
    if (savedIntent?.route.oneofKind !== 'cloud') throw new Error('expected Cloud intent');
    expect(savedIntent.route.cloud.connectorGrantId).toBe('');

    await act(async () => { start.click(); await Promise.resolve(); });
    await flush();
    const reopenedConfirmations = Array.from(
      node.querySelectorAll('input[type="checkbox"]'),
    ) as HTMLInputElement[];
    expect(reopenedConfirmations.filter((confirmation) => !confirmation.checked)).toHaveLength(2);
    act(() => {
      for (const confirmation of reopenedConfirmations) confirmation.click();
    });
    const connector = node.querySelector('select[aria-label="Create authorization from connector"]') as HTMLSelectElement;
    act(() => {
      connector.value = 'connector-1';
      connector.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const create = Array.from(node.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Create account authorization')) as HTMLButtonElement;
    await act(async () => { create.click(); await Promise.resolve(); });
    await flush();

    save = node.querySelector('[data-agent-center-cloud-save="true"]') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await act(async () => { save.click(); await Promise.resolve(); });
    await flush();

    expect(createGrant).toHaveBeenCalledWith('connector-1');
    const intent = session.getSnapshot().state.sharedAIConfig?.aiConfig.capabilities[0];
    expect(intent?.route.oneofKind).toBe('cloud');
    if (intent?.route.oneofKind !== 'cloud') throw new Error('expected Cloud intent');
    expect(intent.route.cloud.connectorGrantId).toBe('grant-1');
    expect(intent.route.cloud.implementation).toEqual({
      implementationId: 'openai',
      driverId: 'nimillm',
      driverDialect: 'openai',
    });
    expect(runtimeAIConfigStructToJson(intent.route.cloud.providerModelTarget)).toEqual({
      provider: 'openai',
      providerModelId: 'gpt-test',
    });
  });
});
