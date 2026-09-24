import { useEffect, useRef, useState } from 'react';
import { Button, TextField } from '@nimiplatform/kit/ui';
import {
  createBrowserAgentRealtimeHostMediaPort,
  createNimiAgentRealtimeSession,
  createNimiAgentRealtimeSessionState,
  type NimiAgentRealtimeSession,
  type NimiLocalAppAgentHandle,
} from '@nimiplatform/kit/features/agent-realtime';
import { Hand, Mic, MicOff, Phone, PhoneOff, Send } from 'lucide-react';
import { useNimiDay } from '../app/context.js';
import {
  applyRealtimeEvent,
  callPhase,
  initialCallView,
  markTyped,
  micProblem,
  shouldListenAgain,
  type CallView,
} from '../platform/voice-call.js';
import { getNimiLocalAppClient } from '../../shell/auth/local-app-client.js';
import { AgentAvatar } from './common.js';

const INPUT_AUDIO = Object.freeze({
  codec: 'pcm-s16le' as const,
  sampleRateHz: 16_000,
  channelCount: 1 as const,
  frameDurationMs: 20,
  maximumFrameBytes: 640,
});

function requestId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`}`;
}

/**
 * A hands-free call with the appointed Agent. It always talks to the one
 * NimiDay appointed and writes into the same conversation anchor, so what is
 * said here shows up in the Assistant conversation afterwards.
 */
export function VoicePanel({ agentHandle, agentName, avatarUrl, conversationAnchorId }: {
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly agentName: string;
  readonly avatarUrl: string | null;
  readonly conversationAnchorId: string | null;
}) {
  const [attempt, setAttempt] = useState(0);
  return (
    <VoiceCall
      key={`${agentHandle}:${conversationAnchorId ?? ''}:${attempt}`}
      agentHandle={agentHandle}
      agentName={agentName}
      avatarUrl={avatarUrl}
      conversationAnchorId={conversationAnchorId}
      onCallAgain={() => setAttempt((value) => value + 1)}
    />
  );
}

