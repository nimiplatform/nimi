import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RuntimeModelPickerPanel,
} from '@nimiplatform/nimi-kit/features/model-picker/ui';
import {
  useRuntimeModelPickerPanel,
} from '@nimiplatform/nimi-kit/features/model-picker/runtime';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { ScrollShell } from '@renderer/components/scroll-shell.js';
import { Button, Card, Input, RuntimeSelect } from './runtime-config-primitives';
import {
  sdkDeleteCatalogModelOverlay,
  sdkDeleteModelCatalogProvider,
  sdkListCatalogProviderModels,
  sdkListModelCatalogProviders,
  sdkUpsertCatalogModelOverlay,
  sdkUpsertModelCatalogProvider,
  type RuntimeCatalogModelDetail,
  type RuntimeCatalogModelOverlayInput,
  type RuntimeCatalogModelSummary,
  type RuntimeCatalogProviderModelsResponse,
  type RuntimeCatalogVoiceEntry,
  type RuntimeCatalogWorkflowBinding,
  type RuntimeCatalogWorkflowModel,
  type RuntimeModelCatalogProvider,
} from './runtime-config-catalog-sdk-service';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';

type CatalogPageProps = { state: RuntimeConfigStateV11 };

type CatalogCapabilityFilter = 'all' | 'text' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | 'music';

type VoiceRow = {
  voiceId: string;
  name: string;
  langs: string;
  modelIds: string;
  sourceUrl: string;
  sourceRetrievedAt: string;
  sourceNote: string;
};

type WorkflowRow = {
  workflowModelId: string;
  workflowType: string;
  inputContractRef: string;
  outputPersistence: string;
  targetModelRefs: string;
  langs: string;
  sourceUrl: string;
  sourceRetrievedAt: string;
  sourceNote: string;
};

type CatalogFormState = {
  modelId: string;
  modelType: string;
  updatedAt: string;
  capabilitiesText: string;
  pricingUnit: string;
  pricingInput: string;
  pricingOutput: string;
  pricingCurrency: string;
  pricingAsOf: string;
  pricingNotes: string;
  sourceUrl: string;
  sourceRetrievedAt: string;
  sourceNote: string;
  voiceSetId: string;
  voiceDiscoveryMode: string;
  voiceRefKindsText: string;
  videoModesText: string;
  videoOptionSupportsText: string;
  videoInputRolesText: string;
  videoLimitsJson: string;
  videoConstraintsJson: string;
  videoOutputVideoUrl: boolean;
  videoOutputLastFrameUrl: boolean;
  voices: VoiceRow[];
  workflows: WorkflowRow[];
  bindingRefsText: string;
  bindingTypesText: string;
};

const MODEL_CATALOG_UPDATED_EVENT = 'nimi:runtime:model-catalog-updated';
const MODEL_CAPABILITY_OPTIONS: Array<{ value: CatalogCapabilityFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'text', label: 'Text' },
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' },
  { value: 'tts', label: 'TTS' },
  { value: 'stt', label: 'STT' },
  { value: 'embedding', label: 'Embedding' },
  { value: 'music', label: 'Music' },
];

function emitModelCatalogUpdated(provider: string) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent(MODEL_CATALOG_UPDATED_EVENT, { detail: { provider, updatedAt: new Date().toISOString() } }));
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function createEmptyVoiceRow(): VoiceRow {
  return { voiceId: '', name: '', langs: '', modelIds: '', sourceUrl: '', sourceRetrievedAt: todayDate(), sourceNote: '' };
}

function createEmptyWorkflowRow(): WorkflowRow {
  return { workflowModelId: '', workflowType: 'tts_v2v', inputContractRef: '', outputPersistence: '', targetModelRefs: '', langs: '', sourceUrl: '', sourceRetrievedAt: todayDate(), sourceNote: '' };
}

function createEmptyFormState(_selectedProvider: RuntimeModelCatalogProvider | null): CatalogFormState {
  return {
    modelId: '',
    modelType: 'text',
    updatedAt: todayDate(),
    capabilitiesText: '',
    pricingUnit: 'token',
    pricingInput: 'unknown',
    pricingOutput: 'unknown',
    pricingCurrency: 'USD',
    pricingAsOf: todayDate(),
    pricingNotes: '',
    sourceUrl: '',
    sourceRetrievedAt: todayDate(),
    sourceNote: '',
    voiceSetId: '',
    voiceDiscoveryMode: 'static_catalog',
    voiceRefKindsText: 'preset_voice_id',
    videoModesText: '',
    videoOptionSupportsText: '',
    videoInputRolesText: '{\n  "t2v": ["prompt"]\n}',
    videoLimitsJson: '{}',
    videoConstraintsJson: '{}',
    videoOutputVideoUrl: true,
    videoOutputLastFrameUrl: false,
    voices: [createEmptyVoiceRow()],
    workflows: [],
    bindingRefsText: '',
    bindingTypesText: '',
  };
}

