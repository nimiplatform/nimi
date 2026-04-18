import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@nimiplatform/nimi-kit/ui';
import type { ConversationCharacterData, ConversationTargetSummary } from '@nimiplatform/nimi-kit/features/chat/headless';
import { useTranslation } from 'react-i18next';
import {
  desktopAgentAvatarBindingQueryKey,
  desktopAgentAvatarResourcesQueryKey,
  getDesktopAgentAvatarBinding,
  listDesktopAgentAvatarResources,
} from '@renderer/bridge/runtime-bridge/chat-agent-avatar-store';
import { hasTauriInvoke } from '@renderer/bridge/runtime-bridge/env';
import { ChatAgentAvatarStageViewport } from './chat-agent-avatar-stage-viewport';
import {
  createIdleChatAgentAvatarPointerInteractionState,
  resolveChatAgentAvatarPointerInteractionScopeKey,
  resolveChatAgentAvatarPointerInteraction,
  shouldUpdateChatAgentAvatarPointerInteraction,
} from './chat-agent-avatar-pointer-interaction';
import {
  CHAT_AGENT_AVATAR_SMOKE_OVERRIDE_EVENT,
  resolveChatAgentAvatarStageRenderModel,
  resolveChatAgentLiveAvatarRailModel,
} from './chat-agent-live-avatar-rail-model';
import {
  type ChatRightPanelHandsFreeState,
} from './chat-right-panel-character-rail';
import { ChatRightPanelSettings } from './chat-right-panel-settings';
import { ChatRightColumn, ChatRightColumnCard, ChatRightColumnCardTitle } from './chat-right-column-primitives';
import type { ChatAgentAvatarLive2dDiagnostic } from './chat-agent-avatar-live2d-diagnostics';
import type { ChatAgentAvatarVrmDiagnostic } from './chat-agent-avatar-vrm-viewport';

export type ChatRightPanelAvatarStageRailProps = {
  selectedTarget: ConversationTargetSummary;
  characterData?: ConversationCharacterData | null;
  onToggleSettings: () => void;
  settingsActive: boolean;
  thinkingState?: 'on' | 'off' | 'unsupported';
  onThinkingToggle?: () => void;
  onToggleFold?: () => void;
  handsFreeState?: ChatRightPanelHandsFreeState;
  settingsContent?: ReactNode;
};

export type ChatAgentAvatarLive2dDiagnosticPanelModel = {
  kind: 'recovery' | 'error';
  message: string;
  toneClassName: string;
  detailClassName: string;
  details: string[];
};

export type ChatAgentAvatarVrmDiagnosticPanelModel = {
  kind: 'loading' | 'error';
  message: string;
  toneClassName: string;
  detailClassName: string;
  details: string[];
};

