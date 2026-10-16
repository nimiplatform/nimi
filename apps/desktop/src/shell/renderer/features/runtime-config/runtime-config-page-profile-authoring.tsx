import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  type NimiCapabilityAIConfig,
  type NimiAIProfileApplyPreview,
  type NimiAIProfileFeatureSubsetResult,
  type NimiAIProfileLocalConfigurationDecision,
  type NimiAIProfileSelectionMismatchPreview,
} from '@nimiplatform/sdk/ai';
import type { NimiLoadoutRecipe } from '@nimiplatform/sdk/runtime';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import { Button, InlineAlert, ScrollShell, SelectField, Surface, TextField, type SelectFieldOption } from '@nimiplatform/kit/ui';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { createRuntimeAgentAIConfigAdapter } from '../../infra/runtime-agent-ai-config.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { RuntimePageShell } from './runtime-config-page-shell.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';
import {
  addRuntimeConfigAIProfileCapability,
  changeRuntimeConfigAIProfileCapabilityContract,
  createRuntimeConfigAIProfileAuthoringState,
  exportRuntimeConfigAIProfileAuthoring,
  importRuntimeConfigAIProfileAuthoring,
  inspectRuntimeConfigAIProfileAuthoring,
  loadRuntimeConfigAIProfileAuthoringCurrentProjection,
  reduceRuntimeConfigAIProfileAuthoringState,
  runtimeConfigAIProfileCapabilityContracts,
  runtimeConfigAIProfileRecipeCandidates,
  technicalErrorDetail,
  type RuntimeConfigAIProfileAuthoringCurrentProjection,
  type RuntimeConfigAIProfileAuthoringDraft,
  type RuntimeConfigAIProfileAuthoringInspection,
  type RuntimeConfigAIProfileAuthoringRequirementView,
  type RuntimeConfigAIProfileAuthoringState,
  type RuntimeConfigAIProfileCapabilityContract,
  type RuntimeConfigAIProfileCapabilityDraft,
} from './runtime-config-profile-authoring-state.js';

type ProjectionStatus = 'loading' | 'ready' | 'failed';

export type AIProfileAuthoringViewProps = {
  readonly state: RuntimeConfigAIProfileAuthoringState;
  readonly inspection: RuntimeConfigAIProfileAuthoringInspection;
  readonly projectionStatus: ProjectionStatus;
  readonly projectionTechnicalError: string;
  readonly recipes: readonly NimiLoadoutRecipe[];
  readonly onDraftChange: (draft: RuntimeConfigAIProfileAuthoringDraft) => void;
  readonly onImportFile: (file: File) => void;
  readonly onExport: () => void;
  readonly onReloadProjection: () => void;
};

export function AIProfileAuthoringPage() {
  const sdk = useDesktopRendererSdk();
  const subjectUserId = useAppStore((state) => String(state.auth.user?.id ?? '').trim());
  const appAIConfig = useMemo(() => sdk.appProduct().aiConfig, [sdk]);
  const loadouts = useMemo(() => sdk.machineProduct().local.loadouts, [sdk]);
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
        appId: sdk.appId(),
        getAppAIConfig: () => readOptionalAIConfig(async () => (
          (await appAIConfig.get()).config as unknown as NimiCapabilityAIConfig | null
        )),
        getSharedAIConfig: () => readOptionalAIConfig(async () => (
          await sharedAIConfig.get({ subjectUserId })
        ).config),
        getLoadouts: () => loadouts.get(),
        getRecipes: () => loadouts.listRecipes(),
      });
      setCurrent(next);
      dispatch({ type: 'recipes-loaded', recipes: next.recipes });
      setProjectionStatus('ready');
    } catch (error) {
      setCurrent(null);
      setProjectionStatus('failed');
      setProjectionTechnicalError(technicalErrorDetail(error));
    }
  }, [appAIConfig, loadouts, sdk, sharedAIConfig, subjectUserId]);

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
          draft: importRuntimeConfigAIProfileAuthoring(source, current?.recipes ?? []),
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
  }, [current]);

  const exportArtifact = useCallback(() => {
    try {
      const artifact = exportRuntimeConfigAIProfileAuthoring(
        state.draft,
        current?.recipes ?? [],
      );
      downloadPortableProfile(artifact.artifactJson, artifact.fileName);
      dispatch({ type: 'export-started' });
    } catch (error) {
      dispatch({
        type: 'operation-failed',
        source: 'export',
        technicalError: technicalErrorDetail(error),
      });
    }
  }, [current, state.draft]);

  return (
    <AIProfileAuthoringView
      state={state}
      inspection={inspection}
      projectionStatus={projectionStatus}
      projectionTechnicalError={projectionTechnicalError}
      recipes={current?.recipes ?? []}
      onDraftChange={(draft) => dispatch({ type: 'draft-changed', draft })}
      onImportFile={importFile}
      onExport={exportArtifact}
      onReloadProjection={() => { void reloadProjection(); }}
    />
  );
}

