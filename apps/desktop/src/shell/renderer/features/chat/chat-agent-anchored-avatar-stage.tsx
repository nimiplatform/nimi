import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@nimiplatform/nimi-kit/ui';
import type { CanonicalConversationAnchoredSurfacePlacement } from '@nimiplatform/nimi-kit/features/chat';
import type { ConversationCharacterData, ConversationTargetSummary } from '@nimiplatform/nimi-kit/features/chat/headless';
import {
  desktopAgentAvatarBindingQueryKey,
  desktopAgentAvatarResourcesQueryKey,
  getDesktopAgentAvatarBinding,
  listDesktopAgentAvatarResources,
} from '@renderer/bridge/runtime-bridge/chat-agent-avatar-store';
import { hasTauriInvoke } from '@renderer/bridge/runtime-bridge/env';
import { ChatAgentAvatarStageViewport } from './chat-agent-avatar-stage-viewport';
import {
  resolveChatAgentAvatarAttentionStateFromAppAttention,
} from './chat-agent-avatar-attention-state';
import {
  CHAT_AGENT_AVATAR_SMOKE_OVERRIDE_EVENT,
  resolveChatAgentAvatarStageRenderModel,
  resolveChatAgentAvatarStageModel,
} from './chat-agent-avatar-stage-model';
import type { ChatAgentAvatarLive2dFramingIntent } from './chat-agent-avatar-live2d-framing';
import type { ChatAgentAvatarVrmFramingIntent } from './chat-agent-avatar-vrm-framing';
import { resolveChatAgentAvatarStageLayoutContract } from './chat-agent-avatar-stage-layout';
import type { ChatAgentAvatarLive2dDiagnostic } from './chat-agent-avatar-live2d-diagnostics';
import type { ChatAgentAvatarVrmDiagnostic } from './chat-agent-avatar-vrm-viewport';
import { useAppAttention } from '@renderer/app-shell/providers/app-attention-context';

export type ChatAgentHandsFreeState = {
  mode: 'push-to-talk' | 'hands-free';
  status: 'idle' | 'listening' | 'transcribing' | 'failed';
  disabled: boolean;
  onEnter: () => void;
  onExit: () => void;
};

export type ChatAgentAnchoredAvatarStageProps = {
  selectedTarget: ConversationTargetSummary;
  characterData?: ConversationCharacterData | null;
  placement?: CanonicalConversationAnchoredSurfacePlacement;
  settingsActive: boolean;
  thinkingState?: 'on' | 'off' | 'unsupported';
  onThinkingToggle?: () => void;
  handsFreeState?: ChatAgentHandsFreeState;
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

export function ChatAgentAnchoredAvatarStage(props: ChatAgentAnchoredAvatarStageProps) {
  const placement = props.placement || 'right-center';
  const bottomAnchored = placement === 'bottom-center' || placement === 'bottom-right';
  const sideAnchored = placement === 'right-center' || placement === 'left-center';
  const layoutContract = resolveChatAgentAvatarStageLayoutContract(placement);
  const live2dFramingIntent: ChatAgentAvatarLive2dFramingIntent = bottomAnchored
    ? 'bottom-companion'
    : sideAnchored
      ? 'scene-presence'
      : 'chat-focus';
  const vrmFramingIntent: ChatAgentAvatarVrmFramingIntent = bottomAnchored
    ? 'bottom-companion'
    : sideAnchored
      ? 'scene-presence'
      : 'chat-focus';
  const [live2dLoadStatus, setLive2dLoadStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [live2dLoadError, setLive2dLoadError] = useState<string | null>(null);
  const [live2dDiagnostic, setLive2dDiagnostic] = useState<ChatAgentAvatarLive2dDiagnostic | null>(null);
  const [vrmLoadStatus, setVrmLoadStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [vrmLoadError, setVrmLoadError] = useState<string | null>(null);
  const [vrmDiagnostic, setVrmDiagnostic] = useState<ChatAgentAvatarVrmDiagnostic | null>(null);
  const [, setSmokeOverrideVersion] = useState(0);
  const appAttention = useAppAttention();
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
  const attentionState = useMemo(
    () => resolveChatAgentAvatarAttentionStateFromAppAttention({
      attention: appAttention,
    }),
    [appAttention],
  );
  const stageModel = resolveChatAgentAvatarStageModel({
    selectedTarget: props.selectedTarget,
    characterData: props.characterData,
    localResource,
    attentionState,
  });
  const stageRenderModel = resolveChatAgentAvatarStageRenderModel({
    stageModel,
    loadStatus: {
      live2d: live2dLoadStatus,
      vrm: vrmLoadStatus,
    },
  });
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
    setLive2dLoadStatus('idle');
    setLive2dLoadError(null);
    setLive2dDiagnostic(null);
    setVrmLoadStatus('idle');
    setVrmLoadError(null);
    setVrmDiagnostic(null);
  }, [
    stageModel.presentation.backendKind,
    stageModel.presentation.avatarAssetRef,
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

  return (
    <div
      className={cn(
        'pointer-events-none relative flex items-end justify-center',
        layoutContract.stageSizeClassName,
      )}
      data-chat-agent-anchored-stage="true"
      data-chat-agent-stage-placement={placement}
      data-chat-agent-stage-layout={layoutContract.stageSizeClassName}
      data-chat-settings-active={props.settingsActive ? 'true' : 'false'}
    >
      <div
        className={cn(
          'relative h-full w-full',
          bottomAnchored ? 'overflow-hidden' : 'overflow-visible',
          bottomAnchored ? layoutContract.viewportSceneClassName : null,
        )}
        data-avatar-stage-viewport="true"
        data-avatar-stage-attention-enabled="true"
        data-avatar-stage-attention-active={attentionState.active ? 'true' : 'false'}
      >
        <ChatAgentAvatarStageViewport
          stage={stageRenderModel}
          live2dFramingIntent={live2dFramingIntent}
          vrmFramingIntent={vrmFramingIntent}
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
      {(live2dDiagnosticPanel || vrmDiagnosticPanel) ? (
        <div
          className="pointer-events-auto absolute right-0 top-10 z-[2] flex w-[min(240px,82%)] flex-col gap-2"
          data-chat-agent-stage-alert="true"
        >
          {live2dDiagnosticPanel ? (
            <div
              className={cn(
                'space-y-2 rounded-2xl border px-3 py-2.5 text-left text-[11px] leading-5 shadow-[0_14px_32px_rgba(15,23,42,0.12)] backdrop-blur-xl',
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
                'space-y-2 rounded-2xl border px-3 py-2.5 text-left text-[11px] leading-5 shadow-[0_14px_32px_rgba(15,23,42,0.12)] backdrop-blur-xl',
                live2dDiagnosticPanel ? 'mt-2' : '',
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
        </div>
      ) : null}
    </div>
  );
}