function splitCsv(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function capabilityMatchesFilter(capabilities: string[], filter: CatalogCapabilityFilter) {
  if (filter === 'all') return true;
  const items = new Set(capabilities.map((item) => item.toLowerCase()));
  if (filter === 'text') return items.has('text.generate');
  if (filter === 'image') return items.has('image.generate');
  if (filter === 'video') return items.has('video.generate');
  if (filter === 'tts') return items.has('audio.synthesize');
  if (filter === 'stt') return items.has('audio.transcribe');
  if (filter === 'embedding') return items.has('text.embed');
  if (filter === 'music') return items.has('music.generate') || items.has('music.generate.iteration');
  return true;
}

function sourceTone(source: RuntimeModelCatalogProvider['source'] | RuntimeCatalogModelSummary['source']) {
  if (source === 'overridden') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (source === 'custom') return 'border-mint-200 bg-mint-50 text-mint-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

export function CatalogPage({ state: _state }: CatalogPageProps) {
  const { t } = useTranslation();
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const [providers, setProviders] = useState<RuntimeModelCatalogProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [providerModels, setProviderModels] = useState<RuntimeCatalogProviderModelsResponse | null>(null);
  const [providerSearch, setProviderSearch] = useState('');
  const [providerCapabilityFilter, setProviderCapabilityFilter] = useState<CatalogCapabilityFilter>('all');
  const [providerSourceFilter, setProviderSourceFilter] = useState<'all' | 'builtin' | 'custom' | 'overridden'>('all');
  const [overlayYamlDraft, setOverlayYamlDraft] = useState('');
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [savingOverlayYaml, setSavingOverlayYaml] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [deletingModelId, setDeletingModelId] = useState('');
  const [showAddModel, setShowAddModel] = useState(false);
  const [showYamlPanel, setShowYamlPanel] = useState(false);
  const [formState, setFormState] = useState<CatalogFormState>(createEmptyFormState(null));

  const loadProviders = useCallback(async () => {
    setLoadingProviders(true);
    try {
      const rows = await sdkListModelCatalogProviders();
      setProviders(rows);
      setSelectedProviderId((current) => (current && rows.some((row) => row.provider === current) ? current : rows[0]?.provider || ''));
    } catch (error) {
      setStatusBanner({ kind: 'error', message: `Catalog load failed: ${error instanceof Error ? error.message : String(error || '')}` });
    } finally {
      setLoadingProviders(false);
    }
  }, [setStatusBanner]);

  const selectedProvider = useMemo(() => providers.find((provider) => provider.provider === selectedProviderId) || null, [providers, selectedProviderId]);

  const loadProviderModels = useCallback(async (provider: string) => {
    if (!provider) return;
    setLoadingModels(true);
    try {
      const response = await sdkListCatalogProviderModels(provider);
      setProviderModels(response);
      setOverlayYamlDraft(response.provider.yaml || '');
    } catch (error) {
      setStatusBanner({ kind: 'error', message: `Model list load failed: ${error instanceof Error ? error.message : String(error || '')}` });
    } finally {
      setLoadingModels(false);
    }
  }, [setStatusBanner]);

  useEffect(() => { void loadProviders(); }, [loadProviders]);
  useEffect(() => { if (selectedProviderId) void loadProviderModels(selectedProviderId); }, [loadProviderModels, selectedProviderId]);
  useEffect(() => { if (showAddModel) setFormState(createEmptyFormState(selectedProvider)); }, [showAddModel, selectedProvider]);

  const filteredProviders = useMemo(() => providers.filter((provider) => {
    if (providerSourceFilter !== 'all' && provider.source !== providerSourceFilter) return false;
    if (!capabilityMatchesFilter(provider.capabilities, providerCapabilityFilter)) return false;
    const haystack = `${provider.provider} ${provider.defaultTextModel} ${provider.capabilities.join(' ')}`.toLowerCase();
    return haystack.includes(providerSearch.trim().toLowerCase());
  }), [providerCapabilityFilter, providerSearch, providerSourceFilter, providers]);

  const overview = useMemo(() => {
    let totalModels = 0;
    let totalCustom = 0;
    let latestOverlay = '';
    for (const provider of providers) {
      totalModels += provider.modelCount;
      totalCustom += provider.customModelCount + provider.overriddenModelCount;
      if (provider.overlayUpdatedAt && provider.overlayUpdatedAt > latestOverlay) latestOverlay = provider.overlayUpdatedAt;
    }
    return { providerCount: providers.length, totalModels, totalCustom, latestOverlay: latestOverlay || 'Never' };
  }, [providers]);

  const onSaveOverlayYaml = useCallback(async () => {
    if (!selectedProvider) return;
    if (!overlayYamlDraft.trim()) {
      setStatusBanner({ kind: 'error', message: 'Overlay YAML cannot be empty.' });
      return;
    }
    setSavingOverlayYaml(true);
    try {
      await sdkUpsertModelCatalogProvider(selectedProvider.provider, overlayYamlDraft);
      emitModelCatalogUpdated(selectedProvider.provider);
      await loadProviders();
      await loadProviderModels(selectedProvider.provider);
      setStatusBanner({ kind: 'success', message: `Overlay YAML saved for ${selectedProvider.provider}.` });
    } catch (error) {
      setStatusBanner({ kind: 'error', message: `Overlay YAML save failed: ${error instanceof Error ? error.message : String(error || '')}` });
    } finally {
      setSavingOverlayYaml(false);
    }
  }, [loadProviderModels, loadProviders, overlayYamlDraft, selectedProvider, setStatusBanner]);

  const onDeleteOverlayYaml = useCallback(async () => {
    if (!selectedProvider) return;
    setSavingOverlayYaml(true);
    try {
      await sdkDeleteModelCatalogProvider(selectedProvider.provider);
      emitModelCatalogUpdated(selectedProvider.provider);
      await loadProviders();
      await loadProviderModels(selectedProvider.provider);
      setStatusBanner({ kind: 'success', message: `Overlay removed for ${selectedProvider.provider}.` });
    } catch (error) {
      setStatusBanner({ kind: 'error', message: `Overlay remove failed: ${error instanceof Error ? error.message : String(error || '')}` });
    } finally {
      setSavingOverlayYaml(false);
    }
  }, [loadProviderModels, loadProviders, selectedProvider, setStatusBanner]);

  const onDeleteModel = useCallback(async (modelId: string) => {
    if (!selectedProvider) return;
    setDeletingModelId(modelId);
    try {
      await sdkDeleteCatalogModelOverlay(selectedProvider.provider, modelId);
      emitModelCatalogUpdated(selectedProvider.provider);
      await loadProviders();
      await loadProviderModels(selectedProvider.provider);
      setStatusBanner({ kind: 'success', message: `Custom model removed: ${modelId}.` });
    } catch (error) {
      setStatusBanner({ kind: 'error', message: `Delete model failed: ${error instanceof Error ? error.message : String(error || '')}` });
    } finally {
      setDeletingModelId('');
    }
  }, [loadProviderModels, loadProviders, selectedProvider, setStatusBanner]);

  const onSubmitModel = useCallback(async () => {
    if (!selectedProvider) return;
    try {
      const capabilities = splitCsv(formState.capabilitiesText);
      if (!formState.modelId.trim() || !formState.modelType.trim() || capabilities.length === 0) throw new Error('model_id, model_type, and capabilities are required.');
      if (!formState.updatedAt.trim() || !formState.sourceUrl.trim() || !formState.sourceRetrievedAt.trim()) throw new Error('updated_at and source_ref fields are required.');
      const needsVoice = capabilities.includes('audio.synthesize') || formState.modelType.trim().toLowerCase() === 'tts';
      const needsVideo = capabilities.includes('video.generate');
      if (needsVoice && !formState.voiceSetId.trim()) throw new Error('voice_set_id is required for TTS models.');
      const videoInputRoles = needsVideo ? JSON.parse(formState.videoInputRolesText || '{}') as Record<string, string[]> : {};
      const videoLimits = needsVideo ? JSON.parse(formState.videoLimitsJson || '{}') as Record<string, unknown> : {};
      const videoConstraints = needsVideo ? JSON.parse(formState.videoConstraintsJson || '{}') as Record<string, unknown> : {};
      const detail: RuntimeCatalogModelDetail = {
        provider: selectedProvider.provider,
        modelId: formState.modelId.trim(),
        modelType: formState.modelType.trim(),
        updatedAt: formState.updatedAt.trim(),
        capabilities,
        source: 'custom',
        userScoped: true,
        sourceNote: formState.sourceNote.trim(),
        hasVoiceCatalog: needsVoice,
        hasVideoGeneration: needsVideo,
        pricing: { unit: formState.pricingUnit.trim(), input: formState.pricingInput.trim() || 'unknown', output: formState.pricingOutput.trim() || 'unknown', currency: formState.pricingCurrency.trim(), asOf: formState.pricingAsOf.trim(), notes: formState.pricingNotes.trim() || 'unknown' },
        voiceSetId: formState.voiceSetId.trim(),
        voiceDiscoveryMode: formState.voiceDiscoveryMode.trim(),
        voiceRefKinds: splitCsv(formState.voiceRefKindsText),
        videoGeneration: needsVideo ? { modes: splitCsv(formState.videoModesText), inputRoles: Object.entries(videoInputRoles).map(([key, values]) => ({ key, values })), limits: videoLimits, optionSupports: splitCsv(formState.videoOptionSupportsText), optionConstraints: videoConstraints, outputs: { videoUrl: formState.videoOutputVideoUrl, lastFrameUrl: formState.videoOutputLastFrameUrl } } : null,
        sourceRef: { url: formState.sourceUrl.trim(), retrievedAt: formState.sourceRetrievedAt.trim(), note: formState.sourceNote.trim() },
        warnings: [],
        voices: [],
        voiceWorkflowModels: [],
        modelWorkflowBinding: formState.bindingRefsText.trim() || formState.bindingTypesText.trim() ? { modelId: formState.modelId.trim(), workflowModelRefs: splitCsv(formState.bindingRefsText), workflowTypes: splitCsv(formState.bindingTypesText) } : null,
      };
      const overlayInput: RuntimeCatalogModelOverlayInput = {
        model: detail,
        voices: formState.voices.filter((voice) => voice.voiceId.trim()).map((voice): RuntimeCatalogVoiceEntry => ({ voiceSetId: formState.voiceSetId.trim(), provider: selectedProvider.provider, voiceId: voice.voiceId.trim(), name: voice.name.trim() || voice.voiceId.trim(), langs: splitCsv(voice.langs), modelIds: splitCsv(voice.modelIds || formState.modelId), sourceRef: { url: voice.sourceUrl.trim() || formState.sourceUrl.trim(), retrievedAt: voice.sourceRetrievedAt.trim() || formState.sourceRetrievedAt.trim(), note: voice.sourceNote.trim() } })),
        voiceWorkflowModels: formState.workflows.filter((workflow) => workflow.workflowModelId.trim()).map((workflow): RuntimeCatalogWorkflowModel => ({ workflowModelId: workflow.workflowModelId.trim(), workflowType: workflow.workflowType.trim(), inputContractRef: workflow.inputContractRef.trim(), outputPersistence: workflow.outputPersistence.trim(), targetModelRefs: splitCsv(workflow.targetModelRefs || formState.modelId), langs: splitCsv(workflow.langs), sourceRef: { url: workflow.sourceUrl.trim() || formState.sourceUrl.trim(), retrievedAt: workflow.sourceRetrievedAt.trim() || formState.sourceRetrievedAt.trim(), note: workflow.sourceNote.trim() } })),
        modelWorkflowBinding: detail.modelWorkflowBinding as RuntimeCatalogWorkflowBinding | null,
      };
      setSavingModel(true);
      await sdkUpsertCatalogModelOverlay(selectedProvider.provider, overlayInput);
      emitModelCatalogUpdated(selectedProvider.provider);
      setShowAddModel(false);
      await loadProviders();
      await loadProviderModels(selectedProvider.provider);
      setStatusBanner({ kind: 'success', message: `Custom model saved for ${selectedProvider.provider}.` });
    } catch (error) {
      setStatusBanner({ kind: 'error', message: `Save model failed: ${error instanceof Error ? error.message : String(error || '')}` });
    } finally {
      setSavingModel(false);
    }
  }, [formState, loadProviderModels, loadProviders, selectedProvider, setStatusBanner]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard label={t('runtimeConfig.catalog.providers', { defaultValue: 'Providers' })} value={String(overview.providerCount)} />
        <SummaryCard label={t('runtimeConfig.catalog.models', { defaultValue: 'Models' })} value={String(overview.totalModels)} />
        <SummaryCard label={t('runtimeConfig.catalog.customModels', { defaultValue: 'Personal Custom Models' })} value={String(overview.totalCustom)} />
        <SummaryCard label={t('runtimeConfig.catalog.overlayUpdatedAt', { defaultValue: 'Latest Overlay Update' })} value={overview.latestOverlay} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <ProviderRail providers={filteredProviders} selectedProviderId={selectedProviderId} providerSearch={providerSearch} providerCapabilityFilter={providerCapabilityFilter} providerSourceFilter={providerSourceFilter} onSelectProvider={setSelectedProviderId} onProviderSearch={setProviderSearch} onCapabilityFilter={setProviderCapabilityFilter} onSourceFilter={setProviderSourceFilter} loading={loadingProviders} />
        <div className="space-y-4">
          <ProviderHeader provider={selectedProvider} loadingModels={loadingModels} onRefresh={() => selectedProviderId && void loadProviderModels(selectedProviderId)} onAddModel={() => setShowAddModel(true)} onToggleYaml={() => setShowYamlPanel((value) => !value)} />
          <ModelSection providerId={selectedProviderId} onDeleteModel={onDeleteModel} deletingModelId={deletingModelId} />
          {showYamlPanel && selectedProvider && providerModels ? (
            <YamlPanel provider={providerModels.provider} overlayYamlDraft={overlayYamlDraft} onChangeOverlayYaml={setOverlayYamlDraft} onSave={onSaveOverlayYaml} onDelete={onDeleteOverlayYaml} saving={savingOverlayYaml} />
          ) : null}
        </div>
      </div>

      {showAddModel && selectedProvider ? (
        <AddModelDialog provider={selectedProvider} formState={formState} saving={savingModel} onChange={setFormState} onClose={() => setShowAddModel(false)} onSubmit={onSubmitModel} />
      ) : null}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border border-transparent bg-gradient-to-br from-white via-[#f7fffb] to-[#eefaf5] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
    </Card>
  );
}

function ProviderRail(props: {
  providers: RuntimeModelCatalogProvider[];
  selectedProviderId: string;
  providerSearch: string;
  providerCapabilityFilter: CatalogCapabilityFilter;
  providerSourceFilter: 'all' | 'builtin' | 'custom' | 'overridden';
  onSelectProvider: (provider: string) => void;
  onProviderSearch: (value: string) => void;
  onCapabilityFilter: (value: CatalogCapabilityFilter) => void;
  onSourceFilter: (value: 'all' | 'builtin' | 'custom' | 'overridden') => void;
  loading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Card className="space-y-3 p-4">
      <div className="space-y-3">
        <Input label={t('runtimeConfig.catalogCenter.searchProviders', { defaultValue: 'Search Providers' })} value={props.providerSearch} onChange={props.onProviderSearch} placeholder={t('runtimeConfig.catalogCenter.searchProvidersPlaceholder', { defaultValue: 'provider, default model, capability' })} />
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-1">
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{t('runtimeConfig.catalogCenter.capability', { defaultValue: 'Capability' })}</p>
            <RuntimeSelect value={props.providerCapabilityFilter} onChange={(value) => props.onCapabilityFilter(value as CatalogCapabilityFilter)} options={MODEL_CAPABILITY_OPTIONS} />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{t('runtimeConfig.catalogCenter.source', { defaultValue: 'Source' })}</p>
            <RuntimeSelect value={props.providerSourceFilter} onChange={(value) => props.onSourceFilter(value as 'all' | 'builtin' | 'custom' | 'overridden')} options={[{ value: 'all', label: t('runtimeConfig.catalogCenter.all', { defaultValue: 'All' }) }, { value: 'builtin', label: t('runtimeConfig.catalogCenter.builtin', { defaultValue: 'Builtin' }) }, { value: 'custom', label: t('runtimeConfig.catalogCenter.custom', { defaultValue: 'Custom' }) }, { value: 'overridden', label: t('runtimeConfig.catalogCenter.overridden', { defaultValue: 'Overridden' }) }]} />
          </div>
        </div>
      </div>
      <div className="space-y-2">
        {props.loading ? <p className="text-sm text-slate-500">{t('runtimeConfig.catalogCenter.loadingProviders', { defaultValue: 'Loading providers...' })}</p> : null}
        {props.providers.map((provider) => (
          <button key={provider.provider} type="button" onClick={() => props.onSelectProvider(provider.provider)} className={`w-full rounded-2xl border p-3 text-left transition-colors ${props.selectedProviderId === provider.provider ? 'border-mint-400 bg-mint-50/80' : 'border-slate-200 bg-white hover:border-mint-200 hover:bg-mint-50/30'}`}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">{provider.provider}</p>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${sourceTone(provider.source)}`}>{provider.source}</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">{provider.defaultTextModel || 'No default text model'} · {provider.modelCount} models</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {provider.capabilities.slice(0, 4).map((capability) => <span key={`${provider.provider}-${capability}`} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">{capability}</span>)}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">{provider.requiresExplicitEndpoint ? 'Endpoint required' : provider.defaultEndpoint || 'Managed default endpoint'}</p>
          </button>
        ))}
      </div>
    </Card>
  );
}

function ProviderHeader(props: { provider: RuntimeModelCatalogProvider | null; loadingModels: boolean; onRefresh: () => void; onAddModel: () => void; onToggleYaml: () => void }) {
  if (!props.provider) return <Card className="p-6 text-sm text-slate-500">No provider selected.</Card>;
  const provider = props.provider;
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold text-slate-900">{provider.provider}</h2>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${sourceTone(provider.source)}`}>{provider.source}</span>
          </div>
          <p className="mt-1 text-sm text-slate-500">{props.provider.runtimePlane || 'remote'} · {props.provider.executionModule || 'nimillm'} · {props.provider.modelCount} models · {props.provider.customModelCount + props.provider.overriddenModelCount} personal entries</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={props.onRefresh} disabled={props.loadingModels}>{props.loadingModels ? 'Refreshing...' : 'Refresh'}</Button>
          <Button variant="secondary" size="sm" onClick={props.onToggleYaml}>Advanced YAML</Button>
          <Button size="sm" onClick={props.onAddModel}>Add Model</Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {provider.capabilities.map((capability) => <span key={`${provider.provider}-${capability}`} className="rounded-full border border-mint-100 bg-mint-50/70 px-2.5 py-1 text-[11px] text-mint-800">{capability}</span>)}
      </div>
    </Card>
  );
}

function ModelSection(props: { providerId: string; onDeleteModel: (modelId: string) => void; deletingModelId: string }) {
  const state = useRuntimeModelPickerPanel({
    provider: props.providerId,
  });

  return (
    <RuntimeModelPickerPanel
      state={state}
      className="rounded-3xl"
      pickerClassName="space-y-3 p-4"
      detailClassName="space-y-4 p-4"
      renderItemActions={(model) => (
        model.source === 'custom' || model.source === 'overridden' ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => props.onDeleteModel(model.modelId)}
            disabled={props.deletingModelId === model.modelId}
          >
            {props.deletingModelId === model.modelId ? 'Deleting...' : 'Delete'}
          </Button>
        ) : null
      )}
      renderDetailActions={(model) => (
        model.source === 'custom' || model.source === 'overridden' ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => props.onDeleteModel(model.modelId)}
            disabled={props.deletingModelId === model.modelId}
          >
            {props.deletingModelId === model.modelId ? 'Deleting...' : 'Delete Selected'}
          </Button>
        ) : null
      )}
    />
  );
}

