import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NimiLocalAppConversationClient, NimiLocalAppConversationState } from '@nimiplatform/kit/core/sdk-contract';
import { LocalAppConversationFollowUpControl } from '../src/components/local-app-conversation-follow-up-control.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement;
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const idle: NimiLocalAppConversationState = {
  textTurnId: null, freeContactEnabled: false, maxFollowUpTurns: 1, pendingFollowUp: null,
};
const pending: NimiLocalAppConversationState = {
  ...idle, freeContactEnabled: true,
  pendingFollowUp: { taskId: 'task-a', revision: '3', sourceTurnId: 'turn-a', scheduledFor: { seconds: '1793001600', nanos: 0 } },
};
async function render(state: NimiLocalAppConversationState | null, cancelFollowUp = vi.fn(), refresh = vi.fn(), agentHandle = 'agent-a') {
  if (!root) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  }
  await act(async () => {
    root!.render(<LocalAppConversationFollowUpControl agentHandle={agentHandle} conversationAnchorId="anchor"
      state={state} translate={key => key} refresh={refresh}
      conversation={() => ({ cancelFollowUp }) as unknown as NimiLocalAppConversationClient} />);
    await flush();
  });
}
async function click(key: string) {
  await act(async () => {
    const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent === key);
    expect(button).toBeTruthy();
    button!.click();
    await flush();
  });
}
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null;
  container?.remove();
  vi.restoreAllMocks();
});

describe('contextual Conversation follow-up control', () => {
  it('occupies no space when no follow-up is pending, regardless of contact permission', async () => {
    await render(idle);
    expect(container.childElementCount).toBe(0);
    await render({ ...idle, freeContactEnabled: true });
    expect(container.childElementCount).toBe(0);
  });

  it('keeps unknown state distinct from idle and offers a read-only refresh', async () => {
    const cancel = vi.fn(), refresh = vi.fn();
    await render(null, cancel, refresh);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Chat.followUpUnavailable');
    await click('Chat.followUpRefresh');
    expect(refresh).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('cancels exactly the observed plan and waits for owner state to remove it', async () => {
    let finish!: () => void;
    const cancel = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const refresh = vi.fn();
    await render(pending, cancel, refresh);
    await click('Chat.followUpCancel');
    expect(container.querySelector('button')?.disabled).toBe(true);
    expect(cancel).toHaveBeenCalledWith({ agentHandle: 'agent-a', conversationAnchorId: 'anchor', taskId: 'task-a', expectedRevision: '3' });
    await act(async () => { finish(); await flush(); });
    expect(refresh).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Chat.followUpPending');
    await render(idle, cancel, refresh);
    expect(container.childElementCount).toBe(0);
  });

  it('keeps a refused cancellation visible and clears the warning only when owner state changes', async () => {
    const cancel = vi.fn().mockRejectedValue(new Error('revision conflict'));
    const refresh = vi.fn();
    await render(pending, cancel, refresh);
    await click('Chat.followUpCancel');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Chat.followUpChanged');
    expect(container.textContent).toContain('Chat.followUpPending');
    await click('Chat.followUpRefresh');
    expect(refresh).toHaveBeenCalledTimes(2);
    await render(idle, cancel, refresh);
    expect(container.childElementCount).toBe(0);
  });

  it('ignores a late cancellation result after changing partners', async () => {
    let reject!: (error: Error) => void;
    const cancel = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
    const refresh = vi.fn();
    await render(pending, cancel, refresh);
    await click('Chat.followUpCancel');
    await render(idle, cancel, refresh, 'agent-b');
    await act(async () => { reject(new Error('late failure')); await flush(); });
    expect(container.childElementCount).toBe(0);
    expect(refresh).not.toHaveBeenCalled();
  });
});
