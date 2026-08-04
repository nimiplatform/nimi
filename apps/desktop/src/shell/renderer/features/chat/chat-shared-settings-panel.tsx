import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { NimiAISchedulingJudgement } from '@nimiplatform/sdk/ai';
import { useAppStore } from '../../app-shell/providers/app-store';
import { useDesktopRendererCommands } from '../../renderer/binding-context.js';
import { schedulingDetailKeyForJudgement, schedulingTitleKey } from './chat-shared-execution-scheduling-guard';
import type {
  ModelConfigSection,
} from '@nimiplatform/kit/features/model-config';
import {
  DisabledConfigNote,
  ModelConfigPanel,
} from '@nimiplatform/kit/features/model-config';
import { Button, InlineAlert, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import {
  createDesktopNimiLocalTextIntent,
  findDesktopNimiTextIntent,
  replaceDesktopNimiTextIntent,
  useDesktopNimiAppAIConfig,
  useOverwriteDesktopNimiAppAIConfig,
} from './chat-nimi-app-ai-config.js';

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

// Nimi Chat consumes the exact `nimi.desktop` App AIConfig. The Runtime owns
// persistence; this panel only renders and mutates its current projection.

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
}) {
  const runtimeConfigNavigation = useDesktopRendererCommands().runtimeConfigNavigation;
  const { t } = useTranslation();
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const appAIConfig = useDesktopNimiAppAIConfig();
  const overwriteAppAIConfig = useOverwriteDesktopNimiAppAIConfig();
  const textIntent = findDesktopNimiTextIntent(appAIConfig.data);
  const routeKind = textIntent?.route.oneofKind;
  const handleManageProfiles = useCallback(() => {
    setActiveTab('runtime');
    runtimeConfigNavigation.openPage('profiles');
  }, [runtimeConfigNavigation, setActiveTab]);
  const handleUseLocal = useCallback(() => {
    overwriteAppAIConfig.mutate(replaceDesktopNimiTextIntent(
      appAIConfig.data?.capabilities ?? [],
      createDesktopNimiLocalTextIntent(),
    ));
  }, [appAIConfig.data, overwriteAppAIConfig]);

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
      <Surface tone="card" className="space-y-3 p-4" data-testid="nimi-app-ai-config">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">
              {t('Chat.settingsChatSection', { defaultValue: 'Nimi Chat AI' })}
            </div>
            <div className="mt-1 text-xs text-[var(--nimi-text-muted)]">
              {t('Chat.settingsAppAIConfigOwnerHint', {
                defaultValue: 'This choice belongs to the Nimi Desktop app. Local execution uses the machine’s current Local AI configuration.',
              })}
            </div>
          </div>
          <StatusBadge
            tone={routeKind ? 'success' : 'warning'}
          >
            {routeKind === 'local'
              ? t('Chat.settingsRouteLocal', { defaultValue: 'Local' })
              : routeKind === 'cloud'
                ? t('Chat.settingsRouteCloud', { defaultValue: 'Cloud' })
                : t('Chat.settingsCapabilityNeedsSetup', { defaultValue: 'Needs setup' })}
          </StatusBadge>
        </div>

        {appAIConfig.isError ? (
          <InlineAlert tone="warning">
            {t('Chat.settingsAppAIConfigUnavailable', {
              defaultValue: 'The Nimi Desktop AI configuration is not available yet. Apply an AIProfile or finish Runtime setup first.',
            })}
          </InlineAlert>
        ) : null}

        {routeKind === 'cloud' ? (
          <InlineAlert tone="info">
            {textIntent?.route.oneofKind === 'cloud' && textIntent.route.cloud.connectorGrantId
              ? t('Chat.settingsCloudGrantSelected', { defaultValue: 'A Cloud connector grant is selected for this app.' })
              : t('Chat.settingsCloudGrantRequired', { defaultValue: 'Cloud intent is saved. Select a connector grant before execution.' })}
          </InlineAlert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            tone={routeKind === 'local' ? 'primary' : 'secondary'}
            size="sm"
            disabled={appAIConfig.isPending || overwriteAppAIConfig.isPending}
            onClick={handleUseLocal}
          >
            {t('Chat.settingsUseLocalAI', { defaultValue: 'Use Local AI' })}
          </Button>
          <Button tone="ghost" size="sm" onClick={handleManageProfiles}>
            {t('Chat.settingsManageProfiles', { defaultValue: 'Manage AIProfiles' })}
          </Button>
        </div>

        {overwriteAppAIConfig.error ? (
          <InlineAlert tone="danger">
            {overwriteAppAIConfig.error instanceof Error
              ? overwriteAppAIConfig.error.message
              : t('Chat.settingsAppAIConfigSaveFailed', { defaultValue: 'Failed to save Nimi Desktop AI configuration.' })}
          </InlineAlert>
        ) : null}
      </Surface>
      {footer}
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
