import { Pause, Play, Square, X, LocateFixed } from 'lucide-react';
import { Button, IconButton } from '@nimiplatform/kit/ui';
import type { LocalAppConversationPlayback } from '../runtime/local-app-conversation-playback.js';
import { resolveChatCopy, type ChatCopy } from '../copy.js';

export type LocalAppConversationPlayerProps = {
  playback: LocalAppConversationPlayback;
  copy?: ChatCopy;
  onLocateMessage?: (messageId: string) => void;
  onOpenSettings?: () => void;
  className?: string;
  placement?: 'inline' | 'floating';
};
function time(seconds: number) { const value = Math.max(0, Math.floor(seconds)); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`; }

export function LocalAppConversationPlayer({ playback, copy, onLocateMessage, onOpenSettings, className, placement = 'floating' }: LocalAppConversationPlayerProps) {
  const labels = resolveChatCopy(copy);
  const { state } = playback;
  if (!state.messageId || state.status === 'idle' || state.realtimeBlocked) return null;
  if (placement === 'floating' && state.sourceVisible) return null;
  // Keep the offscreen inline view's geometry stable while the floating view
  // is visible. Both are projections of this one controller, never two audios.
  const pending = state.status === 'preparing';
  const playable = ['ready', 'playing', 'paused'].includes(state.status);
  const hasPlayback = state.status === 'playing' || state.status === 'paused';
  const stopLabel = pending ? labels.voiceStopWaitingLabel : hasPlayback ? labels.voiceStopLabel : labels.voiceCloseLabel;
  return <div className={className} data-canonical-message-player={state.messageId}>
    <div className="flex flex-wrap items-center gap-2 rounded-[var(--nimi-radius-sm)] bg-[var(--nimi-surface-panel)] px-3 py-2 text-[var(--nimi-text-secondary)]">
      {onLocateMessage ? <IconButton size="sm" tone="ghost" aria-label={labels.voiceLocateLabel} icon={<LocateFixed size={16} />} onClick={() => onLocateMessage(state.messageId!)} /> : null}
      {pending ? <span role="status" className="text-xs">{labels.voicePreparingLabel}</span> : null}
      {playable ? <>
        <IconButton size="sm" tone="ghost" aria-label={state.status === 'playing' ? labels.voicePauseLabel : state.status === 'paused' ? labels.voiceResumeLabel : labels.voicePlayLabel}
          icon={state.status === 'playing' ? <Pause size={16} /> : <Play size={16} />}
          onClick={() => { if (state.status === 'playing') playback.pause(); else if (state.status === 'paused') void playback.resume(); else if (state.message) void playback.play(state.message); }} />
        <input type="range" aria-label={labels.voiceProgressLabel} min={0} max={state.duration || 1} step={0.1} value={Math.min(state.position, state.duration || 1)} disabled={!state.duration}
          onChange={event => playback.seek(Number(event.currentTarget.value))} className="min-w-20 flex-1 accent-[var(--nimi-action-primary-bg)]" />
        <span className="text-xs tabular-nums">{time(state.position)} / {time(state.duration)}</span>
      </> : null}
      {state.status === 'error' ? <>
        <span role="status" className="basis-full text-xs">{state.phase === 'generation' ? labels.voiceGenerationFailedLabel : state.phase === 'read' ? labels.voiceReadFailedLabel : labels.voicePlaybackFailedLabel}</span>
        <Button size="sm" tone="ghost" onClick={() => void playback.retry()}>{state.phase === 'generation' ? labels.voiceRegenerateLabel : labels.voiceRetryPlaybackLabel}</Button>
        {state.phase === 'generation' && onOpenSettings ? <Button size="sm" tone="ghost" onClick={onOpenSettings}>{labels.voiceSettingsLabel}</Button> : null}
      </> : null}
      {state.status === 'unknown' ? <>
        <span role="status" className="basis-full text-xs">{labels.voiceResultUnknownLabel}</span>
        <Button size="sm" tone="ghost" onClick={() => void playback.refresh()}>{labels.voiceRefreshLabel}</Button>
        <Button size="sm" tone="ghost" onClick={() => void playback.continueRequest()}>{labels.voiceContinueRequestLabel}</Button>
        <span className="basis-full text-xs">{labels.voiceContinueRequestHint}</span>
      </> : null}
      <IconButton size="sm" tone="ghost" aria-label={stopLabel} title={stopLabel} icon={hasPlayback ? <Square size={14} /> : <X size={16} />} onClick={playback.stop} />
    </div>
  </div>;
}
