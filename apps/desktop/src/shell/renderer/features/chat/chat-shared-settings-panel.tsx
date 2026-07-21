import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  NimiAICapabilityRequirementDeclaration,
  NimiAISchedulingJudgement,
  NimiAIScopeRef,
} from '@nimiplatform/sdk/ai';
import {
  getNimiRuntimeRouteCapabilityProjectionIssueKind,
  isNimiRuntimeRouteCapabilityProjectionReady,
} from '@nimiplatform/sdk/runtime';
import { useAppStore } from '../../app-shell/providers/app-store';
import { useDesktopRendererCommands, useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { useAccountProfileLibrary } from '../runtime-config/runtime-config-profile-library-context.js';
import { useDesktopRouteModelPickerProviderResolver } from '../runtime-config/desktop-route-model-picker-provider';
import { useSchedulingFeasibility, schedulingDetailKeyForJudgement, schedulingTitleKey } from './chat-shared-execution-scheduling-guard';
import type {
  AppModelConfigSurface,
  ModelConfigProjectionStatus,
  ModelConfigSection,
} from '@nimiplatform/kit/features/model-config';
import {
  DisabledConfigNote,
  ModelConfigAiModelHub,
  ModelConfigPanel,
  defaultModelConfigProfileCopy,
  useModelConfigProfileController,
} from '@nimiplatform/kit/features/model-config';
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
  showPresenceContent?: boolean;
  showDiagnosticsFooter?: boolean;
  /** When set, the AI Model Hub is rendered in a 2-col grouped grid (used by Agent Center). */
  superSections?: ReadonlyArray<import('@nimiplatform/kit/features/model-config').ModelConfigSuperSection>;
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

export function SchedulingWarningBanner(props: { judgement: NimiAISchedulingJudgement }) {
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
  'voice_workflow.voice_clone',
  'voice_workflow.voice_design',
  'image.generate',
  'image.edit',
  'video.generate',
  'text.embed',
] as const;

function chatRequirementDeclaration(scopeRef: NimiAIScopeRef): NimiAICapabilityRequirementDeclaration {
  return {
    requirementId: `desktop.chat.settings:${scopeRef.surfaceId ?? 'default'}`,
    scopeRef,
    requiredSlices: CHAT_ENABLED_CAPABILITIES.map((capability) => ({
      requirementSliceId: `chat:${capability}`,
      capability,
      profileSliceRef: `chat:${capability}`,
      readinessPolicy: 'required',
    })),
    setupProjectionPolicy: 'sdk-ai-config-setup-projection',
  };
}

function toProjectionStatus(
  t: ReturnType<typeof useTranslation>['t'],
  projection: ConversationCapabilityProjection | null | undefined,
): ModelConfigProjectionStatus | null {
  if (!projection) {
    return null;
  }
  const hasBinding = Boolean(projection.selectedTargetRef);
  if (isNimiRuntimeRouteCapabilityProjectionReady(projection)) {
    return {
      supported: true,
      tone: 'ready',
      badgeLabel: t('Chat.settingsCapabilityReady', { defaultValue: 'Ready' }),
      title: t('Chat.settingsRuntimeReady', { defaultValue: 'Runtime ready' }),
      detail: null,
    };
  }
  switch (getNimiRuntimeRouteCapabilityProjectionIssueKind(projection)) {
    case 'needs_selection':
      return {
        supported: false,
        tone: 'attention',
        badgeLabel: t('Chat.settingsCapabilityNeedsSetup', { defaultValue: 'Needs setup' }),
        title: t('Chat.settingsModelSelectionRequired', { defaultValue: 'Model selection required' }),
        detail: t('Chat.settingsModelSelectionRequiredHint', {
          defaultValue: 'Choose one local or cloud model route before using this conversation.',
        }),
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
    case 'route_not_ready':
      return {
        supported: false,
        tone: 'attention',
        badgeLabel: t('Chat.settingsCapabilityNeedsSetup', { defaultValue: 'Needs setup' }),
        title: t('Chat.settingsRouteNeedsSetup', { defaultValue: 'Route needs setup' }),
        detail: t('Chat.settingsRouteNeedsSetupHint', {
          defaultValue: 'Complete setup or warm the selected local model before using this route.',
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
        supported: Boolean(projection.selectedTargetRef && projection.resolvedBinding),
        tone: projection.selectedTargetRef && projection.resolvedBinding ? 'neutral' : 'attention',
        badgeLabel: t('Chat.settingsCapabilityAttention', { defaultValue: 'Attention' }),
        title: t('Chat.settingsRouteMetadataUnavailable', { defaultValue: 'Route metadata unavailable' }),
        detail: t('Chat.settingsRouteMetadataUnavailableHint', {
          defaultValue: 'A route is selected, but runtime describe metadata is not available yet.',
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
  showPresenceContent?: boolean;
  showDiagnosticsFooter?: boolean;
  superSections?: ReadonlyArray<import('@nimiplatform/kit/features/model-config').ModelConfigSuperSection>;
}) {
  const runtimeConfigNavigation = useDesktopRendererCommands().runtimeConfigNavigation;
  const sdk = useDesktopRendererSdk();
  const profileLibrary = useAccountProfileLibrary();
  const providerResolver = useDesktopRouteModelPickerProviderResolver();
  const { t } = useTranslation();
  const aiConfig = useAppStore((state) => state.aiConfig);
  const projectionByCapability = useAppStore((state) => state.conversationCapabilityProjectionByCapability);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const aiConfigService = useMemo(() => sdk.aiConfig(), [sdk]);
  const assetsQuery = useLocalAssets();

  const surface: AppModelConfigSurface = useMemo(() => ({
    scopeRef: aiConfig.scopeRef,
    aiConfigService,
    requirementDeclaration: chatRequirementDeclaration(aiConfig.scopeRef),
    providerResolver,
    projectionResolver: (capabilityId: string) => toProjectionStatus(
      t,
      projectionByCapability[capabilityId as keyof typeof projectionByCapability] || null,
    ),
    localAssetSource: {
      list: () => assetsQuery.data || [],
      loading: assetsQuery.isLoading,
    },
    i18n: { t },
  }), [
    aiConfig.scopeRef,
    aiConfigService,
    assetsQuery.data,
    assetsQuery.isLoading,
    projectionByCapability,
    providerResolver,
    t,
  ]);
  const profileCopy = useMemo(() => defaultModelConfigProfileCopy(t), [t]);
  // Prime the read-through projection of the Rust-owned account profile
  // library so the synchronous kit `userProfilesSource.list()` reflects host
  // truth. The library file family is the source of truth (P-AIPS-013); this
  // is only its renderer projection.
  useEffect(() => {
    void profileLibrary.ensureLoaded();
  }, [profileLibrary]);
  const userProfilesSource = useMemo(
    () => ({ list: profileLibrary.cachedProfiles }),
    [profileLibrary],
  );
  const currentOrigin = useMemo(
    () => (aiConfig.profileOrigin
      ? { profileId: aiConfig.profileOrigin.profileId, title: aiConfig.profileOrigin.title }
      : null),
    [aiConfig.profileOrigin?.profileId, aiConfig.profileOrigin?.title],
  );
  const handleManageProfiles = useCallback(() => {
    setActiveTab('runtime');
    runtimeConfigNavigation.openPage('profiles');
  }, [runtimeConfigNavigation, setActiveTab]);

  const profile = useModelConfigProfileController({
    scopeRef: aiConfig.scopeRef,
    aiConfigService,
    requirementDeclaration: chatRequirementDeclaration(aiConfig.scopeRef),
    copy: profileCopy,
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
    </div>
  );

  return (
    <div className="space-y-5">
      {props.headerSlot}
      {props.showPresenceContent !== false && props.presenceContent ? (
        <div data-chat-settings-module="avatar">{props.presenceContent}</div>
      ) : null}
      <ModelConfigAiModelHub surface={surface} profile={profile} footer={footer} superSections={props.superSections} />
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
  showPresenceContent,
  showDiagnosticsFooter,
  superSections,
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
        showPresenceContent={showPresenceContent}
        showDiagnosticsFooter={showDiagnosticsFooter}
        superSections={superSections}
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
