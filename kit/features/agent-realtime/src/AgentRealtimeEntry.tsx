import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
    <div className={props.className} data-nimi-app-agent-realtime-entry="true">
      <Surface tone="panel" className="space-y-3 p-4">
        <div className="space-y-1">
          <NimiText role="section-title">{copy.title}</NimiText>
          <NimiText role="helper">{copy.description}</NimiText>
        </div>
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
          <div className="grid gap-2" data-nimi-app-agent-realtime-selector="true">
            {references.map((reference) => (
              <Button
                key={reference.agentHandle}
                tone={reference.agentHandle === selectedHandle ? 'primary' : 'secondary'}
                disabled={reference.agentHandle === selectedHandle}
                onClick={() => {
                  setSelectedExplicitly(true);
                  setInitialUnavailable(false);
                  setSelectedHandle(reference.agentHandle);
                }}
                data-nimi-app-agent-realtime-agent-handle={reference.agentHandle}
              >
                <Avatar
                  size="sm"
                  src={reference.avatarUrl || undefined}
                  alt={reference.displayName}
                  fallback={reference.displayName.slice(0, 1)}
                />
                <span>{reference.displayName}</span>
                <span className="text-xs opacity-70">
                  {reference.agentHandle === selectedHandle
                    ? copy.selectedAgent
                    : copy.selectAgent}
                </span>
              </Button>
            ))}
          </div>
        ) : null}
      </Surface>
      {selected ? (
        <BoundAgentRealtimeEntry
          agentRealtime={props.client.agentRealtime}
          agentHandle={selected.agentHandle}
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
        />
      ) : null}
    </div>
  );
}

function BoundAgentRealtimeEntry(props: BoundAgentRealtimeEntryProps) {
  const {
    agentRealtime,
    agentHandle,
    conversationAnchorId,
    inputAudio,
    turnDetection,
    host,
  } = props;
  const session = useMemo(() => createNimiAgentRealtimeSession({
    agentRealtime,
    agentHandle,
    ...(conversationAnchorId === undefined ? {} : { conversationAnchorId }),
    inputAudio,
    turnDetection,
    host,
  }), [
    agentRealtime,
    agentHandle,
    conversationAnchorId,
    host,
    inputAudio,
    turnDetection,
  ]);
  const [state, setState] = useState(() => session.getState());
  const [text, setText] = useState('');
  const copy = resolveNimiAgentRealtimeCopy(props.locale);

  useEffect(() => {
    setState(session.getState());
    const unsubscribe = session.subscribeState((next) => {
      setState(next);
      props.onStateChange?.(next);
    });
    return () => {
      unsubscribe();
      void session.close().catch(() => undefined);
    };
  }, [props.onStateChange, session]);

  useEffect(() => {
    if (!props.onEvent) return undefined;
    return session.subscribeEvents(props.onEvent);
  }, [props.onEvent, session]);

  const openPending = state.lifecycle === 'opening';
  const closePending = state.lifecycle === 'closing';
  const active = ['ready', 'degraded', 'reconnecting'].includes(state.lifecycle);
  const outputTrackId = state.activeOutputTrackIds[0] ?? null;
  const statusText = state.capture === 'active'
    ? copy.capturing
    : state.pressure === 'blocked'
      ? copy.blocked
      : state.pressure === 'pressured'
        ? copy.pressured
        : lifecycleCopy(state, copy);

  return (
    <Surface tone="panel" className={props.className}>
      <div className="space-y-4" data-nimi-agent-realtime-entry="true">
        <div className="space-y-1">
          <NimiText role="section-title">{copy.title}</NimiText>
          <NimiText role="helper" aria-live="polite">{statusText}</NimiText>
        </div>

        {state.error ? (
          <InlineAlert tone="danger">
            {state.error.message}
          </InlineAlert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            tone="primary"
            loading={openPending}
            disabled={openPending || closePending || active}
            onClick={() => { void session.open().catch(() => undefined); }}
          >
            {copy.open}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={state.lifecycle !== 'ready' || state.capture === 'requesting'}
            onClick={() => {
              if (state.capture === 'active') {
                void session.stopCapture().catch(() => undefined);
              } else {
                void session.requestCapture().catch(() => undefined);
              }
            }}
          >
            {state.capture === 'active' ? copy.stop : copy.start}
          </Button>
          <Button
            type="button"
            size="sm"
            tone="ghost"
            disabled={!outputTrackId}
            onClick={() => {
              if (!outputTrackId) return;
              void session.interruptOutput({
                outputTrackId,
                interruptAgentTurn: false,
              }).catch(() => undefined);
            }}
          >
            {copy.interrupt}
          </Button>
          <Button
            type="button"
            size="sm"
            tone="ghost"
            loading={closePending}
            disabled={closePending || (!active && state.lifecycle !== 'opening')}
            onClick={() => { void session.close().catch(() => undefined); }}
          >
            {copy.close}
          </Button>
        </div>

        <div className="space-y-2">
          <TextareaField
            value={text}
            rows={3}
            aria-label={copy.textInputLabel}
            disabled={!active || state.pressure === 'blocked'}
            onChange={(event) => setText(event.currentTarget.value)}
          />
          <Button
            type="button"
            size="sm"
            disabled={!active || state.pressure === 'blocked' || text.trim().length === 0}
            onClick={() => {
              const value = text.trim();
              if (!value) return;
              void session.sendText({
                requestId: createRequestId(),
                text: value,
              }).then((result) => {
                if (result.ack.ok) setText('');
              }).catch(() => undefined);
            }}
          >
            {copy.sendText}
          </Button>
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
