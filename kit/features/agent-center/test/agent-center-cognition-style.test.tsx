import { act } from 'react';
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

function renderCognition(patch: Parameters<typeof buildAgentCenterState>[0] = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<AgentCenter defaultSection="cognition" state={buildAgentCenterState(patch)} />);
  });
  return container;
}

describe('AgentCenter cognition projection surface', () => {
  it('renders the redesigned cognition content below the existing tabs without removed explanatory blocks', () => {
    const node = renderCognition();

    expect(node.querySelector('[data-agent-center-nav-style="desktop-dynamic-expand"]')).not.toBeNull();
    expect(node.querySelector('[data-agent-center-cognition-surface="read-only-projection"]')).not.toBeNull();
    expect(node.querySelector('[data-agent-center-cognition-current="true"]')).not.toBeNull();
    expect(node.querySelector('[data-agent-center-cognition-memory="true"]')).not.toBeNull();
    expect(node.querySelector('[data-agent-center-cognition-about="true"]')).toBeNull();
    expect(node.textContent).toContain('认知状态');
    expect(node.textContent).toContain('查看这个伙伴当前可展示的状态、情绪与记忆摘要');
    expect(node.textContent).toContain('当前认知状态');
    expect(node.textContent).toContain('当前暂无认知投影');
    expect(node.textContent).not.toContain('Runtime 尚未返回生命周期、情绪与记忆摘要。');
    expect(node.textContent).not.toContain('织羽不会补写、猜测或伪造这些信息。');
    expect(node.textContent).toContain('生命周期');
    expect(node.textContent).toContain('尚未投影');
    expect(node.textContent).toContain('情绪投影');
    expect(node.textContent).toContain('记忆状态');
    expect(node.textContent).toContain('暂不可用');
    expect(node.textContent).toContain('最近记忆');
    expect(node.textContent).not.toContain('这里仅展示 Runtime 投影出来的 canonical memory 摘要。');
    expect(node.textContent).toContain('还没有可展示的记忆摘要');
    expect(node.textContent).not.toContain('当 Runtime 投影出近期记忆后，这里会显示记忆摘要、记忆类型和展示原因。');
    expect(node.textContent).not.toContain('不会编辑记忆');
    expect(node.textContent).not.toContain('不会伪造记忆');
    expect(node.textContent).not.toContain('不在本地保存记忆真相');
    expect(node.querySelector('[data-agent-center-cognition-readonly-chip]')).toBeNull();
    expect(node.textContent).not.toContain('关于认知投影');
    expect(node.textContent).not.toContain('这里不能写入、编辑、删除或伪造记忆');
    expect(node.textContent).not.toContain('当前运行状态');
  });

  it('renders Runtime canonical memory summaries without inventing local memory controls', () => {
    const node = renderCognition({
      inspect: {
        lifecycleStatus: 'active',
        executionState: 'chat-active',
        statusText: 'Runtime 已投影一段很长的中文状态说明，用于验证窄屏内容可以自然换行而不挤出容器。',
        activeWorldId: null,
        activeUserId: null,
        updatedAt: null,
        currentEmotion: 'focused',
        proactiveInterruptibility: null,
        presentationProfile: null,
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
          memoryId: 'memory-runtime-1',
          canonicalClass: 'dyadic',
          kind: 'semantic',
          summary: '用户希望认知页面只展示 Runtime 投影出来的记忆摘要。',
          updatedAt: null,
          sourceEventId: 'event-runtime-1',
          policyReason: 'runtime-inspect',
          recallScore: 0.91,
        }],
      } as never,
    });

    expect(node.textContent).toContain('active');
    expect(node.textContent).toContain('focused');
    expect(node.textContent).toContain('可展示');
    expect(node.textContent).not.toContain('Runtime 已投影一段很长的中文状态说明');
    expect(node.textContent).toContain('用户希望认知页面只展示 Runtime 投影出来的记忆摘要。');
    expect(node.textContent).toContain('dyadic');
    expect(node.textContent).toContain('runtime-inspect');
    expect(node.querySelector('[data-agent-center-cognition-surface="read-only-projection"] button')).toBeNull();
  });
});
