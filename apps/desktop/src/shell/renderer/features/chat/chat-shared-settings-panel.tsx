import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AISchedulingJudgement } from '@nimiplatform/sdk/mod';
import { applyAIProfileToConfig } from '@nimiplatform/sdk/mod';
import { confirmDialog } from '@renderer/bridge/runtime-bridge/ui';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { getDesktopAIConfigService } from '@renderer/app-shell/providers/desktop-ai-config-service';
import { dispatchRuntimeConfigOpenPage } from '../runtime-config/runtime-config-navigation-events';
import { loadUserProfiles } from '../runtime-config/runtime-config-profile-storage';
import { getDesktopRouteModelPickerProvider } from '../runtime-config/desktop-route-model-picker-provider';
import { useSchedulingFeasibility, schedulingDetailKeyForJudgement, schedulingTitleKey } from './chat-shared-execution-scheduling-guard';
import type {
  AppModelConfigSurface,
  ModelConfigProjectionStatus,
  ModelConfigSection,
} from '@nimiplatform/nimi-kit/features/model-config';
import {
  DisabledConfigNote,
  ModelConfigAiModelHub,
  ModelConfigPanel,
  defaultModelConfigProfileCopy,
  useModelConfigProfileController,
} from '@nimiplatform/nimi-kit/features/model-config';
import { useLocalAssets } from './capability-settings-shared';
import type { ConversationCapabilityProjection } from './conversation-capability';

type ChatSettingsPanelProps = {
  mode?: 'ai' | 'human';
  headerSlot?: ReactNode;
  modelPickerContent?: ReactNode;
  onModelSelectionChange?: unknown;
  initialModelSelection?: unknown;
  diagnosticsContent?: ReactNode;
  presenceContent?: ReactNode;
  unavailableReason?: string;
  onDiagnosticsVisibilityChange?: (visible: boolean) => void;
  clearChatsTargetName?: string | null;
  clearChatsDisabled?: boolean;
  onClearAgentHistory?: () => Promise<void> | void;
  showPresenceContent?: boolean;
  showDiagnosticsFooter?: boolean;
  showClearHistoryAction?: boolean;
};

const SCHEDULING_STYLE: Record<string, { border: string; bg: string; text: string; icon: string }> = {
  denied: { border: 'border-red-200', bg: 'bg-red-50/70', text: 'text-red-700', icon: 'text-red-400' },
  queue_required: { border: 'border-blue-200', bg: 'bg-blue-50/70', text: 'text-blue-700', icon: 'text-blue-400' },
  preemption_risk: { border: 'border-amber-200', bg: 'bg-amber-50/70', text: 'text-amber-700', icon: 'text-amber-400' },
  slowdown_risk: { border: 'border-amber-200', bg: 'bg-amber-50/70', text: 'text-amber-700', icon: 'text-amber-400' },
  unknown: { border: 'border-slate-200', bg: 'bg-slate-50/70', text: 'text-slate-600', icon: 'text-slate-400' },
};

export function DisabledSettingsNote(props: { label: string }) {
  return <DisabledConfigNote label={props.label} />;
}

