import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AISchedulingJudgement } from '@nimiplatform/sdk/mod';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { dispatchRuntimeConfigOpenPage } from '../runtime-config/runtime-config-navigation-events';
import { useDesktopModelConfigProfileController } from '../runtime-config/desktop-model-config-profile-controller';
import { useSchedulingFeasibility, schedulingDetailKeyForJudgement, schedulingTitleKey } from './chat-execution-scheduling-guard';
import { ConversationModelConfigPanel, useConversationModelConfigSections } from './chat-conversation-capability-settings';
import type { ModelConfigProfileCopy, ModelConfigSection } from '@nimiplatform/nimi-kit/features/model-config';
import { DisabledConfigNote } from '@nimiplatform/nimi-kit/features/model-config';

type ChatSettingsPanelProps = {
  mode?: 'ai' | 'human';
  headerSlot?: ReactNode;
  modelPickerContent?: ReactNode;
  onModelSelectionChange?: unknown;
  initialModelSelection?: unknown;
  diagnosticsContent?: ReactNode;
  presenceContent?: ReactNode;
  unavailableReason?: string;
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

export function ChatSettingsPanel({
  mode = 'ai',
  headerSlot,
  modelPickerContent,
  diagnosticsContent,
  unavailableReason,
}: ChatSettingsPanelProps) {
  const { t } = useTranslation();
  const aiConfig = useAppStore((state) => state.aiConfig);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const aiSections = useConversationModelConfigSections();
  const schedulingJudgement = useSchedulingFeasibility();
  const resolvedUnavailableReason = unavailableReason || t('Chat.settingsUnavailableReason', {
    defaultValue: 'This source does not expose runtime inspect yet.',
  });

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

  const sections = useMemo<ModelConfigSection[]>(() => {
    if (mode !== 'ai') {
      return [
        {
          id: 'chat',
          title: t('Chat.settingsChatSection', { defaultValue: 'Chat' }),
          content: modelPickerContent || (
            <DisabledSettingsNote label={t('Chat.settingsRuntimeNotReady', { defaultValue: 'Runtime not ready' })} />
          ),
        },
        {
          id: 'diagnostics',
          title: t('Chat.diagnosticsTitle', { defaultValue: 'Diagnostics' }),
          content: diagnosticsContent || <DisabledSettingsNote label={resolvedUnavailableReason} />,
        },
      ];
    }
    return [
      ...aiSections,
      {
        id: 'scheduling',
        title: t('Chat.schedulingTitle', { defaultValue: 'Scheduling' }),
        content: <SchedulingWarningSection />,
        hidden: !schedulingJudgement || schedulingJudgement.state === 'runnable',
      },
      {
        id: 'diagnostics',
        title: t('Chat.diagnosticsTitle', { defaultValue: 'Diagnostics' }),
        content: diagnosticsContent || <DisabledSettingsNote label={resolvedUnavailableReason} />,
      },
    ];
  }, [aiSections, diagnosticsContent, mode, modelPickerContent, resolvedUnavailableReason, schedulingJudgement, t]);

  return (
    <div className="space-y-5">
      {headerSlot}
      <ConversationModelConfigPanel
        profile={mode === 'ai' ? profile : undefined}
        sections={sections}
      />
    </div>
  );
}
