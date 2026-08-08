import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  NIMI_AI_PROFILE_LLAMA_CACHE_TYPES,
  NIMI_AI_PROFILE_LLAMA_CPP_IMPLEMENTATION,
  NIMI_AI_PROFILE_STABLE_DIFFUSION_IMPLEMENTATION,
  NIMI_AI_PROFILE_STABLE_DIFFUSION_MODEL_FAMILIES,
  NIMI_AI_PROFILE_STABLE_DIFFUSION_VIDEO_IMPLEMENTATION,
  type NimiAIProfileApplyPreview,
  type NimiAIProfileAuthoringProjectedRequirement,
  type NimiAIProfileFeatureSubsetResult,
  type NimiAIProfileLocalConfigurationDecision,
  type NimiAIProfileSelectionMismatchPreview,
} from '@nimiplatform/sdk/ai';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import { Button, InlineAlert, Surface, TextField } from '@nimiplatform/kit/ui';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { createRuntimeAgentAIConfigAdapter } from '../../infra/runtime-agent-ai-config.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { RuntimePageShell } from './runtime-config-page-shell.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';
import {
  RUNTIME_CONFIG_AI_PROFILE_CAPABILITY_CONTRACTS,
  addRuntimeConfigAIProfileCapability,
  changeRuntimeConfigAIProfileCapabilityContract,
  createRuntimeConfigAIProfileAuthoringState,
  exportRuntimeConfigAIProfileAuthoring,
  importRuntimeConfigAIProfileAuthoring,
  inspectRuntimeConfigAIProfileAuthoring,
  loadRuntimeConfigAIProfileAuthoringCurrentProjection,
  moveRuntimeConfigAIProfileLoRA,
  reduceRuntimeConfigAIProfileAuthoringState,
  technicalErrorDetail,
  type RuntimeConfigAIProfileAuthoringCurrentProjection,
  type RuntimeConfigAIProfileAuthoringDraft,
  type RuntimeConfigAIProfileAuthoringInspection,
  type RuntimeConfigAIProfileAuthoringState,
  type RuntimeConfigAIProfileCapabilityContract,
  type RuntimeConfigAIProfileCapabilityDraft,
  type RuntimeConfigAIProfileLoRADraft,
  type RuntimeConfigAIProfileOptionalBoolean,
  type RuntimeConfigAIProfileOptionalPolicy,
  type RuntimeConfigAIProfileRequirementDraft,
  type RuntimeConfigAIProfileStableDiffusionExecutionDraft,
} from './runtime-config-profile-authoring-state.js';

type ProjectionStatus = 'loading' | 'ready' | 'failed';

export type AIProfileAuthoringViewProps = {
  readonly state: RuntimeConfigAIProfileAuthoringState;
  readonly inspection: RuntimeConfigAIProfileAuthoringInspection;
  readonly projectionStatus: ProjectionStatus;
  readonly projectionTechnicalError: string;
  readonly onDraftChange: (draft: RuntimeConfigAIProfileAuthoringDraft) => void;
  readonly onImportFile: (file: File) => void;
  readonly onExport: () => void;
  readonly onReloadProjection: () => void;
};

export function AIProfileAuthoringPage() {
  const sdk = useDesktopRendererSdk();
  const subjectUserId = useAppStore((state) => String(state.auth.user?.id ?? '').trim());
  const appAIConfig = useMemo(() => sdk.accountProduct().aiConfig, [sdk]);
  const machine = useMemo(() => sdk.machineProduct().local.aiConfiguration, [sdk]);
  const sharedAIConfig = useMemo(() => createRuntimeAgentAIConfigAdapter({
    runtime: {
      get appId() { return sdk.appId(); },
      get auth() { return sdk.accountRuntime().auth; },
      get agent() { return sdk.accountProduct().agents; },
    },
    getSubjectUserId: () => subjectUserId,
    withScopes: sdk.withRuntimeProtectedScopes,
  }), [sdk, subjectUserId]);
  const [state, dispatch] = useReducer(
    reduceRuntimeConfigAIProfileAuthoringState,
    undefined,
    createRuntimeConfigAIProfileAuthoringState,
  );
  const [current, setCurrent] = useState<RuntimeConfigAIProfileAuthoringCurrentProjection | null>(null);
  const [projectionStatus, setProjectionStatus] = useState<ProjectionStatus>('loading');
  const [projectionTechnicalError, setProjectionTechnicalError] = useState('');

  const reloadProjection = useCallback(async () => {
    setProjectionStatus('loading');
    setProjectionTechnicalError('');
    try {
      const next = await loadRuntimeConfigAIProfileAuthoringCurrentProjection({
        appId: appAIConfig.appId,
        getAppAIConfig: () => readOptionalAIConfig(() => appAIConfig.get()),
        getSharedAIConfig: () => readOptionalAIConfig(async () => (
          await sharedAIConfig.get({ subjectUserId })
        ).aiConfig),
        getMachine: () => machine.get(),
      });
      setCurrent(next);
      setProjectionStatus('ready');
    } catch (error) {
      setCurrent(null);
      setProjectionStatus('failed');
      setProjectionTechnicalError(technicalErrorDetail(error));
    }
  }, [appAIConfig, machine, sharedAIConfig, subjectUserId]);

  useEffect(() => {
    void reloadProjection();
  }, [reloadProjection]);

  const inspection = useMemo(
    () => inspectRuntimeConfigAIProfileAuthoring(state.draft, current),
    [current, state.draft],
  );

  const importFile = useCallback((file: File) => {
    void file.text().then((source) => {
      try {
        dispatch({
          type: 'import-succeeded',
          draft: importRuntimeConfigAIProfileAuthoring(source),
        });
      } catch (error) {
        dispatch({
          type: 'operation-failed',
          source: 'import',
          technicalError: technicalErrorDetail(error),
        });
      }
    }, (error) => {
      dispatch({
        type: 'operation-failed',
        source: 'import',
        technicalError: technicalErrorDetail(error),
      });
    });
  }, []);

  const exportArtifact = useCallback(() => {
    try {
      const artifact = exportRuntimeConfigAIProfileAuthoring(state.draft);
      downloadPortableProfile(artifact.artifactJson, artifact.fileName);
      dispatch({ type: 'export-succeeded' });
    } catch (error) {
      dispatch({
        type: 'operation-failed',
        source: 'export',
        technicalError: technicalErrorDetail(error),
      });
    }
  }, [state.draft]);

  return (
    <AIProfileAuthoringView
      state={state}
      inspection={inspection}
      projectionStatus={projectionStatus}
      projectionTechnicalError={projectionTechnicalError}
      onDraftChange={(draft) => dispatch({ type: 'draft-changed', draft })}
      onImportFile={importFile}
      onExport={exportArtifact}
      onReloadProjection={() => { void reloadProjection(); }}
    />
  );
}