export function AIProfileAuthoringView(props: AIProfileAuthoringViewProps) {
  const { t } = useTranslation();
  const editorRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [addSearch, setAddSearch] = useState('');
  const model = props.inspection.status === 'valid' ? props.inspection.model : null;
  const activeCapability = props.state.draft.capabilities.find((item) => item.draftId === selection)
    ?? props.state.draft.capabilities[0];
  const activeView = selection === 'metadata' || selection === 'preview' || selection === 'add'
    ? selection : activeCapability?.draftId ?? 'add';
  const selectEditor = (next: string) => {
    setSelection(next);
    editorRef.current?.scrollIntoView({ block: 'start' });
    editorRef.current?.focus({ preventScroll: true });
  };
  const updateDraft = (next: RuntimeConfigAIProfileAuthoringDraft) => {
    if (activeCapability && !next.capabilities.some((item) => item.draftId === activeCapability.draftId)) {
      const index = props.state.draft.capabilities.indexOf(activeCapability);
      setSelection(next.capabilities[Math.min(index, next.capabilities.length - 1)]?.draftId ?? 'add');
    }
    props.onDraftChange(next);
  };
  useEffect(() => {
    if (props.state.operation === 'imported') {
      setSelection(props.state.draft.capabilities.find((capability) => (
        capability.route === 'local' && capability.local.includeImplementation && !capability.local.recipeId
      ))?.draftId ?? null);
      setSearch('');
      setAddSearch('');
    }
  }, [props.state.operation, props.state.draft]);
  const requirementsByCapability = new Map(
    model?.requirements.map((requirement) => [requirement.capabilityContract, requirement] as const),
  );
  const capabilityContracts = runtimeConfigAIProfileCapabilityContracts(
    props.state.draft,
    props.recipes,
  );
  const usedCapabilities = new Set(
    props.state.draft.capabilities.map((capability) => capability.capabilityContract),
  );
  const canAddCapability = props.recipes.some(
    (recipe) => !usedCapabilities.has(recipe.capabilityContract),
  );
  const exportReady = model?.exportArtifact !== null && model !== null;
  const matchesSearch = (contract: string, query: string) => (
    `${displayRuntimeConfigCapabilityLabel(contract, t)} ${contract}`.toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase())
  );
  const visibleCapabilities = props.state.draft.capabilities.filter((item) => matchesSearch(item.capabilityContract, search));
  const availableContracts = [...new Set(props.recipes.map((recipe) => recipe.capabilityContract))]
    .filter((contract) => matchesSearch(contract, addSearch));

  return (
    <RuntimePageShell>
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
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--nimi-border-subtle)] pt-3 text-xs text-[var(--nimi-text-secondary)]">
          <span>{t('runtimeConfig.profiles.authoring.draftSummary', { count: props.state.draft.capabilities.length })}</span>
          <Button type="button" size="sm" tone="ghost" onClick={() => selectEditor('preview')}>
            {t(`runtimeConfig.profiles.authoring.${exportReady ? 'checkReady' : 'checkPending'}`)}
          </Button>
        </div>
      </Surface>

      <div className="grid min-w-0 items-start gap-4 md:grid-cols-[12rem_minmax(0,1fr)]">
        <Surface tone="card" className="min-w-0 space-y-3 p-3 md:sticky md:top-0" data-testid="ai-profile-authoring-navigation">
          <nav aria-label={t('runtimeConfig.profiles.authoring.profileNavigation')} className="space-y-1">
            {(['metadata', 'preview'] as const).map((view) => (
              <button key={view} type="button" aria-current={activeView === view ? 'page' : undefined}
                className={authoringNavigationClassName(activeView === view)} onClick={() => selectEditor(view)}
                data-testid={`ai-profile-authoring-nav:${view}`}>
                {t(`runtimeConfig.profiles.authoring.${view === 'metadata' ? 'metadataTitle' : 'previewTitle'}`)}
              </button>
            ))}
          </nav>
          <div className="space-y-3 border-t border-[var(--nimi-border-subtle)] pt-3">
            <h4 className="px-2 text-xs font-semibold text-[var(--nimi-text-secondary)]">
              {t('runtimeConfig.profiles.authoring.profileCapabilities', { count: props.state.draft.capabilities.length })}
            </h4>
            <TextField type="search" aria-label={t('runtimeConfig.profiles.authoring.searchCapabilities')}
              placeholder={t('runtimeConfig.profiles.authoring.searchCapabilities')} value={search}
              data-testid="ai-profile-authoring-search" onChange={(event) => setSearch(event.currentTarget.value)} />
            <nav aria-label={t('runtimeConfig.profiles.authoring.capabilitiesTitle')} className="max-h-56 space-y-1 overflow-y-auto md:max-h-[50vh]">
              {visibleCapabilities.map((capability) => (
                <button key={capability.draftId} type="button"
                  aria-current={activeView === capability.draftId ? 'page' : undefined}
                  className={authoringNavigationClassName(activeView === capability.draftId)}
                  onClick={() => selectEditor(capability.draftId)}
                  data-testid={`ai-profile-authoring-nav:${capability.capabilityContract}`}>
                  <span className="block">{displayRuntimeConfigCapabilityLabel(capability.capabilityContract, t)}</span>
                  <span className="mt-1 block text-xs font-normal text-[var(--nimi-text-muted)]">
                    {t(`runtimeConfig.profiles.authoring.${capability.route === 'local' ? 'routeLocal' : 'routeCloud'}`)}
                  </span>
                </button>
              ))}
              {visibleCapabilities.length === 0 ? <p className="px-2 py-3 text-xs text-[var(--nimi-text-muted)]">
                {t(`runtimeConfig.profiles.authoring.${props.state.draft.capabilities.length ? 'noSearchResults' : 'noCapabilities'}`)}
              </p> : null}
            </nav>
            <Button
              type="button"
              size="sm"
              className="w-full"
              disabled={!canAddCapability}
              data-testid="ai-profile-authoring-add"
              onClick={() => { setAddSearch(''); selectEditor('add'); }}
            >
              {t('runtimeConfig.profiles.authoring.addCapability')}
            </Button>
          </div>
        </Surface>

        <div ref={editorRef} tabIndex={-1} className="min-w-0 space-y-4 outline-none" data-testid="ai-profile-authoring-form">
          {activeView === 'add' ? (
            <Surface tone="card" className="space-y-4 p-5" data-testid="ai-profile-authoring-picker">
              <h4 className="text-sm font-semibold">{t('runtimeConfig.profiles.authoring.addCapability')}</h4>
              <p className="text-xs text-[var(--nimi-text-secondary)]">{t('runtimeConfig.profiles.authoring.addCapabilityBody')}</p>
              <TextField type="search" aria-label={t('runtimeConfig.profiles.authoring.searchAvailableCapabilities')}
                placeholder={t('runtimeConfig.profiles.authoring.searchAvailableCapabilities')} value={addSearch}
                data-testid="ai-profile-authoring-add-search" onChange={(event) => setAddSearch(event.currentTarget.value)} />
              <div className="grid max-h-[60vh] gap-2 overflow-y-auto sm:grid-cols-2">
                {availableContracts.map((contract) => (
                  <button key={contract} type="button" disabled={usedCapabilities.has(contract)}
                    data-testid={`ai-profile-authoring-add:${contract}`}
                    className="rounded-xl border border-[var(--nimi-border-subtle)] p-3 text-left hover:bg-[var(--nimi-surface-subtle)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-field-focus)] disabled:opacity-50"
                    onClick={() => {
                      const next = addRuntimeConfigAIProfileCapability(props.state.draft, props.recipes.filter((recipe) => recipe.capabilityContract === contract));
                      const added = next.capabilities.at(-1);
                      updateDraft(next);
                      setSearch('');
                      if (added) selectEditor(added.draftId);
                    }}>
                    <span className="block text-sm font-semibold">{displayRuntimeConfigCapabilityLabel(contract, t)}</span>
                    <span className="mt-1 block break-all font-mono text-xs text-[var(--nimi-text-muted)]">{contract}</span>
                    {usedCapabilities.has(contract) ? <span className="mt-2 block text-xs">{t('runtimeConfig.profiles.authoring.alreadyAdded')}</span> : null}
                  </button>
                ))}
              </div>
              {availableContracts.length === 0 ? <p className="text-sm text-[var(--nimi-text-muted)]">{t('runtimeConfig.profiles.authoring.noSearchResults')}</p> : null}
            </Surface>
          ) : activeView === 'metadata' ? (
            <ProfileMetadataForm draft={props.state.draft} onChange={updateDraft} t={t} />
          ) : activeView === 'preview' ? (
            <JourneyPreviewPanel
              inspection={props.inspection}
              projectionStatus={props.projectionStatus}
              projectionTechnicalError={props.projectionTechnicalError}
              onReloadProjection={props.onReloadProjection}
              onEditMetadata={() => selectEditor('metadata')}
              t={t}
            />
          ) : activeCapability ? (
            <CapabilityAuthoringCard
              key={activeCapability.draftId}
              capability={activeCapability}
              index={props.state.draft.capabilities.indexOf(activeCapability)}
              draft={props.state.draft}
              recipes={props.recipes}
              capabilityContracts={capabilityContracts}
              requirement={requirementsByCapability.get(activeCapability.capabilityContract)}
              onChange={updateDraft}
              t={t}
            />
          ) : null}
        </div>
      </div>
    </RuntimePageShell>
  );
}

