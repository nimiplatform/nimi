import { createNimiAIScopeRef } from '@nimiplatform/sdk/ai';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
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
  'readModelSettings', 'updateModelSettings', 'readAutonomy', 'updateAutonomy',
  'readMemorySummary', 'replaceAppearance', 'restorePreviousAppearance',
  'requestPermission', 'openPermissionSettings',
];

function actionProjection(
  reason: AgentCenterTransportActionReason | null,
): AgentCenterTransportActionProjection {
  const recoveryAction = reason === 'not_granted'
    ? 'requestPermission'
    : reason === 'grant_denied' || reason === 'grant_revoked'
      ? 'openPermissionSettings'
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
      async updateConfiguration() { return {}; },
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
    const session = await sessionFor({
      modelSettings: {
        scopeRef: createNimiAIScopeRef({ kind: 'feature', ownerId: 'runtime.agent.model-settings', surfaceId: 'local-agent:test' }),
        capabilities: ['text.generate'],
        routeIntents: [{ capability: 'text.generate', provider: '', model: 'model-a', routePolicy: 'local' }],
        readiness: [{ capability: 'text.generate', state: 'ready', reason: '', observedAt: null }],
        configurationRevision: '2',
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
    let node = render(<AgentCenter activeSection="model" session={needsGrant} />);
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
    node = render(<AgentCenter activeSection="model" session={reserved} />);
    await flush();
    expect(node.querySelector('[data-agent-center-next-step="wait"]')).not.toBeNull();
    expect(node.querySelector('[data-agent-center-next-step-action="requestPermission"]')).toBeNull();
    expect(node.textContent).toContain('Wait for permission availability');
  });

  it('re-renders live revoked and denied postures with settings recovery', async () => {
    let emit!: (projection: AgentCenterTransportActionProjection) => void;
    let settingsCalls = 0;
    const session = permissionedSession({
      initialReason: null,
      onOpenSettings: () => { settingsCalls += 1; },
      onSubscribe: (listener) => { emit = listener; },
    });
    const node = render(<AgentCenter activeSection="behavior" session={session} />);
    await flush();
    expect(node.querySelector('[data-agent-center-proactive-toggle="true"]')).not.toBeNull();

    act(() => emit(actionProjection('grant_revoked')));
    expect(node.querySelector('[data-agent-center-action-reason="revoked"]')).not.toBeNull();
    let settings = node.querySelector('[data-agent-center-next-step-action="openPermissionSettings"]') as HTMLButtonElement;
    expect(settings).not.toBeNull();

    act(() => emit(actionProjection('grant_denied')));
    expect(node.querySelector('[data-agent-center-action-reason="denied"]')).not.toBeNull();
    settings = node.querySelector('[data-agent-center-next-step-action="openPermissionSettings"]') as HTMLButtonElement;
    await act(async () => { settings.click(); await Promise.resolve(); });
    expect(settingsCalls).toBe(1);
  });

  it('renders model, behavior, and appearance sections through session-owned state', async () => {
    const session = await sessionFor({
      autonomy: {
        revision: 'a1', enabled: true, mode: 'low', budgetExhausted: false,
        usedTokensInWindow: 1, dailyTokenBudget: 100, maxTokensPerHook: 10,
        windowStartedAt: null, suspendedUntil: null,
      },
      appearance: { status: 'not_configured', presentationRevision: 'p1' },
    });
    for (const section of ['model', 'behavior', 'appearance'] as const) {
      const node = render(<AgentCenter activeSection={section} chrome="embedded" session={session} />);
      await flush();
      expect(node.querySelector(`#agent-center-panel-${section}`)).not.toBeNull();
      act(() => root?.unmount());
      root = null;
      container?.remove();
      container = null;
    }
  });
});
