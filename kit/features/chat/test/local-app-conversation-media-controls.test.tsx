import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NimiLocalAppConversationClient } from '@nimiplatform/kit/core/sdk-contract';
import { LocalAppConversationMediaStopButton } from '../src/components/local-app-conversation-media-stop-button.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement;
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
async function render(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root?.render(node); await flush(); });
}
async function click(label: string) {
  await act(async () => {
    const button = Array.from(container.querySelectorAll('button'))
      .find((item) => (item.getAttribute('aria-label') || item.textContent) === label);
    expect(button).toBeTruthy();
    button!.click();
    await flush();
  });
}
afterEach(async () => {
  await act(async () => { root?.unmount(); await flush(); });
  root = null;
  container?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LocalApp Conversation media controls', () => {
  it('stops the named older media turn and waits for owner state to remove the control', async () => {
    const interruptTurn = vi.fn(async () => ({}));
    const client = { interruptTurn } as unknown as NimiLocalAppConversationClient;
    await render(<LocalAppConversationMediaStopButton agentHandle="agent" conversationAnchorId="anchor"
      turnId="old-media-turn" conversation={() => client} label="Stop media" errorLabel="Stop not confirmed" />);
    await click('Stop media');
    expect(interruptTurn).toHaveBeenCalledWith({ agentHandle: 'agent', conversationAnchorId: 'anchor', expectedTurnId: 'old-media-turn' });
    expect(container.textContent).toBe('Stop media');
    expect(container.querySelector('button')?.disabled).toBe(false);
  });

  it('keeps an explicit retry when stopping media cannot be confirmed', async () => {
    const error = new Error('transport lost');
    const onError = vi.fn();
    const interruptTurn = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce({});
    const client = { interruptTurn } as unknown as NimiLocalAppConversationClient;
    await render(<LocalAppConversationMediaStopButton agentHandle="agent" conversationAnchorId="anchor"
      turnId="old-media-turn" conversation={() => client} label="Stop media" errorLabel="Stop not confirmed" onError={onError} />);
    await click('Stop media');
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Stop not confirmed');
    expect(onError).toHaveBeenCalledWith(error);
    await click('Stop media');
    expect(interruptTurn).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
