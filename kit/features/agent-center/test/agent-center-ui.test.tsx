import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { AgentCenter } from '../src/components/AgentCenter.js';
import { buildAgentCenterState } from '../src/state.js';
import type { AgentCenterStateInput } from '../src/types.js';

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

function readyPersonaSourceStatus(): NonNullable<AgentCenterStateInput['sourceContextStatus']> {
  return {
    schemaVersion: 'v2',
    ready: true,
    state: 'ready',
    reasonCode: 'none',
    localAgentRef: 'local-agent:owner:agent',
    sourceRef: {
      kind: 'personaCharacter',
      id: 'persona-safe',
      worldId: 'world-safe',
      ownerAccountId: 'owner-safe',
      sourceHash: 'a'.repeat(64),
    },
    sourceSchemaVersion: 'realm.persona-character-core/v1',
    snapshotSchemaVersion: 'v2',
    snapshotHash: 'b'.repeat(64),
    capturedAt: '2026-07-11T01:02:03.000Z',
    worldContentHash: 'c'.repeat(64),
    materializationContextHash: 'd'.repeat(64),
    coverageSections: [
      { section: 'identity', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
      { section: 'presentation', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
      { section: 'interaction_profile', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
      { section: 'assets', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
      { section: 'authoring', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
      { section: 'persona_style', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
      { section: 'content_profile', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
      { section: 'world_core', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
      { section: 'dependency_closure', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
    ],
  };
}

describe('AgentCenter UI', () => {
  it('renders bounded source/context status in Overview and Advanced without raw or machine reason copy', () => {
    const state = buildAgentCenterState({
      sourceContextStatus: readyPersonaSourceStatus(),
      turnContextSummary: null,
    });
    const node = render(<AgentCenter state={state} />);

    expect(node.querySelector('[data-agent-center-source-context-status="unknown"]')).not.toBeNull();
    expect(node.textContent).toContain('Source and conversation context');
    expect(node.textContent).toContain('Source or conversation context has not been projected yet.');
    expect(node.textContent).toContain('Not projected');

    const advanced = node.querySelector<HTMLButtonElement>('[data-testid="chat-agent-center-section:advanced"]');
    click(advanced);
    expect(node.textContent).toContain('Read-only diagnostics provided by Runtime.');
    expect(node.textContent).toContain('Persona character');
    expect(node.textContent).toContain('world-safe / persona-safe');
    expect(node.textContent).toContain('a'.repeat(64));
    expect(node.textContent).toContain('b'.repeat(64));

    const dom = node.innerHTML;
    expect(dom).not.toMatch(/reasonCode|actionHint|context_not_composed|source_snapshot_invalid|RAW_WORLD_CANARY|RAW_PROMPT_CANARY|runtime-projection/u);

    const behavior = node.querySelector<HTMLButtonElement>('[data-testid="chat-agent-center-section:behavior"]');
    click(behavior);
    expect(node.querySelector('[data-agent-center-proactive-toggle="true"]')).not.toBeNull();
    expect(node.textContent).not.toContain('Source content hash');
    expect(node.textContent).not.toContain('Context lanes');
    expect(node.querySelector('[data-agent-center-context-editor]')).toBeNull();
    expect(node.querySelector('[data-agent-center-personality-editor]')).toBeNull();
  });

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

  it('uses the migrated Desktop Agent Center navigation without a duplicate active section heading', () => {
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
    expect(overview?.className).toContain('min-w-[36px]');
    expect(model?.className).toContain('min-w-[36px]');
    expect(overview?.className).toContain('bg-emerald-500/15');
    expect(overview?.textContent).toContain('Overview');
    const overviewBadge = overview?.querySelector<HTMLElement>('span[aria-hidden="true"]');
    expect(overviewBadge?.textContent).toBe('4');
    expect(overviewBadge?.className).toContain('ml-1.5');
    expect(overviewBadge?.className).not.toContain('absolute');
    expect(model?.querySelector('span')?.className).toContain('max-w-0');
    expect(node.querySelector('[data-agent-center-active-section-label]')).toBeNull();
    const hero = node.querySelector<HTMLElement>('[data-agent-center-progress-hero="desktop-migrated"]');
    expect(hero).not.toBeNull();
    expect(hero?.className).toContain('bg-gradient-to-br');
    expect(hero?.className).toContain('p-5');
    expect(node.textContent).not.toContain('Runtime Agent AI Config can serve local agent turns');
    expect(node.textContent).not.toContain('Current state');

    const appearance = node.querySelector<HTMLButtonElement>('[data-testid="chat-agent-center-section:appearance"]');
    click(appearance);
    const collapsedOverviewBadge = overview?.querySelector<HTMLElement>('span[aria-hidden="true"]');
    expect(overview?.className).toContain('w-[48px]');
    expect(collapsedOverviewBadge?.className).not.toContain('absolute');
    expect(collapsedOverviewBadge?.className).not.toContain('-right');
    expect(collapsedOverviewBadge?.className).not.toContain('-top');
    expect(node.querySelector('[data-agent-center-active-section-label]')).toBeNull();

    click(model);
    expect(model?.className).toContain('bg-emerald-500/15');
    expect(model?.querySelector('span')?.className).toContain('max-w-[160px]');
    expect(overview?.querySelector('span')?.className).toContain('max-w-0');
    expect(node.querySelector('[data-agent-center-active-section-label]')).toBeNull();
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
          'audio.transcribe': {
            route: 'cloud',
            modelId: 'whisper-1',
            connectorId: 'connector-stt',
            targetRef: {
              kind: 'cloud-connector',
              version: 'v2',
              connectorId: 'connector-stt',
              remoteModelCatalogId: 'catalog-stt',
              providerModelId: 'whisper-1',
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
    expect(node.textContent).not.toContain('Revision 9');
    expect(node.querySelector('[data-agent-center-model-surface="runtime-model-config-hub"]')).not.toBeNull();
    expect(node.textContent).toContain('Embedding');
    expect(node.textContent).not.toContain('Model ID');

    click(buttons[4]);
    expect(node.textContent).toContain('用户希望 Agent Center 使用运行时投影');
    expect(node.textContent).not.toContain('正在处理一个非常长的中文状态文本');

    click(buttons[1]);
    expect(node.textContent).toContain('asset://avatar/runtime-admitted');

    click(buttons[5]);
    expect(node.textContent).toContain('Config revision');
    expect(node.textContent).not.toContain(['model', 'Content'].join(''));
    expect(node.textContent).not.toContain(['Capability', 'Studio'].join(''));
  });

  it('lets Zhiyu inject a Chinese copy namespace across Agent Center sections', () => {
    const state = buildAgentCenterState({
      readiness: {
        configRevision: 3,
        capabilities: [
          { capability: 'text.generate', state: 'not_configured', reasonCode: 'model_missing', probedAt: null },
          { capability: 'text.embed', state: 'ready', reasonCode: '', probedAt: null },
        ],
      },
      appearance: {
        status: 'not_configured',
        avatarAssetRef: null,
        disabledReason: null,
      },
    });

    const node = render(
      <AgentCenter
        copy={{
          sectionLabels: {
            overview: '总览',
            appearance: '外观',
            behavior: '主动',
            model: '模型',
            cognition: '认知',
            advanced: '高级',
          },
          overview: {
            attentionTitle: '配置需要处理',
            checklistTitle: '配置检查',
            appearancePendingDescription: '形象与外观尚未完成。',
            modelPendingDescription: '文本和记忆路线需要运行时配置。',
            needsSetupPill: '待配置',
            readyPill: '就绪',
            offPill: '关闭',
            projectedPill: '已投影',
            readOnlyPill: '只读',
          },
          progress: {
            configLabel: '配置',
          },
          advanced: {
            title: '高级',
            descriptionRuntimeProjection: '运行时投影',
            configRevisionLabel: '配置版本',
            runtimeTurnLabel: '运行时回合',
            runtimeStreamLabel: '运行时流',
            runtimeErrorLabel: '运行时错误',
            unavailableValue: '暂不可用',
            notProjectedValue: '尚未投影',
            noneValue: '无',
          },
          model: {
            sectionTitle: '模型',
            superSectionLabels: {
              conversation: '对话',
              voice: '语音',
              media: '媒体',
            },
            setupRequiredLabel: '需要配置',
            runtimeModelPickerUnavailableLabel: '运行时模型选择暂不可用',
            notConfiguredLabel: '未配置',
            detailActiveModelHint: '点击更换模型',
            modelConfig: {
              'ModelConfig.hub.title': '智能模型',
              'ModelConfig.section.chat.title': '聊天',
              'ModelConfig.section.embed.title': '记忆',
              'ModelConfig.section.tts.title': '语音',
              'ModelConfig.section.voice.title': '声音工作流',
              'ModelConfig.section.image.title': '图像',
            },
          },
        }}
        state={state}
      />,
    );

    const buttons = Array.from(node.querySelectorAll('nav button'));
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      '总览',
      '外观',
      '主动',
      '模型',
      '认知',
      '高级',
    ]);
    expect(node.textContent).toContain('配置需要处理');
    expect(node.textContent).toContain('配置检查');
    expect(node.textContent).toContain('待配置');
    expect(node.textContent).not.toContain('Overview');
    expect(node.textContent).not.toContain('Configuration checklist');
    expect(node.textContent).not.toContain('Needs setup');

    click(buttons[3]);
    expect(node.textContent).toContain('模型');
    expect(node.textContent).toContain('对话');
    expect(node.textContent).toContain('语音');
    expect(node.textContent).toContain('媒体');
    expect(node.textContent).not.toContain('Conversation');

    click(buttons[5]);
    expect(node.textContent).toContain('配置版本');
    expect(node.textContent).toContain('运行时回合');
    expect(node.textContent).not.toContain('Config revision');
    expect(node.textContent).not.toContain('Runtime turn');
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
          'audio.transcribe': {
            route: 'cloud',
            modelId: 'whisper-1',
            connectorId: 'connector-stt',
            targetRef: {
              kind: 'cloud-connector',
              version: 'v2',
              connectorId: 'connector-stt',
              remoteModelCatalogId: 'catalog-stt',
              providerModelId: 'whisper-1',
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
              listLocalModels: async () => [
                {
                  localModelId: 'runtime-text-v2',
                  goRuntimeLocalModelId: 'runtime-text-v2',
                  profileBindingId: 'local-runtime:text-v2',
                  modelId: 'local/runtime-text-v2',
                  label: 'runtime-text-v2',
                  engine: 'llama',
                  status: 'active',
                  capabilities: ['text.generate'],
                },
                {
                  localModelId: 'runtime-text-v3',
                  goRuntimeLocalModelId: 'runtime-text-v3',
                  profileBindingId: 'local-runtime:text-v3',
                  modelId: 'local/runtime-text-v3',
                  label: 'runtime-text-v3',
                  engine: 'llama',
                  status: 'active',
                  capabilities: ['text.generate'],
                },
              ],
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
              revision: 9 + calls.length,
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
        'audio.transcribe': {
          route: 'cloud',
          modelId: 'whisper-1',
          connectorId: 'connector-stt',
          targetRef: {
            kind: 'cloud-connector',
            version: 'v2',
            connectorId: 'connector-stt',
            remoteModelCatalogId: 'catalog-stt',
            providerModelId: 'whisper-1',
            provider: 'openai',
          },
        },
      },
    }]);
    expect(node.textContent).toContain('Saved Runtime Agent AI Config revision 10.');
    expect(node.textContent).toContain('runtime-text-v2');

    await clickAsync(node.querySelector('[data-nimi-model-config-capability="text.generate"] button'));
    const secondOption = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('runtime-text-v3'));
    await clickAsync(secondOption || null);

    expect(calls[1]).toMatchObject({
      expectedRevision: 10,
      intents: {
        'text.generate': {
          route: 'local',
          modelId: 'local-runtime:text-v3',
          targetRef: {
            kind: 'local-runtime',
            version: 'v2',
            profileBindingId: 'local-runtime:text-v3',
          },
        },
      },
    });
    expect(node.textContent).toContain('Saved Runtime Agent AI Config revision 11.');
    expect(node.textContent).toContain('runtime-text-v3');
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
    expect(node.textContent).not.toContain('Revision 15');
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
    expect(node.textContent).not.toContain('Revision 22');
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

  it('honors explicit autonomy mutation disablement even when a runtime adapter can write', async () => {
    const autonomyCalls: unknown[] = [];
    const node = render(
      <AgentCenter
        defaultSection="behavior"
        runtimeAdapter={{
          agentAIConfig: {} as never,
          async loadSnapshot() {
            return {};
          },
          async setAutonomyConfig(input) {
            autonomyCalls.push(input);
            return { enabled: true, mode: input.mode } as never;
          },
        }}
        state={{
          autonomyMutationAvailable: false,
          autonomyDisabledReason: '会话没有打开成功，请重新选择伙伴或重启织羽后再试。',
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
            autonomyMode: 'off',
            autonomyEnabled: false,
            autonomyBudgetExhausted: false,
            autonomyUsedTokensInWindow: 0,
            autonomyDailyTokenBudget: 0,
            autonomyMaxTokensPerHook: 0,
            autonomyWindowStartedAt: null,
            autonomySuspendedUntil: null,
            pendingHooksCount: 0,
            nextScheduledFor: null,
            pendingHooks: [],
            recentTerminalHooks: [],
            recentCanonicalMemories: [],
          } as never,
        }}
      />,
    );

    await flush();

    const toggle = node.querySelector<HTMLInputElement>('[data-agent-center-proactive-toggle="true"]');
    const highMode = node.querySelector<HTMLButtonElement>('[data-agent-center-behavior-mode="high"]');
    expect(node.textContent).toContain('会话没有打开成功，请重新选择伙伴或重启织羽后再试。');
    expect(toggle?.disabled).toBe(true);
    expect(highMode?.disabled).toBe(true);
    await clickAsync(highMode);
    expect(autonomyCalls).toEqual([]);
  });

  it('enables proactive companion when selecting a non-quiet behavior level from off', async () => {
    const autonomyCalls: unknown[] = [];
    const node = render(
      <AgentCenter
        defaultSection="behavior"
        runtimeAdapter={{
          agentAIConfig: {} as never,
          async loadSnapshot() {
            return {};
          },
          async setAutonomyConfig(input) {
            autonomyCalls.push(input);
            return {
              enabled: input.enabled,
              mode: input.mode,
              dailyTokenBudget: input.dailyTokenBudget,
              maxTokensPerHook: input.maxTokensPerHook,
            } as never;
          },
        }}
        state={{
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
            autonomyMode: 'off',
            autonomyEnabled: false,
            autonomyBudgetExhausted: false,
            autonomyUsedTokensInWindow: 0,
            autonomyDailyTokenBudget: 0,
            autonomyMaxTokensPerHook: 0,
            autonomyWindowStartedAt: null,
            autonomySuspendedUntil: null,
            pendingHooksCount: 0,
            nextScheduledFor: null,
            pendingHooks: [],
            recentTerminalHooks: [],
            recentCanonicalMemories: [],
          } as never,
        }}
      />,
    );

    await flush();
    await clickAsync(node.querySelector('[data-agent-center-behavior-mode="high"]'));

    expect(autonomyCalls).toEqual([{
      enabled: true,
      mode: 'high',
      dailyTokenBudget: 0,
      maxTokensPerHook: 0,
    }]);
    expect(node.querySelector('[data-agent-center-behavior-mode="high"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(node.querySelector<HTMLInputElement>('[data-agent-center-proactive-toggle="true"]')?.checked).toBe(true);
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

    const enabled = node.querySelector<HTMLInputElement>('[data-agent-center-proactive-toggle="true"]');
    if (!enabled) throw new Error('missing autonomy enabled input');
    act(() => {
      enabled.click();
    });
    await flush();
    expect(autonomyCalls).toEqual([{
      enabled: false,
      mode: 'off',
      dailyTokenBudget: 1200,
      maxTokensPerHook: 80,
    }]);

    click(node.querySelector('[data-testid="chat-agent-center-section:appearance"]'));
    expect(node.textContent).toContain('Partner avatar');
    expect(node.textContent).toContain('Change avatar');
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

  it('enables behavior controls after loading Runtime inspect through the adapter', async () => {
    const autonomyCalls: unknown[] = [];
    const node = render(
      <AgentCenter
        defaultSection="behavior"
        runtimeAdapter={{
          agentAIConfig: {} as never,
          async loadSnapshot() {
            return {
              agentAIConfig: {
                revision: 11,
                updatedAt: null,
                updatedByAppId: 'runtime',
                intents: {
                  'text.generate': { route: 'local', modelId: 'local/default' },
                  'text.embed': { route: 'local', modelId: 'local/default-embedding' },
                },
              },
              readiness: {
                configRevision: 11,
                capabilities: [
                  { capability: 'text.generate', state: 'ready', reasonCode: '', probedAt: null },
                  { capability: 'text.embed', state: 'ready', reasonCode: '', probedAt: null },
                ],
              },
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
                autonomyUsedTokensInWindow: 320,
                autonomyDailyTokenBudget: 2000,
                autonomyMaxTokensPerHook: 500,
                autonomyWindowStartedAt: null,
                autonomySuspendedUntil: null,
                pendingHooksCount: 0,
                nextScheduledFor: null,
                pendingHooks: [],
                recentTerminalHooks: [],
                recentCanonicalMemories: [],
              } as never,
            };
          },
          async setAutonomyConfig(input) {
            autonomyCalls.push(input);
            return {
              enabled: true,
              mode: input.mode,
              dailyTokenBudget: input.dailyTokenBudget,
              maxTokensPerHook: input.maxTokensPerHook,
              budgetExhausted: false,
              usedTokensInWindow: 320,
              windowStartedAt: null,
              suspendedUntil: null,
            } as never;
          },
        }}
        state={{}}
      />,
    );

    await flush();

    const enabled = node.querySelector<HTMLInputElement>('[data-agent-center-proactive-toggle="true"]');
    expect(enabled?.disabled).toBe(false);
    await clickAsync(node.querySelector('[data-agent-center-behavior-mode="high"]'));
    expect(autonomyCalls.at(-1)).toMatchObject({
      enabled: true,
      mode: 'high',
      dailyTokenBudget: 2000,
      maxTokensPerHook: 500,
    });
  });

  it('matches the behavior title scale to appearance and omits the eyebrow label', () => {
    const state = buildAgentCenterState({
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
        autonomyDailyTokenBudget: 0,
        autonomyMaxTokensPerHook: 0,
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
        avatarAssetRef: 'avatar:provided',
        avatarAssetValid: true,
        backendCapabilityProfileRef: 'avatar-profile:live2d',
        live2dAdapterManifestSource: 'embedded_creator_manifest',
        disabledReason: null,
      },
    });
    const node = render(
      <AgentCenter
        behaviorCopy={{
          eyebrow: 'REMOVE_ME_EYEBROW',
          title: 'Behavior section title',
          description: 'Behavior section description',
        }}
        defaultSection="behavior"
        state={state}
      />,
    );

    const behaviorTitle = node.querySelector<HTMLElement>('#agent-center-behavior-title');
    expect(behaviorTitle?.textContent).toBe('Behavior section title');
    expect(node.textContent).not.toContain('REMOVE_ME_EYEBROW');

    click(node.querySelector('[data-testid="chat-agent-center-section:appearance"]'));
    const appearanceTitle = node.querySelector<HTMLElement>('#agent-center-appearance-title');
    expect(appearanceTitle?.textContent).toBe('Appearance');
    expect(behaviorTitle?.className).toBe(appearanceTitle?.className);
  });

  it('renders structured Runtime projection load errors from Electron bridges', async () => {
    const node = render(
      <AgentCenter
        defaultSection="behavior"
        runtimeAdapter={{
          agentAIConfig: {} as never,
          async loadSnapshot() {
            throw {
              message: 'Runtime method denied',
              reasonCode: 'SDK_RUNTIME_SCOPE_DENIED',
              actionHint: 'request_runtime_agent_read',
            };
          },
          async setAutonomyConfig() {
            return { enabled: false, mode: 'off' } as never;
          },
        }}
        state={{}}
      />,
    );

    await flush();

    expect(node.textContent).toContain('Runtime method denied');
    expect(node.textContent).not.toContain('SDK_RUNTIME_SCOPE_DENIED');
    expect(node.textContent).not.toContain('request_runtime_agent_read');
    const toggle = node.querySelector<HTMLInputElement>('[data-agent-center-proactive-toggle="true"]');
    expect(toggle?.disabled).toBe(true);
  });

  it('renders the Chinese proactive companion behavior layout with real mode and budget controls', async () => {
    const autonomyCalls: unknown[] = [];
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
        autonomyUsedTokensInWindow: 320,
        autonomyDailyTokenBudget: 2000,
        autonomyMaxTokensPerHook: 500,
        autonomyWindowStartedAt: null,
        autonomySuspendedUntil: null,
        pendingHooksCount: 0,
        nextScheduledFor: null,
        pendingHooks: [],
        recentTerminalHooks: [],
        recentCanonicalMemories: [],
      } as never,
    });

    const node = render(
      <AgentCenter
        behaviorCopy={{
          eyebrow: '主动陪伴',
          title: '让伙伴在合适的时候主动出现',
          description: '开启后，他可以在日常节奏、久未联系或重要变化时主动和你互动。',
          enableTitle: '允许主动陪伴',
          enableDescription: '关闭后，他只会在你主动发起对话时回应。',
          enabledStatus: '已开启',
          disabledStatus: '已关闭',
          modeTitle: '主动程度',
          quietTitle: '安静',
          quietDescription: '只在你开口时回应',
          occasionalTitle: '偶尔',
          occasionalDescription: '久未联系时提醒',
          dailyTitle: '日常',
          dailyDescription: '自然问候与陪伴',
          activeTitle: '活跃',
          activeDescription: '更频繁参与互动',
          budgetTitle: '主动用量保护',
          budgetDescription: '为主动陪伴设置 token 上限，避免在你没有注意时消耗过多。',
          todayUsedLabel: '今日已用',
          dailyLimitLabel: '每日上限',
          singleLimitLabel: '单次上限',
          reachedLimitLabel: '达到上限后',
          reachedLimitAction: '暂停主动陪伴',
          adjustLimitLabel: '调整用量上限',
          applyLimitLabel: '保存用量上限',
          tokensUnit: 'tokens',
          approxPrefix: '约',
        }}
        defaultSection="behavior"
        runtimeAdapter={{
          agentAIConfig: {} as never,
          async loadSnapshot() {
            return {};
          },
          async setAutonomyConfig(input) {
            autonomyCalls.push(input);
            return {
              enabled: input.enabled ?? true,
              mode: input.mode ?? 'medium',
              dailyTokenBudget: Number(input.dailyTokenBudget),
              maxTokensPerHook: Number(input.maxTokensPerHook),
              usedTokensInWindow: 320,
              budgetExhausted: false,
              windowStartedAt: null,
              suspendedUntil: null,
            } as never;
          },
        }}
        state={state}
      />,
    );

    expect(node.querySelector('[data-agent-center-behavior-page="proactive-companion"]')).not.toBeNull();
    expect(node.textContent).toContain('主动陪伴');
    expect(node.textContent).toContain('让伙伴在合适的时候主动出现');
    expect(node.textContent).toContain('320 / 2000 tokens');
    expect(node.textContent).toContain('约 16%');
    expect(node.textContent).toContain('暂停主动陪伴');

    const selectedMode = node.querySelector<HTMLButtonElement>('[data-agent-center-behavior-mode="medium"]');
    expect(selectedMode?.textContent).toContain('日常');
    expect(selectedMode?.getAttribute('aria-pressed')).toBe('true');
    const progress = node.querySelector<HTMLElement>('[data-agent-center-budget-progress="true"]');
    expect(progress?.getAttribute('style')).toContain('width: 16%');

    await clickAsync(node.querySelector('[data-agent-center-behavior-mode="high"]'));
    expect(autonomyCalls.at(-1)).toMatchObject({
      enabled: true,
      mode: 'high',
      dailyTokenBudget: 2000,
      maxTokensPerHook: 500,
    });

    click(node.querySelector('[data-agent-center-budget-adjust="true"]'));
    const dailyInput = node.querySelector<HTMLInputElement>('input[aria-label="每日上限"]');
    const hookInput = node.querySelector<HTMLInputElement>('input[aria-label="单次上限"]');
    expect(dailyInput?.value).toBe('2000');
    expect(hookInput?.value).toBe('500');
  });
});
