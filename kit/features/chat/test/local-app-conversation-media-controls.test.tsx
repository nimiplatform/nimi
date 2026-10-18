import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NimiLocalAppConversationClient } from '@nimiplatform/kit/core/sdk-contract';
import type { ConversationCanonicalMessage } from '../src/types.js';
import { LocalAppConversationVoiceButton } from '../src/components/local-app-conversation-voice-button.js';
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

function message(id: string, ready = true): ConversationCanonicalMessage {
  return {
    id, sessionId: 'anchor', targetId: 'agent', source: 'agent', role: 'assistant',
    kind: 'text', text: `reply ${id}`, status: 'complete', createdAt: '2026-10-18T00:00:00Z',
    metadata: {
      canonicalTurnId: `turn-${id}`, canonicalConversationAnchorId: 'anchor',
      canonicalVoiceState: ready ? 'ready' : 'failed', canonicalVoiceArtifactId: ready ? `audio-${id}` : null,
    },
  };
}
function Voice({ id, client, ready = true }: { id: string; client: NimiLocalAppConversationClient; ready?: boolean }) {
  return <LocalAppConversationVoiceButton message={message(id, ready)} agentHandle="agent"
    activeConversationAnchorId="anchor" conversation={() => client}
    playLabel={`play ${id}`} pauseLabel={`pause ${id}`} resumeLabel={`resume ${id}`}
    retryLabel={`retry ${id}`} stopLabel={`stop ${id}`} renderingLabel={`rendering ${id}`}
    unavailableLabel="Voice unavailable" errorLabel="Playback failed" progressLabel="Progress"
    settingsLabel="Settings" settingsHint="Check voice settings" />;
}
function installAudio() {
  const instances: FakeAudio[] = [];
  class FakeAudio {
    src: string;
    ended = false;
    currentTime = 0;
    duration = 5;
    onplay: (() => void) | null = null;
    onpause: (() => void) | null = null;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    play = vi.fn(async () => { this.onplay?.(); });
    pause = vi.fn(() => { this.onpause?.(); });
    constructor(url: string) { this.src = url; instances.push(this); }
  }
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:voice');
    static revokeObjectURL = vi.fn();
  });
  return instances;
}

describe('LocalApp Conversation media controls', () => {
  it('switches local playback without canceling Runtime work or regenerating ready audio', async () => {
    const audio = installAudio();
    const renderVoice = vi.fn();
    const interruptTurn = vi.fn();
    const readArtifact = vi.fn(async () => ({ mimeType: 'audio/wav', bytes: new Uint8Array([1, 2]) }));
    const client = { renderVoice, interruptTurn, readArtifact } as unknown as NimiLocalAppConversationClient;
    await render(<><Voice id="a" client={client} /><Voice id="b" client={client} /></>);
    await click('play a');
    expect(audio).toHaveLength(1);
    await click('play b');
    expect(audio).toHaveLength(2);
    expect(audio[0]!.pause).toHaveBeenCalledOnce();
    expect(audio[0]!.src).toBe('');
    expect(audio[1]!.play).toHaveBeenCalledOnce();
    expect(container.querySelector('[aria-label="play a"]')).toBeTruthy();
    expect(renderVoice).not.toHaveBeenCalled();
    expect(interruptTurn).not.toHaveBeenCalled();
  });

  it('does not autoplay a late voice result after another message was chosen', async () => {
    const audio = installAudio();
    let finish!: (value: { status: string; artifactId: string }) => void;
    const renderVoice = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const readArtifact = vi.fn(async () => ({ mimeType: 'audio/wav', bytes: new Uint8Array([1]) }));
    const client = { renderVoice, readArtifact } as unknown as NimiLocalAppConversationClient;
    await render(<><Voice id="a" ready={false} client={client} /><Voice id="b" client={client} /></>);
    await click('retry a');
    await click('play b');
    await act(async () => { finish({ status: 'ready', artifactId: 'audio-a' }); await flush(); });
    expect(audio).toHaveLength(1);
    expect(readArtifact).toHaveBeenCalledTimes(1);
    expect(readArtifact).toHaveBeenCalledWith({ agentHandle: 'agent', conversationAnchorId: 'anchor', artifactId: 'audio-b' });
  });

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