export function SchedulingWarningBanner(props: { judgement: AISchedulingJudgement }) {
  const { t } = useTranslation();
  const { detail, occupancy, resourceWarnings, state } = props.judgement;

  if (state === 'runnable') {
    return null;
  }

  const style = SCHEDULING_STYLE[state] ?? SCHEDULING_STYLE.unknown!;

  return (
    <div
      className={`space-y-1 overflow-hidden rounded-xl border ${style.border} ${style.bg} px-2.5 py-2 [overflow-wrap:anywhere]`}
      data-testid="scheduling-warning-banner"
      data-scheduling-state={state}
    >
      <div className={`text-[11px] font-semibold ${style.text}`}>
        {t(schedulingTitleKey(state))}
      </div>
      <div className={`text-[11px] leading-relaxed ${style.text} opacity-80`}>
        {t(schedulingDetailKeyForJudgement(props.judgement), { detail: detail || '' })}
      </div>
      {occupancy ? (
        <div className={`text-[10px] leading-snug ${style.icon}`}>
          {t('Chat.schedulingOccupancy', {
            used: occupancy.globalUsed,
            cap: occupancy.globalCap,
            appUsed: occupancy.appUsed,
            appCap: occupancy.appCap,
          })}
        </div>
      ) : null}
      {resourceWarnings.length > 0 ? (
        <div className="space-y-0.5">
          {resourceWarnings.map((warning, index) => (
            <div key={index} className={`text-[10px] leading-snug ${style.icon}`}>
              {t('Chat.schedulingResourceWarning', { warning })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SchedulingWarningSection() {
  const judgement = useSchedulingFeasibility();

  if (!judgement || judgement.state === 'runnable') {
    return null;
  }

  return <SchedulingWarningBanner judgement={judgement} />;
}

// ---------------------------------------------------------------------------
// AiModeSettings — delegates to canonical kit ModelConfigAiModelHub. Profile
// import, capability summaries, and capability detail routing are all owned
// by the hub; chat-shared scope contributes scheduling as a hub footer and
// a renderer-local diagnostics entry.
// ---------------------------------------------------------------------------

// Canonical chat enabled capabilities (9 ids). Order mirrors the Wave 4
// preflight acceptance invariant.
const CHAT_ENABLED_CAPABILITIES = [
  'text.generate',
  'audio.synthesize',
  'audio.transcribe',
  'voice_workflow.tts_v2v',
  'voice_workflow.tts_t2v',
  'image.generate',
  'image.edit',
  'video.generate',
  'text.embed',
] as const;

function toProjectionStatus(
  t: ReturnType<typeof useTranslation>['t'],
  projection: ConversationCapabilityProjection | null | undefined,
): ModelConfigProjectionStatus | null {
  if (!projection) {
    return null;
  }
  const hasBinding = Boolean(projection.selectedBinding);
  if (projection.supported && projection.resolvedBinding) {
    return {
      supported: true,
      tone: 'ready',
      badgeLabel: t('Chat.settingsCapabilityReady', { defaultValue: 'Ready' }),
      title: t('Chat.settingsRuntimeReady', { defaultValue: 'Runtime ready' }),
      detail: null,
    };
  }
  switch (projection.reasonCode) {
    case 'selection_missing':
    case 'selection_cleared':
      return {
        supported: false,
        tone: 'attention',
        badgeLabel: t('Chat.settingsCapabilityNeedsSetup', { defaultValue: 'Needs setup' }),
        title: t('Chat.settingsRouteUnavailable', { defaultValue: 'Route unavailable' }),
        detail: null,
      };
    case 'binding_unresolved':
      return {
        supported: false,
        tone: 'attention',
        badgeLabel: t('Chat.settingsCapabilityAttention', { defaultValue: 'Attention' }),
        title: t('Chat.settingsSelectedRouteUnavailable', { defaultValue: 'Selected route unavailable' }),
        detail: t('Chat.settingsSelectedRouteUnavailableHint', {
          defaultValue: 'The selected route can no longer be resolved.',
        }),
      };
    case 'route_unhealthy':
      return {
        supported: false,
        tone: 'attention',
        badgeLabel: t('Chat.settingsCapabilityAttention', { defaultValue: 'Attention' }),
        title: t('Chat.settingsRouteUnhealthy', { defaultValue: 'Route unhealthy' }),
        detail: t('Chat.settingsRouteUnhealthyHint', {
          defaultValue: 'The selected route failed the latest health check.',
        }),
      };
    case 'metadata_missing':
      return {
        supported: false,
        tone: 'attention',
        badgeLabel: t('Chat.settingsCapabilityAttention', { defaultValue: 'Attention' }),
        title: t('Chat.settingsRouteMetadataUnavailable', { defaultValue: 'Route metadata unavailable' }),
        detail: t('Chat.settingsRouteMetadataUnavailableHint', {
          defaultValue: 'This capability cannot execute until runtime describe metadata is available.',
        }),
      };
    case 'capability_unsupported':
      return {
        supported: false,
        tone: 'attention',
        badgeLabel: t('Chat.settingsCapabilityAttention', { defaultValue: 'Attention' }),
        title: t('Chat.settingsCapabilityUnsupported', { defaultValue: 'Capability unsupported' }),
        detail: t('Chat.settingsCapabilityUnsupportedHint', {
          defaultValue: 'The current runtime does not expose this capability.',
        }),
      };
    case 'host_denied':
      return {
        supported: false,
        tone: 'attention',
        badgeLabel: t('Chat.settingsCapabilityAttention', { defaultValue: 'Attention' }),
        title: t('Chat.settingsCapabilityDenied', { defaultValue: 'Capability denied' }),
        detail: t('Chat.settingsCapabilityDeniedHint', {
          defaultValue: 'The host denied this capability for the current conversation surface.',
        }),
      };
    default:
      return {
        supported: false,
        tone: 'neutral',
        badgeLabel: t('Chat.settingsCapabilityNeedsSetup', { defaultValue: 'Needs setup' }),
        title: hasBinding
          ? t('Chat.settingsRuntimeReady', { defaultValue: 'Runtime ready' })
          : t('Chat.settingsRouteUnavailable', { defaultValue: 'Route unavailable' }),
        detail: null,
      };
  }
}

function HumanModeSettings(props: {
  modelPickerContent?: ReactNode;
  diagnosticsContent?: ReactNode;
  unavailableReason: string;
  onDiagnosticsVisibilityChange?: (visible: boolean) => void;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    props.onDiagnosticsVisibilityChange?.(true);
    return () => {
      props.onDiagnosticsVisibilityChange?.(false);
    };
  }, [props.onDiagnosticsVisibilityChange]);
  const sections: ModelConfigSection[] = [
    {
      id: 'chat',
      title: t('Chat.settingsChatSection', { defaultValue: 'Chat' }),
      content: props.modelPickerContent || (
        <DisabledSettingsNote label={t('Chat.settingsRuntimeNotReady', { defaultValue: 'Runtime not ready' })} />
      ),
    },
    {
      id: 'diagnostics',
      title: t('Chat.diagnosticsTitle', { defaultValue: 'Diagnostics' }),
      content: props.diagnosticsContent || <DisabledSettingsNote label={props.unavailableReason} />,
    },
  ];
  return <ModelConfigPanel sections={sections} />;
}

function AiModeSettings(props: {
  headerSlot?: ReactNode;
  presenceContent?: ReactNode;
  diagnosticsContent?: ReactNode;
  unavailableReason: string;
  onDiagnosticsVisibilityChange?: (visible: boolean) => void;
  clearChatsTargetName?: string | null;
  clearChatsDisabled?: boolean;
  onClearAgentHistory?: () => Promise<void> | void;
  showPresenceContent?: boolean;
  showDiagnosticsFooter?: boolean;
  showClearHistoryAction?: boolean;
}) {
  const { t } = useTranslation();
  const aiConfig = useAppStore((state) => state.aiConfig);
  const projectionByCapability = useAppStore((state) => state.conversationCapabilityProjectionByCapability);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const aiConfigService = useMemo(() => getDesktopAIConfigService(), []);
  const assetsQuery = useLocalAssets();

  const surface: AppModelConfigSurface = useMemo(() => ({
    scopeRef: aiConfig.scopeRef,
    aiConfigService,
    enabledCapabilities: CHAT_ENABLED_CAPABILITIES,
    providerResolver: (routeCapability: string) => getDesktopRouteModelPickerProvider(routeCapability),
    projectionResolver: (capabilityId: string) => toProjectionStatus(
      t,
      projectionByCapability[capabilityId as keyof typeof projectionByCapability] || null,
    ),
    runtimeReady: true,
    localAssetSource: {
      list: () => assetsQuery.data || [],
      loading: assetsQuery.isLoading,
    },
    i18n: { t },
  }), [aiConfig.scopeRef, aiConfigService, assetsQuery.data, assetsQuery.isLoading, projectionByCapability, t]);
  const profileCopy = useMemo(() => defaultModelConfigProfileCopy(t), [t]);
  const userProfilesSource = useMemo(() => ({ list: () => loadUserProfiles() }), []);
  const currentOrigin = useMemo(
    () => (aiConfig.profileOrigin
      ? { profileId: aiConfig.profileOrigin.profileId, title: aiConfig.profileOrigin.title }
      : null),
    [aiConfig.profileOrigin?.profileId, aiConfig.profileOrigin?.title],
  );
  const handleManageProfiles = useCallback(() => {
    setActiveTab('runtime');
    setTimeout(() => dispatchRuntimeConfigOpenPage('profiles'), 100);
  }, [setActiveTab]);

  const profile = useModelConfigProfileController({
    scopeRef: aiConfig.scopeRef,
    aiConfigService,
    copy: profileCopy,
    applyAIProfileToConfig,
    userProfilesSource,
    currentOrigin,
    onManage: handleManageProfiles,
  });

  // Diagnostics is always considered visible in the AI panel now that it is a
  // persistent footer entry rather than an on-demand path view.
  useEffect(() => {
    props.onDiagnosticsVisibilityChange?.(true);
    return () => {
      props.onDiagnosticsVisibilityChange?.(false);
    };
  }, [props.onDiagnosticsVisibilityChange]);

  const handleClearChats = useCallback(() => {
    const onClear = props.onClearAgentHistory;
    if (!onClear) return;
    void (async () => {
      const confirmation = await confirmDialog({
        title: t('Chat.clearAgentChatHistoryTitle', { defaultValue: 'Clear agent chat history' }),
        description: t('Chat.clearAgentChatHistoryConfirm', {
          defaultValue: 'Clear all local chat history with {{name}}? This cannot be undone.',
          name: props.clearChatsTargetName || '',
        }),
        level: 'warning',
      });
      if (!confirmation.confirmed) return;
      await onClear();
    })().catch(() => {
      // Swallow confirm/host errors; upstream reporting handles them.
    });
  }, [props.onClearAgentHistory, props.clearChatsTargetName, t]);

  const footer = (
    <div className="space-y-2 border-t border-[color-mix(in_srgb,var(--nimi-border-subtle)_70%,transparent)] pt-3">
      <SchedulingWarningSection />
      {props.showDiagnosticsFooter !== false && props.diagnosticsContent ? (
        <div data-chat-settings-module="diagnostics" className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--nimi-text-muted)]">
            {t('Chat.diagnosticsTitle', { defaultValue: 'Diagnostics' })}
          </div>
          {props.diagnosticsContent}
        </div>
      ) : props.showDiagnosticsFooter !== false ? (
        <DisabledSettingsNote label={props.unavailableReason} />
      ) : null}
      {props.showClearHistoryAction !== false && props.onClearAgentHistory ? (
        <button
          type="button"
          onClick={handleClearChats}
          disabled={props.clearChatsDisabled}
          className="flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-xs text-[var(--nimi-status-danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)] disabled:pointer-events-none disabled:opacity-50"
        >
          <span>{t('Chat.clearAgentChatHistoryTitle', { defaultValue: 'Clear agent chat history' })}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          </svg>
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-5">
      {props.headerSlot}
      {props.showPresenceContent !== false && props.presenceContent ? (
        <div data-chat-settings-module="avatar">{props.presenceContent}</div>
      ) : null}
      <ModelConfigAiModelHub surface={surface} profile={profile} footer={footer} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatSettingsPanel — public API (unchanged props contract)
// ---------------------------------------------------------------------------

export function ChatSettingsPanel({
  mode = 'ai',
  headerSlot,
  modelPickerContent,
  diagnosticsContent,
  presenceContent,
  unavailableReason,
  onDiagnosticsVisibilityChange,
  clearChatsTargetName,
  clearChatsDisabled,
  onClearAgentHistory,
  showPresenceContent,
  showDiagnosticsFooter,
  showClearHistoryAction,
}: ChatSettingsPanelProps) {
  const { t } = useTranslation();
  const resolvedUnavailableReason = unavailableReason || t('Chat.settingsUnavailableReason', {
    defaultValue: 'This source does not expose runtime inspect yet.',
  });

  if (mode === 'ai') {
    return (
      <AiModeSettings
        headerSlot={headerSlot}
        presenceContent={presenceContent}
        diagnosticsContent={diagnosticsContent}
        unavailableReason={resolvedUnavailableReason}
        onDiagnosticsVisibilityChange={onDiagnosticsVisibilityChange}
        clearChatsTargetName={clearChatsTargetName}
        clearChatsDisabled={clearChatsDisabled}
        onClearAgentHistory={onClearAgentHistory}
        showPresenceContent={showPresenceContent}
        showDiagnosticsFooter={showDiagnosticsFooter}
        showClearHistoryAction={showClearHistoryAction}
      />
    );
  }

  return (
    <div className="space-y-5">
      {headerSlot}
      <HumanModeSettings
        modelPickerContent={modelPickerContent}
        diagnosticsContent={diagnosticsContent}
        unavailableReason={resolvedUnavailableReason}
        onDiagnosticsVisibilityChange={onDiagnosticsVisibilityChange}
      />
    </div>
  );
}