export function resolveChatAgentAvatarLive2dDiagnosticPanelModel(input: {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  diagnostic: ChatAgentAvatarLive2dDiagnostic | null;
}): ChatAgentAvatarLive2dDiagnosticPanelModel | null {
  const { diagnostic } = input;
  if (input.status === 'error' && input.error) {
    return {
      kind: 'error',
      message: input.error,
      toneClassName: 'border-amber-200/80 bg-amber-50/90 text-amber-900',
      detailClassName: 'border-amber-200/80 bg-white/70 text-slate-700',
      details: [
        diagnostic ? `backend=${diagnostic.backendKind} status=${diagnostic.status} stage=${diagnostic.stage}` : null,
        diagnostic ? `resourceId=${diagnostic.resourceId || 'none'}` : null,
        diagnostic ? `mocVersion=${diagnostic.mocVersion ?? 'unknown'}` : null,
        diagnostic ? `cubismCore=${diagnostic.cubismCoreAvailable ? 'available' : 'missing'}` : null,
        diagnostic ? `assetRef=${diagnostic.assetRef}` : null,
        diagnostic?.idleMotionGroup ? `idleMotionGroup=${diagnostic.idleMotionGroup}` : null,
        diagnostic?.speechMotionGroup ? `speechMotionGroup=${diagnostic.speechMotionGroup}` : null,
        diagnostic && diagnostic.motionGroups.length > 0
          ? `motionGroups=${diagnostic.motionGroups.join(',')}`
          : null,
        diagnostic?.recoveryReason ? `recoveryReason=${diagnostic.recoveryReason}` : null,
        diagnostic && diagnostic.recoveryAttemptCount > 0
          ? `recoveryAttemptCount=${diagnostic.recoveryAttemptCount}`
          : null,
        diagnostic?.fileUrl ? `fileUrl=${diagnostic.fileUrl}` : null,
        diagnostic?.modelUrl ? `modelUrl=${diagnostic.modelUrl}` : null,
        diagnostic?.error ? `error=${diagnostic.error}` : null,
        diagnostic?.errorUrl ? `errorUrl=${diagnostic.errorUrl}` : null,
        diagnostic?.errorStatus !== null && diagnostic?.errorStatus !== undefined
          ? `errorStatus=${diagnostic.errorStatus}`
          : null,
        ...(diagnostic?.assetProbeFailures ?? []).map((failure) => `probe=${failure}`),
      ].filter((value): value is string => Boolean(value)),
    };
  }

  if (input.status === 'loading' && diagnostic && diagnostic.recoveryAttemptCount > 0) {
    return {
      kind: 'recovery',
      message: 'Recovering Live2D viewport',
      toneClassName: 'border-sky-200/80 bg-sky-50/90 text-sky-950',
      detailClassName: 'border-sky-200/80 bg-white/70 text-slate-700',
      details: [
        `backend=${diagnostic.backendKind} status=${diagnostic.status} stage=${diagnostic.stage}`,
        `resourceId=${diagnostic.resourceId || 'none'}`,
        `mocVersion=${diagnostic.mocVersion ?? 'unknown'}`,
        diagnostic.recoveryReason ? `recoveryReason=${diagnostic.recoveryReason}` : null,
        `recoveryAttemptCount=${diagnostic.recoveryAttemptCount}`,
        diagnostic.idleMotionGroup ? `idleMotionGroup=${diagnostic.idleMotionGroup}` : null,
        diagnostic.speechMotionGroup ? `speechMotionGroup=${diagnostic.speechMotionGroup}` : null,
        diagnostic.motionGroups.length > 0 ? `motionGroups=${diagnostic.motionGroups.join(',')}` : null,
        ...diagnostic.assetProbeFailures.map((failure) => `probe=${failure}`),
      ].filter((value): value is string => Boolean(value)),
    };
  }

  return null;
}

