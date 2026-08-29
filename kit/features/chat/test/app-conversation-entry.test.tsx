import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppClient,
  NimiLocalAppConversationEvent,
} from '@nimiplatform/kit/core/sdk-contract';
import { AppConversationEntry } from '../src/components/app-conversation-entry.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HANDLE_A = `agent_ref_${'A'.repeat(43)}` as NimiLocalAppAgentHandle;
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

function entryHarness() {
  const calls: Array<{ method: string; input?: unknown }> = [];
  let closeStream: (() => void) | null = null;
  const events: AsyncIterable<NimiLocalAppConversationEvent> = {
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise<IteratorResult<NimiLocalAppConversationEvent>>((resolve) => {
          closeStream = () => resolve({ done: true, value: undefined });
        }),
      };
    },
  };
  const client = {
    agents: {
      listReferences: vi.fn(async () => [{
        agentHandle: HANDLE_A,
        displayName: 'Agent A',
        avatarUrl: null,
      }]),
    },
    conversation: {
      open: vi.fn(async (input) => {
        calls.push({ method: 'open', input });
        return { conversationAnchorId: 'anchor-a', activeTurnId: null };
      }),
      subscribe: vi.fn(async (input) => {
        calls.push({ method: 'subscribe', input });
        return {
          [Symbol.asyncIterator]: () => events[Symbol.asyncIterator](),
          cancel: vi.fn(async () => {
            calls.push({ method: 'cancel' });
            closeStream?.();
          }),
        };
      }),
      snapshot: vi.fn(async (input) => {
        calls.push({ method: 'snapshot', input });
        return {
          conversationAnchorId: 'anchor-a',
          throughSequence: '1',
          turns: [{
            turnId: 'turn-1',
            status: 'completed' as const,
            phase: 'started' as const,
            terminalReason: 'stop',
            reasonCode: null,
            message: null,
          }],
          messages: [{
            messageId: 'message-1',
            turnId: 'turn-1',
            role: 'assistant' as const,
            parts: [{ kind: 'text' as const, text: '已提交消息' }],
          }],
          actions: [],
          voices: [],
          truncatedBefore: false,
        };
      }),
      send: vi.fn(async () => ({ turnId: 'turn-2' })),
      uploadAttachment: vi.fn(async () => ({ artifactId: 'artifact-upload-1', expiresAt: '2026-08-30T00:00:00.000Z' })),
      transcribeVoice: vi.fn(async () => ({ text: '转写文本' })),
      interruptTurn: vi.fn(async () => ({ turnId: 'turn-2' })),
      renderVoice: vi.fn(async (input) => {
        calls.push({ method: 'renderVoice', input });
        return {
          status: 'ready' as const,
          voiceId: 'voice-1',
          turnId: 'turn-1',
          messageId: 'message-1',
          artifactId: 'artifact-audio-1',
        };
      }),
      readArtifact: vi.fn(async (input) => {
        calls.push({ method: 'readArtifact', input });
        return {
          artifactId: 'artifact-audio-1',
          mimeType: 'audio/ogg',
          byteLength: 2,
          bytes: Uint8Array.from([1, 2]),
        };
      }),
    },
  } as unknown as NimiLocalAppClient;
  const hostPort = {
    playback: {
      play: vi.fn(async (input) => {
        calls.push({ method: 'play', input });
        return { status: 'playing' as const };
      }),
      stop: vi.fn(async () => { calls.push({ method: 'stop' }); }),
    },
    preview: {
      materialize: vi.fn(async () => ({ status: 'ready' as const, previewHandle: 'preview-1', mediaUrl: 'blob:host-preview-1' })),
      release: vi.fn(async () => {}),
    },
    attachments: {
      pickImage: vi.fn(async () => ({
        status: 'unavailable' as const,
        reasonCode: 'PICKER_UNAVAILABLE',
        message: '图片选择器不可用',
      })),
    },
    voiceInput: {
      record: vi.fn(async () => ({
        status: 'unavailable' as const,
        reasonCode: 'RECORDER_UNAVAILABLE',
        message: '录音不可用',
      })),
      cancel: vi.fn(async () => {}),
    },
  };
  return { calls, client, hostPort };
}

describe('AppConversationEntry', () => {
  it('uses Kit-owned Chinese copy, requires explicit reference selection, and mounts the canonical shell', async () => {
    const harness = entryHarness();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <AppConversationEntry
          client={harness.client}
          hostPort={harness.hostPort}
          language="zh-CN"
        />,
      );
      await Promise.resolve();
    });
    await flush();

    expect(container.textContent).toContain('请明确选择当前 Agent');
    expect(container.textContent).toContain('打开对话');
    expect(harness.calls.some((call) => call.method === 'open')).toBe(false);

    const select = container.querySelector(`[data-nimi-app-conversation-agent-handle="${HANDLE_A}"]`) as HTMLButtonElement;
    await act(async () => {
      select.click();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(container?.querySelector('[data-conversation-shell="canonical"]')).toBeTruthy();
    });
    expect(harness.calls.map((call) => call.method).filter((method) => (
      method === 'open' || method === 'subscribe' || method === 'snapshot'
    ))).toEqual(['open', 'subscribe', 'snapshot']);
    await vi.waitFor(() => expect(container?.textContent).toContain('已提交消息'));
    expect(container.textContent).toContain('播放语音');
    expect(container.textContent).toContain('添加图片');
    expect(container.textContent).toContain('录制语音');

    const attach = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('添加图片')) as HTMLButtonElement;
    await act(async () => { attach.click(); await Promise.resolve(); });
    await vi.waitFor(() => expect(harness.hostPort.attachments.pickImage).toHaveBeenCalledTimes(1));
    expect(container.textContent).toContain('图片选择器不可用');
    expect(container.textContent).toContain('添加图片');

    const record = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('录制语音')) as HTMLButtonElement;
    await act(async () => { record.click(); await Promise.resolve(); });
    await vi.waitFor(() => expect(harness.hostPort.voiceInput.record).toHaveBeenCalledTimes(1));
    expect(container.textContent).toContain('录音不可用');
    expect(container.textContent).toContain('录制语音');
  });

  it('keeps voice mechanics behind render/read and the supplied Host playback port', async () => {
    const harness = entryHarness();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <AppConversationEntry
          client={harness.client}
          hostPort={harness.hostPort}
          language="zh-CN"
        />,
      );
      await Promise.resolve();
    });
    await flush();
    const select = container.querySelector(`[data-nimi-app-conversation-agent-handle="${HANDLE_A}"]`) as HTMLButtonElement;
    await act(async () => { select.click(); await Promise.resolve(); });
    await vi.waitFor(() => expect(container?.textContent).toContain('播放语音'));
    const play = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('播放语音')) as HTMLButtonElement;
    await act(async () => { play.click(); await Promise.resolve(); });
    await vi.waitFor(() => expect(harness.calls.some((call) => call.method === 'play')).toBe(true));
    expect(harness.calls.map((call) => call.method).filter((method) => (
      method === 'renderVoice' || method === 'readArtifact' || method === 'play'
    ))).toEqual(['renderVoice', 'readArtifact', 'play']);
  });
});