function YamlPanel(props: { provider: RuntimeModelCatalogProvider; overlayYamlDraft: string; onChangeOverlayYaml: (value: string) => void; onSave: () => void; onDelete: () => void; saving: boolean }) {
  return (
    <Card className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-sm font-semibold text-slate-900">Advanced YAML</p><p className="text-xs text-slate-500">Editable overlay fragment on the left, effective merged YAML on the right.</p></div>
        <div className="flex gap-2"><Button variant="secondary" size="sm" onClick={props.onDelete} disabled={props.saving || !props.provider.hasOverlay}>Remove Overlay</Button><Button size="sm" onClick={props.onSave} disabled={props.saving}>{props.saving ? 'Saving...' : 'Save YAML'}</Button></div>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <textarea value={props.overlayYamlDraft} onChange={(event) => props.onChangeOverlayYaml(event.target.value)} spellCheck={false} className="min-h-[320px] rounded-2xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-900 outline-none focus:border-mint-400 focus:ring-2 focus:ring-mint-100" />
        <textarea value={props.provider.effectiveYaml} readOnly spellCheck={false} className="min-h-[320px] rounded-2xl border border-slate-200 bg-slate-950 p-3 font-mono text-xs text-slate-100 opacity-95" />
      </div>
    </Card>
  );
}

