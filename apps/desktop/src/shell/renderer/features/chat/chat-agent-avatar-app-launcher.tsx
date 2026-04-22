import { useMemo, useState } from 'react';
import { Button } from '@nimiplatform/nimi-kit/ui';
import {
  buildDesktopAvatarInstanceId,
  launchDesktopAvatarHandoff,
} from '@renderer/bridge/runtime-bridge/chat-agent-avatar-launcher';
import { hasTauriInvoke } from '@renderer/bridge/runtime-bridge/env';

export type ChatAgentAvatarAppLauncherProps = {
  selectedTarget: {
    id: string;
    title: string;
  };
  activeThreadId: string | null;
  activeConversationAnchorId: string | null;
};

export function ChatAgentAvatarAppLauncher(props: ChatAgentAvatarAppLauncherProps) {
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const tauriReady = hasTauriInvoke();
  const anchorMode = props.activeConversationAnchorId ? 'existing' : 'open_new';
  const avatarInstanceId = useMemo(() => buildDesktopAvatarInstanceId({
    agentId: props.selectedTarget.id,
    threadId: props.activeThreadId,
    conversationAnchorId: props.activeConversationAnchorId,
  }), [props.activeConversationAnchorId, props.activeThreadId, props.selectedTarget.id]);

  return (
    <div className="rounded-2xl border border-sky-200/80 bg-sky-50/80 p-4 text-left shadow-[0_16px_32px_rgba(15,23,42,0.06)]">
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-700">
          Avatar App Bridge
        </p>
        <p className="text-sm font-medium text-slate-900">
          Avatar carrier execution now lives in Nimi Avatar. Desktop chat launches and targets the active avatar instance.
        </p>
        <p className="text-xs leading-5 text-slate-600">
          Launch context is explicit: <code>{props.selectedTarget.id}</code> · <code>{avatarInstanceId}</code> ·{' '}
          {anchorMode === 'existing'
            ? `reuse anchor ${props.activeConversationAnchorId}`
            : 'open a new anchor for this agent'}
        </p>
        <p className="text-xs leading-5 text-slate-500">
          Desktop-local Live2D / VRM rendering and binding are retired. Desktop now only launches and targets the avatar app handoff path.
        </p>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          disabled={!tauriReady || pending}
          onClick={() => {
            setPending(true);
            setFeedback(null);
            void launchDesktopAvatarHandoff({
              agentId: props.selectedTarget.id,
              avatarInstanceId,
              conversationAnchorId: props.activeConversationAnchorId,
              anchorMode,
              launchedBy: 'desktop',
              sourceSurface: 'desktop-agent-chat',
            })
              .then(() => {
                setFeedback('Avatar app handoff opened.');
              })
              .catch((error: unknown) => {
                setFeedback(error instanceof Error ? error.message : String(error));
              })
              .finally(() => {
                setPending(false);
              });
          }}
          size="sm"
        >
          {pending ? 'Opening Avatar…' : 'Open In Nimi Avatar'}
        </Button>
        {feedback ? (
          <span className="text-xs text-slate-600">{feedback}</span>
        ) : null}
      </div>
    </div>
  );
}
