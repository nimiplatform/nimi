import type { AvatarLive2dViewportComponentProps } from '@nimiplatform/kit/features/avatar/live2d';
import { cn } from '@nimiplatform/kit/ui';
import type { ChatAgentAvatarFramingIntent } from './chat-agent-avatar-framing-intent';
import type {
  ChatAgentAvatarLive2dDiagnostic,
  Live2dViewportStatus,
} from './chat-agent-avatar-live2d-diagnostics';
import { useChatAgentAvatarLive2dRuntime } from './chat-agent-avatar-live2d-runtime-hook';
import { Live2dErrorShell, Live2dLoadingShell } from './chat-agent-avatar-live2d-shells';

type ChatAgentAvatarLive2dViewportProps = AvatarLive2dViewportComponentProps & {
  onLoadStateChange?: (status: Live2dViewportStatus) => void;
  onLoadErrorChange?: (error: string | null) => void;
  onDiagnosticChange?: (diagnostic: ChatAgentAvatarLive2dDiagnostic) => void;
  framingIntent?: ChatAgentAvatarFramingIntent;
};

export default function ChatAgentAvatarLive2dViewport({
  input,
  chrome = 'default',
  onLoadStateChange,
  onLoadErrorChange,
  onDiagnosticChange,
  framingIntent = 'conversation',
}: ChatAgentAvatarLive2dViewportProps) {
  const { hostRef, loadState, viewportState } = useChatAgentAvatarLive2dRuntime({
    input,
    chrome,
    onLoadStateChange,
    onLoadErrorChange,
    onDiagnosticChange,
    framingIntent,
  });

  return (
    <div
      className={cn(
        'relative h-full w-full overflow-hidden',
        chrome === 'minimal' ? 'bg-transparent' : 'rounded-[28px]',
      )}
      data-avatar-live2d-status={loadState.status}
      data-avatar-live2d-phase={viewportState.phase}
      data-avatar-live2d-emotion={viewportState.emotion}
      data-avatar-live2d-asset={viewportState.assetLabel}
    >
      {chrome === 'minimal' ? null : (
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.12),transparent_26%,rgba(255,255,255,0.10))]" />
      )}
      <div ref={hostRef} className="relative z-[1] h-full w-full" />
      {loadState.status === 'loading' ? <Live2dLoadingShell label={input.label} transparent={chrome === 'minimal'} /> : null}
      {loadState.status === 'error' ? (
        <Live2dErrorShell
          label={input.label}
          errorMessage={loadState.error || 'Live2D model failed to load'}
          posterUrl={input.posterUrl}
          transparent={chrome === 'minimal'}
        />
      ) : null}
      {chrome === 'minimal' || viewportState.phase === 'idle' ? null : (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] flex justify-center pb-4">
          <span className="rounded-full border border-white/80 bg-slate-950/84 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-white shadow-[0_10px_24px_rgba(15,23,42,0.18)]">
            {viewportState.badgeLabel}
          </span>
        </div>
      )}
    </div>
  );
}
