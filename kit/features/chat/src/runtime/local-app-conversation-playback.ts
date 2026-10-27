import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { NimiLocalAppConversationClient, NimiLocalAppAgentHandle } from '@nimiplatform/kit/core/sdk-contract';
import type { ConversationCanonicalMessage } from '../types.js';
import { resolveLocalAppConversationVoiceRequest } from '../headless/local-app-conversation-voice.js';
import { claimConversationPlayback } from '../headless/local-app-conversation-playback.js';

export type LocalAppPlaybackStatus = 'idle' | 'preparing' | 'ready' | 'playing' | 'paused' | 'error' | 'unknown';
export type LocalAppPlaybackPhase = 'generation' | 'read' | 'play';
export type LocalAppPlaybackState = {
  readonly status: LocalAppPlaybackStatus;
  readonly phase: LocalAppPlaybackPhase | null;
  readonly message: ConversationCanonicalMessage | null;
  readonly messageId: string | null;
  readonly artifactId: string | null;
  readonly position: number;
  readonly duration: number;
  readonly realtimeBlocked: boolean;
  readonly sourceVisible: boolean;
  readonly error: unknown;
};
export type LocalAppPlaybackOptions = {
  agentHandle: string | null;
  conversationAnchorId: string | null;
  conversation: () => NimiLocalAppConversationClient;
  realtimeBlocked?: boolean;
  /** Changes on account/access loss even if the visible anchor has not changed. */
  accessKey?: string;
  onError?: (error: unknown) => void;
};
export type LocalAppConversationPlayback = {
  readonly state: LocalAppPlaybackState;
  play: (message: ConversationCanonicalMessage) => Promise<void>;
  pause: () => void;
  resume: () => Promise<void>;
  seek: (seconds: number) => void;
  stop: () => void;
  retry: () => Promise<void>;
  refresh: () => Promise<void>;
  continueRequest: () => Promise<void>;
  setSourceVisible: (visible: boolean) => void;
};

// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-061
// @nimi-authority: rule.nimi.platform.chat-message-interaction.playback-lifetime
export function createLocalAppConversationPlayback(initial: LocalAppPlaybackOptions) {
  let options = initial;
  let epoch = 0;
  let requestId: string | null = null;
  let audio: HTMLAudioElement | null = null;
  let objectUrl: string | null = null;
  let releaseClaim = () => {};
  const playbackOwner = Symbol('local-app-message-playback');
  const listeners = new Set<() => void>();
  let state: LocalAppPlaybackState = {
    status: 'idle', phase: null, message: null, messageId: null, artifactId: null,
    position: 0, duration: 0, realtimeBlocked: Boolean(initial.realtimeBlocked), sourceVisible: false, error: null,
  };
  const publish = (next: Partial<LocalAppPlaybackState>) => {
    state = { ...state, ...next };
    listeners.forEach(listener => listener());
  };
  const releaseAudio = () => {
    if (audio) {
      audio.onplay = audio.onpause = audio.onended = audio.onerror = null;
      audio.ontimeupdate = audio.onloadedmetadata = audio.ondurationchange = null;
      audio.pause(); audio.src = ''; audio = null;
    }
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  };
  const stop = () => {
    epoch += 1; releaseAudio(); releaseClaim(); releaseClaim = () => {};
    publish({ status: 'idle', phase: null, position: 0, duration: 0, error: null });
  };
  const canAct = () => Boolean(options.agentHandle && options.conversationAnchorId && !options.realtimeBlocked);
  const scope = () => ({ agentHandle: options.agentHandle as NimiLocalAppAgentHandle, conversationAnchorId: options.conversationAnchorId! });
  const current = (generation: number) => generation === epoch && canAct();
  const fail = (error: unknown, phase: LocalAppPlaybackPhase, generation: number) => {
    if (!current(generation)) return;
    releaseAudio(); releaseClaim(); releaseClaim = () => {};
    publish({ status: phase === 'generation' ? 'unknown' : 'error', phase, error });
    options.onError?.(error);
  };
  const claim = () => { releaseClaim = claimConversationPlayback('local-app-window', playbackOwner, stop); };
  const loadAndPlay = async (generation: number) => {
    if (!state.artifactId || !current(generation)) return;
    publish({ status: 'preparing', phase: 'read', error: null });
    try {
      const artifact = await options.conversation().readArtifact({ ...scope(), artifactId: state.artifactId });
      if (!current(generation)) return;
      if (!artifact.mimeType.toLowerCase().startsWith('audio/') || !artifact.bytes.byteLength) throw new Error('The voice artifact has no playable audio.');
      const bytes = new Uint8Array(artifact.bytes.byteLength); bytes.set(artifact.bytes);
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: artifact.mimeType }));
      audio = new Audio(objectUrl);
      const activeAudio = audio;
      const updateProgress = () => {
        if (current(generation) && audio === activeAudio) publish({ position: Number.isFinite(activeAudio.currentTime) ? activeAudio.currentTime : 0, duration: Number.isFinite(activeAudio.duration) ? activeAudio.duration : 0 });
      };
      activeAudio.onplay = () => { if (current(generation)) publish({ status: 'playing', phase: 'play' }); };
      activeAudio.onpause = () => { if (current(generation) && !activeAudio.ended) publish({ status: 'paused' }); };
      activeAudio.onended = () => { if (current(generation)) stop(); };
      activeAudio.onerror = () => fail(activeAudio.error || new Error('Voice playback failed.'), 'play', generation);
      activeAudio.ontimeupdate = activeAudio.onloadedmetadata = activeAudio.ondurationchange = updateProgress;
      publish({ phase: 'play' });
      await activeAudio.play();
      if (!current(generation)) { activeAudio.pause(); activeAudio.src = ''; }
    } catch (error) { fail(error, state.phase === 'play' ? 'play' : 'read', generation); }
  };
  const generate = async (generation: number, autoplay: boolean) => {
    if (!state.messageId || !requestId || !current(generation)) return;
    publish({ status: 'preparing', phase: 'generation', error: null });
    try {
      const result = await options.conversation().renderVoice({ ...scope(), messageId: state.messageId, requestId });
      if (!current(generation)) return;
      if (result.status !== 'ready') {
        releaseClaim(); releaseClaim = () => {};
        publish({ status: 'error', phase: 'generation', error: result }); return;
      }
      publish({ status: 'ready', phase: null, artifactId: result.artifactId });
      if (autoplay) await loadAndPlay(generation);
    } catch (error) { fail(error, 'generation', generation); }
  };
  const resume = async () => {
    if (!canAct() || state.status !== 'paused') return;
    claim();
    if (!audio) { await loadAndPlay(epoch); return; }
    const activeAudio = audio; const generation = epoch;
    publish({ status: 'preparing', phase: 'play', error: null });
    try { await activeAudio.play(); if (!current(generation)) { activeAudio.pause(); activeAudio.src = ''; } }
    catch (error) { fail(error, 'play', generation); }
  };
  const play = async (message: ConversationCanonicalMessage) => {
    if (!canAct() || !resolveLocalAppConversationVoiceRequest({ message, agentHandle: options.agentHandle, activeConversationAnchorId: options.conversationAnchorId })) return;
    if (state.messageId === message.id && state.status === 'paused') { await resume(); return; }
    if (state.messageId === message.id && ['playing', 'preparing', 'unknown'].includes(state.status)) return;
    const knownArtifact = state.messageId === message.id ? state.artifactId : null;
    stop(); claim();
    const metadata = message.metadata;
    const artifactId = knownArtifact || (metadata?.canonicalVoiceState === 'ready' ? String(metadata.canonicalVoiceArtifactId || '') : '') || null;
    publish({ message, messageId: message.id, artifactId, position: 0, duration: 0 });
    if (artifactId) await loadAndPlay(epoch);
    else { requestId = `conversation-voice-${crypto.randomUUID()}`; await generate(epoch, true); }
  };
  const retry = async () => {
    if (!canAct() || state.status !== 'error') return;
    epoch += 1; releaseAudio(); claim();
    if (state.artifactId) await loadAndPlay(epoch);
    else { requestId = `conversation-voice-${crypto.randomUUID()}`; await generate(epoch, true); }
  };
  const refresh = async () => {
    if (!canAct() || state.status !== 'unknown' || !state.messageId) return;
    const generation = ++epoch;
    try {
      const snapshot = await options.conversation().snapshot(scope());
      if (!current(generation)) return;
      const voice = snapshot.voices.find(item => item.messageId === state.messageId);
      if (voice?.state === 'ready' && voice.artifactId) publish({ status: 'ready', phase: null, artifactId: voice.artifactId, error: null });
      // A sidecar has no requestId. A failed older attempt cannot settle this
      // unknown request; only its same-ID continuation can report that result.
    } catch (error) { if (current(generation)) { publish({ error }); options.onError?.(error); } }
  };
  const continueRequest = async () => {
    if (!canAct() || state.status !== 'unknown' || !requestId) return;
    epoch += 1; claim(); await generate(epoch, false);
  };
  const actions = {
    play, resume, stop, retry, refresh, continueRequest,
    setSourceVisible: (visible: boolean) => { if (state.sourceVisible !== visible) publish({ sourceVisible: visible }); },
    pause: () => { if (state.status === 'playing') audio?.pause(); },
    seek: (seconds: number) => { if (audio && state.duration > 0 && Number.isFinite(seconds)) { audio.currentTime = Math.max(0, Math.min(seconds, state.duration)); publish({ position: audio.currentTime }); } },
  };
  return {
    ...actions,
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    update(next: LocalAppPlaybackOptions) {
      const changed = next.agentHandle !== options.agentHandle || next.conversationAnchorId !== options.conversationAnchorId || next.accessKey !== options.accessKey;
      const becameBlocked = Boolean(next.realtimeBlocked) && !options.realtimeBlocked;
      options = next;
      if (changed || becameBlocked) stop();
      if (changed) { requestId = null; publish({ message: null, messageId: null, artifactId: null, sourceVisible: false }); }
      if (state.realtimeBlocked !== Boolean(next.realtimeBlocked)) publish({ realtimeBlocked: Boolean(next.realtimeBlocked) });
    },
    dispose() { stop(); listeners.clear(); },
  };
}

export function useLocalAppConversationPlayback(options: LocalAppPlaybackOptions): LocalAppConversationPlayback {
  const controllerRef = useRef<ReturnType<typeof createLocalAppConversationPlayback> | null>(null);
  if (!controllerRef.current) controllerRef.current = createLocalAppConversationPlayback(options);
  const controller = controllerRef.current;
  useLayoutEffect(() => { controller.update(options); });
  useLayoutEffect(() => () => controller.dispose(), [controller]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return { state, play: controller.play, pause: controller.pause, resume: controller.resume, seek: controller.seek, stop: controller.stop, retry: controller.retry, refresh: controller.refresh, continueRequest: controller.continueRequest, setSourceVisible: controller.setSourceVisible };
}