function authoringNavigationClassName(active: boolean): string {
  return `w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium focus-visible:outline-2 focus-visible:outline-[var(--nimi-field-focus)] ${active
    ? 'bg-[var(--nimi-surface-active)] text-[var(--nimi-text-primary)]'
    : 'text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-surface-subtle)]'}`;
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
  readonly recipes: readonly NimiLoadoutRecipe[];
  readonly capabilityContracts: readonly string[];
  readonly requirement: RuntimeConfigAIProfileAuthoringRequirementView | undefined;
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
            props.recipes,
          ))}
          options={props.capabilityContracts.map((candidate) => ({
            value: candidate,
            label: displayRuntimeConfigCapabilityLabel(candidate, props.t),
            disabled: used.has(candidate),
          }))}
        />
        <AuthoringSelect
          label={props.t('runtimeConfig.profiles.authoring.recommendationRoute')}
          value={capability.route}
          field="recommendation-route"
          onChange={(route) => patch({ route: route as 'local' | 'cloud' })}
          options={[
            { value: 'local', label: props.t('runtimeConfig.profiles.authoring.routeLocal') },
            { value: 'cloud', label: props.t('runtimeConfig.profiles.authoring.routeCloud') },
          ]}
        />
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
          recipes={props.recipes}
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
  readonly recipes: readonly NimiLoadoutRecipe[];
  readonly updateCapability: (
    update: (current: RuntimeConfigAIProfileCapabilityDraft) => RuntimeConfigAIProfileCapabilityDraft,
  ) => void;
  readonly t: TFunction;
}) {
  const { capability } = props;
  const candidates = runtimeConfigAIProfileRecipeCandidates(capability, props.recipes);
  const unresolvedImport = capability.local.importedIntent?.recipeId === '';
  const selected = candidates.find((recipe) => recipe.recipeId === capability.local.recipeId);
  const updateLocal = (next: Partial<RuntimeConfigAIProfileCapabilityDraft['local']>) => {
    props.updateCapability((current) => ({
      ...current,
      local: { ...current.local, ...next },
    }));
  };
  if (candidates.length === 0) {
    return <InlineAlert tone="info">{props.t('runtimeConfig.profiles.authoring.localIntentOnly')}</InlineAlert>;
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
          <input type="checkbox" checked={capability.local.includeImplementation} onChange={(event) => updateLocal({ includeImplementation: event.currentTarget.checked })} />
          {props.t('runtimeConfig.profiles.authoring.packageImplementation')}
        </label>
      </div>
      {capability.local.includeImplementation ? (
        <>
          {unresolvedImport && !capability.local.recipeId ? (
            <InlineAlert tone="info">{props.t('runtimeConfig.profiles.authoring.recipeSelectionRequired')}</InlineAlert>
          ) : null}
          <AuthoringSelect label={props.t('runtimeConfig.loadouts.recipe')} placeholder={props.t('runtimeConfig.profiles.authoring.selectRecipe')} value={capability.local.recipeId} field="local-recipe" onChange={(recipeId) => {
            const recipe = candidates.find((candidate) => candidate.recipeId === recipeId);
            if (!recipe) return;
            if (unresolvedImport) {
              updateLocal({ recipeId, recipeRefreshBlocked: undefined });
              return;
            }
            updateLocal({
              recipeId,
              portableConfigJson: recipe ? JSON.stringify(recipe.defaultOptions, null, 2) : '',
              resourceOccurrences: undefined,
              loadout: undefined,
            });
          }}
            options={candidates.map((recipe) => ({
              value: recipe.recipeId,
              label: `${recipe.title} (${recipe.revision})`,
            }))}
          />
          {selected ? (
            <>
              <div className="grid gap-3 md:grid-cols-3" data-testid="ai-profile-authoring-local-identity">
                <ReadOnlyAuthoringField label={props.t('runtimeConfig.profiles.authoring.implementationId')} value={selected.implementation.implementationId} />
                <ReadOnlyAuthoringField label={props.t('runtimeConfig.profiles.authoring.driverId')} value={selected.implementation.driverId} />
                <ReadOnlyAuthoringField label={props.t('runtimeConfig.profiles.authoring.driverDialect')} value={selected.implementation.driverDialect} />
              </div>
              <ReadOnlyAuthoringField label={props.t('runtimeConfig.profiles.authoring.supportedFeatures')} value={selected.implementationSupportedFeatures.join(', ') || props.t('runtimeConfig.profiles.authoring.none')} />
              <AuthoringTextArea
                label={props.t('runtimeConfig.profiles.authoring.driverPortableConfig')}
                hint={props.t('runtimeConfig.profiles.authoring.requirementsRuntimeTruth')}
                value={capability.local.portableConfigJson}
                field="local-portable-config"
                rows={8}
                placeholder="{}"
                onChange={(portableConfigJson) => updateLocal({ portableConfigJson })}
              />
            </>
          ) : (
            <InlineAlert tone="danger">{props.t('runtimeConfig.profiles.authoring.requirementsPending')}</InlineAlert>
          )}
        </>
      ) : null}
    </div>
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
        placeholder={'{\n  "provider": "example",\n  "providerModelId": "model-v1",\n  "remoteModelCatalogId": "remote-model-catalog_..."\n}'}
        onChange={(providerModelTargetJson) => update({ providerModelTargetJson })}
      />
    </div>
  );
}

