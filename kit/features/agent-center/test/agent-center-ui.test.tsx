import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runtimeAIConfigStructToJson } from '@nimiplatform/kit/core/sdk-contract';
import { AgentCenter } from '../src/components/AgentCenter.js';
import {
  createFirstPartyAgentCenterSession,
  createPermissionedAgentCenterSession,
  sealAgentCenterPermissionedSdkSurface,
} from '../src/session.js';
import type {
  AgentCenterOpaqueHandle,
  AgentCenterProductAction,
  AgentCenterSharedAIConfigProjection,
  AgentCenterTransportActionProjection,
  AgentCenterTransportActionReason,
} from '../src/types.js';
import { sessionFor } from './session-fixture.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (!window.HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
}

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

async function openTextCapability(node: HTMLElement): Promise<void> {
  const capability = node.querySelector(
    '[data-nimi-model-config-capability="text.generate"]',
  ) as HTMLButtonElement;
  expect(capability).toBeTruthy();
  await act(async () => { capability.click(); await Promise.resolve(); });
  await flush();
}

async function chooseLocalIntent(node: HTMLElement): Promise<void> {
  const trigger = node.querySelector(
    '[data-testid="model-config-model-trigger:text.generate"]',
  ) as HTMLButtonElement;
  expect(trigger).toBeTruthy();
  await act(async () => { trigger.click(); await Promise.resolve(); });
  await flush();
  const local = document.body.querySelector(
    '[data-nimi-model-picker-source="local"]',
  ) as HTMLButtonElement;
  expect(local).toBeTruthy();
  act(() => { local.click(); });
  const confirm = Array.from(document.body.querySelectorAll('button'))
    .find((button) => button.textContent?.trim() === 'Use this target') as HTMLButtonElement;
  expect(confirm).toBeTruthy();
  await act(async () => { confirm.click(); await Promise.resolve(); });
  await flush();
}

async function selectField(node: HTMLElement, ariaLabel: string, optionLabel: string): Promise<void> {
  const trigger = node.querySelector(`button[aria-label="${ariaLabel}"]`) as HTMLButtonElement;
  expect(trigger).toBeTruthy();
  await act(async () => { trigger.click(); await Promise.resolve(); });
  await flush();
  const option = Array.from(document.body.querySelectorAll('[role="option"]'))
    .find((entry) => entry.textContent?.includes(optionLabel)) as HTMLElement;
  expect(option).toBeTruthy();
  await act(async () => { option.click(); await Promise.resolve(); });
  await flush();
}

