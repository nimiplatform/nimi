import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Button, InlineAlert, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import type { NimiJsonObject } from '@nimiplatform/sdk/contracts';
import { useAppStore } from '../../app-shell/providers/app-store';
import { useDesktopRendererCommands } from '../../renderer/binding-context.js';
import {
  createDesktopNimiCloudTextIntent,
  createDesktopNimiLocalTextIntent,
  desktopNimiTextIntentDefaults,
  findDesktopNimiTextIntent,
  replaceDesktopNimiTextIntent,
  useDesktopNimiAppAIConfig,
  useOverwriteDesktopNimiAppAIConfig,
} from './chat-nimi-app-ai-config.js';

export type ChatSettingsPanelProps = {
  mode?: 'ai' | 'human';
  headerSlot?: ReactNode;
  diagnosticsContent?: ReactNode;
  presenceContent?: ReactNode;
  unavailableReason?: string;
  onDiagnosticsVisibilityChange?: (visible: boolean) => void;
  showPresenceContent?: boolean;
  showDiagnosticsFooter?: boolean;
};

export function DisabledSettingsNote(props: { label: string }) {
  return <InlineAlert tone="info">{props.label}</InlineAlert>;
}

function HumanModeSettings(props: {
  diagnosticsContent?: ReactNode;
  unavailableReason: string;
  onDiagnosticsVisibilityChange?: (visible: boolean) => void;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    props.onDiagnosticsVisibilityChange?.(true);
    return () => { props.onDiagnosticsVisibilityChange?.(false); };
  }, [props.onDiagnosticsVisibilityChange]);

  return (
    <Surface tone="card" className="space-y-3 p-4">
      <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">
        {t('Chat.diagnosticsTitle', { defaultValue: 'Diagnostics' })}
      </div>
      {props.diagnosticsContent || <DisabledSettingsNote label={props.unavailableReason} />}
    </Surface>
  );
}

