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
  NimiAgentRealtimeEvent,
  NimiRealtimeEventEnvelope,
} from '../src/types';
import { playbackFixture } from './playback-fixture';

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
  it('preserves the live session on equal audio and callback rerenders, but closes on a real format change', async () => {
    const client = formalClient(async () => [
      { agentHandle: HANDLE_A, agentBinding: `agent_binding_${'A'.repeat(43)}`, activityAgentRef: 'agr_A', displayName: 'Agent A', avatarUrl: null },
    ]);
    let end: ((event: IteratorResult<NimiRealtimeEventEnvelope<NimiAgentRealtimeEvent>>) => void) | undefined;
    vi.mocked(client.agentRealtime.subscribe).mockResolvedValue({
      [Symbol.asyncIterator]: () => ({ next: () => new Promise(resolve => { end = resolve; }) }),
      cancel: async () => { end?.({ done: true, value: undefined }); },
    });
    const host = testHost();
    const props: ComponentProps<typeof AgentRealtimeEntry> = {
      client, initialAgentHandle: HANDLE_A, inputAudio: { ...AUDIO_FORMAT },
      turnDetection: 'manual', host, locale: 'en', onStateChange: vi.fn(),
    };
    const node = await renderEntry(props);
    await act(async () => { Array.from(node.querySelectorAll('button')).find(b => b.textContent === 'Open live conversation')!.click(); });
    expect(client.agentRealtime.open).toHaveBeenCalledOnce();
    await act(async () => { root!.render(<AgentRealtimeEntry {...props} inputAudio={{ ...AUDIO_FORMAT }} onStateChange={vi.fn()} />); });
    expect(client.agentRealtime.close).not.toHaveBeenCalled();
    vi.mocked(client.agentRealtime.close).mockRejectedValueOnce(new Error('old scope close failed'));
    await act(async () => { root!.render(<AgentRealtimeEntry {...props} inputAudio={{ ...AUDIO_FORMAT, sampleRateHz: 24_000 }} />); });
    expect(client.agentRealtime.close).toHaveBeenCalledOnce();
    expect(node.textContent).toContain('old scope close failed');
    expect(client.agentRealtime.open).toHaveBeenCalledOnce();
    const retry = Array.from(node.querySelectorAll('button')).find(button => button.textContent === resolveNimiAgentRealtimeCopy('en').retryClose)!;
    await act(async () => { retry.click(); });
    expect(client.agentRealtime.close).toHaveBeenCalledTimes(2);
    await act(async () => { Array.from(node.querySelectorAll('button')).find(button => button.textContent === 'Open live conversation')!.click(); });
    expect(client.agentRealtime.open).toHaveBeenLastCalledWith(expect.objectContaining({ inputAudio: { ...AUDIO_FORMAT, sampleRateHz: 24_000 } }));
  });

  it('shows streamed text without audio and replaces final chunks without duplicating them', async () => {
    const client = formalClient(async () => [
      { agentHandle: HANDLE_A, agentBinding: `agent_binding_${'A'.repeat(43)}`, activityAgentRef: 'agr_A', displayName: 'Agent A', avatarUrl: null },
    ]);
    let next!: (event: IteratorResult<NimiRealtimeEventEnvelope<NimiAgentRealtimeEvent>>) => void;
    vi.mocked(client.agentRealtime.subscribe).mockResolvedValue({
      [Symbol.asyncIterator]: () => ({ next: () => new Promise((resolve) => { next = resolve; }) }),
      cancel: async () => { next?.({ done: true, value: undefined }); },
    });
    const onEvent = vi.fn();
    const node = await renderEntry({ client, initialAgentHandle: HANDLE_A, inputAudio: AUDIO_FORMAT,
      turnDetection: 'manual', host: testHost(), locale: 'en', onEvent });
    await act(async () => { Array.from(node.querySelectorAll('button')).find(b => b.textContent === 'Open live conversation')!.click(); });
    const emit = async (requestId: string, outputTrackId: string, text: string, final = false) => {
      await act(async () => { next({ done: false, value: { control: control(), event: { type: 'text-output', requestId, outputTrackId, text, final } } }); });
    };
    await emit('r1', 'first', '风从');
    expect(node.querySelector('[data-nimi-agent-realtime-reply]')?.textContent).toBe('风从');
    await emit('r1', 'first', '纸边经过。');
    await emit('r1', 'first', '风从纸边经过。', true);
    await emit('r1', 'result', '我决定继续画。', true);
    expect(node.querySelector('[data-nimi-agent-realtime-reply]')?.textContent).toBe('风从纸边经过。\n\n我决定继续画。');
    await emit('r2', 'next', '新的回复。', true);
    expect(node.querySelector('[data-nimi-agent-realtime-reply]')?.textContent).toBe('新的回复。');
    expect(onEvent).toHaveBeenCalledTimes(5);
  });

  it.each(['interrupt', 'drain'] as const)('keeps the real Interrupt button usable until queued audio ends by %s', async (ending) => {
    const fixture = playbackFixture();
    const client = formalClient(async () => [
      { agentHandle: HANDLE_A, agentBinding: `agent_binding_${'A'.repeat(43)}`, activityAgentRef: 'agr_A', displayName: 'Agent A', avatarUrl: null },
    ]);
    let next!: (event: IteratorResult<NimiRealtimeEventEnvelope<NimiAgentRealtimeEvent>>) => void;
    vi.mocked(client.agentRealtime.subscribe).mockResolvedValue({
      [Symbol.asyncIterator]: () => ({ next: () => new Promise((resolve) => { next = resolve; }) }),
      cancel: async () => { next?.({ done: true, value: undefined }); },
    });
    const node = await renderEntry({ client, initialAgentHandle: HANDLE_A, inputAudio: AUDIO_FORMAT,
      turnDetection: 'manual', host: fixture.host, locale: 'en' });
    const button = (text: string) => Array.from(node.querySelectorAll('button'))
      .find((entry) => entry.textContent === text) as HTMLButtonElement;
    await act(async () => { button('Open live conversation').click(); });
    const emit = async (event: NimiAgentRealtimeEvent) => {
      await act(async () => { next({ done: false, value: { control: control(), event } }); });
    };
    await emit({ type: 'audio-frame', requestId: 'r1', outputTrackId: 'track', frameSequence: '1', frame: new Uint8Array(640), format: AUDIO_FORMAT });
    await emit({ type: 'output-track', requestId: 'r1', outputTrackId: 'track', lifecycle: 'completed', reasonCode: '' });
    // Runtime events continue while physical playback remains pending.
    await emit({ type: 'terminal', reasonCode: 'ACTION_EXECUTED' });
    const interrupt = button(resolveNimiAgentRealtimeCopy('en').interrupt);
    expect(interrupt.disabled).toBe(false);
    await act(async () => {
      if (ending === 'interrupt') interrupt.click();
      else fixture.sources[0]!.onended?.();
    });
    expect(fixture.sources[0]!.stop).toHaveBeenCalledTimes(ending === 'interrupt' ? 1 : 0);
    expect(client.agentRealtime.interruptOutput).not.toHaveBeenCalled();
    expect(interrupt.disabled).toBe(true);
  });

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
      { agentHandle: HANDLE_A, agentBinding: `agent_binding_${'A'.repeat(43)}`, activityAgentRef: 'agr_A', displayName: 'Same name', avatarUrl: null },
      { agentHandle: HANDLE_B, agentBinding: `agent_binding_${'B'.repeat(43)}`, activityAgentRef: 'agr_B', displayName: 'Same name', avatarUrl: null },
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

  it('reloads current references after a session fails and requires a new explicit selection for a rotated handle', async () => {
    const client = formalClient(async () => [
      { agentHandle: HANDLE_A, agentBinding: `agent_binding_${'A'.repeat(43)}`, activityAgentRef: 'agr_A', displayName: 'Agent A', avatarUrl: null },
    ]);
    const node = await renderEntry({
      client, initialAgentHandle: HANDLE_A, conversationAnchorId: 'old-anchor',
      inputAudio: AUDIO_FORMAT, turnDetection: 'manual', host: testHost(), locale: 'en',
    });
    const button = (text: string) => Array.from(node.querySelectorAll('button'))
      .find((entry) => entry.textContent === text) as HTMLButtonElement;
    // The existing finite subscription ends after open, as a canceled event stream does.
    await act(async () => { button('Open live conversation').click(); });
    expect(node.textContent).toContain('Live conversation is unavailable.');
    expect((node.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(true);

    vi.mocked(client.agents.listReferences).mockResolvedValueOnce([
      { agentHandle: HANDLE_B, agentBinding: `agent_binding_${'B'.repeat(43)}`, activityAgentRef: 'agr_B', displayName: 'Agent A', avatarUrl: null },
    ]);
    const retry = button('Retry');
    expect(retry).toBeTruthy();
    await act(async () => { retry.click(); });
    expect(client.agents.listReferences).toHaveBeenCalledTimes(2);
    expect(node.querySelector('[data-nimi-agent-realtime-entry="true"]')).toBeNull();
    expect(client.agentRealtime.open).toHaveBeenCalledTimes(1);
    await act(async () => {
      (node.querySelector(`[data-nimi-app-agent-realtime-agent-handle="${HANDLE_B}"]`) as HTMLButtonElement).click();
    });
    await act(async () => { button('Open live conversation').click(); });
    expect(client.agentRealtime.open).toHaveBeenLastCalledWith({
      agentHandle: HANDLE_B, inputAudio: AUDIO_FORMAT, turnDetection: 'manual',
    });
  });

  it('validates a supplied current handle through the reference list and preserves its exact anchor', async () => {
    const client = formalClient(async () => [
      { agentHandle: HANDLE_A, agentBinding: `agent_binding_${'A'.repeat(43)}`, activityAgentRef: 'agr_A', displayName: 'Agent A', avatarUrl: null },
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
    agents: {
      listReferences: vi.fn(listReferences),
      getIntroduction: async () => { throw new Error('Unexpected getIntroduction call'); },
    },
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