function AddModelDialog(props: { provider: RuntimeModelCatalogProvider; formState: CatalogFormState; saving: boolean; onChange: (value: CatalogFormState) => void; onClose: () => void; onSubmit: () => void }) {
  const setField = <K extends keyof CatalogFormState>(key: K, value: CatalogFormState[K]) => props.onChange({ ...props.formState, [key]: value });
  const updateVoice = (index: number, patch: Partial<VoiceRow>) => props.onChange({ ...props.formState, voices: props.formState.voices.map((voice, voiceIndex) => (voiceIndex === index ? { ...voice, ...patch } : voice)) });
  const updateWorkflow = (index: number, patch: Partial<WorkflowRow>) => props.onChange({ ...props.formState, workflows: props.formState.workflows.map((workflow, workflowIndex) => (workflowIndex === index ? { ...workflow, ...patch } : workflow)) });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4">
      <ScrollShell
        className="max-h-[92vh] w-full max-w-6xl rounded-[28px] bg-white shadow-[0_32px_120px_rgba(15,23,42,0.28)]"
        viewportClassName="max-h-[92vh] rounded-[28px]"
        contentClassName="p-5"
      >
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{props.provider.provider}</p><h3 className="mt-1 text-xl font-semibold text-slate-900">Add Personal Catalog Model</h3></div>
          <Button variant="ghost" size="sm" onClick={props.onClose}>Close</Button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Input label="Model ID" value={props.formState.modelId} onChange={(value) => setField('modelId', value)} placeholder="provider/model-id" />
          <Input label="Model Type" value={props.formState.modelType} onChange={(value) => setField('modelType', value)} placeholder="text, image, video, tts" />
          <Input label="Updated At" value={props.formState.updatedAt} onChange={(value) => setField('updatedAt', value)} placeholder="2026-03-15" />
          <Input label="Capabilities" value={props.formState.capabilitiesText} onChange={(value) => setField('capabilitiesText', value)} placeholder="text.generate, image.generate" />
          <Input label="Pricing Unit" value={props.formState.pricingUnit} onChange={(value) => setField('pricingUnit', value)} placeholder="token" />
          <Input label="Pricing Currency" value={props.formState.pricingCurrency} onChange={(value) => setField('pricingCurrency', value)} placeholder="USD" />
          <Input label="Pricing Input" value={props.formState.pricingInput} onChange={(value) => setField('pricingInput', value)} placeholder="unknown" />
          <Input label="Pricing Output" value={props.formState.pricingOutput} onChange={(value) => setField('pricingOutput', value)} placeholder="unknown" />
          <Input label="Pricing As Of" value={props.formState.pricingAsOf} onChange={(value) => setField('pricingAsOf', value)} placeholder="2026-03-15" />
          <Input label="Pricing Notes" value={props.formState.pricingNotes} onChange={(value) => setField('pricingNotes', value)} placeholder="unknown or source notes" />
          <Input label="Source URL" value={props.formState.sourceUrl} onChange={(value) => setField('sourceUrl', value)} placeholder="https://provider-docs.example/model" />
          <Input label="Source Retrieved" value={props.formState.sourceRetrievedAt} onChange={(value) => setField('sourceRetrievedAt', value)} placeholder="2026-03-15" />
        </div>
        <div className="mt-3">
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Source Note</label>
          <textarea value={props.formState.sourceNote} onChange={(event) => setField('sourceNote', event.target.value)} className="min-h-[72px] w-full rounded-[10px] border border-mint-100 bg-[#F4FBF8] p-3 text-sm text-gray-900 outline-none focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100" />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Input label="Voice Set ID" value={props.formState.voiceSetId} onChange={(value) => setField('voiceSetId', value)} placeholder="required for TTS" />
          <Input label="Voice Discovery Mode" value={props.formState.voiceDiscoveryMode} onChange={(value) => setField('voiceDiscoveryMode', value)} placeholder="static_catalog" />
          <Input label="Voice Ref Kinds" value={props.formState.voiceRefKindsText} onChange={(value) => setField('voiceRefKindsText', value)} placeholder="preset_voice_id, provider_voice_ref" />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <JsonArea label="Video Modes" value={props.formState.videoModesText} onChange={(value) => setField('videoModesText', value)} placeholder="t2v, i2v_first_frame" />
          <JsonArea label="Video Option Supports" value={props.formState.videoOptionSupportsText} onChange={(value) => setField('videoOptionSupportsText', value)} placeholder="resolution, ratio, duration_sec" />
          <JsonArea label="Video Input Roles JSON" value={props.formState.videoInputRolesText} onChange={(value) => setField('videoInputRolesText', value)} placeholder='{"t2v":["prompt"]}' />
          <JsonArea label="Video Limits JSON" value={props.formState.videoLimitsJson} onChange={(value) => setField('videoLimitsJson', value)} placeholder='{"duration_sec":{"min":1,"max":8}}' />
          <JsonArea label="Video Constraints JSON" value={props.formState.videoConstraintsJson} onChange={(value) => setField('videoConstraintsJson', value)} placeholder='{"service_tier":["standard"]}' />
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Video Outputs</p><label className="mt-3 flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={props.formState.videoOutputVideoUrl} onChange={(event) => setField('videoOutputVideoUrl', event.target.checked)} /> Video URL</label><label className="mt-2 flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={props.formState.videoOutputLastFrameUrl} onChange={(event) => setField('videoOutputLastFrameUrl', event.target.checked)} /> Last Frame URL</label></div>
        </div>
        <SectionHeader title="Voices" actionLabel="Add Voice" onAction={() => props.onChange({ ...props.formState, voices: [...props.formState.voices, createEmptyVoiceRow()] })} />
        <div className="space-y-3">{props.formState.voices.map((voice, index) => <div key={`voice-${index}`} className="grid gap-3 rounded-2xl border border-slate-200 p-3 md:grid-cols-3"><Input label="Voice ID" value={voice.voiceId} onChange={(value) => updateVoice(index, { voiceId: value })} /><Input label="Name" value={voice.name} onChange={(value) => updateVoice(index, { name: value })} /><Input label="Langs" value={voice.langs} onChange={(value) => updateVoice(index, { langs: value })} placeholder="zh-cn, en-us" /><Input label="Model IDs" value={voice.modelIds} onChange={(value) => updateVoice(index, { modelIds: value })} placeholder={props.formState.modelId || 'model-id'} /><Input label="Source URL" value={voice.sourceUrl} onChange={(value) => updateVoice(index, { sourceUrl: value })} /><Input label="Retrieved At" value={voice.sourceRetrievedAt} onChange={(value) => updateVoice(index, { sourceRetrievedAt: value })} /><div className="md:col-span-3"><label className="mb-1.5 block text-sm font-medium text-gray-700">Voice Note</label><textarea value={voice.sourceNote} onChange={(event) => updateVoice(index, { sourceNote: event.target.value })} className="min-h-[64px] w-full rounded-[10px] border border-mint-100 bg-[#F4FBF8] p-3 text-sm text-gray-900 outline-none focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100" /></div></div>)}</div>
        <SectionHeader title="Voice Workflow Models" actionLabel="Add Workflow" onAction={() => props.onChange({ ...props.formState, workflows: [...props.formState.workflows, createEmptyWorkflowRow()] })} />
        <div className="space-y-3">{props.formState.workflows.map((workflow, index) => <div key={`workflow-${index}`} className="grid gap-3 rounded-2xl border border-slate-200 p-3 md:grid-cols-3"><Input label="Workflow Model ID" value={workflow.workflowModelId} onChange={(value) => updateWorkflow(index, { workflowModelId: value })} /><Input label="Workflow Type" value={workflow.workflowType} onChange={(value) => updateWorkflow(index, { workflowType: value })} /><Input label="Input Contract Ref" value={workflow.inputContractRef} onChange={(value) => updateWorkflow(index, { inputContractRef: value })} /><Input label="Output Persistence" value={workflow.outputPersistence} onChange={(value) => updateWorkflow(index, { outputPersistence: value })} /><Input label="Target Model Refs" value={workflow.targetModelRefs} onChange={(value) => updateWorkflow(index, { targetModelRefs: value })} placeholder={props.formState.modelId || 'model-id'} /><Input label="Langs" value={workflow.langs} onChange={(value) => updateWorkflow(index, { langs: value })} /><Input label="Source URL" value={workflow.sourceUrl} onChange={(value) => updateWorkflow(index, { sourceUrl: value })} /><Input label="Retrieved At" value={workflow.sourceRetrievedAt} onChange={(value) => updateWorkflow(index, { sourceRetrievedAt: value })} /><Input label="Note" value={workflow.sourceNote} onChange={(value) => updateWorkflow(index, { sourceNote: value })} /></div>)}</div>
        <div className="mt-4 grid gap-3 md:grid-cols-2"><Input label="Binding Workflow Refs" value={props.formState.bindingRefsText} onChange={(value) => setField('bindingRefsText', value)} placeholder="workflow-a, workflow-b" /><Input label="Binding Workflow Types" value={props.formState.bindingTypesText} onChange={(value) => setField('bindingTypesText', value)} placeholder="tts_v2v, tts_t2v" /></div>
        <div className="mt-5 flex items-center justify-end gap-2"><Button variant="secondary" onClick={props.onClose}>Cancel</Button><Button onClick={props.onSubmit} disabled={props.saving}>{props.saving ? 'Saving...' : 'Save Model'}</Button></div>
      </ScrollShell>
    </div>
  );
}

function JsonArea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <div><label className="mb-1.5 block text-sm font-medium text-gray-700">{label}</label><textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="min-h-[96px] w-full rounded-[10px] border border-mint-100 bg-[#F4FBF8] p-3 font-mono text-xs text-gray-900 outline-none focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100" /></div>;
}

function SectionHeader({ title, actionLabel, onAction }: { title: string; actionLabel: string; onAction: () => void }) {
  return <div className="mt-5 mb-3 flex items-center justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{title}</p><Button variant="secondary" size="sm" onClick={onAction}>{actionLabel}</Button></div>;
}
