import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NimiLocalAppConversationClient } from '@nimiplatform/kit/core/sdk-contract';
import type { ConversationCanonicalMessage } from '../src/types.js';
import { createLocalAppConversationPlayback } from '../src/runtime/local-app-conversation-playback.js';

function message(id = 'answer', ready = false): ConversationCanonicalMessage {
  return { id, sessionId: 'anchor', targetId: 'agent', source: 'agent', role: 'assistant', kind: 'text', text: 'A real reply', status: 'complete', createdAt: '2026-10-27',
    metadata: { canonicalTurnId: 'turn', canonicalConversationAnchorId: 'anchor', canonicalVoiceState: ready ? 'ready' : null, canonicalVoiceArtifactId: ready ? `audio-${id}` : null } };
}
const controllers: ReturnType<typeof createLocalAppConversationPlayback>[] = [];
function setup(client: Partial<NimiLocalAppConversationClient>) {
  const audios: FakeAudio[] = [];
  class FakeAudio {
    src: string; ended = false; currentTime = 0; duration = 10;
    onplay: (() => void) | null = null; onpause: (() => void) | null = null; onended: (() => void) | null = null;
    onerror: (() => void) | null = null; ontimeupdate: (() => void) | null = null; onloadedmetadata: (() => void) | null = null; ondurationchange: (() => void) | null = null;
    play = vi.fn(async () => { this.onplay?.(); }); pause = vi.fn(() => this.onpause?.());
    constructor(url: string) { this.src = url; audios.push(this); }
  }
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:voice'); static revokeObjectURL = vi.fn(); });
  const options = { agentHandle: 'agent', conversationAnchorId: 'anchor', conversation: () => client as NimiLocalAppConversationClient };
  const controller = createLocalAppConversationPlayback(options); controllers.push(controller);
  return { controller, audios, options };
}
const readyArtifact = () => ({ artifactId: 'audio', bytes: new Uint8Array([1, 2]), mimeType: 'audio/wav', byteLength: 2 });
afterEach(() => { controllers.splice(0).forEach(controller => controller.dispose()); vi.unstubAllGlobals(); });
describe('message playback lifetime and request meaning', () => {
  it('plays an existing artifact and keeps playback independent from source visibility', async () => {
    const renderVoice = vi.fn(); const readArtifact = vi.fn(async () => readyArtifact());
    const { controller, audios } = setup({ renderVoice, readArtifact });
    await controller.play(message('one', true)); controller.setSourceVisible(false);
    expect(controller.getSnapshot().status).toBe('playing'); expect(audios[0]!.pause).not.toHaveBeenCalled();
    controller.pause(); expect(controller.getSnapshot().status).toBe('paused');
    await controller.resume(); expect(audios).toHaveLength(1); expect(renderVoice).not.toHaveBeenCalled();
  });
  it('does not restart audio when equivalent snapshots and callbacks are replaced', async () => {
    const client = { readArtifact: vi.fn(async () => readyArtifact()) };
    const { controller, audios, options } = setup(client);
    await controller.play(message('one', true));
    controller.update({ ...options, conversation: () => client as unknown as NimiLocalAppConversationClient });
    await controller.play({ ...message('one', true), metadata: { ...message('one', true).metadata } });
    expect(audios).toHaveLength(1); expect(audios[0]!.pause).not.toHaveBeenCalled();
    expect(client.readArtifact).toHaveBeenCalledTimes(1);
  });
  it('retries artifact reads without generating a second voice', async () => {
    const renderVoice = vi.fn(async () => ({ status: 'ready', artifactId: 'generated' } as const));
    const readArtifact = vi.fn().mockRejectedValueOnce(new Error('read offline')).mockResolvedValue(readyArtifact());
    const { controller } = setup({ renderVoice: renderVoice as never, readArtifact });
    await controller.play(message());
    expect(controller.getSnapshot()).toMatchObject({ status: 'error', phase: 'read', artifactId: 'generated' });
    await controller.retry();
    expect(renderVoice).toHaveBeenCalledTimes(1); expect(readArtifact).toHaveBeenLastCalledWith({ agentHandle: 'agent', conversationAnchorId: 'anchor', artifactId: 'generated' });
    expect(controller.getSnapshot().status).toBe('playing');
  });
  it('retries a device/play failure using the already confirmed audio', async () => {
    const renderVoice = vi.fn(); const readArtifact = vi.fn(async () => readyArtifact());
    const { controller, audios } = setup({ renderVoice, readArtifact });
    await controller.play(message('one', true)); audios[0]!.onerror?.();
    expect(controller.getSnapshot()).toMatchObject({ status: 'error', phase: 'play' });
    await controller.retry(); expect(audios).toHaveLength(2); expect(renderVoice).not.toHaveBeenCalled();
  });
  it('discards late generation after stop and after selecting a different message', async () => {
    let resolve!: (value: unknown) => void;
    const renderVoice = vi.fn(() => new Promise(result => { resolve = result; }));
    const { controller, audios } = setup({ renderVoice: renderVoice as never, readArtifact: vi.fn(async () => readyArtifact()) });
    const first = controller.play(message('old')); controller.stop();
    await controller.play(message('new', true));
    resolve({ status: 'ready', artifactId: 'old-audio' }); await first;
    expect(audios).toHaveLength(1); expect(controller.getSnapshot().messageId).toBe('new');
  });
  it('fences late generation after scope/access change', async () => {
    let resolve!: (value: unknown) => void;
    const renderVoice = vi.fn(() => new Promise(result => { resolve = result; }));
    const readArtifact = vi.fn(async () => readyArtifact());
    const { controller, audios, options } = setup({ renderVoice: renderVoice as never, readArtifact });
    const pending = controller.play(message());
    controller.update({ ...options, accessKey: 'new-account' });
    resolve({ status: 'ready', artifactId: 'late' }); await pending;
    expect(audios).toHaveLength(0); expect(readArtifact).not.toHaveBeenCalled(); expect(controller.getSnapshot().messageId).toBeNull();
  });
  it('blocks play and resume in realtime and never autoplays on closure', async () => {
    const { controller, audios, options } = setup({ readArtifact: vi.fn(async () => readyArtifact()) });
    await controller.play(message('one', true)); controller.update({ ...options, realtimeBlocked: true });
    await controller.play(message('two', true)); await controller.resume();
    expect(audios).toHaveLength(1); expect(audios[0]!.src).toBe('');
    controller.update({ ...options, realtimeBlocked: false }); expect(audios).toHaveLength(1);
    await controller.play(message('two', true)); expect(audios).toHaveLength(2);
  });
  it('separates read-only refresh from same-ID continuation and does not autoplay a recovered result', async () => {
    const renderVoice = vi.fn().mockRejectedValueOnce(new Error('receipt lost')).mockResolvedValue({ status: 'ready', artifactId: 'recovered' });
    const snapshot = vi.fn(async () => ({ voices: [{ messageId: 'answer', state: 'failed' }] }));
    const { controller, audios } = setup({ renderVoice, snapshot: snapshot as never, readArtifact: vi.fn(async () => readyArtifact()) });
    await controller.play(message()); const requestId = renderVoice.mock.calls[0]![0].requestId;
    expect(controller.getSnapshot().status).toBe('unknown'); await controller.refresh();
    expect(renderVoice).toHaveBeenCalledTimes(1); expect(controller.getSnapshot().status).toBe('unknown');
    await controller.continueRequest(); expect(renderVoice.mock.calls[1]![0].requestId).toBe(requestId);
    expect(controller.getSnapshot().status).toBe('ready'); expect(audios).toHaveLength(0);
    await controller.play(message()); expect(audios).toHaveLength(1); expect(renderVoice).toHaveBeenCalledTimes(2);
  });
  it('does not let an older sidecar refresh overwrite a newer explicit continuation', async () => {
    let finishRead!: (value: unknown) => void;
    const snapshot = vi.fn(() => new Promise(resolve => { finishRead = resolve; }));
    const renderVoice = vi.fn().mockRejectedValueOnce(new Error('unknown')).mockResolvedValue({ status: 'ready', artifactId: 'new-result' });
    const { controller } = setup({ renderVoice, snapshot: snapshot as never });
    await controller.play(message()); const refreshing = controller.refresh();
    await controller.continueRequest();
    finishRead({ voices: [{ messageId: 'answer', state: 'ready', artifactId: 'old-result' }] }); await refreshing;
    expect(controller.getSnapshot().artifactId).toBe('new-result');
  });
});
