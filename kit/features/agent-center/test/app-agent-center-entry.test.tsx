import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  NimiLocalAppAgentConfigureClient,
  NimiLocalAppAgentHandle,
  NimiLocalAppClient,
} from '@nimiplatform/kit/core/sdk-contract';
import { AppAgentCenterEntry } from '../src/components/AppAgentCenterEntry.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HANDLE_A = `agent_ref_${'A'.repeat(43)}` as NimiLocalAppAgentHandle;
const HANDLE_B = `agent_ref_${'B'.repeat(43)}` as NimiLocalAppAgentHandle;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function ownerUnavailable(): never {
  throw Object.assign(new Error('Owner unavailable'), {
    reasonCode: 'LOCAL_APP_OPERATION_UNAVAILABLE',
    actionHint: 'refresh_local_app_session',
  });
}

function configureClient(managerCalls: unknown[]): NimiLocalAppAgentConfigureClient {
  return {
    sharedAIConfig: {
      get: async () => ownerUnavailable(),
      overwrite: async () => ownerUnavailable(),
      listOptions: async () => ownerUnavailable(),
    },
    autonomy: {
      snapshot: async () => ownerUnavailable(),
      update: async () => ownerUnavailable(),
    },
    presentation: {
      snapshot: async () => ownerUnavailable(),
      commit: async () => ownerUnavailable(),
    },
    memory: {
      inspect: async () => ownerUnavailable(),
      correct: async () => ownerUnavailable(),
      forget: async () => ownerUnavailable(),
      setEnabled: async () => ownerUnavailable(),
      deleteAll: async () => ownerUnavailable(),
    },
    manager: {
      snapshot: async (input) => {
        managerCalls.push(input);
        return ownerUnavailable();
      },
    },
  };
}

function entryClient(input: {
  readonly references: Pick<NimiLocalAppClient, 'agents'>['agents']['listReferences'];
  readonly managerCalls: unknown[];
}): Pick<NimiLocalAppClient, 'agents' | 'agentConfigure'> {
  return {
    agents: { listReferences: input.references },
    agentConfigure: configureClient(input.managerCalls),
  };
}

async function renderEntry(
  props: ComponentProps<typeof AppAgentCenterEntry>,
): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<AppAgentCenterEntry {...props} />);
    await Promise.resolve();
  });
  await flush();
  return container;
}

describe('App Agent Center entry', () => {
  it('uses one formal client and carries an exact supplied Conversation anchor into its single Manager Session', async () => {
    const managerCalls: unknown[] = [];
    const client = entryClient({
      managerCalls,
      references: vi.fn(async () => [{ agentHandle: HANDLE_A, displayName: 'Agent A', avatarUrl: null }]),
    });
    const node = await renderEntry({
      client,
      initialAgentHandle: HANDLE_A,
      conversationAnchorId: 'anchor-1',
      language: 'en',
    });
    expect(node.querySelector('[data-chat-agent-center="true"]')).toBeTruthy();
    expect(managerCalls).toContainEqual({ agentHandle: HANDLE_A, conversationAnchorId: 'anchor-1' });
  });

  it('requires explicit choice for multiple current references and does not associate by display name or order', async () => {
    const managerCalls: unknown[] = [];
    const client = entryClient({
      managerCalls,
      references: vi.fn(async () => [
        { agentHandle: HANDLE_A, displayName: 'Same name', avatarUrl: null },
        { agentHandle: HANDLE_B, displayName: 'Same name', avatarUrl: null },
      ]),
    });
    const node = await renderEntry({ client, conversationAnchorId: 'must-not-reuse', language: 'en' });
    expect(node.querySelector('[data-nimi-app-agent-center-selector="true"]')).toBeTruthy();
    expect(node.querySelector('[data-chat-agent-center="true"]')).toBeNull();
    expect(managerCalls).toEqual([]);

    const target = node.querySelector(`[data-nimi-app-agent-center-agent-handle="${HANDLE_B}"]`) as HTMLButtonElement;
    await act(async () => { target.click(); await Promise.resolve(); });
    await flush();
    expect(node.querySelector('[data-chat-agent-center="true"]')).toBeTruthy();
    expect(managerCalls).toContainEqual({ agentHandle: HANDLE_B });
    expect(JSON.stringify(managerCalls)).not.toContain('must-not-reuse');
  });

  it('keeps list failure retryable with Kit-owned Chinese copy', async () => {
    const managerCalls: unknown[] = [];
    let attempts = 0;
    const listReferences = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('Runtime unavailable');
      return [{ agentHandle: HANDLE_A, displayName: 'Agent A', avatarUrl: null }];
    });
    const node = await renderEntry({
      client: entryClient({ managerCalls, references: listReferences }),
      language: 'zh-CN',
    });
    expect(node.textContent).toContain('Runtime unavailable');
    const retry = Array.from(node.querySelectorAll('button')).find((button) => button.textContent?.includes('重试')) as HTMLButtonElement;
    await act(async () => { retry.click(); await Promise.resolve(); });
    await flush();
    expect(listReferences).toHaveBeenCalledTimes(2);
    expect(node.querySelector('[data-chat-agent-center="true"]')).toBeTruthy();
  });
});
