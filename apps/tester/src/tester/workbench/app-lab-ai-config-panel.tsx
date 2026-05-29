import { useEffect, useMemo, useState } from 'react';
import { Button, StatusBadge, Surface, TextareaField } from '@nimiplatform/kit/ui';
import {
  ModelConfigAiModelHub,
  defaultModelConfigProfileCopy,
  useModelConfigProfileController,
  type AppModelConfigSurface,
  type ModelConfigProjectionStatus,
} from '@nimiplatform/kit/features/model-config';
import { applyAIProfileToConfig, type AIConfig } from '@nimiplatform/sdk/ai';
import { Upload } from 'lucide-react';
import type { TesterRuntimeInspection } from '../tester-runtime.js';
import {
  createTesterAIConfigService,
  createTesterAppLabAIScopeRef,
  importTesterAIProfileJson,
} from '../tester-ai-config-store.js';
import { createTesterRuntimeModelPickerProvider } from '../tester-runtime-model-provider.js';

type AppLabAIConfigPanelProps = {
  runtime: TesterRuntimeInspection | null;
};

const enabledCapabilities = ['text.generate', 'text.embed'] as const;

const copy: Record<string, string> = {
  'ModelConfig.hub.title': 'AIConfig',
  'ModelConfig.hub.aggregateReady': 'ready',
  'ModelConfig.hub.aggregateAttention': 'attention',
  'ModelConfig.hub.aggregateNeutral': 'unset',
  'ModelConfig.hub.aggregateEmpty': 'No bindings',
  'ModelConfig.section.chat.title': 'Text',
  'ModelConfig.section.embed.title': 'Embeddings',
  'ModelConfig.capability.text.generate.title': 'Text generation',
  'ModelConfig.capability.text.generate.subtitle': 'Used by text.generate and chat.stream',
  'ModelConfig.capability.text.embed.title': 'Embeddings',
  'ModelConfig.capability.text.embed.subtitle': 'Used by text.embed',
  'ModelConfig.profile.sectionTitle': 'AIProfile',
  'ModelConfig.profile.summaryLabel': 'Profile',
  'ModelConfig.profile.emptySummaryLabel': 'No profile applied',
  'ModelConfig.profile.applyButtonLabel': 'Apply',
  'ModelConfig.profile.changeButtonLabel': 'Change',
  'ModelConfig.profile.manageButtonTitle': 'Profiles',
  'ModelConfig.profile.modalTitle': 'Apply AIProfile',
  'ModelConfig.profile.modalHint': 'Choose an imported profile for this App Lab scope.',
  'ModelConfig.profile.loadingLabel': 'Loading profiles',
  'ModelConfig.profile.emptyLabel': 'No imported AIProfiles',
  'ModelConfig.profile.currentBadgeLabel': 'Current',
  'ModelConfig.profile.cancelLabel': 'Cancel',
  'ModelConfig.profile.confirmLabel': 'Preview',
  'ModelConfig.profile.applyingLabel': 'Applying',
  'ModelConfig.profile.reloadLabel': 'Reload',
  'ModelConfig.profile.importLabel': 'Apply imported AIProfile',
  'ModelConfig.profile.previewTitle': 'Preview AIConfig changes',
  'ModelConfig.profile.previewHint': 'Review the AIConfig diff before applying.',
  'ModelConfig.profile.previewingLabel': 'Preparing preview',
  'ModelConfig.profile.previewFirstApplyLabel': 'First apply for this scope',
  'ModelConfig.profile.previewNoChangeLabel': 'No AIConfig changes',
  'ModelConfig.profile.previewBeforeLabel': 'Before',
  'ModelConfig.profile.previewAfterLabel': 'After',
  'ModelConfig.profile.previewWarningsLabel': 'Warnings',
  'ModelConfig.profile.previewConfirmLabel': 'Apply',
  'ModelConfig.profile.previewBackLabel': 'Back',
};

function t(key: string, vars?: Readonly<Record<string, string | number>>): string {
  const value = copy[key] || key;
  if (!vars) return value;
  return Object.entries(vars).reduce(
    (current, [name, replacement]) => current.replaceAll(`{{${name}}}`, String(replacement)),
    value,
  );
}

function bindingStatus(config: AIConfig, capabilityId: string, runtime: TesterRuntimeInspection | null): ModelConfigProjectionStatus {
  if (!runtime || runtime.status !== 'ready') {
    return {
      supported: false,
      tone: 'attention',
      badgeLabel: 'Runtime unavailable',
      title: 'Runtime unavailable',
      detail: runtime?.detail || 'Runtime readiness has not succeeded.',
    };
  }
  const binding = config.capabilities.selectedBindings[capabilityId] || null;
  if (!binding) {
    return {
      supported: false,
      tone: 'attention',
      badgeLabel: 'Needs binding',
      title: 'Binding required',
      detail: 'Runs fail closed until this capability has an AIConfig binding.',
    };
  }
  return {
    supported: true,
    tone: 'ready',
    badgeLabel: 'Bound',
    title: 'Binding configured',
    detail: binding.modelLabel || binding.model || null,
  };
}

