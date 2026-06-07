import { useEffect, useMemo, useState } from 'react';
import { Button, IconButton, ScrollArea, StatusBadge, Surface, TextareaField } from '@nimiplatform/kit/ui';
import {
  ModelConfigCapabilityDetail,
  ProfileConfigSection,
  SectionGroupHeader,
  defaultModelConfigProfileCopy,
  useModelConfigProfileController,
  type AppModelConfigSurface,
  type ModelConfigProjectionStatus,
  type SharedAIConfigService,
} from '@nimiplatform/kit/features/model-config';
import {
  CANONICAL_CAPABILITY_CATALOG_BY_ID,
  type CanonicalCapabilityDescriptor,
  type CanonicalCapabilitySectionId,
} from '@nimiplatform/kit/core/runtime-capabilities';
import {
  selectRequirementDescriptors,
  summarizeAiModelAggregate,
  type CapabilityEvaluation,
  type ModelConfigStatusTone,
} from '@nimiplatform/kit/core/model-config';
import type { RouteModelPickerDataProvider } from '@nimiplatform/kit/features/model-picker';
import type {
  NimiAICapabilityRequirementDeclaration,
  NimiAIConfig,
  NimiAIConfigTargetRef,
  NimiAIScopeRef,
} from '@nimiplatform/kit/core/sdk-contract';
import { ChevronLeft, ChevronRight, Upload, X } from 'lucide-react';

// Scaffold-managed AI config Settings surface.
//
// Mirrors the canonical Nimi Desktop tester settings model: a list of capability
// sections that drills into a per-capability detail backed by the admitted kit
// `ModelConfigCapabilityDetail` + `SharedAIConfigService` contract. Unlike kit's
// `ModelConfigAiModelHub`, this panel accepts an `initialSection` so the AI
// Capabilities settings gear can open straight into the capability under test.
// It owns NO truth: the app injects its app-scoped NimiAIConfig service, scope ref,
// model-picker provider resolver, and copy. Runtime model catalog stays Runtime
// truth (resolved through the SDK by the injected provider). Only admitted
// kit/SDK surfaces; no app-local provider/model defaults, no REST bypass.

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
  runtimeReady: boolean;
  runtimeDetail: string | null;
  copy: Record<string, string>;
  /** Open straight into this section's detail (e.g. from a capability gear). */
  initialSection?: CanonicalCapabilitySectionId | null;
  /** Slide-over close affordance. When omitted the panel renders inline. */
  onClose?: () => void;
  /** Optional AIProfile JSON import (app-owned profile library write). */
  onImportProfileJson?: (json: string) => TesterAiConfigProfileImportResult;
};

// Canonical section ordering — mirrors P-CAPCAT-001 enum / the desktop tester.
const SECTION_ORDER: ReadonlyArray<CanonicalCapabilitySectionId> = [
  'chat',
  'tts',
  'stt',
  'image',
  'video',
  'voice',
  'embed',
  'world',
];