export function AIProfileAuthoringView(props: AIProfileAuthoringViewProps) {
  const { t } = useTranslation();
  const model = props.inspection.status === 'valid' ? props.inspection.model : null;
  const updateDraft = props.onDraftChange;
  const requirementsByCapability = new Map(
    model?.requirements.map((requirement) => [requirement.capabilityContract, requirement] as const),
  );
  const canAddCapability = props.state.draft.capabilities.length
    < RUNTIME_CONFIG_AI_PROFILE_CAPABILITY_CONTRACTS.length;
  const exportReady = model?.exportArtifact !== null && model !== null;

  return (
    <RuntimePageShell
      maxWidth="full"
      className="max-w-[96rem] space-y-4 px-6 py-6"
    >
      <Surface
        tone="card"
        className="space-y-4 p-5"
        data-testid="ai-profile-authoring-header"
        data-authoring-output="preview-and-export-only"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-[var(--nimi-text-primary)]">
                {t('runtimeConfig.profiles.authoring.title')}
              </h3>
              <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-status-info)_12%,transparent)] px-2.5 py-1 text-[length:var(--nimi-type-caption-size)] font-semibold text-[var(--nimi-status-info)]">
                {t('runtimeConfig.profiles.authoring.previewOnlyBadge')}
              </span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-[var(--nimi-text-secondary)]">
              {t('runtimeConfig.profiles.authoring.description')}
            </p>
            <p className="mt-2 text-xs text-[var(--nimi-text-muted)]">
              {t('runtimeConfig.profiles.authoring.noCommitNotice')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-[var(--nimi-border-subtle)] px-3 text-xs font-semibold text-[var(--nimi-text-secondary)]">
              {t('runtimeConfig.profiles.authoring.importAction')}
              <input
                className="sr-only"
                type="file"
                accept="application/json,.json"
                data-testid="ai-profile-authoring-import"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) props.onImportFile(file);
                }}
              />
            </label>
            <Button
              type="button"
              size="sm"
              tone="primary"
              disabled={!exportReady}
              onClick={props.onExport}
              data-testid="ai-profile-authoring-export"
            >
              {t('runtimeConfig.profiles.authoring.exportAction')}
            </Button>
          </div>
        </div>
        <AuthoringOperationFeedback state={props.state} t={t} />
      </Surface>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(22rem,0.85fr)]">
        <div className="min-w-0 space-y-4" data-testid="ai-profile-authoring-form">
          <ProfileMetadataForm draft={props.state.draft} onChange={updateDraft} t={t} />

          <div className="flex flex-wrap items-center justify-between gap-3 px-1">
            <div>
              <h4 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                {t('runtimeConfig.profiles.authoring.capabilitiesTitle')}
              </h4>
              <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                {t('runtimeConfig.profiles.authoring.capabilitiesBody')}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={!canAddCapability}
              onClick={() => updateDraft(addRuntimeConfigAIProfileCapability(props.state.draft))}
            >
              {t('runtimeConfig.profiles.authoring.addCapability')}
            </Button>
          </div>

          {props.state.draft.capabilities.map((capability, index) => (
            <CapabilityAuthoringCard
              key={capability.draftId}
              capability={capability}
              index={index}
              draft={props.state.draft}
              requirement={requirementsByCapability.get(capability.capabilityContract)}
              onChange={updateDraft}
              t={t}
            />
          ))}
        </div>

        <div className="min-w-0 xl:sticky xl:top-0 xl:self-start">
          <JourneyPreviewPanel
            inspection={props.inspection}
            projectionStatus={props.projectionStatus}
            projectionTechnicalError={props.projectionTechnicalError}
            onReloadProjection={props.onReloadProjection}
            t={t}
          />
        </div>
      </div>
    </RuntimePageShell>
  );
}

