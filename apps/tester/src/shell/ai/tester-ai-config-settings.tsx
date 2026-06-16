import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Button, IconButton, ScrollArea, StatusBadge, Surface, TextareaField } from '@nimiplatform/kit/ui';
import {
  ModelConfigAiModelHub,
  defaultModelConfigProfileCopy,
  useModelConfigProfileController,
  type AppModelConfigSurface,
  type ModelConfigProjectionStatus,
  type SharedAIConfigService,
} from '@nimiplatform/kit/features/model-config';
import type { CanonicalCapabilitySectionId } from '@nimiplatform/kit/core/runtime-capabilities';
import type { RouteModelPickerDataProvider } from '@nimiplatform/kit/features/model-picker';
import type {
  NimiAICapabilityRequirementDeclaration,
  NimiAIConfig,
  NimiAIConfigTargetRef,
  NimiAIScopeRef,
} from '@nimiplatform/kit/core/sdk-contract';
import { X } from 'lucide-react';

// Scaffold-managed AI config Settings surface.
//
// The app owns only the injected scope, service, runtime model-picker provider,
// and import side effect. The rendered model-config body is the kit
// ModelConfigAiModelHub, including capability drill-down via initialSection.

export type TesterAiConfigProfileImportResult = {
  ok: boolean;
  message: string;
  errors?: string[];
  profileId?: string;
};

export type TesterAiConfigSettingsProps = {
  scopeRef: NimiAIScopeRef;
  service: SharedAIConfigService;
  enabledCapabilities: readonly string[];
  providerResolver: (capabilityId: string) => RouteModelPickerDataProvider | null;
  localAssetSource?: AppModelConfigSurface['localAssetSource'];
  runtimeReady: boolean;
  runtimeDetail: string | null;
  copy: Record<string, string>;
  /** Open straight into this section's detail from the studio model gear. */
  initialSection?: CanonicalCapabilitySectionId | null;
  /** Full settings surface or capability-scoped drawer launched from the studio gear. */
  variant?: 'full' | 'capability-drawer';
  /** Slide-over close affordance. When omitted the panel renders inline. */
  onClose?: () => void;
  /** Optional AIProfile JSON import (app-owned profile library write). */
  onImportProfileJson?: (json: string) => TesterAiConfigProfileImportResult;
};

function makeTranslator(copy: Record<string, string>) {
  return (key: string, vars?: Readonly<Record<string, string | number>>): string => {
    const value = copy[key] || (typeof vars?.defaultValue === 'string' ? vars.defaultValue : key);
    if (!vars) return value;
    return Object.entries(vars).reduce(
      (current, [name, replacement]) => current.replaceAll(`{{${name}}}`, String(replacement)),
      value,
    );
  };
}

function bindingStatus(
  config: NimiAIConfig,
  capabilityId: string,
  runtimeReady: boolean,
  runtimeDetail: string | null,
): ModelConfigProjectionStatus {
  if (!runtimeReady) {
    return {
      supported: false,
      tone: 'attention',
      badgeLabel: 'Runtime unavailable',
      title: 'Runtime unavailable',
      detail: runtimeDetail || 'Runtime readiness has not succeeded.',
    };
  }
  const targetRef = config.capabilities.targetRefs[capabilityId] || null;
  if (!targetRef) {
    return {
      supported: false,
      tone: 'attention',
      badgeLabel: 'Needs target',
      title: 'Target required',
      detail: 'Runs fail closed until this capability has an NimiAIConfig targetRef.',
    };
  }
  return {
    supported: true,
    tone: 'ready',
    badgeLabel: 'Bound',
    title: 'Target configured',
    detail: targetRefDetail(targetRef),
  };
}

function targetRefDetail(targetRef: NimiAIConfigTargetRef): string | null {
  if (targetRef.kind === 'cloud-connector') {
    return targetRef.providerModelId || targetRef.connectorId || null;
  }
  if (targetRef.kind === 'local-runtime') {
    return targetRef.profileId || targetRef.targetId || targetRef.readinessRef || null;
  }
  return `${targetRef.sourceProfileId}:${targetRef.sliceId}`;
}

function useLiveAIConfig(service: SharedAIConfigService, scopeRef: NimiAIScopeRef): NimiAIConfig {
  const [config, setConfig] = useState<NimiAIConfig>(() => service.aiConfig.get(scopeRef));
  useEffect(() => {
    setConfig(service.aiConfig.get(scopeRef));
    return service.aiConfig.subscribe(scopeRef, setConfig);
  }, [service, scopeRef]);
  return config;
}

function createRequirementDeclaration(
  scopeRef: NimiAIScopeRef,
  capabilities: readonly string[],
): NimiAICapabilityRequirementDeclaration {
  return {
    requirementId: `${scopeRef.ownerId}:${scopeRef.surfaceId || 'default'}:tester-settings`,
    scopeRef,
    requiredSlices: capabilities.map((capability) => ({
      requirementSliceId: `tester-settings.${capability}`,
      capability,
      profileSliceRef: `profile.${capability}`,
      readinessPolicy: 'required' as const,
    })),
    setupProjectionPolicy: 'sdk-ai-config-setup-projection',
  };
}