function VoiceCall({ agentHandle, agentName, avatarUrl, conversationAnchorId, onCallAgain }: {
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly agentName: string;
  readonly avatarUrl: string | null;
  readonly conversationAnchorId: string | null;
  readonly onCallAgain: () => void;
}) {
  const { copy } = useNimiDay();
  // The session is created by the effect that also closes it, so a remount
  // (including React's development double-mount) never reuses a closed call.
  const [session, setSession] = useState<NimiAgentRealtimeSession | null>(null);
  const [state, setState] = useState(() => createNimiAgentRealtimeSessionState({
    agentHandle,
    ...(conversationAnchorId ? { conversationAnchorId } : {}),
  }));
  const [view, setView] = useState<CallView>(initialCallView);
  const [micWanted, setMicWanted] = useState(false);
  const [text, setText] = useState('');
  const listeningRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const created = createNimiAgentRealtimeSession({
      agentRealtime: getNimiLocalAppClient().agentRealtime,
      agentHandle,
      ...(conversationAnchorId ? { conversationAnchorId } : {}),
      inputAudio: INPUT_AUDIO,
      turnDetection: 'server-vad',
      host: createBrowserAgentRealtimeHostMediaPort(),
    });
    setSession(created);
    setState(created.getState());
    setView(initialCallView);
    const offState = created.subscribeState(setState);
    const offEvents = created.subscribeEvents((event) => setView((current) => applyRealtimeEvent(current, event)));
    return () => {
      offState();
      offEvents();
      void created.close().catch(() => undefined);
    };
  }, [agentHandle, conversationAnchorId]);

  // A microphone problem ends hands-free listening until the user turns the mic on again.
  const problem = micProblem(state);
  useEffect(() => {
    if (problem) setMicWanted(false);
  }, [problem]);

  useEffect(() => {
    if (!session || !shouldListenAgain({ state, view, micWanted }) || listeningRef.current) return;
    listeningRef.current = true;
    void session.requestCapture()
      .catch(() => undefined)
      .finally(() => { listeningRef.current = false; });
  }, [micWanted, session, state, view]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [view.captions]);

  const phase = callPhase(state, view);
  const inCall = ['listening', 'you-speaking', 'thinking', 'agent-speaking', 'muted', 'reconnecting'].includes(phase);
  const outputTrackId = state.activeOutputTrackIds[0] ?? null;

  const call = () => {
    if (!session) return;
    setMicWanted(true);
    void session.open().catch(() => undefined);
  };
  const toggleMic = () => {
    if (!session) return;
    if (state.capture === 'active') {
      setMicWanted(false);
      void session.stopCapture().catch(() => undefined);
      return;
    }
    setMicWanted(true);
  };
  const interrupt = () => {
    if (!session || !outputTrackId) return;
    void session.interruptOutput({ outputTrackId, interruptAgentTurn: false }).catch(() => undefined);
  };
  const hangUp = () => {
    if (!session) return;
    setMicWanted(false);
    void session.close().catch(() => undefined);
  };
  const sendText = () => {
    const value = text.trim();
    if (!session || !value || !inCall || state.pressure === 'blocked') return;
    const id = requestId('nimiday-voice-text');
    void session.sendText({ requestId: id, text: value }).then((result) => {
      if (!result.ack.ok) return;
      setText('');
      setView((current) => markTyped(current, id, value));
    }).catch(() => undefined);
  };

  const status = (() => {
    switch (phase) {
      case 'idle': return copy.voice.body;
      case 'connecting': return copy.voice.connecting;
      case 'reconnecting': return copy.voice.reconnecting;
      case 'listening': return copy.voice.listening;
      case 'you-speaking': return copy.voice.youSpeaking;
      case 'thinking': return copy.voice.thinking(agentName);
      case 'agent-speaking': return copy.voice.speaking(agentName);
      case 'muted': return copy.voice.connected;
      case 'ended': return copy.voice.ended;
      case 'failed': return copy.voice.failed(agentName);
    }
  })();

  const notices: string[] = [];
  if (phase === 'failed' && /config|voice|policy|model/iu.test(state.error?.reasonCode ?? '')) notices.push(copy.voice.setupHint(agentName));
  if (problem === 'permission') notices.push(copy.voice.micPermission);
  if (problem === 'missing') notices.push(copy.voice.micMissing);
  if (problem === 'lost') notices.push(copy.voice.micLost);
  if (inCall && state.playback === 'unavailable') notices.push(copy.voice.playbackUnavailable);
  if (inCall && state.pressure === 'pressured') notices.push(copy.voice.pressured);
  if (inCall && state.pressure === 'blocked') notices.push(copy.voice.blocked);

  return (
    <div className="nd-voice" data-testid="nd-voice" data-phase={phase}>
      <div className="nd-voice-head">
        <span className="nd-voice-avatar" data-active={phase === 'agent-speaking' || phase === 'you-speaking' ? 'true' : undefined}>
          <AgentAvatar name={agentName} url={avatarUrl} size="lg" />
        </span>
        <div>
          <strong>{agentName}</strong>
          <p className="nd-faint" aria-live="polite" data-testid="nd-voice-status">{status}</p>
        </div>
      </div>

      {notices.map((notice) => <p key={notice} className="nd-voice-notice">{notice}</p>)}
      {phase === 'failed' && state.error ? (
        <details className="nd-faint"><summary>{copy.assistant.technical}</summary>{state.error.reasonCode || state.error.message}</details>
      ) : null}

      <div className="nd-voice-captions" ref={scrollRef} data-testid="nd-voice-captions">
        {view.captions.length === 0 ? <p className="nd-faint">{copy.voice.empty}</p> : null}
        {view.captions.map((caption) => (
          <p key={caption.key} className="nd-voice-caption" data-who={caption.who} data-final={caption.final ? 'true' : 'false'}>
            <span className="nd-voice-who">{caption.who === 'you' ? copy.voice.you : agentName}</span>
            {caption.text}
          </p>
        ))}
      </div>

      <div className="nd-voice-controls">
        {phase === 'idle' || phase === 'connecting' ? (
          <Button tone="primary" leadingIcon={<Phone size={15} aria-hidden="true" />} loading={phase === 'connecting'} disabled={phase === 'connecting'} onClick={call}>
            {copy.voice.call}
          </Button>
        ) : null}
        {phase === 'ended' || phase === 'failed' ? (
          <Button tone="primary" leadingIcon={<Phone size={15} aria-hidden="true" />} onClick={onCallAgain}>{copy.voice.callAgain}</Button>
        ) : null}
        {inCall ? (
          <>
            <Button
              tone={state.capture === 'active' ? 'secondary' : 'primary'}
              leadingIcon={state.capture === 'active' ? <MicOff size={15} aria-hidden="true" /> : <Mic size={15} aria-hidden="true" />}
              disabled={state.lifecycle !== 'ready' || state.capture === 'requesting'}
              onClick={toggleMic}
            >
              {state.capture === 'active' ? copy.voice.mute : copy.voice.unmute}
            </Button>
            <Button tone="ghost" leadingIcon={<Hand size={15} aria-hidden="true" />} disabled={!outputTrackId} onClick={interrupt}>
              {copy.voice.interrupt(agentName)}
            </Button>
            <Button tone="danger" leadingIcon={<PhoneOff size={15} aria-hidden="true" />} onClick={hangUp}>{copy.voice.hangUp}</Button>
          </>
        ) : null}
      </div>

      {inCall ? (
        <div className="nd-voice-type">
          <TextField
            value={text}
            aria-label={copy.voice.typeLabel}
            placeholder={copy.voice.typePlaceholder}
            maxLength={2000}
            disabled={state.pressure === 'blocked'}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                sendText();
              }
            }}
          />
          <Button tone="secondary" leadingIcon={<Send size={14} aria-hidden="true" />} disabled={!text.trim() || state.pressure === 'blocked'} onClick={sendText}>
            {copy.voice.send}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