function ProfileMetadataForm(props: {
  readonly draft: RuntimeConfigAIProfileAuthoringDraft;
  readonly onChange: (draft: RuntimeConfigAIProfileAuthoringDraft) => void;
  readonly t: TFunction;
}) {
  const patch = (next: Partial<RuntimeConfigAIProfileAuthoringDraft>) => {
    props.onChange({ ...props.draft, ...next });
  };
  return (
    <Surface tone="card" className="space-y-4 p-5" data-testid="ai-profile-authoring-metadata">
      <div>
        <h4 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {props.t('runtimeConfig.profiles.authoring.metadataTitle')}
        </h4>
        <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
          {props.t('runtimeConfig.profiles.authoring.metadataBody')}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <AuthoringTextField
          label={props.t('runtimeConfig.profiles.authoring.profileId')}
          value={props.draft.profileId}
          field="profile-id"
          onChange={(profileId) => patch({ profileId })}
        />
        <AuthoringTextField
          label={props.t('runtimeConfig.profiles.authoring.profileTitle')}
          value={props.draft.title}
          field="title"
          onChange={(title) => patch({ title })}
        />
      </div>
      <label className="flex items-start gap-2 text-sm text-[var(--nimi-text-secondary)]">
        <input
          type="checkbox"
          checked={props.draft.descriptionIncluded}
          onChange={(event) => patch({ descriptionIncluded: event.currentTarget.checked })}
          className="mt-0.5"
        />
        <span>{props.t('runtimeConfig.profiles.authoring.includeDescription')}</span>
      </label>
      {props.draft.descriptionIncluded ? (
        <AuthoringTextArea
          label={props.t('runtimeConfig.profiles.authoring.profileDescription')}
          value={props.draft.description}
          field="description"
          rows={3}
          onChange={(description) => patch({ description })}
        />
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <AuthoringTextArea
          label={props.t('runtimeConfig.profiles.authoring.provenance')}
          hint={props.t('runtimeConfig.profiles.authoring.provenanceHint')}
          value={props.draft.provenanceJson}
          field="provenance"
          rows={6}
          placeholder={'{\n  "publisher": "example.org"\n}'}
          onChange={(provenanceJson) => patch({ provenanceJson })}
        />
        <AuthoringTextArea
          label={props.t('runtimeConfig.profiles.authoring.license')}
          hint={props.t('runtimeConfig.profiles.authoring.licenseHint')}
          value={props.draft.licenseJson}
          field="license"
          rows={6}
          placeholder={'"Apache-2.0"'}
          onChange={(licenseJson) => patch({ licenseJson })}
        />
      </div>
      <AuthoringTextArea
        label={props.t('runtimeConfig.profiles.authoring.displayMetadata')}
        hint={props.t('runtimeConfig.profiles.authoring.optionalJsonHint')}
        value={props.draft.displayMetadataJson}
        field="display-metadata"
        rows={4}
        placeholder="{}"
        onChange={(displayMetadataJson) => patch({ displayMetadataJson })}
      />
    </Surface>
  );
}

function CapabilityAuthoringCard(props: {
  readonly capability: RuntimeConfigAIProfileCapabilityDraft;
  readonly index: number;
  readonly draft: RuntimeConfigAIProfileAuthoringDraft;
  readonly requirement: {
    readonly supportedFeatures: readonly string[];
    readonly projection: { readonly requirements: readonly NimiAIProfileAuthoringProjectedRequirement[] };
  } | undefined;
  readonly onChange: (draft: RuntimeConfigAIProfileAuthoringDraft) => void;
  readonly t: TFunction;
}) {
  const { capability } = props;
  const updateCapability = (
    update: (current: RuntimeConfigAIProfileCapabilityDraft) => RuntimeConfigAIProfileCapabilityDraft,
  ) => props.onChange({
    ...props.draft,
    capabilities: props.draft.capabilities.map((item) => (
      item.draftId === capability.draftId ? update(item) : item
    )),
  });
  const patch = (next: Partial<RuntimeConfigAIProfileCapabilityDraft>) => {
    updateCapability((current) => ({ ...current, ...next }));
  };
  const used = new Set(props.draft.capabilities
    .filter((item) => item.draftId !== capability.draftId)
    .map((item) => item.capabilityContract));

  return (
    <Surface
      tone="card"
      className="space-y-4 p-5"
      data-testid={`ai-profile-authoring-capability:${capability.capabilityContract}`}
      data-route={capability.route}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[var(--nimi-type-overline-letter-spacing)] text-[var(--nimi-text-muted)]">
            {props.t('runtimeConfig.profiles.authoring.capabilityOrdinal', {
              position: props.index + 1,
            })}
          </div>
          <div className="mt-1 font-mono text-sm font-semibold text-[var(--nimi-text-primary)]">
            {displayRuntimeConfigCapabilityLabel(capability.capabilityContract, props.t)}
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          tone="danger"
          onClick={() => props.onChange({
            ...props.draft,
            capabilities: props.draft.capabilities.filter(
              (item) => item.draftId !== capability.draftId,
            ),
          })}
        >
          {props.t('runtimeConfig.profiles.authoring.removeCapability')}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <AuthoringSelect
          label={props.t('runtimeConfig.profiles.authoring.capabilityContract')}
          value={capability.capabilityContract}
          field="capability-contract"
          onChange={(value) => props.onChange(changeRuntimeConfigAIProfileCapabilityContract(
            props.draft,
            capability.draftId,
            value as RuntimeConfigAIProfileCapabilityContract,
          ))}
        >
          {RUNTIME_CONFIG_AI_PROFILE_CAPABILITY_CONTRACTS.map((candidate) => (
            <option key={candidate} value={candidate} disabled={used.has(candidate)}>
              {displayRuntimeConfigCapabilityLabel(candidate, props.t)}
            </option>
          ))}
        </AuthoringSelect>
        <AuthoringSelect
          label={props.t('runtimeConfig.profiles.authoring.recommendationRoute')}
          value={capability.route}
          field="recommendation-route"
          onChange={(route) => patch({ route: route as 'local' | 'cloud' })}
        >
          <option value="local">{props.t('runtimeConfig.profiles.authoring.routeLocal')}</option>
          <option value="cloud">{props.t('runtimeConfig.profiles.authoring.routeCloud')}</option>
        </AuthoringSelect>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <AuthoringTextField
          label={props.t('runtimeConfig.profiles.authoring.requiredFeatures')}
          hint={props.t('runtimeConfig.profiles.authoring.featuresHint')}
          value={capability.requiredFeaturesText}
          field="required-features"
          placeholder={props.t('runtimeConfig.profiles.authoring.featuresPlaceholder')}
          onChange={(requiredFeaturesText) => patch({ requiredFeaturesText })}
        />
        <AuthoringTextArea
          label={props.t('runtimeConfig.profiles.authoring.defaults')}
          hint={props.t('runtimeConfig.profiles.authoring.optionalJsonHint')}
          value={capability.defaultsJson}
          field="defaults"
          rows={4}
          placeholder="{}"
          onChange={(defaultsJson) => patch({ defaultsJson })}
        />
      </div>

      {capability.route === 'local' ? (
        <LocalImplementationFields
          capability={capability}
          updateCapability={updateCapability}
          t={props.t}
        />
      ) : (
        <CloudRecommendationFields
          capability={capability}
          updateCapability={updateCapability}
          t={props.t}
        />
      )}

      {capability.route === 'local' && capability.local.includeImplementation ? (
        <RequirementProjectionSurface requirement={props.requirement} t={props.t} />
      ) : null}
    </Surface>
  );
}

function LocalImplementationFields(props: {
  readonly capability: RuntimeConfigAIProfileCapabilityDraft;
  readonly updateCapability: (
    update: (current: RuntimeConfigAIProfileCapabilityDraft) => RuntimeConfigAIProfileCapabilityDraft,
  ) => void;
  readonly t: TFunction;
}) {
  const { capability } = props;
  const updateLocal = (next: Partial<RuntimeConfigAIProfileCapabilityDraft['local']>) => {
    props.updateCapability((current) => ({
      ...current,
      local: { ...current.local, ...next },
    }));
  };
  if (capability.local.driverKind === 'none') {
    return (
      <InlineAlert tone="info">
        {props.t('runtimeConfig.profiles.authoring.localIntentOnly')}
      </InlineAlert>
    );
  }
  return (
    <div className="space-y-4 rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-subtle)] p-4" data-testid="ai-profile-authoring-local-section">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h5 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {props.t('runtimeConfig.profiles.authoring.localImplementationTitle')}
          </h5>
          <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
            {props.t('runtimeConfig.profiles.authoring.localImplementationBody')}
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-medium text-[var(--nimi-text-secondary)]">
          <input
            type="checkbox"
            checked={capability.local.includeImplementation}
            onChange={(event) => updateLocal({ includeImplementation: event.currentTarget.checked })}
          />
          {props.t('runtimeConfig.profiles.authoring.packageImplementation')}
        </label>
      </div>
      {capability.local.includeImplementation ? (
        <>
          <div className="grid gap-3 md:grid-cols-3" data-testid="ai-profile-authoring-local-identity">
            <ReadOnlyAuthoringField
              label={props.t('runtimeConfig.profiles.authoring.implementationId')}
              value={localDriverImplementation(capability.local.driverKind).implementationId}
            />
            <ReadOnlyAuthoringField
              label={props.t('runtimeConfig.profiles.authoring.driverId')}
              value={localDriverImplementation(capability.local.driverKind).driverId}
            />
            <ReadOnlyAuthoringField
              label={props.t('runtimeConfig.profiles.authoring.driverDialect')}
              value={localDriverImplementation(capability.local.driverKind).driverDialect}
            />
          </div>
          <AuthoringTextField
            label={props.t('runtimeConfig.profiles.authoring.supportedFeatures')}
            hint={props.t('runtimeConfig.profiles.authoring.featuresHint')}
            value={capability.local.supportedFeaturesText}
            field="local-supported-features"
            placeholder="input.image"
            onChange={(supportedFeaturesText) => updateLocal({ supportedFeaturesText })}
          />
          {capability.local.driverKind === 'llama' ? (
            <LlamaAuthoringFields capability={capability} updateLocal={updateLocal} t={props.t} />
          ) : capability.local.driverKind === 'stable-diffusion-video' ? (
            <StableDiffusionVideoAuthoringFields
              capability={capability}
              updateLocal={updateLocal}
              t={props.t}
            />
          ) : (
            <StableDiffusionAuthoringFields
              capability={capability}
              updateLocal={updateLocal}
              t={props.t}
            />
          )}
        </>
      ) : null}
    </div>
  );
}

function localDriverImplementation(
  driverKind: RuntimeConfigAIProfileCapabilityDraft['local']['driverKind'],
) {
  if (driverKind === 'llama') return NIMI_AI_PROFILE_LLAMA_CPP_IMPLEMENTATION;
  if (driverKind === 'stable-diffusion-video') {
    return NIMI_AI_PROFILE_STABLE_DIFFUSION_VIDEO_IMPLEMENTATION;
  }
  return NIMI_AI_PROFILE_STABLE_DIFFUSION_IMPLEMENTATION;
}

function LlamaAuthoringFields(props: {
  readonly capability: RuntimeConfigAIProfileCapabilityDraft;
  readonly updateLocal: (next: Partial<RuntimeConfigAIProfileCapabilityDraft['local']>) => void;
  readonly t: TFunction;
}) {
  const llama = props.capability.local.llama;
  const update = (next: Partial<typeof llama>) => props.updateLocal({ llama: { ...llama, ...next } });
  return (
    <fieldset className="space-y-4" data-testid="ai-profile-authoring-llama-fields">
      <legend className="text-sm font-semibold text-[var(--nimi-text-primary)]">
        {props.t('runtimeConfig.profiles.authoring.driverPortableConfig')}
      </legend>
      <div className="grid gap-3 lg:grid-cols-2">
        <RequirementAuthoringFields
          title={props.t('runtimeConfig.profiles.authoring.llamaMain')}
          value={llama.main}
          onChange={(main) => update({ main })}
          t={props.t}
        />
        <RequirementAuthoringFields
          title={props.t('runtimeConfig.profiles.authoring.llamaProjector')}
          value={llama.mmproj}
          onChange={(mmproj) => update({ mmproj })}
          t={props.t}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <AuthoringTextField label={props.t('runtimeConfig.profiles.authoring.contextSize')} value={llama.contextSize} field="llama-context-size" type="number" onChange={(contextSize) => update({ contextSize })} />
        <CacheTypeSelect label={props.t('runtimeConfig.profiles.authoring.cacheTypeK')} value={llama.cacheTypeK} onChange={(cacheTypeK) => update({ cacheTypeK })} t={props.t} />
        <CacheTypeSelect label={props.t('runtimeConfig.profiles.authoring.cacheTypeV')} value={llama.cacheTypeV} onChange={(cacheTypeV) => update({ cacheTypeV })} t={props.t} />
        <OptionalBooleanSelect label={props.t('runtimeConfig.profiles.authoring.flashAttention')} value={llama.flashAttention} field="llama-flash-attention" onChange={(flashAttention) => update({ flashAttention })} t={props.t} />
        <AuthoringTextField label={props.t('runtimeConfig.profiles.authoring.gpuLayers')} value={llama.gpuLayers} field="llama-gpu-layers" type="number" onChange={(gpuLayers) => update({ gpuLayers })} />
      </div>
    </fieldset>
  );
}

function StableDiffusionAuthoringFields(props: {
  readonly capability: RuntimeConfigAIProfileCapabilityDraft;
  readonly updateLocal: (next: Partial<RuntimeConfigAIProfileCapabilityDraft['local']>) => void;
  readonly t: TFunction;
}) {
  const stable = props.capability.local.stableDiffusion;
  const update = (next: Partial<typeof stable>) => props.updateLocal({
    stableDiffusion: { ...stable, ...next },
  });
  const updateExecution = (next: Partial<RuntimeConfigAIProfileStableDiffusionExecutionDraft>) => {
    update({ execution: { ...stable.execution, ...next } });
  };
  const updateLoRA = (index: number, next: Partial<RuntimeConfigAIProfileLoRADraft>) => {
    update({
      loras: stable.loras.map((lora, itemIndex) => (
        itemIndex === index ? { ...lora, ...next } : lora
      )),
    });
  };
  return (
    <fieldset className="space-y-4" data-testid="ai-profile-authoring-stable-diffusion-fields">
      <legend className="text-sm font-semibold text-[var(--nimi-text-primary)]">
        {props.t('runtimeConfig.profiles.authoring.driverPortableConfig')}
      </legend>
      <div className="grid gap-3 md:grid-cols-2">
        <AuthoringSelect
          label={props.t('runtimeConfig.profiles.authoring.modelFamily')}
          value={stable.modelFamily}
          field="sd-model-family"
          onChange={(modelFamily) => update({
            modelFamily: modelFamily as typeof stable.modelFamily,
          })}
        >
          {NIMI_AI_PROFILE_STABLE_DIFFUSION_MODEL_FAMILIES.map((family) => (
            <option key={family} value={family}>{family}</option>
          ))}
        </AuthoringSelect>
        <OptionalBooleanSelect
          label={props.t('runtimeConfig.profiles.authoring.enableInputImage')}
          value={stable.enableInputImage}
          field="sd-enable-input-image"
          onChange={(enableInputImage) => update({ enableInputImage })}
          t={props.t}
        />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <RequirementAuthoringFields title={props.t('runtimeConfig.profiles.authoring.sdMain')} value={stable.main} onChange={(main) => update({ main })} t={props.t} />
        <RequirementAuthoringFields title={props.t('runtimeConfig.profiles.authoring.sdTextEncoder')} value={stable.textEncoder} onChange={(textEncoder) => update({ textEncoder })} t={props.t} />
        <RequirementAuthoringFields title={props.t('runtimeConfig.profiles.authoring.sdVae')} value={stable.vae} onChange={(vae) => update({ vae })} t={props.t} />
        {stable.modelFamily === 'ideogram4' ? (
          <RequirementAuthoringFields title={props.t('runtimeConfig.profiles.authoring.sdUncond')} value={stable.uncondDiffusion} onChange={(uncondDiffusion) => update({ uncondDiffusion })} t={props.t} />
        ) : null}
      </div>

      <div className="space-y-3" data-testid="ai-profile-authoring-lora-list">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h6 className="text-xs font-semibold uppercase tracking-[var(--nimi-type-overline-letter-spacing)] text-[var(--nimi-text-secondary)]">
              {props.t('runtimeConfig.profiles.authoring.orderedLoras')}
            </h6>
            <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
              {props.t('runtimeConfig.profiles.authoring.orderedLorasBody')}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={stable.loras.length >= 32}
            onClick={() => update({
              loras: [...stable.loras, createLoRADraft(stable.loras)],
            })}
          >
            {props.t('runtimeConfig.profiles.authoring.addLora')}
          </Button>
        </div>
        {stable.loras.length === 0 ? (
          <p className="text-xs text-[var(--nimi-text-muted)]">
            {props.t('runtimeConfig.profiles.authoring.noLoras')}
          </p>
        ) : stable.loras.map((lora, index) => (
          <div
            key={lora.draftId}
            className="space-y-3 rounded-xl border border-[var(--nimi-border-subtle)] p-3"
            data-testid={`ai-profile-authoring-lora:${index + 1}`}
            data-occurrence-ordinal={index + 1}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-[var(--nimi-text-secondary)]">
                {props.t('runtimeConfig.profiles.authoring.loraOrdinal', { position: index + 1 })}
              </div>
              <div className="flex flex-wrap gap-1">
                <Button type="button" size="sm" tone="ghost" disabled={index === 0} onClick={() => update({ loras: moveRuntimeConfigAIProfileLoRA(stable.loras, index, -1) })}>{props.t('runtimeConfig.profiles.authoring.moveUp')}</Button>
                <Button type="button" size="sm" tone="ghost" disabled={index === stable.loras.length - 1} onClick={() => update({ loras: moveRuntimeConfigAIProfileLoRA(stable.loras, index, 1) })}>{props.t('runtimeConfig.profiles.authoring.moveDown')}</Button>
                <Button type="button" size="sm" tone="danger" onClick={() => update({ loras: stable.loras.filter((_, itemIndex) => itemIndex !== index) })}>{props.t('runtimeConfig.profiles.authoring.remove')}</Button>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <AuthoringTextField label={props.t('runtimeConfig.profiles.authoring.displayLabel')} value={lora.displayLabel} field="lora-display-label" onChange={(displayLabel) => updateLoRA(index, { displayLabel })} />
              <PolicySelect label={props.t('runtimeConfig.profiles.authoring.requirementPolicy')} value={lora.policy} onChange={(policy) => updateLoRA(index, { policy })} t={props.t} />
              <AuthoringTextField label={props.t('runtimeConfig.profiles.authoring.verifiedContentId')} value={lora.verifiedContentId} field="lora-verified-content" onChange={(verifiedContentId) => updateLoRA(index, { verifiedContentId })} />
              <AuthoringTextField label={props.t('runtimeConfig.profiles.authoring.weight')} value={lora.weight} field="lora-weight" type="number" onChange={(weight) => updateLoRA(index, { weight })} />
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-3" data-testid="ai-profile-authoring-sd-execution-options">
        <h6 className="text-xs font-semibold uppercase tracking-[var(--nimi-type-overline-letter-spacing)] text-[var(--nimi-text-secondary)]">
          {props.t('runtimeConfig.profiles.authoring.executionOptions')}
        </h6>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(['steps', 'cfgScale', 'width', 'height', 'seed', 'threads'] as const).map((key) => (
            <AuthoringTextField key={key} label={props.t(`runtimeConfig.profiles.authoring.execution.${key}`)} value={stable.execution[key]} field={`sd-${key}`} type="number" onChange={(value) => updateExecution({ [key]: value })} />
          ))}
          <AuthoringTextField label={props.t('runtimeConfig.profiles.authoring.execution.sampler')} value={stable.execution.sampler} field="sd-sampler" onChange={(sampler) => updateExecution({ sampler })} />
          <AuthoringTextField label={props.t('runtimeConfig.profiles.authoring.execution.scheduler')} value={stable.execution.scheduler} field="sd-scheduler" onChange={(scheduler) => updateExecution({ scheduler })} />
          <OptionalBooleanSelect label={props.t('runtimeConfig.profiles.authoring.execution.diffusionFlashAttention')} value={stable.execution.diffusionFlashAttention} field="sd-diffusion-flash-attention" onChange={(diffusionFlashAttention) => updateExecution({ diffusionFlashAttention })} t={props.t} />
          <OptionalBooleanSelect label={props.t('runtimeConfig.profiles.authoring.execution.offloadParamsToCPU')} value={stable.execution.offloadParamsToCPU} field="sd-offload-params" onChange={(offloadParamsToCPU) => updateExecution({ offloadParamsToCPU })} t={props.t} />
        </div>
      </div>
    </fieldset>
  );
}

function StableDiffusionVideoAuthoringFields(props: {
  readonly capability: RuntimeConfigAIProfileCapabilityDraft;
  readonly updateLocal: (next: Partial<RuntimeConfigAIProfileCapabilityDraft['local']>) => void;
  readonly t: TFunction;
}) {
  const video = props.capability.local.stableDiffusionVideo;
  const update = (next: Partial<typeof video>) => props.updateLocal({
    stableDiffusionVideo: { ...video, ...next },
  });
  return (
    <fieldset className="space-y-4" data-testid="ai-profile-authoring-stable-diffusion-video-fields">
      <legend className="text-sm font-semibold text-[var(--nimi-text-primary)]">
        {props.t('runtimeConfig.profiles.authoring.driverPortableConfig')}
      </legend>
      <div className="grid gap-3 lg:grid-cols-2">
        <RequirementAuthoringFields title={props.t('runtimeConfig.profiles.authoring.sdVideoFl2va')} value={video.fl2va} onChange={(fl2va) => update({ fl2va })} t={props.t} />
        <RequirementAuthoringFields title={props.t('runtimeConfig.profiles.authoring.sdVideoRef2va')} value={video.ref2va} onChange={(ref2va) => update({ ref2va })} t={props.t} />
        <RequirementAuthoringFields title={props.t('runtimeConfig.profiles.authoring.sdVideoEncoder')} value={video.encoder} onChange={(encoder) => update({ encoder })} t={props.t} />
        <RequirementAuthoringFields title={props.t('runtimeConfig.profiles.authoring.sdVideoVideoVae')} value={video.videoVAE} onChange={(videoVAE) => update({ videoVAE })} t={props.t} />
        <RequirementAuthoringFields title={props.t('runtimeConfig.profiles.authoring.sdVideoAudioVae')} value={video.audioVAE} onChange={(audioVAE) => update({ audioVAE })} t={props.t} />
      </div>
    </fieldset>
  );
}

function CloudRecommendationFields(props: {
  readonly capability: RuntimeConfigAIProfileCapabilityDraft;
  readonly updateCapability: (
    update: (current: RuntimeConfigAIProfileCapabilityDraft) => RuntimeConfigAIProfileCapabilityDraft,
  ) => void;
  readonly t: TFunction;
}) {
  const cloud = props.capability.cloud;
  const update = (next: Partial<typeof cloud>) => props.updateCapability((current) => ({
    ...current,
    cloud: { ...current.cloud, ...next },
  }));
  return (
    <div
      className="space-y-4 rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-subtle)] p-4"
      data-testid="ai-profile-authoring-cloud-section"
      data-authoring-account-fields="absent"
      data-authoring-grant-fields="absent"
    >
      <div>
        <h5 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {props.t('runtimeConfig.profiles.authoring.cloudRecommendationTitle')}
        </h5>
        <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
          {props.t('runtimeConfig.profiles.authoring.cloudRecommendationBody')}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <AuthoringTextField label={props.t('runtimeConfig.profiles.authoring.implementationId')} value={cloud.implementationId} field="cloud-implementation-id" onChange={(implementationId) => update({ implementationId })} />
        <AuthoringTextField label={props.t('runtimeConfig.profiles.authoring.driverId')} value={cloud.driverId} field="cloud-driver-id" onChange={(driverId) => update({ driverId })} />
        <AuthoringTextField label={props.t('runtimeConfig.profiles.authoring.driverDialect')} value={cloud.driverDialect} field="cloud-driver-dialect" onChange={(driverDialect) => update({ driverDialect })} />
      </div>
      <AuthoringTextField label={props.t('runtimeConfig.profiles.authoring.supportedFeatures')} hint={props.t('runtimeConfig.profiles.authoring.featuresHint')} value={cloud.supportedFeaturesText} field="cloud-supported-features" onChange={(supportedFeaturesText) => update({ supportedFeaturesText })} />
      <AuthoringTextArea
        label={props.t('runtimeConfig.profiles.authoring.providerModelTarget')}
        hint={props.t('runtimeConfig.profiles.authoring.providerModelTargetHint')}
        value={cloud.providerModelTargetJson}
        field="cloud-provider-model-target"
        rows={6}
        placeholder={'{\n  "provider": "example",\n  "providerModelId": "model-v1"\n}'}
        onChange={(providerModelTargetJson) => update({ providerModelTargetJson })}
      />
    </div>
  );
}

function RequirementAuthoringFields(props: {
  readonly title: string;
  readonly value: RuntimeConfigAIProfileRequirementDraft;
  readonly onChange: (value: RuntimeConfigAIProfileRequirementDraft) => void;
  readonly t: TFunction;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-[var(--nimi-border-subtle)] p-3">
      <div className="text-xs font-semibold text-[var(--nimi-text-primary)]">{props.title}</div>
      <PolicySelect
        label={props.t('runtimeConfig.profiles.authoring.requirementPolicy')}
        value={props.value.policy}
        onChange={(policy) => props.onChange({ ...props.value, policy })}
        t={props.t}
      />
      <AuthoringTextField
        label={props.t('runtimeConfig.profiles.authoring.verifiedContentId')}
        hint={props.t('runtimeConfig.profiles.authoring.verifiedContentHint')}
        value={props.value.verifiedContentId}
        field="verified-content-id"
        onChange={(verifiedContentId) => props.onChange({ ...props.value, verifiedContentId })}
      />
    </div>
  );
}

function RequirementProjectionSurface(props: {
  readonly requirement: {
    readonly supportedFeatures: readonly string[];
    readonly projection: { readonly requirements: readonly NimiAIProfileAuthoringProjectedRequirement[] };
  } | undefined;
  readonly t: TFunction;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-info)_26%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-info)_6%,var(--nimi-surface-card))] p-4" data-testid="ai-profile-authoring-requirements">
      <div>
        <h5 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {props.t('runtimeConfig.profiles.authoring.requirementsTitle')}
        </h5>
        <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
          {props.t('runtimeConfig.profiles.authoring.requirementsRuntimeTruth')}
        </p>
      </div>
      {!props.requirement ? (
        <p className="text-xs text-[var(--nimi-text-muted)]">
          {props.t('runtimeConfig.profiles.authoring.requirementsPending')}
        </p>
      ) : (
        <>
          <div className="text-xs text-[var(--nimi-text-secondary)]">
            <span className="font-semibold">{props.t('runtimeConfig.profiles.authoring.supportedFeatures')}:</span>{' '}
            {props.requirement.supportedFeatures.length > 0
              ? props.requirement.supportedFeatures.join(', ')
              : props.t('runtimeConfig.profiles.authoring.none')}
          </div>
          <div className="space-y-2">
            {props.requirement.projection.requirements.map((requirement) => (
              <div
                key={requirement.requirementId}
                className="grid gap-1 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 text-xs sm:grid-cols-2"
                data-requirement-role={requirement.role}
                data-requirement-ordinal={requirement.occurrenceOrdinal}
              >
                <div className="font-semibold text-[var(--nimi-text-primary)]">{requirement.displayLabel}</div>
                <div className="font-mono text-[var(--nimi-text-muted)]">{requirement.requirementId}</div>
                <div className="text-[var(--nimi-text-secondary)]">
                  {props.t('runtimeConfig.profiles.authoring.requirementRoleOrdinal', {
                    role: requirement.role,
                    position: requirement.occurrenceOrdinal,
                  })}
                </div>
                <div className="text-[var(--nimi-text-secondary)]">
                  {props.t('runtimeConfig.profiles.authoring.requirementKindPolicy', {
                    kind: requirement.resourceKind,
                    policy: requirement.policy,
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function JourneyPreviewPanel(props: {
  readonly inspection: RuntimeConfigAIProfileAuthoringInspection;
  readonly projectionStatus: ProjectionStatus;
  readonly projectionTechnicalError: string;
  readonly onReloadProjection: () => void;
  readonly t: TFunction;
}) {
  return (
    <Surface tone="card" className="space-y-4 p-5" data-testid="ai-profile-authoring-preview" data-preview-commits="false">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {props.t('runtimeConfig.profiles.authoring.previewTitle')}
          </h4>
          <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
            {props.t('runtimeConfig.profiles.authoring.previewBody')}
          </p>
        </div>
        <span className="rounded-full bg-[var(--nimi-surface-subtle)] px-2.5 py-1 text-[length:var(--nimi-type-caption-size)] font-semibold text-[var(--nimi-text-secondary)]">
          {props.t('runtimeConfig.profiles.authoring.readOnly')}
        </span>
      </div>

      {props.inspection.status === 'invalid' ? (
        <>
          <InlineAlert tone="danger">
            {props.t('runtimeConfig.profiles.authoring.validationFailed')}
          </InlineAlert>
          <TechnicalDetails detail={props.inspection.technicalError} t={props.t} />
        </>
      ) : (
        <>
          {props.inspection.model.exportArtifact ? (
            <InlineAlert tone="success">
              {props.t('runtimeConfig.profiles.authoring.exportReady')}
            </InlineAlert>
          ) : (
            <>
              <InlineAlert tone="info">
                {props.t('runtimeConfig.profiles.authoring.exportNeedsMetadata')}
              </InlineAlert>
              <TechnicalDetails detail={props.inspection.model.exportTechnicalError} t={props.t} />
            </>
          )}

          {props.projectionStatus === 'loading' ? (
            <InlineAlert tone="info">
              {props.t('runtimeConfig.profiles.authoring.loadingCurrentProjection')}
            </InlineAlert>
          ) : props.projectionStatus === 'failed' ? (
            <div className="space-y-2">
              <InlineAlert tone="danger">
                {props.t('runtimeConfig.profiles.authoring.currentProjectionFailed')}
              </InlineAlert>
              <TechnicalDetails detail={props.projectionTechnicalError} t={props.t} />
              <Button type="button" size="sm" onClick={props.onReloadProjection}>
                {props.t('runtimeConfig.profiles.authoring.retryProjection')}
              </Button>
            </div>
          ) : props.inspection.model.journey ? (
            <JourneySections model={props.inspection.model.journey} t={props.t} />
          ) : null}
        </>
      )}
    </Surface>
  );
}

function JourneySections(props: {
  readonly model: NonNullable<Extract<RuntimeConfigAIProfileAuthoringInspection, { status: 'valid' }>['model']['journey']>;
  readonly t: TFunction;
}) {
  const writes = props.model.importPreview.declaredWrites;
  return (
    <div className="space-y-4">
      <PreviewSection title={props.t('runtimeConfig.profiles.authoring.importPreviewTitle')} testId="ai-profile-authoring-import-preview">
        <p>{props.t('runtimeConfig.profiles.authoring.importPreviewBody')}</p>
        <dl className="mt-2 grid gap-1">
          <PreviewFact label={props.t('runtimeConfig.profiles.authoring.profileArtifact')} value={yesNo(writes.profileArtifact, props.t)} />
          <PreviewFact label={props.t('runtimeConfig.profiles.authoring.aiConfigWrite')} value={yesNo(writes.aiConfig, props.t)} />
          <PreviewFact label={props.t('runtimeConfig.profiles.authoring.localConfigurationWrite')} value={yesNo(writes.localCapabilityConfigurations, props.t)} />
          <PreviewFact label={props.t('runtimeConfig.profiles.authoring.machineSelectionWrite')} value={yesNo(writes.machineSelection, props.t)} />
          <PreviewFact label={props.t('runtimeConfig.profiles.authoring.authorizationWrite')} value={yesNo(writes.connectorGrant, props.t)} />
        </dl>
      </PreviewSection>

      <ApplyPreviewSection preview={props.model.appApplyPreview} ownerLabel={props.t('runtimeConfig.profiles.authoring.appOwner')} t={props.t} />
      <ApplyPreviewSection preview={props.model.sharedApplyPreview} ownerLabel={props.t('runtimeConfig.profiles.authoring.sharedOwner')} t={props.t} />

      <PreviewSection title={props.t('runtimeConfig.profiles.authoring.localConfigurationPreviewTitle')} testId="ai-profile-authoring-local-preview">
        {props.model.localConfigurationPreviews.length === 0 ? (
          <p>{props.t('runtimeConfig.profiles.authoring.noLocalImplementation')}</p>
        ) : props.model.localConfigurationPreviews.map((preview) => (
          <div key={preview.proposal.capabilityContract} className="mt-2 space-y-2 rounded-lg border border-[var(--nimi-border-subtle)] p-3">
            <div className="font-mono font-semibold text-[var(--nimi-text-primary)]">{displayRuntimeConfigCapabilityLabel(preview.proposal.capabilityContract, props.t)}</div>
            <div>{localDecisionCopy(preview.decision, props.t)}</div>
            <div>
              {props.t('runtimeConfig.profiles.authoring.expectedResolution', {
                resolution: expectedResolution(preview.decision),
              })}
            </div>
            <div className="font-mono text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">{preview.equivalenceDigest}</div>
            <div>{props.t('runtimeConfig.profiles.authoring.doesNotSelect')}</div>
          </div>
        ))}
      </PreviewSection>

      <PreviewSection title={props.t('runtimeConfig.profiles.authoring.selectionPreviewTitle')} testId="ai-profile-authoring-selection-preview">
        {props.model.selectionPreviews.map((preview) => (
          <SelectionPreview key={preview.capabilityContract} preview={preview} t={props.t} />
        ))}
      </PreviewSection>
    </div>
  );
}

function ApplyPreviewSection(props: {
  readonly preview: NimiAIProfileApplyPreview;
  readonly ownerLabel: string;
  readonly t: TFunction;
}) {
  const { intentDiff } = props.preview;
  return (
    <PreviewSection title={props.t('runtimeConfig.profiles.authoring.applyPreviewTitle', { owner: props.ownerLabel })} testId={`ai-profile-authoring-apply-preview:${props.preview.target.kind}`}>
      <div>{props.preview.identical
        ? props.t('runtimeConfig.profiles.authoring.applyIdentical')
        : props.t('runtimeConfig.profiles.authoring.applyChanges')}</div>
      <dl className="mt-2 grid gap-1">
        <PreviewFact label={props.t('runtimeConfig.profiles.authoring.added')} value={listOrNone(intentDiff.addedCapabilityContracts.map((contract) => displayRuntimeConfigCapabilityLabel(contract, props.t)), props.t)} />
        <PreviewFact label={props.t('runtimeConfig.profiles.authoring.changed')} value={listOrNone(intentDiff.changedCapabilityContracts.map((contract) => displayRuntimeConfigCapabilityLabel(contract, props.t)), props.t)} />
        <PreviewFact label={props.t('runtimeConfig.profiles.authoring.removed')} value={listOrNone(intentDiff.removedCapabilityContracts.map((contract) => displayRuntimeConfigCapabilityLabel(contract, props.t)), props.t)} />
        <PreviewFact label={props.t('runtimeConfig.profiles.authoring.unchanged')} value={listOrNone(intentDiff.unchangedCapabilityContracts.map((contract) => displayRuntimeConfigCapabilityLabel(contract, props.t)), props.t)} />
      </dl>
      {props.preview.cloudSelections.length > 0 ? (
        <div className="mt-2 text-[var(--nimi-status-info)]">
          {props.t('runtimeConfig.profiles.authoring.cloudSelectionRequired', {
            capabilities: props.preview.cloudSelections
              .map((selection) => displayRuntimeConfigCapabilityLabel(selection.capabilityContract, props.t))
              .join(', '),
          })}
        </div>
      ) : null}
      <details className="mt-2">
        <summary className="cursor-pointer font-semibold text-[var(--nimi-text-secondary)]">
          {props.t('runtimeConfig.profiles.authoring.beforeAfter')}
        </summary>
        <div className="mt-2 grid gap-2">
          <ReadOnlyJson label={props.t('runtimeConfig.profiles.authoring.before')} value={props.preview.before} />
          <ReadOnlyJson label={props.t('runtimeConfig.profiles.authoring.after')} value={props.preview.after} />
        </div>
      </details>
    </PreviewSection>
  );
}

function SelectionPreview(props: {
  readonly preview: NimiAIProfileSelectionMismatchPreview;
  readonly t: TFunction;
}) {
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-[var(--nimi-border-subtle)] p-3" data-selection-mismatch-fails-closed={props.preview.mismatchFailsClosed}>
      <div className="font-mono font-semibold text-[var(--nimi-text-primary)]">{displayRuntimeConfigCapabilityLabel(props.preview.capabilityContract, props.t)}</div>
      {props.preview.branches.map((branch) => (
        <div key={branch.kind} className="rounded-lg bg-[var(--nimi-surface-subtle)] p-2.5" data-feature-status={branch.featureSubset.status}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-[var(--nimi-text-primary)]">
              {props.t(`runtimeConfig.profiles.authoring.branch.${branch.kind}`)}
            </span>
            <FeatureStatusBadge subset={branch.featureSubset} t={props.t} />
          </div>
          <FeatureSubsetFacts subset={branch.featureSubset} t={props.t} />
          <div className="mt-1 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">
            {'prerequisite' in branch
              ? props.t('runtimeConfig.profiles.authoring.prerequisite', { value: branch.prerequisite })
              : props.t('runtimeConfig.profiles.authoring.currentSelection', {
                value: branch.configurationId ?? props.t('runtimeConfig.profiles.authoring.none'),
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

function FeatureStatusBadge(props: { readonly subset: NimiAIProfileFeatureSubsetResult; readonly t: TFunction }) {
  const className = props.subset.status === 'compatible'
    ? 'text-[var(--nimi-status-success)]'
    : props.subset.status === 'feature-mismatch'
      ? 'text-[var(--nimi-status-danger)]'
      : 'text-[var(--nimi-text-muted)]';
  return (
    <span className={`text-[length:var(--nimi-type-caption-size)] font-semibold ${className}`}>
      {props.t(`runtimeConfig.profiles.authoring.featureStatus.${props.subset.status}`)}
    </span>
  );
}

function FeatureSubsetFacts(props: { readonly subset: NimiAIProfileFeatureSubsetResult; readonly t: TFunction }) {
  return (
    <div className="mt-1 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-secondary)]">
      <div>{props.t('runtimeConfig.profiles.authoring.requiredFeatureList', { value: listOrNone(props.subset.requiredFeatures, props.t) })}</div>
      <div>{props.t('runtimeConfig.profiles.authoring.supportedFeatureList', { value: listOrNone(props.subset.supportedFeatures, props.t) })}</div>
      {props.subset.missingFeatures.length > 0 ? (
        <div className="text-[var(--nimi-status-danger)]">
          {props.t('runtimeConfig.profiles.authoring.missingFeatureList', { value: props.subset.missingFeatures.join(', ') })}
        </div>
      ) : null}
    </div>
  );
}

function AuthoringOperationFeedback(props: {
  readonly state: RuntimeConfigAIProfileAuthoringState;
  readonly t: TFunction;
}) {
  if (props.state.operation === 'editing') return null;
  if (props.state.operation === 'imported') {
    return (
      <div data-testid="ai-profile-authoring-import-success">
        <InlineAlert tone="success">{props.t('runtimeConfig.profiles.authoring.importSuccess')}</InlineAlert>
      </div>
    );
  }
  if (props.state.operation === 'exported') {
    return <InlineAlert tone="success">{props.t('runtimeConfig.profiles.authoring.exportSuccess')}</InlineAlert>;
  }
  return (
    <div data-testid="ai-profile-authoring-operation-error">
      <InlineAlert tone="danger">
        {props.t(props.state.operationSource === 'import'
          ? 'runtimeConfig.profiles.authoring.importFailed'
          : 'runtimeConfig.profiles.authoring.exportFailed')}
      </InlineAlert>
      <TechnicalDetails detail={props.state.technicalError} t={props.t} />
    </div>
  );
}

function PreviewSection(props: {
  readonly title: string;
  readonly testId: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--nimi-border-subtle)] p-3 text-xs leading-relaxed text-[var(--nimi-text-secondary)]" data-testid={props.testId}>
      <h5 className="text-xs font-semibold text-[var(--nimi-text-primary)]">{props.title}</h5>
      <div className="mt-2">{props.children}</div>
    </section>
  );
}

function PreviewFact(props: { readonly label: string; readonly value: string }) {
  return (
    <div className="grid grid-cols-[minmax(7rem,0.7fr)_minmax(0,1fr)] gap-2">
      <dt className="font-medium text-[var(--nimi-text-secondary)]">{props.label}</dt>
      <dd className="m-0 break-words text-[var(--nimi-text-primary)]">{props.value}</dd>
    </div>
  );
}

function ReadOnlyJson(props: { readonly label: string; readonly value: unknown }) {
  return (
    <div>
      <div className="mb-1 text-[length:var(--nimi-type-caption-size)] font-semibold text-[var(--nimi-text-secondary)]">{props.label}</div>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--nimi-surface-subtle)] p-2 font-mono text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">
        {JSON.stringify(props.value, null, 2)}
      </pre>
    </div>
  );
}

function TechnicalDetails(props: { readonly detail: string; readonly t: TFunction }) {
  if (!props.detail) return null;
  return (
    <details className="mt-2 rounded-xl border border-[var(--nimi-border-subtle)] p-3 text-xs text-[var(--nimi-text-secondary)]">
      <summary className="cursor-pointer font-semibold">
        {props.t('runtimeConfig.profiles.technicalDetails')}
      </summary>
      <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[length:var(--nimi-type-caption-size)]">{props.detail}</pre>
    </details>
  );
}

function AuthoringTextField(props: {
  readonly label: string;
  readonly hint?: string;
  readonly value: string;
  readonly field: string;
  readonly type?: 'text' | 'number';
  readonly placeholder?: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1.5 text-xs font-medium text-[var(--nimi-text-secondary)]">
      <span>{props.label}</span>
      <TextField
        type={props.type ?? 'text'}
        value={props.value}
        placeholder={props.placeholder}
        data-authoring-field={props.field}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
      {props.hint ? <span className="block font-normal text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">{props.hint}</span> : null}
    </label>
  );
}

function AuthoringTextArea(props: {
  readonly label: string;
  readonly hint?: string;
  readonly value: string;
  readonly field: string;
  readonly rows: number;
  readonly placeholder?: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1.5 text-xs font-medium text-[var(--nimi-text-secondary)]">
      <span>{props.label}</span>
      <textarea
        rows={props.rows}
        value={props.value}
        placeholder={props.placeholder}
        spellCheck={false}
        data-authoring-field={props.field}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        className="w-full rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] p-3 font-mono text-xs text-[var(--nimi-text-primary)] outline-none focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)]"
      />
      {props.hint ? <span className="block font-normal text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">{props.hint}</span> : null}
    </label>
  );
}

function AuthoringSelect(props: {
  readonly label: string;
  readonly value: string;
  readonly field: string;
  readonly onChange: (value: string) => void;
  readonly children: ReactNode;
}) {
  return (
    <label className="space-y-1.5 text-xs font-medium text-[var(--nimi-text-secondary)]">
      <span>{props.label}</span>
      <select
        value={props.value}
        data-authoring-field={props.field}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        className={authoringSelectClassName}
      >
        {props.children}
      </select>
    </label>
  );
}

function PolicySelect(props: {
  readonly label: string;
  readonly value: RuntimeConfigAIProfileOptionalPolicy;
  readonly onChange: (value: RuntimeConfigAIProfileOptionalPolicy) => void;
  readonly t: TFunction;
}) {
  return (
    <AuthoringSelect label={props.label} value={props.value} field="requirement-policy" onChange={(value) => props.onChange(value as RuntimeConfigAIProfileOptionalPolicy)}>
      <option value="">{props.t('runtimeConfig.profiles.authoring.policyDefault')}</option>
      <option value="substitutable">{props.t('runtimeConfig.profiles.authoring.policySubstitutable')}</option>
      <option value="strict">{props.t('runtimeConfig.profiles.authoring.policyStrict')}</option>
    </AuthoringSelect>
  );
}

function OptionalBooleanSelect(props: {
  readonly label: string;
  readonly value: RuntimeConfigAIProfileOptionalBoolean;
  readonly field: string;
  readonly onChange: (value: RuntimeConfigAIProfileOptionalBoolean) => void;
  readonly t: TFunction;
}) {
  return (
    <AuthoringSelect label={props.label} value={props.value} field={props.field} onChange={(value) => props.onChange(value as RuntimeConfigAIProfileOptionalBoolean)}>
      <option value="">{props.t('runtimeConfig.profiles.authoring.notIncluded')}</option>
      <option value="true">{props.t('runtimeConfig.profiles.authoring.booleanTrue')}</option>
      <option value="false">{props.t('runtimeConfig.profiles.authoring.booleanFalse')}</option>
    </AuthoringSelect>
  );
}

function CacheTypeSelect(props: {
  readonly label: string;
  readonly value: RuntimeConfigAIProfileCapabilityDraft['local']['llama']['cacheTypeK'];
  readonly onChange: (value: RuntimeConfigAIProfileCapabilityDraft['local']['llama']['cacheTypeK']) => void;
  readonly t: TFunction;
}) {
  return (
    <AuthoringSelect label={props.label} value={props.value} field="llama-cache-type" onChange={(value) => props.onChange(value as typeof props.value)}>
      <option value="">{props.t('runtimeConfig.profiles.authoring.notIncluded')}</option>
      {NIMI_AI_PROFILE_LLAMA_CACHE_TYPES.map((value) => (
        <option key={value} value={value}>{value}</option>
      ))}
    </AuthoringSelect>
  );
}

function ReadOnlyAuthoringField(props: { readonly label: string; readonly value: string }) {
  return (
    <div className="space-y-1 text-xs text-[var(--nimi-text-secondary)]">
      <div className="font-medium">{props.label}</div>
      <div className="break-all rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2.5 py-2 font-mono text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-primary)]">{props.value}</div>
    </div>
  );
}

function createLoRADraft(current: readonly RuntimeConfigAIProfileLoRADraft[]): RuntimeConfigAIProfileLoRADraft {
  let ordinal = 1;
  const used = new Set(current.map((lora) => lora.draftId));
  while (used.has(`lora-${ordinal}`)) ordinal += 1;
  return {
    draftId: `lora-${ordinal}`,
    displayLabel: '',
    policy: '',
    verifiedContentId: '',
    weight: '',
  };
}

function expectedResolution(decision: NimiAIProfileLocalConfigurationDecision): string {
  if (decision.kind === 'add-new') return decision.expectedRequirementResolution;
  if (decision.kind === 'reuse-equivalent') return decision.expectedRequirementResolution;
  return decision.updateExpectedRequirementResolution;
}

function localDecisionCopy(
  decision: NimiAIProfileLocalConfigurationDecision,
  t: TFunction,
): string {
  if (decision.kind === 'add-new') {
    return t('runtimeConfig.profiles.authoring.decisionAdd');
  }
  if (decision.kind === 'reuse-equivalent') {
    return t('runtimeConfig.profiles.authoring.decisionReuse', {
      ids: decision.matches.map((match) => match.configurationId).join(', '),
    });
  }
  return t('runtimeConfig.profiles.authoring.decisionChoose', {
    ids: decision.updateCandidateConfigurationIds.join(', '),
  });
}

function yesNo(value: boolean, t: TFunction): string {
  return t(value ? 'runtimeConfig.profiles.authoring.yes' : 'runtimeConfig.profiles.authoring.no');
}

function listOrNone(values: readonly string[], t: TFunction): string {
  return values.length > 0 ? values.join(', ') : t('runtimeConfig.profiles.authoring.none');
}

async function readOptionalAIConfig<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (extractNimiErrorFields(error).reasonCode === 'AI_CONFIG_NOT_FOUND') return null;
    throw error;
  }
}

function downloadPortableProfile(source: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([source], { type: 'application/json' }));
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

const authoringSelectClassName = 'min-h-10 w-full rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] px-3 text-sm text-[var(--nimi-text-primary)] outline-none focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)]';
