import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NimiLocalAppClient } from '@nimiplatform/kit/core/sdk-contract';

import {
  AgentRealtimeEntry,
  createBrowserAgentRealtimeHostMediaPort,
  resolveNimiAgentRealtimeCopy,
} from '../src/index';
import type {
  NimiAgentRealtimeClient,
  NimiLocalAppAgentHandle,
  NimiRealtimeControlStatus,
} from '../src/types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HANDLE_A = `agent_ref_${'A'.repeat(43)}` as NimiLocalAppAgentHandle;
const HANDLE_B = `agent_ref_${'B'.repeat(43)}` as NimiLocalAppAgentHandle;
const AUDIO_FORMAT = Object.freeze({
  codec: 'pcm-s16le' as const,
  sampleRateHz: 16_000,
  channelCount: 1 as const,
  frameDurationMs: 20,
  maximumFrameBytes: 640,
});
let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('Agent Realtime public entry', () => {
  it('owns bounded English and Chinese selector copy', () => {
    expect(resolveNimiAgentRealtimeCopy('en-US').selectAgent).toBe('Choose Agent');
    expect(resolveNimiAgentRealtimeCopy('zh-CN').selectAgent).toBe('选择 Agent');
  });

  it('renders the formal-App entry without listing, opening, or capturing during render', () => {
    const client = formalClient(async () => []);
    const host = createBrowserAgentRealtimeHostMediaPort();
    const html = renderToStaticMarkup(
      <AgentRealtimeEntry
        client={client}
        inputAudio={AUDIO_FORMAT}
        turnDetection="server-vad"
        host={host}
        locale="zh-CN"
      />,
    );

    expect(html).toContain('data-nimi-app-agent-realtime-entry="true"');
    expect(html).toContain('实时对话');
    expect(client.agents.listReferences).not.toHaveBeenCalled();
    expect(client.agentRealtime.open).not.toHaveBeenCalled();
  });

  it('lists minimal references and requires explicit handle selection without reusing an unrelated anchor', async () => {
    const client = formalClient(async () => [
      { agentHandle: HANDLE_A, displayName: 'Same name', avatarUrl: null },
      { agentHandle: HANDLE_B, displayName: 'Same name', avatarUrl: null },
    ]);
    const node = await renderEntry({
      client,
      conversationAnchorId: 'must-not-reuse',
      inputAudio: AUDIO_FORMAT,
      turnDetection: 'server-vad',
      host: testHost(),
      locale: 'en',
    });

    expect(client.agents.listReferences).toHaveBeenCalledTimes(1);
    expect(node.querySelector('[data-nimi-app-agent-realtime-selector="true"]')).toBeTruthy();
    expect(node.querySelector('[data-nimi-agent-realtime-entry="true"]')).toBeNull();

    const select = node.querySelector(
      `[data-nimi-app-agent-realtime-agent-handle="${HANDLE_B}"]`,
    ) as HTMLButtonElement;
    await act(async () => { select.click(); await Promise.resolve(); });
    expect(node.querySelector('[data-nimi-agent-realtime-entry="true"]')).toBeTruthy();

    const open = Array.from(node.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Open live conversation'),
    ) as HTMLButtonElement;
    await act(async () => { open.click(); await Promise.resolve(); });
    expect(client.agentRealtime.open).toHaveBeenCalledWith({
      agentHandle: HANDLE_B,
      inputAudio: AUDIO_FORMAT,
      turnDetection: 'server-vad',
    });
  });

  it('validates a supplied current handle through the reference list and preserves its exact anchor', async () => {
    const client = formalClient(async () => [
      { agentHandle: HANDLE_A, displayName: 'Agent A', avatarUrl: null },
    ]);
    const node = await renderEntry({
      client,
      initialAgentHandle: HANDLE_A,
      conversationAnchorId: 'anchor-1',
      inputAudio: AUDIO_FORMAT,
      turnDetection: 'manual',
      host: testHost(),
      locale: 'en',
    });
    expect(node.querySelector('[data-nimi-agent-realtime-entry="true"]')).toBeTruthy();

    const open = Array.from(node.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Open live conversation'),
    ) as HTMLButtonElement;
    await act(async () => { open.click(); await Promise.resolve(); });
    expect(client.agentRealtime.open).toHaveBeenCalledWith({
      agentHandle: HANDLE_A,
      conversationAnchorId: 'anchor-1',
      inputAudio: AUDIO_FORMAT,
      turnDetection: 'manual',
    });
  });
});

async function renderEntry(
  props: ComponentProps<typeof AgentRealtimeEntry>,
): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<AgentRealtimeEntry {...props} />);
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

function formalClient(
  listReferences: Pick<NimiLocalAppClient, 'agents'>['agents']['listReferences'],
): Pick<NimiLocalAppClient, 'agents' | 'agentRealtime'> {
  return {
    agents: { listReferences: vi.fn(listReferences) },
    agentRealtime: realtimeClient(),
  };
}

function realtimeClient(): NimiAgentRealtimeClient {
  return {
    open: vi.fn(async () => ({
      conversationAnchorId: 'anchor-returned',
      realtimeSessionId: 'realtime-session-1',
      channelId: 'channel-1',
      generation: '1',
      negotiatedInputAudio: AUDIO_FORMAT,
      negotiatedOutputAudio: AUDIO_FORMAT,
      control: control(),
    })),
    appendInput: vi.fn(async () => ({
      ack: { ok: true, reasonCode: '', actionHint: '' },
      control: control(),
    })),
    subscribe: vi.fn(async () => ({
      async *[Symbol.asyncIterator]() {
        // No event is needed to prove formal reference binding.
      },
      cancel: async () => undefined,
    })),
    status: vi.fn(async () => control()),
    interruptOutput: vi.fn(async () => ({
      ack: { ok: true, reasonCode: '', actionHint: '' },
      control: control(),
    })),
    close: vi.fn(async () => ({
      ack: { ok: true, reasonCode: '', actionHint: '' },
      control: control('closed'),
    })),
  };
}

function testHost(): ComponentProps<typeof AgentRealtimeEntry>['host'] {
  return {
    microphone: {
      beginCapture: vi.fn(async () => ({ status: 'device-unavailable' as const })),
    },
    playback: {
      writeAudioFrame: vi.fn(async () => undefined),
      finishOutputTrack: vi.fn(async () => undefined),
      interruptOutputTrack: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    },
  };
}

function control(
  lifecycle: NimiRealtimeControlStatus['lifecycle'] = 'ready',
): NimiRealtimeControlStatus {
  return {
    realtimeSessionId: 'realtime-session-1',
    channelId: 'channel-1',
    subscriptionId: 'subscription-1',
    adapterKind: 'local-agent',
    lifecycle,
    generation: '1',
    sequence: '1',
    correlationId: 'correlation-1',
    backpressure: 'normal',
    bufferedItems: 0,
    bufferCapacity: 1,
    terminalReason: lifecycle === 'closed' ? 'cancelled' : '',
    actionHint: '',
    occurredAt: null,
  };
}
