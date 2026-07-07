import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { AgentCenter } from '../src/components/AgentCenter.js';
import { buildAgentCenterState } from '../src/state.js';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
});

function render(element: ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(element);
  });
  return container;
}

function click(button: Element | null) {
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('expected button');
  }
  act(() => {
    button.click();
  });
}

async function clickAsync(button: Element | null) {
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('expected button');
  }
  await act(async () => {
    button.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('AgentCenter UI', () => {
  it('renders identity chrome only for standalone placement', () => {
    const state = buildAgentCenterState({});
    const identity = {
      displayName: '颜真卿',
      localAgentRef: 'local-agent:runtime-ae3e127864d3567bdf...',
      avatarFallback: '颜',
      badgeLabel: '世界角色',
    };

    const standalone = render(<AgentCenter identity={identity} state={state} />);
    expect(standalone.textContent).toContain('颜真卿');
    expect(standalone.textContent).toContain('local-agent:runtime-ae3e127864d3567bdf...');
    expect(standalone.textContent).toContain('世界角色');

    root?.unmount();
    standalone.remove();
    root = null;
    container = null;

    const embedded = render(<AgentCenter chrome="embedded" identity={identity} state={state} />);
    expect(embedded.textContent).not.toContain('颜真卿');
    expect(embedded.textContent).not.toContain('local-agent:runtime-ae3e127864d3567bdf...');
  });

  it('uses the migrated Desktop Agent Center navigation and section chrome', () => {
    const state = buildAgentCenterState({
      agentAIConfig: {
        revision: 4,
        updatedAt: null,
        updatedByAppId: 'runtime',
        intents: {
          'text.generate': {
            route: 'local',
            modelId: 'local/runtime-agent-live-e2e',
            targetRef: {
              kind: 'local-runtime',
              version: 'v2',
              profileBindingId: 'local-runtime:text-default',
            },
          },
        },
      },
      readiness: {
        configRevision: 4,
        capabilities: [
          { capability: 'text.generate', state: 'ready', reasonCode: '', probedAt: null },
          { capability: 'text.embed', state: 'not_configured', reasonCode: 'model_missing', probedAt: null },
          { capability: 'image.generate', state: 'not_configured', reasonCode: '', probedAt: null },
          { capability: 'audio.synthesize', state: 'not_configured', reasonCode: '', probedAt: null },
        ],
      },
    });

    const node = render(<AgentCenter identity={{ displayName: '颜真卿', avatarFallback: '颜' }} state={state} />);
    const nav = node.querySelector<HTMLElement>('[data-agent-center-nav-style="desktop-dynamic-expand"]');
    expect(nav).not.toBeNull();
    const overview = node.querySelector<HTMLButtonElement>('[data-testid="chat-agent-center-section:overview"]');
    const model = node.querySelector<HTMLButtonElement>('[data-testid="chat-agent-center-section:model"]');
    expect(overview?.className).toContain('bg-emerald-500/15');
    expect(overview?.textContent).toContain('Overview');
    expect(model?.querySelector('span')?.className).toContain('max-w-0');
    expect(node.querySelector('[data-agent-center-active-section-label]')?.textContent).toBe('Overview');
    const hero = node.querySelector<HTMLElement>('[data-agent-center-progress-hero="desktop-migrated"]');
    expect(hero).not.toBeNull();
    expect(hero?.className).toContain('bg-gradient-to-br');
    expect(hero?.className).toContain('p-5');

    click(model);
    expect(model?.className).toContain('bg-emerald-500/15');
    expect(model?.querySelector('span')?.className).toContain('max-w-[160px]');
    expect(overview?.querySelector('span')?.className).toContain('max-w-0');
    expect(node.querySelector('[data-agent-center-active-section-label]')?.textContent).toBe('Model');
    expect(node.querySelector('[data-agent-center-model-surface="runtime-model-config-hub"]')).not.toBeNull();
    expect(node.textContent).toContain('Conversation');
    expect(node.textContent).toContain('Voice');
    expect(node.textContent).toContain('Media');
  });

  it('renders all generic sections and switches tabs without app-specific slots', () => {
    const state = buildAgentCenterState({
      agentAIConfig: {
        revision: 9,
        updatedAt: null,
        updatedByAppId: 'runtime',
        intents: {
          'text.generate': {
            route: 'local',
            modelId: 'local/default',
            targetRef: {
              kind: 'local-runtime',
              version: 'v2',
              profileBindingId: 'local-runtime:text-default',
            },
          },
          'text.embed': {
            route: 'local',
            modelId: 'local/default-embedding',
            targetRef: {
              kind: 'local-runtime',
              version: 'v2',
              profileBindingId: 'local-runtime:embedding-default',
            },
          },
          'image.generate': {
            route: 'cloud',
            modelId: 'gpt-image-1.5',
            connectorId: 'connector-image',
            imagePolicyRef: 'image-policy:runtime-agent-default',
            targetRef: {
              kind: 'cloud-connector',
              version: 'v2',
              connectorId: 'connector-image',
              remoteModelCatalogId: 'catalog-image',
              providerModelId: 'gpt-image-1.5',
              provider: 'openai',
            },
          },
        },
      },
      readiness: {
        configRevision: 9,
        capabilities: [
          { capability: 'text.generate', state: 'ready', reasonCode: '', probedAt: null },
          { capability: 'text.embed', state: 'ready', reasonCode: '', probedAt: null },
          { capability: 'image.generate', state: 'not_configured', reasonCode: '', probedAt: null },
          { capability: 'audio.synthesize', state: 'not_configured', reasonCode: '', probedAt: null },
        ],
      },
      autonomyMutationAvailable: true,
      inspect: {
        lifecycleStatus: 'active',
        executionState: 'chat-active',
        statusText: '正在处理一个非常长的中文状态文本，用于验证窄屏布局不会把按钮或标签挤出容器',
        activeWorldId: null,
        activeUserId: null,
        updatedAt: null,
        currentEmotion: 'focused',
        proactiveInterruptibility: null,
        presentationProfile: {
          backendKind: 'live2d',
          avatarAssetRef: 'asset://avatar/runtime-admitted',
          expressionProfileRef: null,
          idlePreset: null,
          interactionPolicyRef: null,
          defaultVoiceReference: 'preset_voice_id:nimi-default',
          avatarAutoplay: true,
        },
        autonomyMode: 'medium',
        autonomyEnabled: true,
        autonomyBudgetExhausted: false,
        autonomyUsedTokensInWindow: 10,
        autonomyDailyTokenBudget: 1200,
        autonomyMaxTokensPerHook: 80,
        autonomyWindowStartedAt: null,
        autonomySuspendedUntil: null,
        pendingHooksCount: 0,
        nextScheduledFor: null,
        pendingHooks: [],
        recentTerminalHooks: [],
        recentCanonicalMemories: [{
          memoryId: 'memory-1',
          canonicalClass: 'dyadic',
          kind: 'semantic',
          summary: '用户希望 Agent Center 使用运行时投影',
          updatedAt: null,
          sourceEventId: null,
          policyReason: 'runtime-inspect',
          recallScore: 0.9,
        }],
      } as never,
    });

    const node = render(<AgentCenter state={state} />);
    const buttons = Array.from(node.querySelectorAll('nav button'));
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Overview',
      'Appearance',
      'Behavior',
      'Model',
      'Cognition',
      'Advanced',
    ]);

    click(buttons[3]);
    expect(node.textContent).toContain('Revision 9');
    expect(node.querySelector('[data-agent-center-model-surface="runtime-model-config-hub"]')).not.toBeNull();
    expect(node.textContent).toContain('Embedding');
    expect(node.textContent).not.toContain('Model ID');

    click(buttons[4]);
    expect(node.textContent).toContain('用户希望 Agent Center 使用运行时投影');
    expect(node.textContent).toContain('正在处理一个非常长的中文状态文本');

    click(buttons[1]);
    expect(node.textContent).toContain('asset://avatar/runtime-admitted');

    click(buttons[5]);
    expect(node.textContent).toContain('Config revision');
    expect(node.textContent).not.toContain(['model', 'Content'].join(''));
    expect(node.textContent).not.toContain(['Capability', 'Studio'].join(''));
  });

  it('commits model selection through the Runtime Agent AI Config adapter with the current revision', async () => {
    const calls: unknown[] = [];
    const state = buildAgentCenterState({
      agentAIConfig: {
        revision: 9,
        updatedAt: null,
        updatedByAppId: 'runtime',
        intents: {
          'text.generate': {
            route: 'local',
            modelId: 'local/default',
            targetRef: {
              kind: 'local-runtime',
              version: 'v2',
              profileBindingId: 'local-runtime:text-default',
            },
          },
          'text.embed': {
            route: 'local',
            modelId: 'local/default-embedding',
            targetRef: {
              kind: 'local-runtime',
              version: 'v2',
              profileBindingId: 'local-runtime:embedding-default',
            },
          },
          'image.generate': {
            route: 'cloud',
            modelId: 'gpt-image-1.5',
            connectorId: 'connector-image',
            imagePolicyRef: 'image-policy:runtime-agent-default',
            targetRef: {
              kind: 'cloud-connector',
              version: 'v2',
              connectorId: 'connector-image',
              remoteModelCatalogId: 'catalog-image',
              providerModelId: 'gpt-image-1.5',
              provider: 'openai',
            },
          },
        },
      },
      readiness: {
        configRevision: 9,
        capabilities: [
          { capability: 'text.generate', state: 'ready', reasonCode: '', probedAt: null },
          { capability: 'text.embed', state: 'ready', reasonCode: '', probedAt: null },
          { capability: 'image.generate', state: 'not_configured', reasonCode: '', probedAt: null },
          { capability: 'audio.synthesize', state: 'not_configured', reasonCode: '', probedAt: null },
          { capability: 'voice_workflow.voice_clone', state: 'not_configured', reasonCode: '', probedAt: null } as never,
          { capability: 'voice_workflow.voice_design', state: 'not_configured', reasonCode: '', probedAt: null } as never,
        ],
      },
    });

    const node = render(
      <AgentCenter
        defaultSection="model"
        runtimeAdapter={{
          agentAIConfig: {} as never,
          modelConfig: {
            providerResolver: () => ({
              listLocalModels: async () => [{
                localModelId: 'runtime-text-v2',
                goRuntimeLocalModelId: 'runtime-text-v2',
                profileBindingId: 'local-runtime:text-v2',
                modelId: 'local/runtime-text-v2',
                label: 'runtime-text-v2',
                engine: 'llama',
                status: 'active',
                capabilities: ['text.generate'],
              }],
              listConnectors: async () => [],
              listConnectorModels: async () => [],
            }),
          },
          async loadSnapshot() {
            return {};
          },
          async upsertAgentAIConfig(input) {
            calls.push(input);
            return {
              revision: 10,
              updatedAt: null,
              updatedByAppId: 'runtime',
              intents: input.intents,
            };
          },
        }}
        state={state}
      />,
    );

    await clickAsync(node.querySelector('[data-nimi-model-config-section="chat"]'));
    const selector = node.querySelector('[data-nimi-model-config-capability="text.generate"] button');
    await clickAsync(selector);
    const option = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('runtime-text-v2'));
    await clickAsync(option || null);

    expect(calls).toEqual([{
      expectedRevision: 9,
      intents: {
        'text.generate': {
          route: 'local',
          modelId: 'local-runtime:text-v2',
          targetRef: {
            kind: 'local-runtime',
            version: 'v2',
            profileBindingId: 'local-runtime:text-v2',
          },
        },
        'text.embed': {
          route: 'local',
          modelId: 'local/default-embedding',
          targetRef: {
            kind: 'local-runtime',
            version: 'v2',
            profileBindingId: 'local-runtime:embedding-default',
          },
        },
        'image.generate': {
          route: 'cloud',
          modelId: 'gpt-image-1.5',
          connectorId: 'connector-image',
          imagePolicyRef: 'image-policy:runtime-agent-default',
          targetRef: {
            kind: 'cloud-connector',
            version: 'v2',
            connectorId: 'connector-image',
            remoteModelCatalogId: 'catalog-image',
            providerModelId: 'gpt-image-1.5',
            provider: 'openai',
          },
        },
      },
    }]);
    expect(node.textContent).toContain('Saved Runtime Agent AI Config revision 10.');
  });

  it('loads Runtime projection through the adapter when the app supplies placement-only state', async () => {
    const calls: string[] = [];
    const node = render(
      <AgentCenter
        defaultSection="model"
        runtimeAdapter={{
          agentAIConfig: {} as never,
          async loadSnapshot() {
            calls.push('loadSnapshot');
            return {
              agentAIConfig: {
                revision: 15,
                updatedAt: null,
                updatedByAppId: 'runtime',
                intents: {
                  'text.generate': { route: 'local', modelId: 'local/loaded-text' },
                  'text.embed': { route: 'local', modelId: 'local/loaded-embed' },
                },
              },
              readiness: {
                configRevision: 15,
                capabilities: [
                  { capability: 'text.generate', state: 'ready', reasonCode: '', probedAt: null },
                  { capability: 'text.embed', state: 'ready', reasonCode: '', probedAt: null },
                ],
              },
            };
          },
        }}
        state={{}}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(calls).toEqual(['loadSnapshot']);
    expect(node.textContent).toContain('Revision 15');
    expect(node.querySelector('[data-agent-center-model-surface="runtime-model-config-hub"]')).not.toBeNull();
    expect(node.textContent).toContain('Embedding');
  });

  it('does not reload Runtime projection when the app already supplies it in placement state', async () => {
    let loadCalls = 0;
    const node = render(
      <AgentCenter
        defaultSection="model"
        runtimeAdapter={{
          agentAIConfig: {} as never,
          async loadSnapshot() {
            loadCalls += 1;
            return {
              runtimeError: 'unexpected duplicate load',
            };
          },
        }}
        state={{
          agentAIConfig: {
            revision: 22,
            updatedAt: null,
            updatedByAppId: 'runtime',
            intents: {
              'text.generate': { route: 'local', modelId: 'local/provided-text' },
              'text.embed': { route: 'local', modelId: 'local/provided-embed' },
            },
          },
          readiness: {
            configRevision: 22,
            capabilities: [
              { capability: 'text.generate', state: 'ready', reasonCode: '', probedAt: null },
              { capability: 'text.embed', state: 'ready', reasonCode: '', probedAt: null },
            ],
          },
        }}
      />,
    );

    await flush();

    expect(loadCalls).toBe(0);
    expect(node.textContent).toContain('Revision 22');
    expect(node.textContent).toContain('Embedding');
    expect(node.textContent).not.toContain('unexpected duplicate load');
  });

  it('does not reload appearance when the app already supplies appearance state', async () => {
    let loadCalls = 0;
    const state = buildAgentCenterState({
      appearance: {
        status: 'ready',
        avatarAssetRef: 'avatar:provided',
        avatarAssetValid: true,
        defaultVoiceReference: null,
        disabledReason: null,
      },
    });
    const node = render(
      <AgentCenter
        defaultSection="appearance"
        appearanceAdapter={{
          async load() {
            loadCalls += 1;
            return {
              status: 'invalid',
              disabledReason: 'unexpected duplicate appearance load',
            };
          },
        }}
        state={state}
      />,
    );

    await flush();

    expect(loadCalls).toBe(0);
    expect(node.textContent).toContain('avatar:provided');
    expect(node.textContent).not.toContain('unexpected duplicate appearance load');
  });

  it('commits behavior and appearance edits through typed adapters', async () => {
    const autonomyCalls: unknown[] = [];
    const appearanceCalls: unknown[] = [];
    const state = buildAgentCenterState({
      agentAIConfig: {
        revision: 9,
        updatedAt: null,
        updatedByAppId: 'runtime',
        intents: {
          'text.generate': { route: 'local', modelId: 'local/default' },
          'text.embed': { route: 'local', modelId: 'local/default-embedding' },
        },
      },
      readiness: {
        configRevision: 9,
        capabilities: [
          { capability: 'text.generate', state: 'ready', reasonCode: '', probedAt: null },
          { capability: 'text.embed', state: 'ready', reasonCode: '', probedAt: null },
        ],
      },
      autonomyMutationAvailable: true,
      inspect: {
        lifecycleStatus: 'active',
        executionState: 'idle',
        statusText: 'ready',
        activeWorldId: null,
        activeUserId: null,
        updatedAt: null,
        currentEmotion: 'calm',
        proactiveInterruptibility: null,
        presentationProfile: null,
        autonomyMode: 'medium',
        autonomyEnabled: true,
        autonomyBudgetExhausted: false,
        autonomyUsedTokensInWindow: 0,
        autonomyDailyTokenBudget: 1200,
        autonomyMaxTokensPerHook: 80,
        autonomyWindowStartedAt: null,
        autonomySuspendedUntil: null,
        pendingHooksCount: 0,
        nextScheduledFor: null,
        pendingHooks: [],
        recentTerminalHooks: [],
        recentCanonicalMemories: [],
      } as never,
      appearance: {
        status: 'ready',
        backendKind: 'live2d',
        avatarAssetRef: 'avatar:old',
        backgroundRef: 'background:old',
        defaultVoiceReference: 'voice:runtime',
        avatarAutoplay: false,
        disabledReason: null,
        avatarAssetValid: true,
        backgroundValid: true,
        validationStatus: 'valid',
        backendCapabilityProfileRef: 'avatar-profile:live2d',
        live2dAdapterManifestSource: 'external_sidecar_manifest',
      },
    });

    const node = render(
      <AgentCenter
        appearanceAdapter={{
          async load() {
            return state.appearance;
          },
          async admitAsset(input) {
            appearanceCalls.push(input);
            return { ...state.appearance, avatarAssetRef: input.localAssetRef };
          },
          async importAvatarAsset(kind) {
            appearanceCalls.push({ importAvatarAsset: kind });
            return { ...state.appearance, avatarAssetRef: `avatar:${kind}` };
          },
          async importBackground() {
            appearanceCalls.push({ importBackground: true });
            return { ...state.appearance, backgroundRef: 'background:new' };
          },
          async setAvatarAutoplay(enabled) {
            appearanceCalls.push({ autoplay: enabled });
            return { ...state.appearance, avatarAutoplay: enabled };
          },
        }}
        defaultSection="behavior"
        runtimeAdapter={{
          agentAIConfig: {} as never,
          async loadSnapshot() {
            return {};
          },
          async setAutonomyConfig(input) {
            autonomyCalls.push(input);
            return { enabled: false, mode: 'low' } as never;
          },
        }}
        state={state}
      />,
    );

    const enabled = node.querySelector<HTMLInputElement>('[aria-label="Autonomy enabled"]');
    if (!enabled) throw new Error('missing autonomy enabled input');
    act(() => {
      enabled.click();
    });
    click(node.querySelector('[data-agent-center-autonomy-apply]'));
    expect(autonomyCalls).toEqual([{
      enabled: false,
      mode: 'medium',
      dailyTokenBudget: 1200,
      maxTokensPerHook: 80,
    }]);

    click(node.querySelector('[data-testid="chat-agent-center-section:appearance"]'));
    expect(node.textContent).toContain('Import Live2D folder');
    expect(node.textContent).toContain('Import VRM file');
    expect(node.textContent).toContain('Import background image');
    expect(node.textContent).not.toContain('Avatar local asset ref');
    await clickAsync(Array.from(node.querySelectorAll('button')).find((button) => button.textContent?.includes('Import Live2D folder')) || null);
    await clickAsync(Array.from(node.querySelectorAll('button')).find((button) => button.textContent?.includes('Import background image')) || null);
    click(node.querySelector('[data-agent-center-avatar-autoplay]'));
    expect(appearanceCalls).toEqual([
      { importAvatarAsset: 'live2d' },
      { importBackground: true },
      { autoplay: true },
    ]);
  });
});
