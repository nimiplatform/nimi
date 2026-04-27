import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@nimiplatform/nimi-kit/ui';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import {
  buildDesktopAvatarEphemeralInstanceId,
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
  defaultLaunchTarget?: 'current' | 'new';
};

type LaunchFeedbackTone = 'success' | 'warning' | 'error';

type LaunchFeedback = {
  tone: LaunchFeedbackTone;
  message: string;
};

function LaunchDetailRow(props: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-sky-700/70">
        {props.label}
      </span>
      <span className="max-w-[65%] break-all text-right text-xs text-slate-700">
        {props.value}
      </span>
    </div>
  );
}

export function ChatAgentAvatarAppLauncher(props: ChatAgentAvatarAppLauncherProps) {
  const { t } = useTranslation();
  const [pendingAction, setPendingAction] = useState<'current' | 'new' | null>(null);
  const [feedback, setFeedback] = useState<LaunchFeedback | null>(null);
  const tauriReady = hasTauriInvoke();
  const anchorMode = props.activeConversationAnchorId ? 'existing' : 'open_new';
  const avatarInstanceId = useMemo(() => buildDesktopAvatarInstanceId({
    agentId: props.selectedTarget.id,
    threadId: props.activeThreadId,
    conversationAnchorId: props.activeConversationAnchorId,
  }), [props.activeConversationAnchorId, props.activeThreadId, props.selectedTarget.id]);
  const anchorModeLabel = anchorMode === 'existing'
    ? t('Chat.avatarLaunchModeExisting', { defaultValue: 'Continue current anchor' })
    : t('Chat.avatarLaunchModeOpenNew', { defaultValue: 'Open new anchor' });
  const continuityLabel = anchorMode === 'existing'
    ? (props.activeConversationAnchorId || t('Chat.avatarLaunchContinuityThread', { defaultValue: 'Reuse current thread continuity' }))
    : t('Chat.avatarLaunchContinuityOpenNew', { defaultValue: 'Launch asks Nimi Avatar to create a fresh explicit anchor.' });
  const launchReadinessLabel = tauriReady
    ? t('Chat.avatarLaunchReadyPill', { defaultValue: 'Desktop handoff ready' })
    : t('Chat.avatarLaunchUnavailablePill', { defaultValue: 'Desktop runtime required' });
  const newCompanionInstanceId = useMemo(() => buildDesktopAvatarEphemeralInstanceId({
    agentId: props.selectedTarget.id,
    threadId: props.activeThreadId,
    conversationAnchorId: props.activeConversationAnchorId,
  }), [props.activeConversationAnchorId, props.activeThreadId, props.selectedTarget.id]);
  const feedbackToneClass = feedback?.tone === 'success'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : feedback?.tone === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-red-200 bg-red-50 text-red-700';
  const primaryLaunchTarget = props.defaultLaunchTarget === 'new' ? 'new' : 'current';
  const secondaryLaunchTarget = primaryLaunchTarget === 'current' ? 'new' : 'current';

  const launchWithInstanceId = (instanceId: string, mode: 'current' | 'new') => {
    setPendingAction(mode);
    setFeedback(null);
    void launchDesktopAvatarHandoff({
      agentId: props.selectedTarget.id,
      avatarInstanceId: instanceId,
      conversationAnchorId: props.activeConversationAnchorId,
      anchorMode,
      launchedBy: 'nimi.desktop',
      runtimeAppId: 'nimi.desktop',
      sourceSurface: 'desktop-agent-chat',
    })
      .then((result) => {
        setFeedback(result.opened
          ? {
            tone: 'success',
            message: mode === 'new'
              ? t('Chat.avatarLaunchOpenedNewFeedback', {
                defaultValue: 'Desktop sent a new companion handoff to Nimi Avatar.',
              })
              : t('Chat.avatarLaunchOpenedFeedback', {
                defaultValue: 'Desktop sent the handoff to Nimi Avatar for this chat.',
              }),
          }
          : {
            tone: 'warning',
            message: t('Chat.avatarLaunchUnconfirmedFeedback', {
              defaultValue: 'Desktop prepared the handoff, but the OS did not confirm that Nimi Avatar opened.',
            }),
          });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error || '');
        setFeedback({
          tone: 'error',
          message: message.trim()
            ? t('Chat.avatarLaunchFailedFeedbackWithReason', {
              defaultValue: 'Could not open Nimi Avatar: {{message}}',
              message,
            })
            : t('Chat.avatarLaunchFailedFeedback', {
              defaultValue: 'Could not open Nimi Avatar.',
            }),
        });
      })
      .finally(() => {
        setPendingAction(null);
      });
  };

  const renderLaunchButton = (target: 'current' | 'new', tone: 'primary' | 'secondary') => {
    const isCurrent = target === 'current';
    const buttonTone = tone === 'primary' ? undefined : 'secondary';
    return (
      <Button
        tone={buttonTone}
        disabled={!tauriReady || pendingAction !== null}
        data-testid={isCurrent ? E2E_IDS.chatAvatarLaunchCurrentButton : E2E_IDS.chatAvatarLaunchNewButton}
        onClick={() => {
          launchWithInstanceId(isCurrent ? avatarInstanceId : newCompanionInstanceId, target);
        }}
        size="sm"
      >
        {target === 'current'
          ? pendingAction === 'current'
            ? t('Chat.avatarLaunchActionPending', { defaultValue: 'Opening…' })
            : t('Chat.avatarLaunchAction', { defaultValue: 'Open in Nimi Avatar' })
          : pendingAction === 'new'
            ? t('Chat.avatarLaunchNewActionPending', { defaultValue: 'Opening new…' })
            : t('Chat.avatarLaunchNewAction', { defaultValue: 'Open New Companion' })}
      </Button>
    );
  };

  return (
    <div
      className="rounded-2xl border border-sky-200/80 bg-sky-50/80 p-4 text-left shadow-[0_16px_32px_rgba(15,23,42,0.06)]"
      data-testid={E2E_IDS.chatAvatarLaunchCard}
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-700">
            {t('Chat.avatarLaunchCardEyebrow', { defaultValue: 'Companion Launch' })}
          </p>
          <span className="rounded-full border border-sky-200 bg-white/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-700">
            {launchReadinessLabel}
          </span>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-900">
            {t('Chat.avatarLaunchCardTitle', {
              defaultValue: 'Desktop sends an explicit handoff to Nimi Avatar for this chat.',
            })}
          </p>
          <p className="text-xs leading-5 text-slate-600">
            {t('Chat.avatarLaunchCardDescription', {
              defaultValue: 'This launch path stays desktop-owned. It targets {{name}} with an explicit avatar instance id and anchor mode instead of falling back to a default companion.',
              name: props.selectedTarget.title,
            })}
          </p>
        </div>
        <div className="space-y-2 rounded-2xl border border-sky-100 bg-white/80 p-3">
          <LaunchDetailRow
            label={t('Chat.avatarLaunchTargetLabel', { defaultValue: 'Agent' })}
            value={props.selectedTarget.title}
          />
          <LaunchDetailRow
            label={t('Chat.avatarLaunchModeLabel', { defaultValue: 'Anchor mode' })}
            value={anchorModeLabel}
          />
          <LaunchDetailRow
            label={t('Chat.avatarLaunchContinuityLabel', { defaultValue: 'Continuity' })}
            value={continuityLabel}
          />
          <LaunchDetailRow
            label={t('Chat.avatarLaunchInstanceLabel', { defaultValue: 'Instance ID' })}
            value={avatarInstanceId}
          />
        </div>
        {!tauriReady ? (
          <div className="rounded-xl border border-dashed border-sky-200 bg-white/70 px-3 py-2 text-xs text-slate-600">
            {t('Chat.avatarLaunchRuntimeOnlyNote', {
              defaultValue: 'This launcher only works inside the desktop shell runtime. Desktop web previews can show the targeting state, but cannot send the handoff.',
            })}
          </div>
        ) : null}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {renderLaunchButton(primaryLaunchTarget, 'primary')}
        {renderLaunchButton(secondaryLaunchTarget, 'secondary')}
      </div>
      {feedback ? (
        <div className={`mt-3 rounded-xl border px-3 py-2 text-xs ${feedbackToneClass}`}>
          {feedback.message}
        </div>
      ) : null}
    </div>
  );
}
