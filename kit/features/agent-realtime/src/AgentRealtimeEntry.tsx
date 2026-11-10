import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, Check, ChevronRight, Mic, MicOff, PhoneOff } from 'lucide-react';
import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppAgentReference,
  NimiLocalAppClient,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  Avatar,
  Button,
  InlineAlert,
  LoadingSkeleton,
  NimiText,
  Surface,
  TextareaField,
  cn,
} from '@nimiplatform/kit/ui';

import { resolveNimiAgentRealtimeCopy } from './copy.js';
import { createNimiAgentRealtimeSession } from './session.js';
import type {
  CreateNimiAgentRealtimeSessionInput,
  NimiAgentRealtimeEvent,
  NimiAgentRealtimeSessionState,
} from './types.js';

type BoundAgentRealtimeEntryProps = CreateNimiAgentRealtimeSessionInput & {
  readonly locale?: string;
  readonly className?: string;
  readonly onEvent?: (event: NimiAgentRealtimeEvent) => void;
  readonly onStateChange?: (state: NimiAgentRealtimeSessionState) => void;
};

export type AgentRealtimeEntryProps = Omit<
  BoundAgentRealtimeEntryProps,
  'agentRealtime' | 'agentHandle'
> & {
  readonly client: Pick<NimiLocalAppClient, 'agents' | 'agentRealtime'>;
  readonly initialAgentHandle?: NimiLocalAppAgentHandle | null;
};

// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-080
export function AgentRealtimeEntry(props: AgentRealtimeEntryProps) {
  const copy = useMemo(() => resolveNimiAgentRealtimeCopy(props.locale), [props.locale]);
  const [references, setReferences] = useState<readonly NimiLocalAppAgentReference[] | null>(null);
  const [validatedReferenceContext, setValidatedReferenceContext] = useState<{
    readonly agents: NimiLocalAppClient['agents'];
    readonly initialAgentHandle: NimiLocalAppAgentHandle | null;
  } | null>(null);
  const [selectedHandle, setSelectedHandle] = useState<NimiLocalAppAgentHandle | null>(
    props.initialAgentHandle ?? null,
  );
  const [selectedExplicitly, setSelectedExplicitly] = useState(false);
  const [initialUnavailable, setInitialUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState('');
  const loadEpochRef = useRef(0);

  const loadReferences = useCallback(async () => {
    const epoch = ++loadEpochRef.current;
    setLoading(true);
    setFailure('');
    setValidatedReferenceContext(null);
    try {
      const next = await props.client.agents.listReferences();
      if (loadEpochRef.current !== epoch) return;
      setReferences(next);
      setValidatedReferenceContext({
        agents: props.client.agents,
        initialAgentHandle: props.initialAgentHandle ?? null,
      });
      const initialAvailable = Boolean(
        props.initialAgentHandle
        && next.some((reference) => reference.agentHandle === props.initialAgentHandle),
      );
      setInitialUnavailable(Boolean(props.initialAgentHandle) && !initialAvailable);
      setSelectedHandle((current) => {
        const candidate = current ?? props.initialAgentHandle ?? null;
        return candidate && next.some((reference) => reference.agentHandle === candidate)
          ? candidate
          : null;
      });
    } catch (error) {
      if (loadEpochRef.current !== epoch) return;
      setReferences(null);
      setValidatedReferenceContext(null);
      setSelectedHandle(null);
      setInitialUnavailable(false);
      setFailure(errorMessage(error, copy.agentsLoadFailed));
    } finally {
      if (loadEpochRef.current === epoch) setLoading(false);
    }
  }, [copy.agentsLoadFailed, props.client.agents, props.initialAgentHandle]);

  useEffect(() => {
    setSelectedExplicitly(false);
    setSelectedHandle(props.initialAgentHandle ?? null);
    void loadReferences();
    return () => { loadEpochRef.current += 1; };
  }, [loadReferences, props.initialAgentHandle]);

  const referencesReady = validatedReferenceContext?.agents === props.client.agents
    && validatedReferenceContext.initialAgentHandle === (props.initialAgentHandle ?? null);
  const selected = referencesReady
    ? references?.find((reference) => reference.agentHandle === selectedHandle) ?? null
    : null;
  return (
    <div className={cn('@container mx-auto max-w-[76rem] space-y-5', props.className)} data-nimi-app-agent-realtime-entry="true">
      <header className="flex items-start gap-4 py-2">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--nimi-surface-active)] text-[var(--nimi-action-primary-bg)]">
          <AudioLines className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h1 className="m-0 text-2xl font-semibold tracking-tight">{copy.title}</h1>
          <p className="m-0 mt-1 max-w-xl text-sm leading-relaxed text-[var(--nimi-text-secondary)]">{copy.description}</p>
        </div>
      </header>
      <div className={cn('grid items-start gap-4', selected && '@min-[50rem]:grid-cols-[14rem_minmax(0,1fr)]')}>
        {loading ? <LoadingSkeleton lines={2} label={copy.agentsLoading} /> : null}
        {failure ? (
          <div className="space-y-2">
            <InlineAlert tone="warning">{failure}</InlineAlert>
            <Button size="sm" tone="secondary" onClick={() => { void loadReferences(); }}>
              {copy.agentsRetry}
            </Button>
          </div>
        ) : null}
        {!loading && !failure && referencesReady && references?.length === 0 ? (
          <InlineAlert tone="warning">{copy.agentsEmpty}</InlineAlert>
        ) : null}
        {!loading && !failure && referencesReady && initialUnavailable ? (
          <InlineAlert tone="warning">{copy.initialAgentUnavailable}</InlineAlert>
        ) : null}
        {!loading && !failure && referencesReady && references && references.length > 0 ? (
          <div className={cn('grid gap-2', selected
            ? 'grid-cols-[repeat(auto-fill,minmax(min(100%,10rem),1fr))] @min-[50rem]:grid-cols-1'
            : 'grid-cols-[repeat(auto-fill,minmax(min(100%,13rem),1fr))]')} data-nimi-app-agent-realtime-selector="true">
            {references.map((reference) => (
              <Button
                key={reference.agentHandle}
                tone={reference.agentHandle === selectedHandle ? 'primary' : 'secondary'}
                aria-pressed={reference.agentHandle === selectedHandle}
                aria-label={`${reference.displayName} · ${reference.agentHandle === selectedHandle ? copy.selectedAgent : copy.selectAgent}`}
                title={reference.displayName}
                className="min-h-14 min-w-0 justify-start px-3 text-left [&>span]:w-full [&>span]:justify-start"
                onClick={() => {
                  if (reference.agentHandle === selectedHandle) return;
                  setSelectedExplicitly(true);
                  setInitialUnavailable(false);
                  setSelectedHandle(reference.agentHandle);
                }}
                data-nimi-app-agent-realtime-agent-handle={reference.agentHandle}
              >
                <Avatar
                  size="md"
                  src={reference.avatarUrl || undefined}
                  alt=""
                  fallback={reference.displayName.slice(0, 1)}
                />
                <span className="min-w-0 flex-1 truncate">{reference.displayName}</span>
                {reference.agentHandle === selectedHandle
                  ? <Check className="size-4 shrink-0" aria-hidden="true" />
                  : <ChevronRight className="size-4 shrink-0 opacity-60" aria-hidden="true" />}
              </Button>
            ))}
          </div>
        ) : null}
        {selected ? (
          <BoundAgentRealtimeEntry
            agentRealtime={props.client.agentRealtime}
            agentHandle={selected.agentHandle}
            displayName={selected.displayName}
            avatarUrl={selected.avatarUrl}
            {...(props.conversationAnchorId
              && props.initialAgentHandle === selected.agentHandle
              && !selectedExplicitly
              ? { conversationAnchorId: props.conversationAnchorId }
              : {})}
            inputAudio={props.inputAudio}
            turnDetection={props.turnDetection}
            host={props.host}
            locale={props.locale}
            onEvent={props.onEvent}
            onStateChange={props.onStateChange}
            onReloadAgents={() => { void loadReferences(); }}
          />
        ) : null}
      </div>
    </div>
  );
}