export function resolveChatAgentAvatarVrmDiagnosticPanelModel(input: {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  diagnostic: ChatAgentAvatarVrmDiagnostic | null;
}): ChatAgentAvatarVrmDiagnosticPanelModel | null {
  const { diagnostic } = input;
  if (!diagnostic) {
    return null;
  }

  if (input.status === 'error' && input.error) {
    return {
      kind: 'error',
      message: input.error,
      toneClassName: 'border-amber-200/80 bg-amber-50/90 text-amber-900',
      detailClassName: 'border-amber-200/80 bg-white/70 text-slate-700',
      details: [
        `backend=${diagnostic.backendKind} status=${diagnostic.status} stage=${diagnostic.stage}`,
        `source=${diagnostic.source}`,
        diagnostic.resourceId ? `resourceId=${diagnostic.resourceId}` : null,
        diagnostic.assetLabel ? `assetLabel=${diagnostic.assetLabel}` : null,
        `assetRef=${diagnostic.assetRef || 'none'}`,
        diagnostic.assetUrl ? `assetUrl=${diagnostic.assetUrl}` : null,
        diagnostic.networkAssetUrl ? `networkAssetUrl=${diagnostic.networkAssetUrl}` : null,
        diagnostic.posterUrl ? `posterUrl=${diagnostic.posterUrl}` : null,
        `resizePosture=${diagnostic.resizePosture}`,
        `hostRenderable=${diagnostic.hostRenderable ? 'true' : 'false'}`,
        `viewport=${diagnostic.viewportWidth}x${diagnostic.viewportHeight}`,
        `canvasEpoch=${diagnostic.canvasEpoch}`,
        diagnostic.recoveryReason ? `recoveryReason=${diagnostic.recoveryReason}` : null,
        diagnostic.recoveryAttemptCount > 0 ? `recoveryAttemptCount=${diagnostic.recoveryAttemptCount}` : null,
        diagnostic.error ? `error=${diagnostic.error}` : null,
      ].filter((value): value is string => Boolean(value)),
    };
  }

  if (input.status === 'loading') {
    const message = diagnostic.recoveryAttemptCount > 0
      ? 'Recovering VRM viewport'
      : !diagnostic.hostRenderable && diagnostic.stage === 'ready'
        ? 'Waiting for renderable VRM host'
        : diagnostic.stage === 'asset-resolve'
          ? 'Resolving VRM asset'
          : 'Loading VRM viewport';
    return {
      kind: 'loading',
      message,
      toneClassName: 'border-sky-200/80 bg-sky-50/90 text-sky-950',
      detailClassName: 'border-sky-200/80 bg-white/70 text-slate-700',
      details: [
        `backend=${diagnostic.backendKind} status=${diagnostic.status} stage=${diagnostic.stage}`,
        `source=${diagnostic.source}`,
        diagnostic.resourceId ? `resourceId=${diagnostic.resourceId}` : null,
        diagnostic.assetLabel ? `assetLabel=${diagnostic.assetLabel}` : null,
        `assetRef=${diagnostic.assetRef || 'none'}`,
        diagnostic.assetUrl ? `assetUrl=${diagnostic.assetUrl}` : null,
        diagnostic.networkAssetUrl ? `networkAssetUrl=${diagnostic.networkAssetUrl}` : null,
        `resizePosture=${diagnostic.resizePosture}`,
        `hostRenderable=${diagnostic.hostRenderable ? 'true' : 'false'}`,
        `viewport=${diagnostic.viewportWidth}x${diagnostic.viewportHeight}`,
        `canvasEpoch=${diagnostic.canvasEpoch}`,
        diagnostic.recoveryReason ? `recoveryReason=${diagnostic.recoveryReason}` : null,
        diagnostic.recoveryAttemptCount > 0 ? `recoveryAttemptCount=${diagnostic.recoveryAttemptCount}` : null,
      ].filter((value): value is string => Boolean(value)),
    };
  }

  return null;
}