function useLiveAIConfig(service: ReturnType<typeof createTesterAIConfigService>, scopeRef: ReturnType<typeof createTesterAppLabAIScopeRef>): AIConfig {
  const [config, setConfig] = useState<AIConfig>(() => service.aiConfig.get(scopeRef));
  useEffect(() => {
    setConfig(service.aiConfig.get(scopeRef));
    return service.aiConfig.subscribe(scopeRef, setConfig);
  }, [service, scopeRef]);
  return config;
}

export function AppLabAIConfigPanel({ runtime }: AppLabAIConfigPanelProps) {
  const scopeRef = useMemo(() => createTesterAppLabAIScopeRef(), []);
  const service = useMemo(() => createTesterAIConfigService(), []);
  const config = useLiveAIConfig(service, scopeRef);
  const [profileJson, setProfileJson] = useState('');
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importTone, setImportTone] = useState<'success' | 'warning' | 'neutral'>('neutral');
  const providerCache = useMemo(() => new Map<string, ReturnType<typeof createTesterRuntimeModelPickerProvider>>(), []);

  const surface: AppModelConfigSurface = useMemo(() => ({
    scopeRef,
    aiConfigService: service,
    enabledCapabilities,
    providerResolver: (capabilityId: string) => {
      if (!runtime || runtime.status !== 'ready') return null;
      const cached = providerCache.get(capabilityId);
      if (cached) return cached;
      const provider = createTesterRuntimeModelPickerProvider(capabilityId);
      providerCache.set(capabilityId, provider);
      return provider;
    },
    projectionResolver: (capabilityId: string) => bindingStatus(config, capabilityId, runtime),
    runtimeReady: runtime?.status === 'ready',
    runtimeNotReadyLabel: runtime?.detail || 'Runtime unavailable',
    i18n: { t },
  }), [config, providerCache, runtime, scopeRef, service]);

  const profileCopy = useMemo(() => defaultModelConfigProfileCopy(t), []);
  const currentOrigin = useMemo(
    () => (config.profileOrigin
      ? { profileId: config.profileOrigin.profileId, title: config.profileOrigin.title }
      : null),
    [config.profileOrigin],
  );
  const profileController = useModelConfigProfileController({
    scopeRef,
    aiConfigService: service,
    copy: profileCopy,
    applyAIProfileToConfig,
    currentOrigin,
  });

  function importProfile() {
    const result = importTesterAIProfileJson(profileJson);
    setImportTone(result.ok ? 'success' : 'warning');
    setImportMessage(result.ok ? result.message : `${result.message} ${result.errors.join('; ')}`);
    if (result.ok) {
      setProfileJson('');
      profileController.onReload?.();
      profileController.onSelectedProfileChange(result.profile.profileId);
      profileController.onApply(result.profile.profileId);
    }
  }

  const footer = (
    <div className="app-lab-ai-config__footer">
      <div className="app-lab-ai-config__scope">
        <StatusBadge tone={runtime?.status === 'ready' ? 'success' : 'warning'} shape="dot">
          {runtime?.status === 'ready' ? 'catalog live' : 'catalog unavailable'}
        </StatusBadge>
        <code>{scopeRef.kind}:{scopeRef.ownerId}:{scopeRef.surfaceId}</code>
      </div>
      <div className="app-lab-ai-config__import">
        <TextareaField
          rows={6}
          wrap="soft"
          aria-label="AIProfile JSON"
          placeholder='{"profileId":"tester-runtime","title":"Tester Runtime Profile","description":"","tags":[],"capabilities":{"text.generate":{"binding":{"source":"cloud","connectorId":"runtime-connector-id","model":"runtime-model-id"}}}}'
          value={profileJson}
          onChange={(event) => setProfileJson(event.currentTarget.value)}
        />
        <div className="app-lab-ai-config__import-actions">
          <Button
            type="button"
            tone="secondary"
            leadingIcon={<Upload size={14} />}
            disabled={!profileJson.trim()}
            onClick={importProfile}
          >
            Import AIProfile JSON
          </Button>
          {importMessage ? <StatusBadge tone={importTone} shape="dot">{importMessage}</StatusBadge> : null}
        </div>
      </div>
    </div>
  );

  return (
    <Surface className="app-lab-ai-config" material="glass-thin" tone="panel" elevation="base">
      <ModelConfigAiModelHub surface={surface} profile={profileController} footer={footer} />
    </Surface>
  );
}