const PRODUCT_ACTIONS: readonly AgentCenterProductAction[] = [
  'getSharedAIConfig', 'overwriteSharedAIConfig', 'readAutonomy', 'updateAutonomy',
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

  it('allows first-time configuration after Runtime reports canonical AIConfig absence', async () => {
    let committed: AgentCenterSharedAIConfigProjection | null = null;
    const session = createFirstPartyAgentCenterSession({
      identity: { ownerUserId: 'owner', runtimeSourceRef: 'source', localAgentRef: 'agent' },
      sharedAIConfig: {
        async get() {
          if (!committed) throw { reasonCode: 'AI_CONFIG_NOT_FOUND' };
          return committed;
        },
        async overwrite(input) {
          const capabilities = [...input.capabilities];
          committed = {
            aiConfig: {
              owner: {
                owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} },
              },
              capabilities,
            },
            capabilities: capabilities.map((intent) => intent.capabilityContract),
            intents: capabilities.map((intent) => ({
              capability: intent.capabilityContract,
              route: intent.route.oneofKind === 'local' ? 'local' : 'cloud',
              requiredFeatures: [...intent.requiredFeatures],
            })),
          };
          return committed;
        },
      },
    });
    await session.refresh();

    const node = render(<AgentCenter activeSection="ai-config" session={session} />);
    await flush();
    await openTextCapability(node);
    await chooseLocalIntent(node);
    const configure = node.querySelector(
      '[data-testid="model-config-save:text.generate"]',
    ) as HTMLButtonElement;
    expect(configure).toBeTruthy();
    expect(configure.disabled).toBe(false);
    expect(node.textContent).not.toContain('Runtime is offline');

    await act(async () => { configure.click(); await Promise.resolve(); });
    await flush();
    expect(session.getSnapshot().state.sharedAIConfig?.aiConfig.capabilities)
      .toEqual([expect.objectContaining({ capabilityContract: 'text.generate' })]);
  });

  it('keeps first-time actions disabled when no configuration read completed', async () => {
    const session = permissionedSession({ initialReason: null });
    const node = render(<AgentCenter activeSection="ai-config" session={session} />);
    await flush();
    await openTextCapability(node);
    const configure = node.querySelector(
      '[data-testid="model-config-save:text.generate"]',
    ) as HTMLButtonElement;
    expect(configure).toBeTruthy();
    expect(configure.disabled).toBe(true);
  });

  it('writes a Local text.generate intent without exposing model targets', async () => {
    const session = await sessionFor();
    const node = render(<AgentCenter activeSection="ai-config" session={session} />);
    await flush();
    await openTextCapability(node);
    expect(node.querySelector('[data-nimi-model-config-defaults="text.generate"]')).not.toBeNull();
    expect(node.textContent).toContain('Default parameters');
    await chooseLocalIntent(node);
    const configure = node.querySelector(
      '[data-testid="model-config-save:text.generate"]',
    ) as HTMLButtonElement;
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
    const listTargets = vi.fn(async () => [{
      targetId: '["openai","gpt-test"]',
      label: 'gpt-test',
      provider: 'openai',
      providerModelTarget: { provider: 'openai', providerModelId: 'gpt-test' },
    }]);
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
      listTargets,
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
    await openTextCapability(node);
    const modelTrigger = node.querySelector(
      '[data-testid="model-config-model-trigger:text.generate"]',
    ) as HTMLButtonElement;
    await act(async () => { modelTrigger.click(); await Promise.resolve(); });
    await flush();
    const cloudTab = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Cloud') as HTMLButtonElement;
    expect(cloudTab).toBeTruthy();
    act(() => { cloudTab.click(); });
    await flush();
    expect(document.body.querySelector(
      '[data-nimi-model-picker-source="cloud"]',
    )).toBeNull();
    expect(listTargets).not.toHaveBeenCalled();
    await selectField(document.body, 'Cloud Connector', 'Work account');
    const target = document.body.querySelector(
      '[data-nimi-model-picker-source="cloud"]',
    ) as HTMLButtonElement;
    expect(target).toBeTruthy();
    act(() => { target.click(); });
    const confirmTarget = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Use this target') as HTMLButtonElement;
    await act(async () => { confirmTarget.click(); await Promise.resolve(); });
    await flush();
    expect(node.textContent).toContain('Account authorization');
    expect(node.textContent).toContain('applies to every LocalAgent and proactive task');
    const confirmations = Array.from(node.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    expect(confirmations).toHaveLength(1);
    act(() => {
      for (const confirmation of confirmations) confirmation.click();
    });
    expect(node.textContent).toContain('Account authorization still needs to be selected.');
    let save = node.querySelector('[data-testid="model-config-save:text.generate"]') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await act(async () => { save.click(); await Promise.resolve(); });
    await flush();
    let savedIntent = session.getSnapshot().state.sharedAIConfig?.aiConfig.capabilities[0];
    expect(savedIntent?.route.oneofKind).toBe('cloud');
    if (savedIntent?.route.oneofKind !== 'cloud') throw new Error('expected Cloud intent');
    expect(savedIntent.route.cloud.connectorGrantId).toBe('');

    const reopenedConfirmations = Array.from(
      node.querySelectorAll('input[type="checkbox"]'),
    ) as HTMLInputElement[];
    expect(reopenedConfirmations.filter((confirmation) => !confirmation.checked)).toHaveLength(1);
    act(() => {
      for (const confirmation of reopenedConfirmations) confirmation.click();
    });
    const create = Array.from(node.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Create account authorization')) as HTMLButtonElement;
    await act(async () => { create.click(); await Promise.resolve(); });
    await flush();
    const postGrantConfirmations = Array.from(
      node.querySelectorAll('input[type="checkbox"]'),
    ) as HTMLInputElement[];
    act(() => {
      for (const confirmation of postGrantConfirmations) {
        if (!confirmation.checked) confirmation.click();
      }
    });

    save = node.querySelector('[data-testid="model-config-save:text.generate"]') as HTMLButtonElement;
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
