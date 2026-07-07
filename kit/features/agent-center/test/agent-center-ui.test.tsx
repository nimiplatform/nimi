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

describe('AgentCenter UI', () => {
  it('renders all generic sections and switches tabs without app-specific slots', () => {
    const state = buildAgentCenterState({
      executionConfig: {
        revision: 9,
        updatedAt: null,
        updatedByAppId: 'runtime',
        bindings: {
          'text.generate': { route: 'local', modelId: 'local/default' },
        },
      },
      readiness: {
        configRevision: 9,
        capabilities: [
          { capability: 'text.generate', state: 'ready', reasonCode: '', probedAt: null },
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
          speechModelId: null,
          speechRoutePolicy: null,
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
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Overview',
      'Model',
      'Behavior',
      'Cognition',
      'Appearance',
      'Advanced',
    ]);

    click(buttons[1]);
    expect(node.textContent).toContain('Revision 9');
    expect(node.textContent).toContain('Read-only projection');

    click(buttons[3]);
    expect(node.textContent).toContain('用户希望 Agent Center 使用运行时投影');
    expect(node.textContent).toContain('正在处理一个非常长的中文状态文本');

    click(buttons[4]);
    expect(node.textContent).toContain('asset://avatar/runtime-admitted');

    click(buttons[5]);
    expect(node.textContent).toContain('Config revision');
    expect(node.textContent).not.toContain(['model', 'Content'].join(''));
    expect(node.textContent).not.toContain(['Capability', 'Studio'].join(''));
  });
});