function parseDefaultsJson(value: string): NimiJsonObject | undefined {
  if (!value.trim()) return undefined;
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Defaults must be a JSON object.');
  }
  return parsed as NimiJsonObject;
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
  const [routeDraft, setRouteDraft] = useState<'local' | 'cloud'>('local');
  const [requiredFeaturesDraft, setRequiredFeaturesDraft] = useState('');
  const [defaultsDraft, setDefaultsDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);

  useEffect(() => {
    setRouteDraft(routeKind === 'cloud' ? 'cloud' : 'local');
    setRequiredFeaturesDraft(textIntent?.requiredFeatures.join(', ') ?? '');
    const defaults = desktopNimiTextIntentDefaults(textIntent);
    setDefaultsDraft(Object.keys(defaults).length > 0 ? JSON.stringify(defaults, null, 2) : '');
    setDraftError(null);
  }, [routeKind, textIntent]);

  useEffect(() => {
    props.onDiagnosticsVisibilityChange?.(true);
    return () => { props.onDiagnosticsVisibilityChange?.(false); };
  }, [props.onDiagnosticsVisibilityChange]);

  const handleManageProfiles = useCallback(() => {
    setActiveTab('runtime');
    runtimeConfigNavigation.openPage('profiles');
  }, [runtimeConfigNavigation, setActiveTab]);

  const handleSaveIntent = useCallback(() => {
    try {
      const requiredFeatures = requiredFeaturesDraft
        .split(',')
        .map((feature) => feature.trim())
        .filter(Boolean);
      const defaults = parseDefaultsJson(defaultsDraft);
      const nextIntent = routeDraft === 'local'
        ? createDesktopNimiLocalTextIntent({ requiredFeatures, defaults })
        : createDesktopNimiCloudTextIntent({
          requiredFeatures,
          defaults,
        });
      setDraftError(null);
      overwriteAppAIConfig.mutate(replaceDesktopNimiTextIntent(
        appAIConfig.data?.capabilities ?? [],
        nextIntent,
      ));
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : String(error || 'Invalid AI intent'));
    }
  }, [
    appAIConfig.data,
    defaultsDraft,
    overwriteAppAIConfig,
    requiredFeaturesDraft,
    routeDraft,
  ]);

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
      <Surface tone="card" className="space-y-4 p-4" data-testid="nimi-app-ai-config">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">
              {t('Chat.settingsChatSection', { defaultValue: 'Nimi Chat AI' })}
            </div>
            <div className="mt-1 text-xs text-[var(--nimi-text-muted)]">
              {t('Chat.settingsAppAIConfigOwnerHint', {
                defaultValue: 'Nimi Desktop stores only capability intent. Runtime chooses and validates the implementation when execution starts.',
              })}
            </div>
          </div>
          <StatusBadge tone={routeKind ? 'success' : 'warning'}>
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
              defaultValue: 'Nimi Desktop AI intent could not be loaded from Runtime.',
            })}
          </InlineAlert>
        ) : null}

        <div className="space-y-2">
          <div className="text-xs font-semibold text-[var(--nimi-text-secondary)]">Execution intent</div>
          <div className="flex flex-wrap gap-2">
            <Button
              tone={routeDraft === 'local' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setRouteDraft('local')}
            >
              {t('Chat.settingsUseLocalAI', { defaultValue: 'Local' })}
            </Button>
            <Button
              tone={routeDraft === 'cloud' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setRouteDraft('cloud')}
            >
              {t('Chat.settingsRouteCloud', { defaultValue: 'Cloud' })}
            </Button>
          </div>
        </div>

        <label className="block space-y-1.5 text-xs text-[var(--nimi-text-secondary)]">
          <span className="font-semibold">Required features</span>
          <input
            value={requiredFeaturesDraft}
            onChange={(event) => setRequiredFeaturesDraft(event.currentTarget.value)}
            placeholder="Comma-separated CapabilityContract features"
            className="min-h-9 w-full rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] px-3 text-sm text-[var(--nimi-text-primary)]"
          />
        </label>

        <label className="block space-y-1.5 text-xs text-[var(--nimi-text-secondary)]">
          <span className="font-semibold">Portable defaults (JSON)</span>
          <textarea
            value={defaultsDraft}
            onChange={(event) => setDefaultsDraft(event.currentTarget.value)}
            rows={4}
            spellCheck={false}
            placeholder="Optional capability defaults"
            className="w-full rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] p-3 font-mono text-xs text-[var(--nimi-text-primary)]"
          />
        </label>

        {routeDraft === 'cloud' ? (
          <InlineAlert tone="info">
            Cloud expresses App intent only. Runtime owns authorization, implementation selection, and typed execution failures.
          </InlineAlert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={appAIConfig.isPending || overwriteAppAIConfig.isPending}
            onClick={handleSaveIntent}
          >
            {overwriteAppAIConfig.isPending ? 'Saving…' : 'Save intent'}
          </Button>
          <Button tone="ghost" size="sm" onClick={handleManageProfiles}>
            {t('Chat.settingsManageProfiles', { defaultValue: 'Apply portable AIProfile' })}
          </Button>
        </div>

        {draftError ? <InlineAlert tone="danger">{draftError}</InlineAlert> : null}
        {overwriteAppAIConfig.error ? (
          <>
            <InlineAlert tone="danger">
              {t('Chat.settingsAppAIConfigSaveFailed', {
                defaultValue: 'Runtime could not save the Nimi Desktop AI intent.',
              })}
            </InlineAlert>
            <details className="rounded-lg border border-[var(--nimi-border-subtle)] p-2 text-xs text-[var(--nimi-text-secondary)]">
              <summary className="cursor-pointer font-semibold">Technical details</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px]">
                {overwriteAppAIConfig.error instanceof Error
                  ? overwriteAppAIConfig.error.message
                  : String(overwriteAppAIConfig.error)}
              </pre>
            </details>
          </>
        ) : null}
      </Surface>
      {footer}
    </div>
  );
}

export function ChatSettingsPanel({
  mode = 'ai',
  headerSlot,
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
        diagnosticsContent={diagnosticsContent}
        unavailableReason={resolvedUnavailableReason}
        onDiagnosticsVisibilityChange={onDiagnosticsVisibilityChange}
      />
    </div>
  );
}