export function ChatRightPanelAvatarStageRail(props: ChatRightPanelAvatarStageRailProps) {
  const { t } = useTranslation();
  const [pointerInteraction, setPointerInteraction] = useState(
    () => createIdleChatAgentAvatarPointerInteractionState(),
  );
  const [live2dLoadStatus, setLive2dLoadStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [live2dLoadError, setLive2dLoadError] = useState<string | null>(null);
  const [live2dDiagnostic, setLive2dDiagnostic] = useState<ChatAgentAvatarLive2dDiagnostic | null>(null);
  const [vrmLoadStatus, setVrmLoadStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [vrmLoadError, setVrmLoadError] = useState<string | null>(null);
  const [vrmDiagnostic, setVrmDiagnostic] = useState<ChatAgentAvatarVrmDiagnostic | null>(null);
  const [, setSmokeOverrideVersion] = useState(0);
  const avatarResourcesQuery = useQuery({
    queryKey: desktopAgentAvatarResourcesQueryKey(),
    queryFn: listDesktopAgentAvatarResources,
    enabled: hasTauriInvoke(),
    staleTime: 30_000,
  });
  const avatarBindingQuery = useQuery({
    queryKey: desktopAgentAvatarBindingQueryKey(props.selectedTarget.id),
    queryFn: async () => getDesktopAgentAvatarBinding(props.selectedTarget.id),
    enabled: hasTauriInvoke(),
    staleTime: 30_000,
  });
  const localResource = useMemo(
    () => avatarBindingQuery.data
      ? avatarResourcesQuery.data?.find((item) => item.resourceId === avatarBindingQuery.data?.resourceId) || null
      : null,
    [avatarBindingQuery.data, avatarResourcesQuery.data],
  );
  const pointerInteractionScopeKey = resolveChatAgentAvatarPointerInteractionScopeKey({
    targetId: props.selectedTarget.id,
    canonicalSessionId: props.selectedTarget.canonicalSessionId,
  });
  const railModel = resolveChatAgentLiveAvatarRailModel({
    selectedTarget: props.selectedTarget,
    characterData: props.characterData,
    localResource,
    pointerInteraction,
  });
  const stageRenderModel = resolveChatAgentAvatarStageRenderModel({
    railModel,
    loadStatus: {
      live2d: live2dLoadStatus,
      vrm: vrmLoadStatus,
    },
  });
  const phase = railModel.snapshot.interaction.phase;
  const dockBusy = phase === 'thinking' || phase === 'speaking' || phase === 'listening';
  const live2dDiagnosticPanel = resolveChatAgentAvatarLive2dDiagnosticPanelModel({
    status: live2dLoadStatus,
    error: live2dLoadError,
    diagnostic: live2dDiagnostic,
  });
  const vrmDiagnosticPanel = resolveChatAgentAvatarVrmDiagnosticPanelModel({
    status: vrmLoadStatus,
    error: vrmLoadError,
    diagnostic: vrmDiagnostic,
  });

  useEffect(() => {
    setPointerInteraction(createIdleChatAgentAvatarPointerInteractionState());
  }, [pointerInteractionScopeKey]);

  useEffect(() => {
    setLive2dLoadStatus('idle');
    setLive2dLoadError(null);
    setLive2dDiagnostic(null);
    setVrmLoadStatus('idle');
    setVrmLoadError(null);
    setVrmDiagnostic(null);
  }, [
    railModel.presentation.backendKind,
    railModel.presentation.avatarAssetRef,
  ]);

  useEffect(() => {
    const handleSmokeOverrideChange = () => {
      setSmokeOverrideVersion((current) => current + 1);
    };
    window.addEventListener(CHAT_AGENT_AVATAR_SMOKE_OVERRIDE_EVENT, handleSmokeOverrideChange);
    return () => {
      window.removeEventListener(CHAT_AGENT_AVATAR_SMOKE_OVERRIDE_EVENT, handleSmokeOverrideChange);
    };
  }, []);

  function handlePointerStageMove(event: ReactPointerEvent<HTMLDivElement>) {
    const nextInteraction = resolveChatAgentAvatarPointerInteraction({
      clientX: event.clientX,
      clientY: event.clientY,
      rect: event.currentTarget.getBoundingClientRect(),
    });
    setPointerInteraction((current) => (
      shouldUpdateChatAgentAvatarPointerInteraction(current, nextInteraction)
        ? nextInteraction
        : current
    ));
  }

  function handlePointerStageLeave() {
    setPointerInteraction(createIdleChatAgentAvatarPointerInteractionState());
  }

  return (
    <ChatRightColumn data-chat-mode-column="agent">
      <ChatRightColumnCard cardKey="primary" className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-[-36px] top-[-20px] h-40 w-40 rounded-full bg-mint-100/45 blur-3xl" />
          <div className="absolute bottom-10 right-[-30px] h-44 w-44 rounded-full bg-sky-100/45 blur-3xl" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.22),transparent_22%,transparent_78%,rgba(255,255,255,0.18))]" />
        </div>
        <div
          className="relative flex min-h-0 flex-1 overflow-hidden"
          data-avatar-stage-viewport="true"
          data-avatar-stage-pointer-enabled="true"
          data-avatar-stage-hovered={pointerInteraction.hovered ? 'true' : 'false'}
          onPointerEnter={handlePointerStageMove}
          onPointerMove={handlePointerStageMove}
          onPointerLeave={handlePointerStageLeave}
          onPointerCancel={handlePointerStageLeave}
        >
          <span className="pointer-events-none absolute inset-x-10 top-6 h-px bg-gradient-to-r from-transparent via-white/60 to-transparent" />
          <span className="pointer-events-none absolute inset-x-6 bottom-5 h-10 rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.08),transparent_72%)] blur-2xl" />
          <ChatAgentAvatarStageViewport
            stage={stageRenderModel}
            onVrmLoadStateChange={(status) => {
              setVrmLoadStatus((current) => {
                if (current === status) {
                  return current;
                }
                return status;
              });
            }}
            onVrmLoadErrorChange={setVrmLoadError}
            onVrmDiagnosticChange={setVrmDiagnostic}
            onLive2dLoadStateChange={(status) => {
              setLive2dLoadStatus((current) => {
                if (current === status) {
                  return current;
                }
                return status;
              });
            }}
            onLive2dLoadErrorChange={setLive2dLoadError}
            onLive2dDiagnosticChange={setLive2dDiagnostic}
          />
        </div>
      </ChatRightColumnCard>

      <ChatRightColumnCard cardKey="status" className="px-4 py-4 text-center">
        <div className="flex items-center justify-center gap-2">
          <span className={cn('inline-block h-2.5 w-2.5 rounded-full bg-emerald-500/90', dockBusy ? 'animate-pulse' : '')} />
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-700/72">
            {railModel.statusLabel}
          </p>
        </div>
        <p className="mt-2.5 text-[1.75rem] font-black leading-tight tracking-tight text-slate-950">
          {railModel.displayName}
        </p>
        {props.selectedTarget.handle ? (
          <p className="mt-1 text-xs font-medium text-slate-500">{props.selectedTarget.handle}</p>
        ) : null}
        {live2dDiagnosticPanel ? (
          <div
            className={cn(
              'mt-2 space-y-2 rounded-2xl border px-3 py-2.5 text-left text-[11px] leading-5',
              live2dDiagnosticPanel.toneClassName,
            )}
            data-live2d-fallback-reason={live2dDiagnosticPanel.kind === 'error' ? 'true' : undefined}
            data-live2d-recovery-reason={live2dDiagnosticPanel.kind === 'recovery' ? 'true' : undefined}
          >
            <p className={cn(
              'font-semibold',
              live2dDiagnosticPanel.kind === 'error' ? 'text-amber-800' : 'text-sky-800',
            )}>{live2dDiagnosticPanel.message}</p>
            <div className={cn(
              'space-y-1 rounded-xl border px-2.5 py-2 font-mono text-[10px] leading-4',
              live2dDiagnosticPanel.detailClassName,
            )}>
              {live2dDiagnosticPanel.details.map((detail) => (
                <p
                  key={detail}
                  className={cn(
                    'break-all',
                    detail.startsWith('error=') || detail.startsWith('errorUrl=') || detail.startsWith('errorStatus=')
                      ? 'text-rose-700'
                      : null,
                  )}
                >
                  {detail}
                </p>
              ))}
            </div>
          </div>
        ) : null}
        {vrmDiagnosticPanel ? (
          <div
            className={cn(
              'mt-2 space-y-2 rounded-2xl border px-3 py-2.5 text-left text-[11px] leading-5',
              vrmDiagnosticPanel.toneClassName,
            )}
            data-vrm-load-reason={vrmDiagnosticPanel.kind === 'loading' ? 'true' : undefined}
            data-vrm-error-reason={vrmDiagnosticPanel.kind === 'error' ? 'true' : undefined}
          >
            <p className={cn(
              'font-semibold',
              vrmDiagnosticPanel.kind === 'error' ? 'text-amber-800' : 'text-sky-800',
            )}>{vrmDiagnosticPanel.message}</p>
            <div className={cn(
              'space-y-1 rounded-xl border px-2.5 py-2 font-mono text-[10px] leading-4',
              vrmDiagnosticPanel.detailClassName,
            )}>
              {vrmDiagnosticPanel.details.map((detail) => (
                <p
                  key={detail}
                  className={cn(
                    'break-all',
                    detail.startsWith('error=')
                      ? 'text-rose-700'
                      : null,
                  )}
                >
                  {detail}
                </p>
              ))}
            </div>
          </div>
        ) : null}
      </ChatRightColumnCard>

      <ChatRightPanelSettings
        onToggleSettings={props.onToggleSettings}
        thinkingState={props.thinkingState}
        onThinkingToggle={props.onThinkingToggle}
        onToggleFold={props.onToggleFold}
        handsFreeState={props.handsFreeState}
        expanded={props.settingsActive}
        collapsedSummary={t('Chat.agentSettingsCollapsedSummary', {
          defaultValue: 'Avatar controls and diagnostics stay docked here.',
        })}
      >
        {props.settingsContent ?? (
          <div className="px-1 py-1">
            <ChatRightColumnCardTitle
              title={t('Chat.avatarCardTitle', { defaultValue: 'Avatar' })}
              subtitle={t('Chat.avatarCardSubtitle', {
                defaultValue: 'Open settings to manage this agent\'s model, diagnostics, and avatar controls.',
              })}
            />
          </div>
        )}
      </ChatRightPanelSettings>
    </ChatRightColumn>
  );
}
