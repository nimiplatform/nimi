import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Button, InlineAlert, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import type {
  AgentCenterCloudAuthorizationOptions,
  AgentCenterCloudImplementationOption,
  AgentCenterCloudTargetOption,
} from '@nimiplatform/kit/features/agent-center';
import { runtimeAIConfigStructToJson } from '@nimiplatform/sdk/ai';
import type { NimiJsonObject } from '@nimiplatform/sdk/contracts';
import { useAppStore } from '../../app-shell/providers/app-store';
import {
  useDesktopRendererCommands,
  useDesktopRendererSdk,
} from '../../renderer/binding-context.js';
import {
  createDesktopNimiCloudTextIntent,
  createDesktopNimiLocalTextIntent,
  desktopNimiTextIntentDefaults,
  findDesktopNimiTextIntent,
  replaceDesktopNimiTextIntent,
  useDesktopNimiAppAIConfig,
  useOverwriteDesktopNimiAppAIConfig,
} from './chat-nimi-app-ai-config.js';
import { createDesktopCloudAIConfigModule } from './chat-cloud-ai-config-module.js';

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

const EMPTY_CLOUD_AUTHORIZATION: AgentCenterCloudAuthorizationOptions = {
  connectors: [],
  grants: [],
};

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
  const sdk = useDesktopRendererSdk();
  const cloudAIConfig = useMemo(() => createDesktopCloudAIConfigModule(sdk), [sdk]);
  const { t } = useTranslation();
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const appAIConfig = useDesktopNimiAppAIConfig();
  const overwriteAppAIConfig = useOverwriteDesktopNimiAppAIConfig();
  const textIntent = findDesktopNimiTextIntent(appAIConfig.data);
  const routeKind = textIntent?.route.oneofKind;
  const currentCloud = textIntent?.route.oneofKind === 'cloud' ? textIntent.route.cloud : null;
  const currentTarget = useMemo(
    () => runtimeAIConfigStructToJson(currentCloud?.providerModelTarget),
    [currentCloud?.providerModelTarget],
  );
  const currentProvider = jsonText(currentTarget.provider);
  const currentModel = jsonText(currentTarget.providerModelId) || jsonText(currentTarget.model);
  const [routeDraft, setRouteDraft] = useState<'local' | 'cloud'>('local');
  const [requiredFeaturesDraft, setRequiredFeaturesDraft] = useState('');
  const [defaultsDraft, setDefaultsDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudOptionsLoaded, setCloudOptionsLoaded] = useState(false);
  const [cloudImplementations, setCloudImplementations] = useState<readonly AgentCenterCloudImplementationOption[]>([]);
  const [cloudTargets, setCloudTargets] = useState<readonly AgentCenterCloudTargetOption[]>([]);
  const [cloudAuthorization, setCloudAuthorization] = useState<AgentCenterCloudAuthorizationOptions>(EMPTY_CLOUD_AUTHORIZATION);
  const [cloudImplementationId, setCloudImplementationId] = useState('');
  const [cloudTargetId, setCloudTargetId] = useState('');
  const [cloudGrantId, setCloudGrantId] = useState('');
  const [cloudConnectorId, setCloudConnectorId] = useState('');
  const [cloudTargetConfirmed, setCloudTargetConfirmed] = useState(false);

  useEffect(() => {
    setRouteDraft(routeKind === 'cloud' ? 'cloud' : 'local');
    setRequiredFeaturesDraft(textIntent?.requiredFeatures.join(', ') ?? '');
    const defaults = desktopNimiTextIntentDefaults(textIntent);
    setDefaultsDraft(Object.keys(defaults).length > 0 ? JSON.stringify(defaults, null, 2) : '');
    setCloudImplementationId(currentProvider);
    setCloudTargetId(currentProvider && currentModel ? cloudTargetOptionId(currentProvider, currentModel) : '');
    setCloudGrantId(currentCloud?.connectorGrantId ?? '');
    setCloudTargetConfirmed(false);
    setDraftError(null);
  }, [currentCloud?.connectorGrantId, currentModel, currentProvider, routeKind, textIntent]);

  const loadCloudOptions = useCallback(async () => {
    setCloudLoading(true);
    setDraftError(null);
    try {
      const implementations = await cloudAIConfig.listImplementations('text.generate');
      setCloudImplementations(implementations);
      if (currentProvider && implementations.some((item) => item.optionId === currentProvider)) {
        setCloudImplementationId(currentProvider);
      }
      try {
        setCloudAuthorization(await cloudAIConfig.listAuthorizationOptions());
      } catch {
        setCloudAuthorization(EMPTY_CLOUD_AUTHORIZATION);
        setDraftError(t('Chat.settingsCloudAuthorizationLoadFailed', {
          defaultValue: 'Account authorization choices could not be loaded. You may still save with no authorization selected.',
        }));
      }
    } catch {
      setDraftError(t('Chat.settingsCloudChoicesLoadFailed', {
        defaultValue: 'Cloud implementation and target choices could not be loaded.',
      }));
    } finally {
      setCloudOptionsLoaded(true);
      setCloudLoading(false);
    }
  }, [cloudAIConfig, currentProvider, t]);

  useEffect(() => {
    if (routeDraft !== 'cloud' || cloudOptionsLoaded || cloudLoading) return;
    void loadCloudOptions();
  }, [cloudLoading, cloudOptionsLoaded, loadCloudOptions, routeDraft]);

  const selectedCloudImplementation = cloudImplementations.find(
    (item) => item.optionId === cloudImplementationId,
  ) ?? null;
  const selectedCloudTarget = cloudTargets.find((item) => item.targetId === cloudTargetId) ?? null;
  const selectedCloudGrant = cloudAuthorization.grants.find((item) => item.grantId === cloudGrantId) ?? null;
  const cloudConnectors = cloudAuthorization.connectors.filter(
    (connector) => connector.provider === selectedCloudImplementation?.provider,
  );
  const cloudGrants = cloudAuthorization.grants.filter((grant) => cloudConnectors.some(
    (connector) => connector.connectorId === grant.connectorId,
  ));

  useEffect(() => {
    if (!selectedCloudImplementation) {
      setCloudTargets([]);
      return;
    }
    let cancelled = false;
    setCloudLoading(true);
    void cloudAIConfig.listTargets({
      capabilityContract: 'text.generate',
      provider: selectedCloudImplementation.provider,
    }).then((targets) => {
      if (cancelled) return;
      setCloudTargets(targets);
      if (
        currentProvider === selectedCloudImplementation.provider
        && currentModel
        && targets.some((target) => target.targetId === cloudTargetOptionId(currentProvider, currentModel))
      ) {
        setCloudTargetId(cloudTargetOptionId(currentProvider, currentModel));
      }
    }).catch(() => {
      if (!cancelled) setDraftError(t('Chat.settingsCloudChoicesLoadFailed', {
        defaultValue: 'Cloud implementation and target choices could not be loaded.',
      }));
    }).finally(() => {
      if (!cancelled) setCloudLoading(false);
    });
    return () => { cancelled = true; };
  }, [cloudAIConfig, currentModel, currentProvider, selectedCloudImplementation, t]);

  useEffect(() => {
    props.onDiagnosticsVisibilityChange?.(true);
    return () => { props.onDiagnosticsVisibilityChange?.(false); };
  }, [props.onDiagnosticsVisibilityChange]);

  const handleManageProfiles = useCallback(() => {
    setActiveTab('runtime');
    runtimeConfigNavigation.openPage('profiles');
  }, [runtimeConfigNavigation, setActiveTab]);

  const handleCreateCloudGrant = useCallback(async () => {
    if (!cloudConnectorId) return;
    setCloudLoading(true);
    setDraftError(null);
    try {
      const grant = await cloudAIConfig.createGrant(cloudConnectorId);
      setCloudAuthorization(await cloudAIConfig.listAuthorizationOptions());
      setCloudGrantId(grant.grantId);
    } catch {
      setDraftError(t('Chat.settingsCloudCreateGrantFailed', {
        defaultValue: 'Account authorization could not be created.',
      }));
    } finally {
      setCloudLoading(false);
    }
  }, [cloudAIConfig, cloudConnectorId, t]);

  const handleSaveIntent = useCallback(() => {
    try {
      const requiredFeatures = requiredFeaturesDraft
        .split(',')
        .map((feature) => feature.trim())
        .filter(Boolean);
      const defaults = parseDefaultsJson(defaultsDraft);
      const nextIntent = routeDraft === 'local'
        ? createDesktopNimiLocalTextIntent({ requiredFeatures, defaults })
        : (() => {
          if (!selectedCloudImplementation || !selectedCloudTarget || !cloudTargetConfirmed) {
            throw new Error(t('Chat.settingsCloudTargetConfirmationRequired', {
              defaultValue: 'Choose and confirm an existing Cloud implementation and provider-model target.',
            }));
          }
          if (cloudGrantId && selectedCloudGrant?.status !== 'active') {
            throw new Error(t('Chat.settingsCloudGrantRevoked', {
              defaultValue: 'The selected account authorization is no longer active.',
            }));
          }
          return createDesktopNimiCloudTextIntent(
            { requiredFeatures, defaults },
            {
              implementation: selectedCloudImplementation.implementation,
              providerModelTarget: selectedCloudTarget.providerModelTarget,
              connectorGrantId: cloudGrantId || null,
            },
          );
        })();
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
    cloudGrantId,
    cloudTargetConfirmed,
    overwriteAppAIConfig,
    requiredFeaturesDraft,
    routeDraft,
    selectedCloudGrant?.status,
    selectedCloudImplementation,
    selectedCloudTarget,
    t,
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
                defaultValue: 'Nimi Desktop stores capability intent. Cloud intent includes an explicitly confirmed implementation and target; Runtime validates the committed choice when execution starts.',
              })}
            </div>
          </div>
          <StatusBadge tone={routeKind ? 'success' : 'warning'}>
            {routeKind === 'local'
              ? t('Chat.settingsIntentLocal', { defaultValue: 'Local' })
              : routeKind === 'cloud'
                ? t('Chat.settingsIntentCloud', { defaultValue: 'Cloud' })
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
          <div className="text-xs font-semibold text-[var(--nimi-text-secondary)]">
            {t('Chat.settingsExecutionIntent', { defaultValue: 'Execution intent' })}
          </div>
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
              {t('Chat.settingsIntentCloud', { defaultValue: 'Cloud' })}
            </Button>
          </div>
        </div>

        <label className="block space-y-1.5 text-xs text-[var(--nimi-text-secondary)]">
          <span className="font-semibold">
            {t('Chat.settingsRequiredFeatures', { defaultValue: 'Required features' })}
          </span>
          <input
            value={requiredFeaturesDraft}
            onChange={(event) => setRequiredFeaturesDraft(event.currentTarget.value)}
            placeholder={t('Chat.settingsRequiredFeaturesPlaceholder', {
              defaultValue: 'Comma-separated CapabilityContract features',
            })}
            className="min-h-9 w-full rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] px-3 text-sm text-[var(--nimi-text-primary)]"
          />
        </label>

        <label className="block space-y-1.5 text-xs text-[var(--nimi-text-secondary)]">
          <span className="font-semibold">
            {t('Chat.settingsPortableDefaults', { defaultValue: 'Portable defaults (JSON)' })}
          </span>
          <textarea
            value={defaultsDraft}
            onChange={(event) => setDefaultsDraft(event.currentTarget.value)}
            rows={4}
            spellCheck={false}
            placeholder={t('Chat.settingsPortableDefaultsPlaceholder', {
              defaultValue: 'Optional capability defaults',
            })}
            className="w-full rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] p-3 font-mono text-xs text-[var(--nimi-text-primary)]"
          />
        </label>

        {routeDraft === 'cloud' ? (
          <div className="space-y-4 rounded-xl border border-[var(--nimi-border-subtle)] p-3" data-chat-cloud-config="true">
            <div className="space-y-2">
              <div className="text-xs font-semibold text-[var(--nimi-text-primary)]">
                {t('Chat.settingsCloudTargetStep', { defaultValue: '1. Confirm implementation and target' })}
              </div>
              <label className="block space-y-1.5 text-xs text-[var(--nimi-text-secondary)]">
                <span className="font-semibold">
                  {t('Chat.settingsCloudImplementation', { defaultValue: 'Cloud implementation' })}
                </span>
                <select
                  aria-label={t('Chat.settingsCloudImplementation', { defaultValue: 'Cloud implementation' })}
                  className="min-h-9 w-full rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] px-3 text-sm text-[var(--nimi-text-primary)]"
                  disabled={cloudLoading}
                  value={cloudImplementationId}
                  onChange={(event) => {
                    setCloudImplementationId(event.currentTarget.value);
                    setCloudTargetId('');
                    setCloudGrantId('');
                    setCloudConnectorId('');
                    setCloudTargetConfirmed(false);
                  }}
                >
                  <option value="">
                    {t('Chat.settingsCloudImplementationPlaceholder', { defaultValue: 'Choose an existing implementation' })}
                  </option>
                  {cloudImplementations.map((implementation) => (
                    <option key={implementation.optionId} value={implementation.optionId}>{implementation.label}</option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1.5 text-xs text-[var(--nimi-text-secondary)]">
                <span className="font-semibold">
                  {t('Chat.settingsCloudTarget', { defaultValue: 'Provider-model target' })}
                </span>
                <select
                  aria-label={t('Chat.settingsCloudTarget', { defaultValue: 'Provider-model target' })}
                  className="min-h-9 w-full rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] px-3 text-sm text-[var(--nimi-text-primary)]"
                  disabled={!selectedCloudImplementation || cloudLoading}
                  value={cloudTargetId}
                  onChange={(event) => {
                    setCloudTargetId(event.currentTarget.value);
                    setCloudTargetConfirmed(false);
                  }}
                >
                  <option value="">
                    {t('Chat.settingsCloudTargetPlaceholder', { defaultValue: 'Choose an existing target' })}
                  </option>
                  {cloudTargets.map((target) => (
                    <option key={target.targetId} value={target.targetId}>{target.label}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-start gap-2 text-xs text-[var(--nimi-text-secondary)]">
                <input
                  checked={cloudTargetConfirmed}
                  disabled={!selectedCloudTarget}
                  onChange={(event) => setCloudTargetConfirmed(event.currentTarget.checked)}
                  type="checkbox"
                />
                <span>{t('Chat.settingsCloudTargetConfirmation', {
                  defaultValue: 'I confirm this implementation and provider-model target.',
                })}</span>
              </label>
            </div>

            <div className="space-y-2 border-t border-[var(--nimi-border-subtle)] pt-3">
              <div className="text-xs font-semibold text-[var(--nimi-text-primary)]">
                {t('Chat.settingsCloudAuthorizationStep', { defaultValue: '2. Select account authorization' })}
              </div>
              <label className="block space-y-1.5 text-xs text-[var(--nimi-text-secondary)]">
                <span className="font-semibold">
                  {t('Chat.settingsCloudAuthorization', { defaultValue: 'Account authorization' })}
                </span>
                <select
                  aria-label={t('Chat.settingsCloudAuthorization', { defaultValue: 'Account authorization' })}
                  className="min-h-9 w-full rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] px-3 text-sm text-[var(--nimi-text-primary)]"
                  disabled={!selectedCloudImplementation || cloudLoading}
                  value={cloudGrantId}
                  onChange={(event) => setCloudGrantId(event.currentTarget.value)}
                >
                  <option value="">{t('Chat.settingsCloudAuthorizationNone', { defaultValue: 'No authorization selected' })}</option>
                  {cloudGrantId && !selectedCloudGrant ? (
                    <option disabled value={cloudGrantId}>{cloudGrantId}</option>
                  ) : null}
                  {cloudGrants.map((grant) => {
                    const connector = cloudAuthorization.connectors.find((item) => item.connectorId === grant.connectorId);
                    return (
                      <option disabled={grant.status !== 'active'} key={grant.grantId} value={grant.grantId}>
                        {connector?.label || grant.connectorId} · {grant.status === 'active'
                          ? t('Chat.settingsCloudGrantActive', { defaultValue: 'Active' })
                          : t('Chat.settingsCloudGrantRevokedStatus', { defaultValue: 'Revoked' })}
                      </option>
                    );
                  })}
                </select>
              </label>
              {!cloudGrantId ? (
                <InlineAlert tone="info">
                  {t('Chat.settingsCloudGrantSelectionRequired', {
                    defaultValue: 'Account authorization still needs to be selected. You may save this information state and choose one later.',
                  })}
                </InlineAlert>
              ) : null}
              {cloudGrantId && selectedCloudGrant?.status !== 'active' ? (
                <InlineAlert tone="warning">
                  {t('Chat.settingsCloudGrantRevoked', { defaultValue: 'The selected account authorization is no longer active.' })}
                </InlineAlert>
              ) : null}
              <div className="flex min-w-0 gap-2">
                <select
                  aria-label={t('Chat.settingsCloudConnector', { defaultValue: 'Connector for account authorization' })}
                  className="min-h-9 min-w-0 flex-1 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] px-3 text-sm text-[var(--nimi-text-primary)]"
                  disabled={!selectedCloudImplementation || cloudLoading}
                  value={cloudConnectorId}
                  onChange={(event) => setCloudConnectorId(event.currentTarget.value)}
                >
                  <option value="">{t('Chat.settingsCloudConnectorPlaceholder', { defaultValue: 'Choose a connector for this provider' })}</option>
                  {cloudConnectors.map((connector) => (
                    <option key={connector.connectorId} value={connector.connectorId}>{connector.label}</option>
                  ))}
                </select>
                <Button
                  disabled={!cloudConnectorId || cloudLoading}
                  onClick={() => { void handleCreateCloudGrant(); }}
                  size="sm"
                  tone="secondary"
                >
                  {t('Chat.settingsCloudCreateGrant', { defaultValue: 'Create authorization' })}
                </Button>
              </div>
              <div className="text-[11px] leading-relaxed text-[var(--nimi-text-muted)]">
                {t('Chat.settingsCloudAuthorizationSeparation', {
                  defaultValue: 'Authorization identifies the account only. It does not choose or change the implementation or target.',
                })}
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={
              appAIConfig.isPending
              || overwriteAppAIConfig.isPending
              || (routeDraft === 'cloud' && (
                cloudLoading
                || !selectedCloudImplementation
                || !selectedCloudTarget
                || !cloudTargetConfirmed
                || (cloudGrantId !== '' && selectedCloudGrant?.status !== 'active')
              ))
            }
            onClick={handleSaveIntent}
          >
            {overwriteAppAIConfig.isPending
              ? t('Chat.settingsSavingIntent', { defaultValue: 'Saving…' })
              : t('Chat.settingsSaveIntent', { defaultValue: 'Save intent' })}
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
              <summary className="cursor-pointer font-semibold">
                {t('Chat.settingsTechnicalDetails', { defaultValue: 'Technical details' })}
              </summary>
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

function cloudTargetOptionId(provider: string, modelId: string): string {
  return JSON.stringify([provider, modelId]);
}

function jsonText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