export function TesterAiConfigSettings({
  scopeRef,
  service,
  enabledCapabilities,
  providerResolver,
  localAssetSource,
  runtimeReady,
  runtimeDetail,
  copy,
  initialSection = null,
  variant = 'full',
  onClose,
  onImportProfileJson,
}: TesterAiConfigSettingsProps) {
  const t = useMemo(() => makeTranslator(copy), [copy]);
  const config = useLiveAIConfig(service, scopeRef);
  const [profileJson, setProfileJson] = useState('');
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importTone, setImportTone] = useState<'success' | 'warning' | 'neutral'>('neutral');

  const requirementDeclaration = useMemo(
    () => createRequirementDeclaration(scopeRef, enabledCapabilities),
    [enabledCapabilities, scopeRef],
  );
  const surface: AppModelConfigSurface = useMemo(() => ({
    scopeRef,
    aiConfigService: service,
    requirementDeclaration,
    providerResolver: (capabilityId: string) => (runtimeReady ? providerResolver(capabilityId) : null),
    projectionResolver: (capabilityId: string) => bindingStatus(config, capabilityId, runtimeReady, runtimeDetail),
    localAssetSource,
    runtimeNotReadyLabel: runtimeDetail || 'Runtime unavailable',
    i18n: { t },
  }), [config, localAssetSource, providerResolver, requirementDeclaration, runtimeDetail, runtimeReady, scopeRef, service, t]);

  const profileCopy = useMemo(() => defaultModelConfigProfileCopy(t), [t]);
  const currentOrigin = useMemo(
    () => (config.profileOrigin
      ? { profileId: config.profileOrigin.profileId, title: config.profileOrigin.title }
      : null),
    [config.profileOrigin],
  );
  const profileController = useModelConfigProfileController({
    scopeRef,
    aiConfigService: service,
    requirementDeclaration,
    copy: profileCopy,
    currentOrigin,
  });

  function importProfile() {
    if (!onImportProfileJson) return;
    const result = onImportProfileJson(profileJson);
    setImportTone(result.ok ? 'success' : 'warning');
    setImportMessage(result.ok
      ? `${result.message} Open Apply AI Profile to preview and confirm.`
      : `${result.message} ${(result.errors || []).join('; ')}`.trim());
    if (result.ok && result.profileId) {
      setProfileJson('');
      profileController.onCancelPreview();
      profileController.onReload?.();
      profileController.onSelectedProfileChange(result.profileId);
    }
  }

  const drawer = variant === 'capability-drawer';
  const importFooter = !drawer && onImportProfileJson ? (
    <div className="grid gap-3 border-t border-[var(--nimi-border-subtle)] pt-4">
      <TextareaField
        rows={4}
        wrap="soft"
        aria-label="AIProfile JSON"
        placeholder='{"profileId":"tester-runtime","title":"Tester Runtime Profile","capabilities":{"text.generate":{"targetRef":{"kind":"cloud-connector","connectorId":"runtime-connector-id","providerModelId":"runtime-model-id"}}}}'
        value={profileJson}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setProfileJson(event.currentTarget.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          tone="secondary"
          disabled={!profileJson.trim()}
          onClick={importProfile}
        >
          Import AIProfile JSON
        </Button>
        {importMessage ? <StatusBadge tone={importTone} shape="dot">{importMessage}</StatusBadge> : null}
      </div>
    </div>
  ) : null;

  return (
    <Surface
      as="section"
      tone="panel"
      material="glass-regular"
      elevation="floating"
      padding="none"
      role="group"
      aria-label={t('Tester.settings.title')}
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-none border-0 bg-white/95 shadow-none"
    >
      {!drawer ? (
        <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-[var(--nimi-border-subtle)] px-4">
          <div className="min-w-0 flex-1">
            <strong className="block truncate text-[15px] font-semibold text-[var(--nimi-text-primary)]">
              {t('Tester.settings.title')}
            </strong>
            <span className="block truncate text-xs text-[var(--nimi-text-muted)]">
              {t('Tester.settings.subtitle')}
            </span>
          </div>
          <StatusBadge tone={runtimeReady ? 'success' : 'warning'} shape="dot">
            {runtimeReady ? 'Runtime ready' : 'Runtime unavailable'}
          </StatusBadge>
          {onClose ? (
            <IconButton
              aria-label={t('Tester.settings.close')}
              tone="ghost"
              size="sm"
              icon={<X size={16} />}
              onClick={onClose}
            />
          ) : null}
        </header>
      ) : null}
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-4 py-4">
          <ModelConfigAiModelHub
            surface={surface}
            profile={profileController}
            initialSection={initialSection}
            detailOnly={drawer}
            detailHeaderAction={drawer && onClose ? (
              <IconButton
                aria-label={t('Tester.settings.close')}
                tone="ghost"
                size="sm"
                icon={<X size={16} />}
                onClick={onClose}
              />
            ) : null}
            footer={importFooter}
          />
        </div>
      </ScrollArea>
    </Surface>
  );
}