function RequirementProjectionSurface(props: {
  readonly requirement: RuntimeConfigAIProfileAuthoringRequirementView | undefined;
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
                key={requirement.slotId}
                className="grid gap-1 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 text-xs sm:grid-cols-2"
                data-recipe-slot={requirement.slotId}
              >
                <div className="min-w-0 font-semibold text-[var(--nimi-text-primary)]">{requirement.displayLabel}</div>
                <div className="min-w-0 break-all font-mono text-[var(--nimi-text-muted)]">{requirement.slotId}</div>
                <div className="min-w-0 break-all text-[var(--nimi-text-secondary)]">
                  {requirement.recommendedContentIds.length > 0
                    ? requirement.recommendedContentIds.join(', ')
                    : props.t('runtimeConfig.profiles.authoring.none')}
                </div>
                <div className="min-w-0 break-all font-mono text-[var(--nimi-text-secondary)]">
                  {JSON.stringify(requirement.modelContract)}
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
  readonly onEditMetadata: () => void;
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
              <Button type="button" size="sm" onClick={props.onEditMetadata}>
                {props.t('runtimeConfig.profiles.authoring.editMetadata')}
              </Button>
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
  const [target, setTarget] = useState('app');
  const writes = props.model.importPreview.declaredWrites;
  const preview = target === 'app' ? props.model.appApplyPreview : props.model.sharedApplyPreview;
  return (
    <div className="space-y-4">
      <AuthoringSelect
        label={props.t('runtimeConfig.profiles.authoring.previewTarget')}
        value={target}
        field="preview-target"
        onChange={setTarget}
        options={[
          { value: 'app', label: props.t('runtimeConfig.profiles.authoring.appOwner') },
          { value: 'shared', label: props.t('runtimeConfig.profiles.authoring.sharedOwner') },
        ]}
      />
      <ApplyPreviewSection
        key={target}
        preview={preview}
        ownerLabel={props.t(`runtimeConfig.profiles.authoring.${target === 'app' ? 'appOwner' : 'sharedOwner'}`)}
        t={props.t}
      />

      <PreviewSection collapsible title={props.t('runtimeConfig.profiles.authoring.importPreviewTitle')} testId="ai-profile-authoring-import-preview">
        <p>{props.t('runtimeConfig.profiles.authoring.importPreviewBody')}</p>
        <dl className="mt-2 grid gap-1">
          <PreviewFact label={props.t('runtimeConfig.profiles.authoring.profileArtifact')} value={yesNo(writes.profileArtifact, props.t)} />
          <PreviewFact label={props.t('runtimeConfig.profiles.authoring.aiConfigWrite')} value={yesNo(writes.aiConfig, props.t)} />
          <PreviewFact label={props.t('runtimeConfig.profiles.authoring.localConfigurationWrite')} value={yesNo(writes.localCapabilityConfigurations, props.t)} />
          <PreviewFact label={props.t('runtimeConfig.profiles.authoring.machineSelectionWrite')} value={yesNo(writes.machineSelection, props.t)} />
        </dl>
      </PreviewSection>

      <PreviewSection collapsible title={props.t('runtimeConfig.profiles.authoring.localConfigurationPreviewTitle')} testId="ai-profile-authoring-local-preview">
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

      <PreviewSection collapsible title={props.t('runtimeConfig.profiles.authoring.selectionPreviewTitle')} testId="ai-profile-authoring-selection-preview">
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
  const hasChanges = intentDiff.addedCapabilityContracts.length > 0
    || intentDiff.changedCapabilityContracts.length > 0
    || intentDiff.removedCapabilityContracts.length > 0;
  return (
    <PreviewSection title={props.t('runtimeConfig.profiles.authoring.applyPreviewTitle', { owner: props.ownerLabel })} testId={`ai-profile-authoring-apply-preview:${props.preview.target.kind}`}>
      <div>{props.t(`runtimeConfig.profiles.authoring.${hasChanges ? 'applyChanges' : 'applyUnchanged'}`)}</div>
      <dl className="mt-2 grid gap-1">
        <PreviewFact label={props.t('runtimeConfig.profiles.authoring.added')} value={listOrNone(intentDiff.addedCapabilityContracts.map((contract) => displayRuntimeConfigCapabilityLabel(contract, props.t)), props.t)} />
        <PreviewFact label={props.t('runtimeConfig.profiles.authoring.changed')} value={listOrNone(intentDiff.changedCapabilityContracts.map((contract) => displayRuntimeConfigCapabilityLabel(contract, props.t)), props.t)} />
        <PreviewFact label={props.t('runtimeConfig.profiles.authoring.removed')} value={listOrNone(intentDiff.removedCapabilityContracts.map((contract) => displayRuntimeConfigCapabilityLabel(contract, props.t)), props.t)} />
        <PreviewFact label={props.t('runtimeConfig.profiles.authoring.unchanged')} value={listOrNone(intentDiff.unchangedCapabilityContracts.map((contract) => displayRuntimeConfigCapabilityLabel(contract, props.t)), props.t)} />
      </dl>
      {props.preview.cloudConfigurations.length > 0 ? (
        <div className="mt-2 text-[var(--nimi-status-info)]">
          {props.t('runtimeConfig.profiles.authoring.cloudConfigured', {
            capabilities: props.preview.cloudConfigurations
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
              : props.t('runtimeConfig.profiles.authoring.currentLoadout', {
                value: branch.loadoutId ?? props.t('runtimeConfig.profiles.authoring.none'),
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
  if (props.state.operation === 'export-started') {
    return <InlineAlert tone="info">{props.t('runtimeConfig.profiles.authoring.exportStarted')}</InlineAlert>;
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
  readonly collapsible?: boolean;
  readonly children: ReactNode;
}) {
  if (props.collapsible) {
    return (
      <details className="rounded-xl border border-[var(--nimi-border-subtle)] p-3 text-xs leading-relaxed text-[var(--nimi-text-secondary)]" data-testid={props.testId}>
        <summary className="cursor-pointer font-semibold text-[var(--nimi-text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-field-focus)]">
          {props.title}
        </summary>
        <div className="mt-3">{props.children}</div>
      </details>
    );
  }
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
      <ScrollShell className="max-h-48 rounded-lg bg-[var(--nimi-surface-subtle)] p-2">
        <pre className="whitespace-pre-wrap break-words font-mono text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">
          {JSON.stringify(props.value, null, 2)}
        </pre>
      </ScrollShell>
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
  readonly placeholder?: string;
  readonly value: string;
  readonly field: string;
  readonly onChange: (value: string) => void;
  readonly options: SelectFieldOption[];
}) {
  return (
    <label className="block space-y-1.5 text-xs font-medium text-[var(--nimi-text-secondary)]">
      <span>{props.label}</span>
      <SelectField
        value={props.value}
        placeholder={props.placeholder}
        data-testid={`authoring-field-${props.field}`}
        onValueChange={props.onChange}
        options={props.options}
        selectClassName="min-h-10 rounded-xl px-3 text-sm"
      />
    </label>
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
      ids: decision.matches.map((match) => match.loadoutId).join(', '),
    });
  }
  return t('runtimeConfig.profiles.authoring.decisionChoose', {
    ids: decision.updateCandidateLoadoutIds.join(', '),
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