function BoundAgentRealtimeEntry(props: BoundAgentRealtimeEntryProps & {
  readonly onReloadAgents: () => void;
  readonly displayName: string;
  readonly avatarUrl: string | null;
}) {
  const {
    agentRealtime,
    agentHandle,
    conversationAnchorId,
    inputAudio,
    turnDetection,
    host,
  } = props;
  const requestedSession = useMemo(() => createNimiAgentRealtimeSession({
    agentRealtime,
    agentHandle,
    ...(conversationAnchorId === undefined ? {} : { conversationAnchorId }),
    inputAudio: {
      codec: inputAudio.codec,
      sampleRateHz: inputAudio.sampleRateHz,
      channelCount: inputAudio.channelCount,
      frameDurationMs: inputAudio.frameDurationMs,
      maximumFrameBytes: inputAudio.maximumFrameBytes,
    },
    turnDetection,
    host,
  }), [
    agentRealtime,
    agentHandle,
    conversationAnchorId,
    host,
    inputAudio.codec,
    inputAudio.sampleRateHz,
    inputAudio.channelCount,
    inputAudio.frameDurationMs,
    inputAudio.maximumFrameBytes,
    turnDetection,
  ]);
  const [session, setSession] = useState(requestedSession);
  const [state, setState] = useState(() => session.getState());
  const [text, setText] = useState('');
  const draftRevision = useRef(0);
  const currentSession = useRef(session);
  const [reply, setReply] = useState<{
    requestId: string;
    tracks: readonly { id: string; text: string }[];
  }>({ requestId: '', tracks: [] });
  const copy = resolveNimiAgentRealtimeCopy(props.locale);

  useEffect(() => {
    currentSession.current = session;
    setState(session.getState());
    const unsubscribe = session.subscribeState((next) => {
      setState(next);
    });
    return () => {
      unsubscribe();
      void session.close().catch(() => undefined);
    };
  }, [session]);

  useEffect(() => {
    if (requestedSession === session) return undefined;
    let current = true;
    // A real scope/config change must finish the previous owner's Close.
    // On failure keep that controller visible so Retry Close still owns it.
    void session.close().then(() => {
      if (current) setSession(requestedSession);
    }).catch(() => undefined);
    return () => { current = false; };
  }, [requestedSession, session]);

  useEffect(() => {
    if (!props.onStateChange) return undefined;
    return session.subscribeState(props.onStateChange);
  }, [props.onStateChange, session]);

  useEffect(() => {
    if (!props.onEvent) return undefined;
    return session.subscribeEvents(props.onEvent);
  }, [props.onEvent, session]);

  useEffect(() => {
    setReply({ requestId: '', tracks: [] });
    return session.subscribeEvents((event) => {
      if (event.type !== 'text-output') return;
      setReply((previous) => {
        const tracks = previous.requestId === event.requestId ? [...previous.tracks] : [];
        const index = tracks.findIndex((track) => track.id === event.outputTrackId);
        const prior = index < 0 ? '' : tracks[index]!.text;
        const track = { id: event.outputTrackId, text: event.final ? event.text : prior + event.text };
        if (index < 0) tracks.push(track);
        else tracks[index] = track;
        return { requestId: event.requestId, tracks };
      });
    });
  }, [session]);

  const replyText = reply.tracks.map((track) => track.text).join('\n\n');

  const openPending = state.lifecycle === 'opening';
  const closePending = state.lifecycle === 'closing';
  const active = ['ready', 'degraded', 'reconnecting'].includes(state.lifecycle);
  const switching = requestedSession !== session;
  const outputTrackId = state.activeOutputTrackIds[0] ?? null;
  const staleModelCatalog = state.error?.reasonCode === 'ai-remote-model-catalog-stale';
  const chinese = props.locale?.trim().toLowerCase().startsWith('zh');
  const statusText = state.capture === 'active'
    ? copy.capturing
    : state.pressure === 'blocked'
      ? copy.blocked
      : state.pressure === 'pressured'
        ? copy.pressured
        : lifecycleCopy(state, copy);

  return (
    <Surface tone="panel" className="min-w-0 overflow-hidden">
      <div data-nimi-agent-realtime-entry="true">
        <header className="flex items-center gap-3 border-b border-[var(--nimi-border-subtle)] px-5 py-4">
          {!switching ? <Avatar size="lg" src={props.avatarUrl || undefined} alt="" fallback={props.displayName.slice(0, 1)} /> : null}
          <div className="min-w-0">
            <h2 className="m-0 text-base font-semibold break-words">{switching ? copy.title : props.displayName}</h2>
            <NimiText role="helper" aria-live="polite">{statusText}</NimiText>
          </div>
        </header>
        <div className="space-y-4 p-5">
          {state.error ? (
            <InlineAlert tone="danger">
              {state.closeUnconfirmed ? <p>{copy.closeUnconfirmed}</p> : null}
              {staleModelCatalog ? (
                <>
                  <p>{chinese
                    ? '云端模型列表已更新。请在伙伴中心的「模型 → 实时语音」重新选择并保存模型，然后回来重试。'
                    : 'The cloud model list has changed. Open Agent Center, choose and save a model under Models → Realtime voice, then try again.'}</p>
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer">{chinese ? '技术详情' : 'Technical details'}</summary>
                    <p>{state.error.message}</p>
                  </details>
                </>
              ) : <p>{state.error.message}</p>}
            </InlineAlert>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {!active && !closePending && !state.closeUnconfirmed && !switching ? <Button
              type="button"
              size="sm"
              tone="primary"
              loading={openPending}
              disabled={openPending}
              onClick={() => {
                if (state.lifecycle === 'failed') props.onReloadAgents();
                else void session.open().catch(() => undefined);
              }}
            >
              {state.lifecycle === 'failed' ? copy.agentsRetry : copy.open}
            </Button> : null}
            {active && !switching ? <Button
              type="button"
              tone="primary"
              disabled={state.lifecycle !== 'ready' || state.capture === 'requesting'}
              onClick={() => {
                if (state.capture === 'active') {
                  void session.stopCapture().catch(() => undefined);
                } else {
                  void session.requestCapture().catch(() => undefined);
                }
              }}
            >
              {state.capture === 'active' ? <MicOff className="size-4" aria-hidden="true" /> : <Mic className="size-4" aria-hidden="true" />}
              {state.capture === 'active' ? copy.stop : copy.start}
            </Button> : null}
            {outputTrackId && !switching ? <Button
              type="button"
              size="sm"
              tone="ghost"
              onClick={() => {
                if (!outputTrackId) return;
                void session.interruptOutput({
                  outputTrackId,
                  interruptAgentTurn: true,
                }).catch(() => undefined);
              }}
            >
              {copy.interrupt}
            </Button> : null}
            {active || openPending || closePending || state.closeUnconfirmed ? <Button
              type="button"
              size="sm"
              tone="ghost"
              loading={closePending}
              disabled={closePending}
              onClick={() => {
                void session.close().then(() => {
                  if (requestedSession !== session) setSession(requestedSession);
                }).catch(() => undefined);
              }}
            >
              <PhoneOff className="size-4" aria-hidden="true" />
              {state.closeUnconfirmed && !closePending ? copy.retryClose : copy.close}
            </Button> : null}
          </div>

          {replyText && !switching ? (
            <NimiText role="body" className="rounded-xl border border-[var(--nimi-border-subtle)] p-4 whitespace-pre-wrap break-words" data-nimi-agent-realtime-reply="true">
              {replyText}
            </NimiText>
          ) : null}

          {active && !switching ? <div className="grid gap-2 border-t border-[var(--nimi-border-subtle)] pt-4">
            <TextareaField
              value={text}
              rows={3}
              aria-label={copy.textInputLabel}
              placeholder={copy.textInputLabel}
              disabled={state.pressure === 'blocked'}
              onChange={(event) => {
                draftRevision.current += 1;
                setText(event.currentTarget.value);
              }}
            />
            <Button
              type="button"
              size="sm"
              className="justify-self-end"
              disabled={state.pressure === 'blocked' || text.trim().length === 0}
              onClick={() => {
                const value = text.trim();
                if (!value) return;
                const revision = draftRevision.current;
                const epoch = session.getState().sessionEpoch;
                void session.sendText({
                  requestId: createRequestId(),
                  text: value,
                }).then((result) => {
                  if (result.ack.ok && currentSession.current === session
                    && session.getState().sessionEpoch === epoch && draftRevision.current === revision) {
                    draftRevision.current += 1;
                    setText('');
                  }
                }).catch(() => undefined);
              }}
            >
              {copy.sendText}
            </Button>
          </div> : null}
        </div>
      </div>
    </Surface>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : fallback;
}

function lifecycleCopy(
  state: NimiAgentRealtimeSessionState,
  copy: ReturnType<typeof resolveNimiAgentRealtimeCopy>,
): string {
  switch (state.lifecycle) {
    case 'idle': return copy.idle;
    case 'opening': return copy.opening;
    case 'ready':
    case 'degraded': return copy.ready;
    case 'reconnecting': return copy.reconnecting;
    case 'closing': return copy.closing;
    case 'closed': return copy.closed;
    case 'failed': return copy.failed;
  }
}

function createRequestId(): string {
  return `kit_realtime_${globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`}`;
}
