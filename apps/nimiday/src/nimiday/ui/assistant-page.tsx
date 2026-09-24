import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButton,
  nimiToast,
} from '@nimiplatform/kit/ui';
import { createBrowserAppConversationHostPort } from '@nimiplatform/kit/features/chat';
import { AudioLines, CalendarPlus, Mic, Send, Square, UserRoundCog, Volume2, Monitor } from 'lucide-react';
import { circleMentioned, draftFromRequest } from '../domain/quick-capture.js';
import { isActive } from '../domain/reminders.js';
import { toLocalDate } from '../domain/time.js';
import { itemLine } from '../domain/work.js';
import { describeUndone, formatInstant } from '../i18n/index.js';
import { useDayStore, useDesk, useEngine, useNimiDay } from '../app/context.js';
import type { DeskMessage } from '../platform/agent-desk.js';
import type { SkillRun } from '../domain/types.js';
import { showAgentAvatar } from '../platform/avatar.js';
import { AgentAvatar, Card, PageHead } from './common.js';
import { AppointPanel } from './appoint-panel.js';
import { RunChanges } from './run-card.js';
import { useUi } from './ui-context.js';
import { VoicePanel } from './voice-panel.js';

export function AssistantPage() {
  const { copy } = useNimiDay();
  const desk = useDesk();
  if (desk.phase !== 'ready' || !desk.agent) {
    return (
      <div className="nd-page nd-page--narrow" data-testid="nd-assistant">
        <PageHead title={copy.assistant.title} />
        <Card>
          <AppointPanel />
        </Card>
        <AppointmentHistory />
      </div>
    );
  }
  return <Conversation />;
}

