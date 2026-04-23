import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AISchedulingJudgement } from '@nimiplatform/sdk/mod';
import { confirmDialog } from '@renderer/bridge/runtime-bridge/ui';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { dispatchRuntimeConfigOpenPage } from '../runtime-config/runtime-config-navigation-events';
import { useDesktopModelConfigProfileController } from '../runtime-config/desktop-model-config-profile-controller';
import { useSchedulingFeasibility, schedulingDetailKeyForJudgement, schedulingTitleKey } from './chat-shared-execution-scheduling-guard';
import {
  ConversationModelConfigPanel,
  useConversationCapabilityData,
  useConversationModelConfigSections,
} from './chat-shared-conversation-capability-settings';
import type { ModelConfigProfileCopy, ModelConfigSection } from '@nimiplatform/nimi-kit/features/model-config';
import { DisabledConfigNote } from '@nimiplatform/nimi-kit/features/model-config';
import { ChatSettingsSummaryHome } from './chat-shared-settings-summary-home';
import { ChatSettingsModuleDetail } from './chat-shared-settings-module-detail';
import { ChatSettingsAiModelHome, AI_MODEL_MODULE_ORDER } from './chat-shared-settings-ai-model-home';

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
    importLabel: t('Chat.settingsAIProfileImport', { defaultValue: 'Import AI Profile' }),
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

type AiModeSettingsPath =
  | []
  | ['avatar']
  | ['ai-model']
  | ['ai-model', string]
  | ['diagnostics'];

function AiModeSettings(props: {
  headerSlot?: ReactNode;
  presenceContent?: ReactNode;
  diagnosticsContent?: ReactNode;
  unavailableReason: string;
  onDiagnosticsVisibilityChange?: (visible: boolean) => void;
  clearChatsTargetName?: string | null;
  clearChatsDisabled?: boolean;
  onClearAgentHistory?: () => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const aiConfig = useAppStore((state) => state.aiConfig);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const [path, setPath] = useState<AiModeSettingsPath>([]);

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

  const diagnosticsVisible = path[0] === 'diagnostics';
  useEffect(() => {
    props.onDiagnosticsVisibilityChange?.(diagnosticsVisible);
    return () => {
      props.onDiagnosticsVisibilityChange?.(false);
    };
  }, [diagnosticsVisible, props.onDiagnosticsVisibilityChange]);

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

  const avatarSummary = props.presenceContent
    ? {
      title: t('Chat.avatarBindingTitle', { defaultValue: 'Avatar' }),
      subtitle: t('Chat.avatarSummarySubtitle', {
        defaultValue: 'Review avatar model status, open this chat in Nimi Avatar, and adjust local shell appearance here.',
      }),
      statusDot: 'neutral' as const,
      statusLabel: null,
    }
    : null;

  const backLabel = t('Chat.settingsBack', { defaultValue: 'Back' });

  const renderBody = () => {
    // Home
    if (path.length === 0) {
      return (
        <ChatSettingsSummaryHome
          sections={sections}
          profile={profile}
          onSelectModule={(moduleId) => {
            if (moduleId === 'avatar' || moduleId === 'ai-model' || moduleId === 'diagnostics') {
              setPath([moduleId] as AiModeSettingsPath);
            }
          }}
          schedulingContent={schedulingContent}
          diagnosticsContent={diagnosticsNode}
          avatarSummary={avatarSummary}
          onClearChats={props.onClearAgentHistory ? handleClearChats : undefined}
          clearChatsDisabled={props.clearChatsDisabled}
        />
      );
    }

    // Avatar detail
    if (path[0] === 'avatar') {
      return (
        <div data-chat-settings-module="avatar">
          <div className="mb-5 flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setPath([])}
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] bg-white text-[var(--nimi-text-muted)] transition-all hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,transparent)] hover:text-[var(--nimi-action-primary-bg)]"
              aria-label={backLabel}
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
      );
    }

    // AI Model sub-home → capability list
    if (path[0] === 'ai-model' && path.length === 1) {
      return (
        <div data-chat-settings-module="ai-model">
          <div className="mb-5 flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setPath([])}
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] bg-white text-[var(--nimi-text-muted)] transition-all hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,transparent)] hover:text-[var(--nimi-action-primary-bg)]"
              aria-label={backLabel}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <h2 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
              {t('Chat.settingsAiModelEntryTitle', { defaultValue: 'AI Model' })}
            </h2>
          </div>
          <ChatSettingsAiModelHome
            sections={sections}
            onSelectModule={(capabilityId) => {
              if ((AI_MODEL_MODULE_ORDER as readonly string[]).includes(capabilityId)) {
                setPath(['ai-model', capabilityId]);
              }
            }}
          />
        </div>
      );
    }

    // AI Model → capability detail
    if (path[0] === 'ai-model' && path.length === 2) {
      return (
        <ChatSettingsModuleDetail
          moduleId={path[1] as string}
          sections={sections}
          items={items}
          profile={profile}
          onBack={() => setPath(['ai-model'])}
          imageContext={imageContext}
          imageEditorCopy={imageEditorCopy}
          schedulingContent={schedulingContent}
          diagnosticsContent={diagnosticsNode}
        />
      );
    }

    // Diagnostics detail
    if (path[0] === 'diagnostics') {
      return (
        <ChatSettingsModuleDetail
          moduleId="diagnostics"
          sections={sections}
          items={items}
          profile={profile}
          onBack={() => setPath([])}
          imageContext={imageContext}
          imageEditorCopy={imageEditorCopy}
          schedulingContent={schedulingContent}
          diagnosticsContent={diagnosticsNode}
        />
      );
    }

    return null;
  };

  return (
    <div className="space-y-5">
      {props.headerSlot}
      <div className={path.length > 0 ? 'animate-in slide-in-from-right-4 duration-200' : undefined}>
        {renderBody()}
      </div>
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
