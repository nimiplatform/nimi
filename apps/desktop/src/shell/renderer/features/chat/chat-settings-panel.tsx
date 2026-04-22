import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AISchedulingJudgement } from '@nimiplatform/sdk/mod';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { dispatchRuntimeConfigOpenPage } from '../runtime-config/runtime-config-navigation-events';
import { useDesktopModelConfigProfileController } from '../runtime-config/desktop-model-config-profile-controller';
import { useSchedulingFeasibility, schedulingDetailKeyForJudgement, schedulingTitleKey } from './chat-execution-scheduling-guard';
import {
  ConversationModelConfigPanel,
  useConversationCapabilityData,
  useConversationModelConfigSections,
} from './chat-conversation-capability-settings';
import type { ModelConfigProfileCopy, ModelConfigSection } from '@nimiplatform/nimi-kit/features/model-config';
import { DisabledConfigNote } from '@nimiplatform/nimi-kit/features/model-config';
import { ChatSettingsSummaryHome } from './chat-settings-summary-home';
import { ChatSettingsModuleDetail } from './chat-settings-module-detail';

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
      className={`space-y-1.5 rounded-xl border ${style.border} ${style.bg} px-3 py-3`}
      data-testid="scheduling-warning-banner"
      data-scheduling-state={state}
    >
      <div className={`text-[11px] font-semibold ${style.text}`}>
        {t(schedulingTitleKey(state))}
      </div>
      <div className={`text-[11px] ${style.text} opacity-80`}>
        {t(schedulingDetailKeyForJudgement(props.judgement), { detail: detail || '' })}
      </div>
      {occupancy ? (
        <div className={`text-[10px] ${style.icon}`}>
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
            <div key={index} className={`text-[10px] ${style.icon}`}>
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

function createProfileCopy(t: ReturnType<typeof useTranslation>['t']): ModelConfigProfileCopy {
  return {
    sectionTitle: 'Profile',
    summaryLabel: t('Chat.settingsAIProfileTitle', { defaultValue: 'AI Profile' }),
    emptySummaryLabel: t('Chat.settingsAIProfileNone', { defaultValue: 'No profile applied' }),
    applyButtonLabel: t('Chat.settingsAIProfileApplyBtn', { defaultValue: 'Apply profile' }),
    changeButtonLabel: t('Chat.settingsAIProfileChange', { defaultValue: 'Change' }),
    manageButtonTitle: t('Chat.settingsAIProfileManage', { defaultValue: 'Manage profiles' }),
    modalTitle: t('Chat.settingsAIProfileModalTitle', { defaultValue: 'Apply AI Profile' }),
    modalHint: t('Chat.settingsAIProfileModalHint', {
      defaultValue: 'Selecting a profile will overwrite all current capability bindings (Chat, TTS, Image, Video). This action cannot be undone.',
    }),
    loadingLabel: t('Chat.settingsLoading', { defaultValue: 'Loading profiles...' }),
    emptyLabel: t('Chat.settingsAIProfileEmpty', { defaultValue: 'No profiles available.' }),
    currentBadgeLabel: t('Chat.settingsAIProfileCurrent', { defaultValue: 'Current' }),
    cancelLabel: t('Chat.settingsAIProfileCancel', { defaultValue: 'Cancel' }),
    confirmLabel: t('Chat.settingsAIProfileConfirm', { defaultValue: 'Confirm & Apply' }),
    applyingLabel: t('Chat.settingsAIProfileApplying', { defaultValue: 'Applying...' }),
  };
}

// ---------------------------------------------------------------------------
// Non-AI mode: simple flat sections (unchanged from original)
// ---------------------------------------------------------------------------

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
  return <ConversationModelConfigPanel sections={sections} />;
}

// ---------------------------------------------------------------------------
// AI mode: summary home + module detail view swap
// ---------------------------------------------------------------------------

function AiModeSettings(props: {
  headerSlot?: ReactNode;
  presenceContent?: ReactNode;
  diagnosticsContent?: ReactNode;
  unavailableReason: string;
  onDiagnosticsVisibilityChange?: (visible: boolean) => void;
}) {
  const { t } = useTranslation();
  const aiConfig = useAppStore((state) => state.aiConfig);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);

  const sections = useConversationModelConfigSections();
  const { items, imageContext, imageEditorCopy } = useConversationCapabilityData();

  const profile = useDesktopModelConfigProfileController({
    scopeRef: aiConfig.scopeRef,
    currentOrigin: aiConfig.profileOrigin
      ? { profileId: aiConfig.profileOrigin.profileId, title: aiConfig.profileOrigin.title }
      : null,
    copy: createProfileCopy(t),
    onManage: () => {
      setActiveTab('runtime');
      setTimeout(() => dispatchRuntimeConfigOpenPage('profiles'), 100);
    },
  });

  const schedulingContent = <SchedulingWarningSection />;

  const diagnosticsNode = props.diagnosticsContent || (
    <DisabledSettingsNote label={props.unavailableReason} />
  );

  useEffect(() => {
    props.onDiagnosticsVisibilityChange?.(activeModuleId === 'diagnostics');
    return () => {
      props.onDiagnosticsVisibilityChange?.(false);
    };
  }, [activeModuleId, props.onDiagnosticsVisibilityChange]);

  const avatarSummary = props.presenceContent
    ? {
      title: t('Chat.avatarBindingTitle', { defaultValue: 'Avatar' }),
      subtitle: t('Chat.avatarSummarySubtitle', {
        defaultValue: 'Launch Nimi Avatar for carrier rendering; desktop keeps shell-only backdrop controls here.',
      }),
      statusDot: 'neutral' as const,
      statusLabel: null,
    }
    : null;

  if (activeModuleId) {
    return (
      <div className="space-y-5">
        {props.headerSlot}
        <div className="animate-in slide-in-from-right-4 duration-200">
          {activeModuleId === 'avatar' ? (
            <div data-chat-settings-module="avatar">
              {/* Avatar detail — Local VRM/Live2D import + binding (moved from top-level) */}
              <div className="mb-5 flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setActiveModuleId(null)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] bg-white text-[var(--nimi-text-muted)] transition-all hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,transparent)] hover:text-[var(--nimi-action-primary-bg)]"
                  aria-label={t('Chat.settingsBack', { defaultValue: 'Back' })}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m15 18-6-6 6-6" />
                  </svg>
                </button>
                <h2 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                  {t('Chat.avatarBindingTitle', { defaultValue: 'Avatar' })}
                </h2>
              </div>
              {props.presenceContent}
            </div>
          ) : (
            <ChatSettingsModuleDetail
              moduleId={activeModuleId}
              sections={sections}
              items={items}
              profile={profile}
              onBack={() => setActiveModuleId(null)}
              imageContext={imageContext}
              imageEditorCopy={imageEditorCopy}
              schedulingContent={schedulingContent}
              diagnosticsContent={diagnosticsNode}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {props.headerSlot}
      <ChatSettingsSummaryHome
        sections={sections}
        profile={profile}
        onSelectModule={setActiveModuleId}
        schedulingContent={schedulingContent}
        diagnosticsContent={diagnosticsNode}
        avatarSummary={avatarSummary}
      />
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