function AppointmentHistory() {
  const { copy } = useNimiDay();
  const { state } = useDayStore();
  const { now } = useEngine();
  if (state.profile.appointmentHistory.length === 0) return null;
  const today = toLocalDate(now);
  return (
    <Card title={copy.assistant.appointmentHistory} className="" testId="nd-appointment-history">
      <ul className="nd-changes-list">
        {[...state.profile.appointmentHistory].reverse().map((record) => (
          <li key={`${record.displayName}-${record.from}`}>
            {record.displayName} · {formatInstant(copy, record.from, today)}
            {record.to ? ` – ${formatInstant(copy, record.to, today)}` : ` · ${copy.assistant.current}`}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function MessageBubble({ message, agentName, run, unconfirmed }: {
  readonly message: DeskMessage;
  readonly agentName: string;
  readonly run: SkillRun | null;
  readonly unconfirmed: string | null;
}) {
  const { desk: deskApi, copy, engine } = useNimiDay();
  const { state } = useDayStore();
  const { now } = useEngine();
  const ui = useUi();
  const [images, setImages] = useState<string[]>([]);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    let active = true;
    if (message.images.length === 0) return;
    void Promise.all(message.images.map((image) => deskApi.readImage(image.artifactId).catch(() => null))).then((urls) => {
      if (active) setImages(urls.filter((url): url is string => Boolean(url)));
    });
    return () => { active = false; };
  }, [deskApi, message.images]);

  if (message.role === 'app') {
    // Runtime prefixes an App-originated turn with its App and routine; the rest is addressed to the agent.
    const routine = /^\[App: [^\]]*?· Routine: ([^\]]+)\]\s*/u.exec(message.text);
    return (
      <div className="nd-chat-notice" data-testid="nd-app-message">
        {routine ? copy.assistant.routineStarted(routine[1]!.trim()) : copy.assistant.appStarted}
        <details className="nd-faint"><summary>{copy.assistant.routineAsked}</summary>{routine ? message.text.slice(routine[0].length) : message.text}</details>
      </div>
    );
  }

  const speak = async () => {
    if (speaking) {
      deskApi.stopSpeaking();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    const result = await deskApi.speak(message.id, `speak-${message.id}-${Date.now()}`);
    if (result.ok) {
      await result.finished;
      setSpeaking(false);
      return;
    }
    setSpeaking(false);
    nimiToast.show({
      tone: 'warning',
      message: result.reason === 'voice-unavailable' ? copy.assistant.voiceUnavailable(agentName) : copy.assistant.voiceFailed,
      durationMs: 7000,
    });
  };

  return (
    <div className="nd-bubble" data-role={message.role} data-testid={`nd-bubble-${message.role}`}>
      {message.text}
      {images.map((url) => <img key={url} src={url} alt={copy.assistant.image} />)}
      {run && run.changes.length > 0 ? (
        <div className="nd-bubble-changes" data-testid="nd-chat-changes">
          <RunChanges run={run} />
          {run.undone ? <span className="nd-faint">{describeUndone(copy, run, state.items)}</span> : (
            <button type="button" className="nd-link" onClick={() => {
              const outcome = engine.undoRun(run.id);
              if (outcome) nimiToast.show({ tone: outcome.kept > 0 ? 'warning' : 'success', message: copy.run.undoResult(outcome.reverted, outcome.kept), durationMs: 5000 });
            }}>{copy.run.undoAll}</button>
          )}
        </div>
      ) : null}
      {unconfirmed ? (
        <div className="nd-bubble-changes" data-testid="nd-chat-unconfirmed">
          <p className="nd-faint" style={{ margin: '0 0 4px' }}>{copy.assistant.unconfirmed}</p>
          <span className="nd-inline-actions">
            <button type="button" className="nd-link" onClick={() => {
              const draft = draftFromRequest(unconfirmed, now);
              ui.newItem({
                title: draft.title,
                kind: draft.kind,
                date: draft.date,
                time: draft.time,
                repeat: draft.repeat,
                importance: draft.importance,
                circleId: circleMentioned(draft.title, state.circles),
              });
              engine.dismissUnconfirmed();
            }}>{copy.assistant.unconfirmedAdd}</button>
            <button type="button" className="nd-link" onClick={engine.dismissUnconfirmed}>{copy.assistant.unconfirmedDismiss}</button>
          </span>
        </div>
      ) : null}
      {message.role === 'assistant' && message.text ? (
        <div className="nd-bubble-tools">
          <button type="button" className="nd-link nd-link-icon" onClick={() => { void speak(); }} aria-label={copy.assistant.readAloud}>
            <Volume2 size={13} aria-hidden="true" />{speaking ? copy.run.stopListening : copy.assistant.readAloud}
          </button>
          <span className="nd-faint">{agentName}</span>
        </div>
      ) : null}
    </div>
  );
}

function Conversation() {
  const { copy, desk: deskApi, language, engine } = useNimiDay();
  const desk = useDesk();
  const { state } = useDayStore();
  const { now, unconfirmed } = useEngine();
  const ui = useUi();
  const agent = desk.agent!;
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [recording, setRecording] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [switchPrompt, setSwitchPrompt] = useState<((value: boolean) => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hostPort = useMemo(() => createBrowserAppConversationHostPort(), []);
  const replying = desk.activeTurnId !== null;
  // The conversation is shared across Nimi: another App's turn can be running here too.
  const ownTurn = replying && deskApi.ownsTurn(desk.activeTurnId);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [desk.messages.length, desk.streaming?.text]);

  useEffect(() => () => { void hostPort.voiceInput.cancel(); }, [hostPort]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    const result = await engine.chat(text);
    setSending(false);
    if (result.ok) {
      setDraft('');
      return;
    }
    const message = result.reason === 'busy'
      ? copy.assistant.busy(agent.displayName)
      : result.reason === 'not-ready' ? copy.assistant.notConnected(agent.displayName) : copy.assistant.sendFailed;
    nimiToast.show({ tone: 'warning', message, durationMs: 5000 });
  };

  const toggleVoiceInput = async () => {
    if (recording === 'transcribing') return;
    const result = await hostPort.voiceInput.record();
    if (result.status === 'recording') {
      setRecording('recording');
      return;
    }
    if (result.status === 'unavailable') {
      setRecording('idle');
      if (result.reasonCode !== 'RECORDING_CANCELLED') nimiToast.show({ tone: 'warning', message: micMessage(result.reasonCode), durationMs: 6000 });
      return;
    }
    setRecording('transcribing');
    try {
      const text = await deskApi.transcribe({ requestId: `voice-${Date.now()}`, mimeType: result.mimeType, bytes: result.bytes });
      setDraft((current) => (current ? `${current} ${text}` : text));
    } catch {
      nimiToast.show({ tone: 'warning', message: copy.assistant.transcribeFailed, durationMs: 6000 });
    } finally {
      setRecording('idle');
    }
  };

  const micMessage = (reasonCode: string) => {
    if (reasonCode === 'MICROPHONE_PERMISSION_DENIED') return copy.assistant.micPermission;
    if (reasonCode === 'MICROPHONE_DEVICE_UNAVAILABLE') return copy.assistant.micMissing;
    if (reasonCode === 'MICROPHONE_DEVICE_BUSY' || reasonCode === 'MICROPHONE_BUSY') return copy.assistant.micBusy;
    return copy.assistant.micFailed;
  };

  const shareToday = () => {
    const today = toLocalDate(now);
    const lines = state.items
      .filter((item) => isActive(item) && item.date === today)
      .map((item) => itemLine(item, state.circles, language, now).replace(/\[[^\]]+\]\s/u, ''))
      .join('\n');
    setDraft(copy.assistant.shareTodayDraft(lines || copy.today.scheduleEmpty));
  };

  const [avatarPending, setAvatarPending] = useState(false);
  const showAvatar = async () => {
    if (!desk.anchorId || avatarPending) return;
    setAvatarPending(true);
    nimiToast.show({ tone: 'info', message: copy.assistant.avatarCalling(agent.displayName), durationMs: 4000 });
    // The desktop may take a while to present the companion; say so instead of staying silent.
    const slow = setTimeout(() => nimiToast.show({ tone: 'warning', message: copy.assistant.avatarSlow(agent.displayName), durationMs: 8000 }), 30_000);
    try {
      const outcome = await showAgentAvatar({
        agentHandle: agent.agentHandle,
        conversationAnchorId: desk.anchorId,
        confirmSwitch: () => new Promise<boolean>((resolve) => setSwitchPrompt(() => resolve)),
      });
      if (outcome.kind === 'shown') nimiToast.show({ tone: 'success', message: copy.assistant.avatarOpened(agent.displayName), durationMs: 4000 });
      if (outcome.kind === 'failed') nimiToast.show({ tone: 'warning', message: copy.assistant.avatarFailedBody(agent.displayName), durationMs: 7000 });
    } finally {
      clearTimeout(slow);
      setAvatarPending(false);
    }
  };

  const liveTools = desk.liveTools.filter((tool) => tool.turnId === desk.activeTurnId && tool.lifecycle === 'started');
  const chatRuns = useMemo(() => new Map(state.runs
    .filter((run) => run.trigger === 'chat' && run.replyMessageId)
    .map((run) => [run.replyMessageId!, run] as const)), [state.runs]);

  return (
    <div className="nd-chat" data-testid="nd-assistant">
      <div className="nd-chat-head">
        <div className="nd-inline-actions" style={{ gap: 12 }}>
          <AgentAvatar name={agent.displayName} url={agent.avatarUrl} size="md" />
          <div>
            <strong style={{ fontSize: 16 }}>{agent.displayName}</strong>
            <div className="nd-faint">
              <span className="nd-status-dot" data-tone={desk.connection === 'lost' ? 'lost' : replying ? 'busy' : undefined} aria-hidden="true" />
              {desk.connection === 'lost' ? copy.agent.connectionLost : replying ? (ownTurn ? copy.agent.replying : copy.agent.busyElsewhere) : copy.agent.idle}
              {state.profile.appointment ? ` · ${copy.agent.since(formatInstant(copy, state.profile.appointment.appointedAt, toLocalDate(now)))}` : ''}
            </div>
          </div>
        </div>
        <div className="nd-inline-actions">
          {desk.connection === 'lost' ? <Button tone="secondary" size="sm" onClick={() => { void deskApi.reconnect().then(() => engine.checkActiveRun()); }}>{copy.agent.reconnect}</Button> : null}
          <Button tone="ghost" size="sm" leadingIcon={<AudioLines size={15} aria-hidden="true" />} onClick={() => setVoiceOpen(true)}>{copy.assistant.voice}</Button>
          <Button tone="ghost" size="sm" leadingIcon={<Monitor size={15} aria-hidden="true" />} loading={avatarPending} disabled={avatarPending} onClick={() => { void showAvatar(); }}>{copy.assistant.avatar}</Button>
          <Button tone="ghost" size="sm" leadingIcon={<UserRoundCog size={15} aria-hidden="true" />} onClick={ui.appointAgent}>{copy.agent.change}</Button>
        </div>
      </div>

      {desk.connection !== 'live' ? (
        <div className="nd-voice-notice" style={{ margin: '12px 28px 0' }} data-testid="nd-connection-notice">
          {desk.connection === 'reconnecting' ? copy.assistant.reconnecting(agent.displayName) : copy.assistant.connectionLostBody(agent.displayName)}
          {desk.error ? <details className="nd-faint"><summary>{copy.assistant.technical}</summary>{desk.error}</details> : null}
        </div>
      ) : null}
      <div className="nd-chat-scroll" ref={scrollRef}>
        <div className="nd-chat-inner">
          <div className="nd-chat-notice">{copy.assistant.sharedNote(agent.displayName)}</div>
          {desk.truncatedBefore ? <div className="nd-chat-notice">{copy.assistant.earlier}</div> : null}
          {desk.messages.length === 0 && !desk.streaming ? <div className="nd-chat-notice">{copy.assistant.empty(agent.displayName)}</div> : null}
          {desk.messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              agentName={agent.displayName}
              run={message.role === 'assistant' ? chatRuns.get(message.id) ?? null : null}
              unconfirmed={unconfirmed && unconfirmed.messageId === message.id ? unconfirmed.request : null}
            />
          ))}
          {desk.streaming ? <div className="nd-bubble" data-role="assistant" data-streaming="true">{desk.streaming.text}</div> : null}
          {liveTools.length > 0 ? (
            <div className="nd-chat-notice">{copy.assistant.liveTool(liveTools.map((tool) => copy.skills.toolNames[tool.name] ?? tool.name).join('、'))}</div>
          ) : null}
          {desk.lastOutcome && desk.lastOutcome.kind !== 'completed' && !replying ? (
            <div className="nd-chat-notice">
              {desk.lastOutcome.kind === 'failed' ? copy.assistant.failed(agent.displayName) : copy.assistant.interrupted}
              {desk.lastOutcome.detail ? (
                <details className="nd-faint"><summary>{copy.assistant.technical}</summary>{desk.lastOutcome.detail}</details>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="nd-composer">
        <div className="nd-composer-inner">
          <div className="nd-composer-row">
            <textarea
              value={draft}
              rows={Math.min(6, Math.max(1, draft.split('\n').length))}
              placeholder={recording === 'recording' ? copy.assistant.recording : recording === 'transcribing' ? copy.assistant.transcribing : copy.assistant.placeholder(agent.displayName)}
              aria-label={copy.assistant.placeholder(agent.displayName)}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <IconButton
              tone={recording === 'recording' ? 'danger' : 'ghost'}
              icon={recording === 'recording' ? <Square size={16} aria-hidden="true" /> : <Mic size={16} aria-hidden="true" />}
              aria-label={copy.assistant.voiceInput}
              title={copy.assistant.voiceInput}
              disabled={recording === 'transcribing'}
              onClick={() => { void toggleVoiceInput(); }}
            />
            {replying && ownTurn ? (
              <Button tone="secondary" onClick={() => { void engine.stopActive(desk.activeTurnId!); }}>{copy.assistant.stop}</Button>
            ) : replying ? (
              <Button tone="secondary" disabled>{copy.assistant.busyElsewhere(agent.displayName)}</Button>
            ) : (
              <Button tone="primary" leadingIcon={<Send size={15} aria-hidden="true" />} disabled={!draft.trim() || sending} loading={sending} onClick={() => { void send(); }}>{copy.assistant.send}</Button>
            )}
          </div>
          <div className="nd-inline-actions">
            <button type="button" className="nd-link nd-link-icon" onClick={shareToday}>
              <CalendarPlus size={13} aria-hidden="true" />{copy.assistant.shareToday}
            </button>
          </div>
        </div>
      </div>

      {voiceOpen ? (
        <Dialog open onOpenChange={(open) => { if (!open) setVoiceOpen(false); }}>
          <DialogContent onClose={() => setVoiceOpen(false)} data-testid="nd-voice-dialog">
            <DialogHeader><DialogTitle>{copy.voice.title(agent.displayName)}</DialogTitle></DialogHeader>
            <DialogBody>
              <VoicePanel
                agentHandle={agent.agentHandle}
                agentName={agent.displayName}
                avatarUrl={agent.avatarUrl}
                conversationAnchorId={desk.anchorId}
              />
            </DialogBody>
          </DialogContent>
        </Dialog>
      ) : null}

      {switchPrompt ? (
        <Dialog open onOpenChange={(open) => { if (!open) { switchPrompt(false); setSwitchPrompt(null); } }}>
          <DialogContent onClose={() => { switchPrompt(false); setSwitchPrompt(null); }}>
            <DialogHeader><DialogTitle>{copy.assistant.avatarSwitchTitle}</DialogTitle></DialogHeader>
            <DialogBody><p style={{ margin: 0 }}>{copy.assistant.avatarSwitchBody(agent.displayName)}</p></DialogBody>
            <DialogFooter>
              <Button tone="secondary" size="sm" onClick={() => { switchPrompt(false); setSwitchPrompt(null); }}>{copy.common.cancel}</Button>
              <Button tone="primary" size="sm" onClick={() => { switchPrompt(true); setSwitchPrompt(null); }}>{copy.assistant.avatarSwitch}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
