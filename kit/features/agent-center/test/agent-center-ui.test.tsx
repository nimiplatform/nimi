import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runtimeAIConfigStructToJson } from '@nimiplatform/kit/core/sdk-contract';
import { AgentCenter } from '../src/components/AgentCenter.js';
import {
  createFirstPartyAgentCenterSession,
} from '../src/session.js';
import type {
  AgentCenterSharedAIConfigProjection,
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

describe('AgentCenter UI session contract', () => {
  it('renders from the Manager Session and exposes only UI composition props', async () => {
    const intent = {
      capabilityContract: 'text.generate',
      route: { oneofKind: 'local' as const, local: { loadoutRef: 'loadout:text' } },
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
        revision: '1',
        capabilities: ['text.generate'],
        intents: [{ capability: 'text.generate', route: 'local', requiredFeatures: [] }],
      },
    });
    const node = render(
      <AgentCenter
        chrome="standalone"
        identity={{ displayName: 'Nimi', avatarFallback: 'N' }}
        session={session}
      />,
    );
    await flush();
    const surface = node.querySelector('[data-chat-agent-center="true"]') as HTMLElement;
    expect(surface).not.toBeNull();
    expect(surface.className).toContain('h-full');
    expect(surface.className).toContain('flex-col');
    const panel = node.querySelector('[role="tabpanel"]') as HTMLElement;
    expect(panel.className).toContain('flex-1');
    expect(panel.className).toContain('overflow-y-auto');
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

  it('routes unavailable covered actions to the admitted Runtime owner surface', async () => {
    const session = await sessionFor();
    let opened = 0;
    const node = render(
      <AgentCenter
        activeSection="behavior"
        placementActions={{ openRuntimeSettings: () => { opened += 1; } }}
        session={session}
      />,
    );
    await flush();

    const handoff = node.querySelector(
      '[data-agent-center-next-step-action="openRuntimeSettings"]',
    ) as HTMLButtonElement;
    expect(handoff).toBeTruthy();
    act(() => handoff.click());
    expect(opened).toBe(1);
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

  it('roams section tabs with arrow keys using roving tabindex', async () => {
    const session = await sessionFor();
    const node = render(<AgentCenter session={session} />);
    await flush();
    const overview = node.querySelector('#agent-center-tab-overview') as HTMLButtonElement;
    expect(overview).toBeTruthy();
    act(() => { overview.focus(); });
    act(() => {
      overview.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    });
    const appearance = node.querySelector('#agent-center-tab-appearance') as HTMLButtonElement;
    expect(document.activeElement).toBe(appearance);
    expect(appearance.tabIndex).toBe(0);
    expect(overview.tabIndex).toBe(-1);
    expect(node.querySelector('#agent-center-panel-appearance')).not.toBeNull();
    act(() => {
      appearance.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(overview);
    expect(node.querySelector('#agent-center-panel-overview')).not.toBeNull();
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

  it('passes autonomy budget input unchanged to the SDK-owned validation boundary', async () => {
    const session = await sessionFor({
      autonomy: {
        revision: 'a1', enabled: true, mode: 'low', budgetExhausted: false,
        usedTokensInWindow: 1, dailyTokenBudget: 100, maxTokensPerHook: 10,
        windowStartedAt: null, suspendedUntil: null,
      },
    });
    const update = vi.spyOn(session, 'updateAutonomy').mockRejectedValue(new Error('invalid budget'));
    const node = render(<AgentCenter activeSection="behavior" session={session} />);
    await flush();

    act(() => {
      (node.querySelector('[data-agent-center-budget-adjust="true"]') as HTMLButtonElement).click();
    });
    const inputs = node.querySelectorAll('input[type="number"]');
    const daily = inputs[0] as HTMLInputElement;
    const perHook = inputs[1] as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(daily, '-1');
      daily.dispatchEvent(new Event('input', { bubbles: true }));
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(perHook, '1.5');
      perHook.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      (node.querySelector('[data-agent-center-autonomy-apply="true"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      dailyTokenBudget: -1,
      maxTokensPerHook: 1.5,
    }));
    expect(node.textContent).toContain('invalid budget');
  });

  it('allows first-time configuration after Runtime reports canonical AIConfig absence', async () => {
    let committed: AgentCenterSharedAIConfigProjection['aiConfig'] | null = null;
    let revision = '0';
    const session = createFirstPartyAgentCenterSession({
      identity: { ownerUserId: 'owner', runtimeSourceRef: 'source', localAgentRef: 'agent' },
      sharedAIConfig: {
        async get() {
          return { config: committed, revision, effectiveSelections: [] };
        },
        async overwrite(input) {
          const capabilities = [...input.capabilities];
          committed = {
            owner: {
              owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} },
            },
            capabilities,
          };
          revision = '1';
          return { outcome: 'committed' as const, config: committed, revision };
        },
        async listOptions() {
          return {
            kind: 'local-loadouts' as const,
            options: [{
              loadoutRef: 'loadout:text', label: 'Local text model', capabilityContract: 'text.generate',
              implementation: { implementationId: 'local.text', driverId: 'test', driverDialect: 'test/local/v1' },
              supportedFeatures: [], state: 'ready' as const, reasons: [],
            }],
            truncated: false,
          };
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
      route: { oneofKind: 'local', local: { loadoutRef: 'loadout:text' } },
    })]);
    expect(JSON.stringify(config)).not.toContain('targetRef');
  });

  it('saves an exact Cloud Connector and target without a second confirmation gate', async () => {
    const connector = {
      connectorRef: 'connector-1', label: 'Work account', provider: 'openai',
      state: 'ready' as const, reasons: [],
    };
    const target = {
      connectorRef: 'connector-1',
      label: 'gpt-test',
      capabilityContract: 'text.generate',
      implementation: { implementationId: 'openai', driverId: 'nimillm', driverDialect: 'openai' },
      providerModelTarget: {
        provider: 'openai',
        providerModelId: 'gpt-test',
        remoteModelCatalogId: 'remote-model-catalog-gpt-test',
      },
      supportedFeatures: [], state: 'ready' as const, reasons: [],
    };
    const session = await sessionFor({}, null, {
      connectors: [connector],
      targets: [target],
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
    await selectField(document.body, 'Cloud Connector', 'Work account');
    const targetButton = document.body.querySelector(
      '[data-nimi-model-picker-source="cloud"]',
    ) as HTMLButtonElement;
    expect(targetButton).toBeTruthy();
    act(() => { targetButton.click(); });
    const confirmTarget = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Use this target') as HTMLButtonElement;
    await act(async () => { confirmTarget.click(); await Promise.resolve(); });
    await flush();
    expect(node.textContent).toContain('Cloud execution');
    const confirmations = Array.from(node.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    expect(confirmations).toHaveLength(0);
    let save = node.querySelector('[data-testid="model-config-save:text.generate"]') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await act(async () => { save.click(); await Promise.resolve(); });
    await flush();
    let savedIntent = session.getSnapshot().state.sharedAIConfig?.aiConfig.capabilities[0];
    expect(savedIntent?.route.oneofKind).toBe('cloud');
    if (savedIntent?.route.oneofKind !== 'cloud') throw new Error('expected Cloud intent');
    const intent = session.getSnapshot().state.sharedAIConfig?.aiConfig.capabilities[0];
    expect(intent?.route.oneofKind).toBe('cloud');
    if (intent?.route.oneofKind !== 'cloud') throw new Error('expected Cloud intent');
    expect(intent.route.cloud.connectorRef).toBe('connector-1');
    expect(intent.route.cloud.implementation).toEqual({
      implementationId: 'openai',
      driverId: 'nimillm',
      driverDialect: 'openai',
    });
    expect(runtimeAIConfigStructToJson(intent.route.cloud.providerModelTarget)).toEqual({
      provider: 'openai',
      providerModelId: 'gpt-test',
      remoteModelCatalogId: 'remote-model-catalog-gpt-test',
    });
  });
});