function makeTranslator(copy: Record<string, string>) {
  return (key: string, vars?: Readonly<Record<string, string | number>>): string => {
    const value = copy[key] || key;
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

function groupBySection(
  descriptors: ReadonlyArray<CanonicalCapabilityDescriptor>,
): Map<CanonicalCapabilitySectionId, CanonicalCapabilityDescriptor[]> {
  const map = new Map<CanonicalCapabilitySectionId, CanonicalCapabilityDescriptor[]>();
  for (const descriptor of descriptors) {
    const list = map.get(descriptor.section) ?? [];
    list.push(descriptor);
    map.set(descriptor.section, list);
  }
  return map;
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

function statusDotTone(tone: ModelConfigStatusTone): 'success' | 'warning' | 'neutral' {
  if (tone === 'ready') return 'success';
  if (tone === 'attention') return 'warning';
  return 'neutral';
}

export function TesterAiConfigSettings({
  scopeRef,
  service,
  enabledCapabilities,
  providerResolver,
  runtimeReady,
  runtimeDetail,
  copy,
  initialSection = null,
  onClose,
  onImportProfileJson,
}: TesterAiConfigSettingsProps) {
  const t = useMemo(() => makeTranslator(copy), [copy]);
  const config = useLiveAIConfig(service, scopeRef);
  const [activeSection, setActiveSection] = useState<CanonicalCapabilitySectionId | null>(initialSection);
  const [profileJson, setProfileJson] = useState('');
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importTone, setImportTone] = useState<'success' | 'warning' | 'neutral'>('neutral');

  useEffect(() => {
    setActiveSection(initialSection ?? null);
  }, [initialSection]);

  const surface: AppModelConfigSurface = useMemo(() => ({
    scopeRef,
    aiConfigService: service,
    requirementDeclaration: createRequirementDeclaration(scopeRef, enabledCapabilities),
    providerResolver: (capabilityId: string) => (runtimeReady ? providerResolver(capabilityId) : null),
    projectionResolver: (capabilityId: string) => bindingStatus(config, capabilityId, runtimeReady, runtimeDetail),
    runtimeNotReadyLabel: runtimeDetail || 'Runtime unavailable',
    i18n: { t },
  }), [config, enabledCapabilities, providerResolver, runtimeDetail, runtimeReady, scopeRef, service, t]);

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
    requirementDeclaration: surface.requirementDeclaration,
    copy: profileCopy,
    currentOrigin,
  });

  const descriptors = useMemo(
    () => selectRequirementDescriptors(surface.requirementDeclaration, CANONICAL_CAPABILITY_CATALOG_BY_ID),
    [surface.requirementDeclaration],
  );
  const sectionMap = useMemo(() => groupBySection(descriptors), [descriptors]);
  const orderedSections = useMemo(
    () => SECTION_ORDER.filter((section) => sectionMap.has(section)),
    [sectionMap],
  );
  const evaluations: ReadonlyArray<CapabilityEvaluation> = useMemo(() => {
    const out: CapabilityEvaluation[] = [];
    for (const descriptor of descriptors) {
      out.push({
        capabilityId: descriptor.capabilityId,
        descriptor,
        status: surface.projectionResolver(descriptor.capabilityId),
        bindingPresent: Boolean(config.capabilities.targetRefs?.[descriptor.capabilityId]),
      });
    }
    return out;
  }, [config, descriptors, surface]);

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

  const inDetail = activeSection !== null;
  const headerTitle = inDetail
    ? t(`ModelConfig.section.${activeSection}.title`)
    : t('Tester.settings.title');
  const headerSubtitle = inDetail
    ? t('Tester.settings.detailSubtitle')
    : t('Tester.settings.subtitle');

  return (
    <Surface
      as="section"
      tone="panel"
      material="glass-regular"
      elevation="floating"
      padding="none"
      role="group"
      aria-label={t('Tester.settings.title')}
      className="tester-ai-config-settings"
    >
      <header className="tester-ai-config-settings__head">
        {inDetail ? (
          <IconButton
            aria-label={t('Tester.settings.back')}
            tone="ghost"
            size="sm"
            icon={<ChevronLeft size={16} />}
            onClick={() => setActiveSection(null)}
          />
        ) : null}
        <div className="tester-ai-config-settings__head-copy">
          <strong>{headerTitle}</strong>
          <span>{headerSubtitle}</span>
        </div>
        <div className="tester-ai-config-settings__head-aside">
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
        </div>
      </header>

      <ScrollArea className="tester-ai-config-settings__scroll">
        <div className="tester-ai-config-settings__body">
          {inDetail ? (
            <div className="tester-ai-config-settings__detail">
              <SectionGroupHeader label={t('Tester.settings.generalGroup')} />
              {(sectionMap.get(activeSection!) ?? []).map((descriptor) => (
                <ModelConfigCapabilityDetail
                  key={descriptor.capabilityId}
                  capabilityId={descriptor.capabilityId}
                  surface={surface}
                  config={config}
                  activeModelLabel={
                    (sectionMap.get(activeSection!) ?? []).length > 1
                      ? t(descriptor.i18nKeys.title)
                      : undefined
                  }
                />
              ))}
            </div>
          ) : (
            <div className="tester-ai-config-settings__list">
              <ProfileConfigSection controller={profileController} variant="import-button" />
              {orderedSections.map((section) => {
                const sectionEvaluations = evaluations.filter((evaluation) => evaluation.descriptor.section === section);
                const aggregate = summarizeAiModelAggregate(sectionEvaluations, {
                  ready: t('ModelConfig.hub.aggregateReady'),
                  attention: t('ModelConfig.hub.aggregateAttention'),
                  neutral: t('ModelConfig.hub.aggregateNeutral'),
                });
                const items = sectionMap.get(section) ?? [];
                const firstDescriptor = items[0];
                return (
                  <button
                    key={section}
                    type="button"
                    className="tester-ai-config-settings__section-row"
                    onClick={() => setActiveSection(section)}
                  >
                    <span className="tester-ai-config-settings__section-copy">
                      <strong>{t(`ModelConfig.section.${section}.title`)}</strong>
                      <span className="tester-ai-config-settings__section-sub">
                        <StatusBadge tone={statusDotTone(aggregate.statusDot)} shape="dot">
                          {aggregate.subtitle || (firstDescriptor ? t(firstDescriptor.i18nKeys.subtitle) : '')}
                        </StatusBadge>
                      </span>
                    </span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                );
              })}

              {onImportProfileJson ? (
                <div className="tester-ai-config-settings__import">
                  <TextareaField
                    rows={5}
                    wrap="soft"
                    aria-label="AIProfile JSON"
                    placeholder='{"profileId":"tester-runtime","title":"Tester Runtime Profile","capabilities":{"text.generate":{"targetRef":{"kind":"cloud-connector","connectorId":"runtime-connector-id","providerModelId":"runtime-model-id"}}}}'
                    value={profileJson}
                    onChange={(event) => setProfileJson(event.currentTarget.value)}
                  />
                  <div className="tester-ai-config-settings__import-actions">
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
              ) : null}
            </div>
          )}
        </div>
      </ScrollArea>
    </Surface>
  );
}
