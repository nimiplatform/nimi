import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RuntimeModelPickerPanel,
} from '@nimiplatform/nimi-kit/features/model-picker/ui';
import {
  useRuntimeModelPickerPanel,
} from '@nimiplatform/nimi-kit/features/model-picker/runtime';
import { ScrollArea } from '@nimiplatform/nimi-kit/ui';
import { Button, Card, Input, RuntimeSelect } from './runtime-config-primitives';
import { RuntimePageShell } from './runtime-config-page-shell';
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
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';

type CatalogPageProps = {
  model: RuntimeConfigPanelControllerModel;
  state: RuntimeConfigStateV11;
};

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

function sourceTone(source: RuntimeModelCatalogProvider['source'] | RuntimeCatalogModelSummary['source']) {
  if (source === 'overridden') return 'border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)] text-[var(--nimi-status-warning)]';
  if (source === 'custom') return 'border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] text-[var(--nimi-action-primary-bg)]';
  return 'border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] text-[var(--nimi-text-secondary)]';
}

export function CatalogPage({ model, state: _state }: CatalogPageProps) {
  const [providers, setProviders] = useState<RuntimeModelCatalogProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [providerModels, setProviderModels] = useState<RuntimeCatalogProviderModelsResponse | null>(null);
  const [overlayYamlDraft, setOverlayYamlDraft] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);
  const [savingOverlayYaml, setSavingOverlayYaml] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [deletingModelId, setDeletingModelId] = useState('');
  const [showAddModel, setShowAddModel] = useState(false);
  const [formState, setFormState] = useState<CatalogFormState>(createEmptyFormState(null));

  const loadProviders = useCallback(async () => {
    try {
      const rows = await sdkListModelCatalogProviders();
      setProviders(rows);
      setSelectedProviderId((current) => (current && rows.some((row) => row.provider === current) ? current : rows[0]?.provider || ''));
    } catch (error) {
      model.setPageFeedback({ kind: 'error', message: `Catalog load failed: ${error instanceof Error ? error.message : String(error || '')}` });
    }
  }, [model]);

  const selectedProvider = useMemo(() => providers.find((provider) => provider.provider === selectedProviderId) || null, [providers, selectedProviderId]);

  const loadProviderModels = useCallback(async (provider: string) => {
    if (!provider) return;
    setLoadingModels(true);
    try {
      const response = await sdkListCatalogProviderModels(provider);
      setProviderModels(response);
      setOverlayYamlDraft(response.provider.yaml || '');
    } catch (error) {
      model.setPageFeedback({ kind: 'error', message: `Model list load failed: ${error instanceof Error ? error.message : String(error || '')}` });
    } finally {
      setLoadingModels(false);
    }
  }, [model]);

  useEffect(() => { void loadProviders(); }, [loadProviders]);
  useEffect(() => { if (selectedProviderId) void loadProviderModels(selectedProviderId); }, [loadProviderModels, selectedProviderId]);
  useEffect(() => { if (showAddModel) setFormState(createEmptyFormState(selectedProvider)); }, [showAddModel, selectedProvider]);

  const onSaveOverlayYaml = useCallback(async () => {
    if (!selectedProvider) return;
    if (!overlayYamlDraft.trim()) {
      model.setPageFeedback({ kind: 'error', message: 'Overlay YAML cannot be empty.' });
      return;
    }
    setSavingOverlayYaml(true);
    try {
      await sdkUpsertModelCatalogProvider(selectedProvider.provider, overlayYamlDraft);
      emitModelCatalogUpdated(selectedProvider.provider);
      await loadProviders();
      await loadProviderModels(selectedProvider.provider);
      model.setPageFeedback({ kind: 'success', message: `Overlay YAML saved for ${selectedProvider.provider}.` });
    } catch (error) {
      model.setPageFeedback({ kind: 'error', message: `Overlay YAML save failed: ${error instanceof Error ? error.message : String(error || '')}` });
    } finally {
      setSavingOverlayYaml(false);
    }
  }, [loadProviderModels, loadProviders, model, overlayYamlDraft, selectedProvider]);

  const onDeleteOverlayYaml = useCallback(async () => {
    if (!selectedProvider) return;
    setSavingOverlayYaml(true);
    try {
      await sdkDeleteModelCatalogProvider(selectedProvider.provider);
      emitModelCatalogUpdated(selectedProvider.provider);
      await loadProviders();
      await loadProviderModels(selectedProvider.provider);
      model.setPageFeedback({ kind: 'success', message: `Overlay removed for ${selectedProvider.provider}.` });
    } catch (error) {
      model.setPageFeedback({ kind: 'error', message: `Overlay remove failed: ${error instanceof Error ? error.message : String(error || '')}` });
    } finally {
      setSavingOverlayYaml(false);
    }
  }, [loadProviderModels, loadProviders, model, selectedProvider]);

  const onDeleteModel = useCallback(async (modelId: string) => {
    if (!selectedProvider) return;
    setDeletingModelId(modelId);
    try {
      await sdkDeleteCatalogModelOverlay(selectedProvider.provider, modelId);
      emitModelCatalogUpdated(selectedProvider.provider);
      await loadProviders();
      await loadProviderModels(selectedProvider.provider);
      model.setPageFeedback({ kind: 'success', message: `Custom model removed: ${modelId}.` });
    } catch (error) {
      model.setPageFeedback({ kind: 'error', message: `Delete model failed: ${error instanceof Error ? error.message : String(error || '')}` });
    } finally {
      setDeletingModelId('');
    }
  }, [loadProviderModels, loadProviders, model, selectedProvider]);

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
      model.setPageFeedback({ kind: 'success', message: `Custom model saved for ${selectedProvider.provider}.` });
    } catch (error) {
      model.setPageFeedback({ kind: 'error', message: `Save model failed: ${error instanceof Error ? error.message : String(error || '')}` });
    } finally {
      setSavingModel(false);
    }
  }, [formState, loadProviderModels, loadProviders, model, selectedProvider]);

  return (
    <RuntimePageShell className="space-y-4">
      {/* Top bar: provider selector + actions */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-56 shrink-0">
            <RuntimeSelect
              value={selectedProviderId}
              onChange={(value) => setSelectedProviderId(value)}
              options={providers.map((p) => ({ value: p.provider, label: `${p.provider} (${p.modelCount})` }))}
              contentClassName="max-h-[360px]"
            />
          </div>
          <ProviderCapabilities provider={selectedProvider} />
        </div>
        {selectedProvider ? (
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => selectedProviderId && void loadProviderModels(selectedProviderId)} disabled={loadingModels}>{loadingModels ? '...' : 'Refresh'}</Button>
            <Button size="sm" onClick={() => setShowAddModel(true)}>+ Add</Button>
          </div>
        ) : null}
      </div>

      {/* Model picker (full width) */}
      <ModelSection providerId={selectedProviderId} onDeleteModel={onDeleteModel} deletingModelId={deletingModelId} />

      {/* YAML panel */}
      {selectedProvider && providerModels ? (
        <YamlPanel provider={providerModels.provider} overlayYamlDraft={overlayYamlDraft} onChangeOverlayYaml={setOverlayYamlDraft} onSave={onSaveOverlayYaml} onDelete={onDeleteOverlayYaml} saving={savingOverlayYaml} />
      ) : null}

      {/* Add model dialog */}
      {showAddModel && selectedProvider ? (
        <AddModelDialog provider={selectedProvider} formState={formState} saving={savingModel} onChange={setFormState} onClose={() => setShowAddModel(false)} onSubmit={onSubmitModel} />
      ) : null}
    </RuntimePageShell>
  );
}

function ProviderCapabilities({ provider }: { provider: RuntimeModelCatalogProvider | null }) {
  if (!provider || provider.capabilities.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${sourceTone(provider.source)}`}>{provider.source}</span>
      <span className="text-xs text-[var(--nimi-text-muted)]">{provider.modelCount} models</span>
      {provider.capabilities.map((capability) => (
        <span key={`${provider.provider}-${capability}`} className="rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,transparent)] px-2 py-0.5 text-[11px] text-[var(--nimi-action-primary-bg)]">
          {capability}
        </span>
      ))}
    </div>
  );
}

function ModelSection(props: { providerId: string; onDeleteModel: (modelId: string) => void; deletingModelId: string }) {
  const state = useRuntimeModelPickerPanel({
    provider: props.providerId,
  });

  return (
    <RuntimeModelPickerPanel
      state={state}
      className="rounded-3xl [&>div]:xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
      pickerClassName="h-[600px] overflow-y-auto space-y-3 p-4 [&_.lg\:grid-cols-2]:!grid-cols-1 [&_label.min-h-11]:hidden [&>div>div.grid.gap-2]:!block [&_.mt-3.gap-1]:hidden [&_button>div>div>p.mt-1]:hidden [&_button>div.gap-3>span]:hidden [&_button>div.mt-2]:!mt-0 [&_button>div.items-start]:items-center [&_button]:flex [&_button]:items-center [&_button]:justify-between [&_button>div.mt-2]:!ml-auto [&_button>div.mt-2]:!flex-nowrap [&_div.rounded-2xl]:!p-0 [&_button.w-full]:!px-3 [&_button.w-full]:!py-2.5"
      detailClassName="h-[600px] overflow-y-auto space-y-4 p-4"
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
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">YAML Overlay</p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={props.onDelete} disabled={props.saving || !props.provider.hasOverlay}>Remove</Button>
          <Button size="sm" onClick={props.onSave} disabled={props.saving}>{props.saving ? 'Saving...' : 'Save'}</Button>
        </div>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <textarea value={props.overlayYamlDraft} onChange={(event) => props.onChangeOverlayYaml(event.target.value)} spellCheck={false} className="min-h-[320px] rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] p-3 font-mono text-xs text-[var(--nimi-text-primary)] outline-none focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)]" />
        <textarea value={props.provider.effectiveYaml} readOnly spellCheck={false} className="min-h-[320px] rounded-xl border border-[var(--nimi-border-subtle)] bg-[color:rgb(15_23_42)] p-3 font-mono text-xs text-[color:rgb(241_245_249)] opacity-95" />
      </div>
    </Card>
  );
}

function AddModelDialog(props: { provider: RuntimeModelCatalogProvider; formState: CatalogFormState; saving: boolean; onChange: (value: CatalogFormState) => void; onClose: () => void; onSubmit: () => void }) {
  const setField = <K extends keyof CatalogFormState>(key: K, value: CatalogFormState[K]) => props.onChange({ ...props.formState, [key]: value });
  const updateVoice = (index: number, patch: Partial<VoiceRow>) => props.onChange({ ...props.formState, voices: props.formState.voices.map((voice, voiceIndex) => (voiceIndex === index ? { ...voice, ...patch } : voice)) });
  const updateWorkflow = (index: number, patch: Partial<WorkflowRow>) => props.onChange({ ...props.formState, workflows: props.formState.workflows.map((workflow, workflowIndex) => (workflowIndex === index ? { ...workflow, ...patch } : workflow)) });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(15_23_42/0.35)] p-4">
      <ScrollArea
        className="max-h-[92vh] w-full max-w-3xl rounded-2xl bg-white shadow-[0_24px_80px_rgba(15,23,42,0.2)]"
        viewportClassName="max-h-[92vh] rounded-2xl"
        contentClassName="p-5"
      >
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--nimi-text-muted)]">{props.provider.provider}</p><h3 className="mt-1 text-xl font-semibold text-[var(--nimi-text-primary)]">Add Personal Catalog Model</h3></div>
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
          <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">Source Note</label>
          <textarea value={props.formState.sourceNote} onChange={(event) => setField('sourceNote', event.target.value)} className="min-h-[72px] w-full rounded-[10px] border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))] p-3 text-sm text-[var(--nimi-text-primary)] outline-none focus:border-[var(--nimi-field-focus)] focus:bg-white focus:ring-2 focus:ring-mint-100" />
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
          <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] p-3"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--nimi-text-muted)]">Video Outputs</p><label className="mt-3 flex items-center gap-2 text-sm text-[var(--nimi-text-secondary)]"><input type="checkbox" checked={props.formState.videoOutputVideoUrl} onChange={(event) => setField('videoOutputVideoUrl', event.target.checked)} /> Video URL</label><label className="mt-2 flex items-center gap-2 text-sm text-[var(--nimi-text-secondary)]"><input type="checkbox" checked={props.formState.videoOutputLastFrameUrl} onChange={(event) => setField('videoOutputLastFrameUrl', event.target.checked)} /> Last Frame URL</label></div>
        </div>
        <SectionHeader title="Voices" actionLabel="Add Voice" onAction={() => props.onChange({ ...props.formState, voices: [...props.formState.voices, createEmptyVoiceRow()] })} />
        <div className="space-y-3">{props.formState.voices.map((voice, index) => <div key={`voice-${index}`} className="grid gap-3 rounded-2xl border border-[var(--nimi-border-subtle)] p-3 md:grid-cols-3"><Input label="Voice ID" value={voice.voiceId} onChange={(value) => updateVoice(index, { voiceId: value })} /><Input label="Name" value={voice.name} onChange={(value) => updateVoice(index, { name: value })} /><Input label="Langs" value={voice.langs} onChange={(value) => updateVoice(index, { langs: value })} placeholder="zh-cn, en-us" /><Input label="Model IDs" value={voice.modelIds} onChange={(value) => updateVoice(index, { modelIds: value })} placeholder={props.formState.modelId || 'model-id'} /><Input label="Source URL" value={voice.sourceUrl} onChange={(value) => updateVoice(index, { sourceUrl: value })} /><Input label="Retrieved At" value={voice.sourceRetrievedAt} onChange={(value) => updateVoice(index, { sourceRetrievedAt: value })} /><div className="md:col-span-3"><label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">Voice Note</label><textarea value={voice.sourceNote} onChange={(event) => updateVoice(index, { sourceNote: event.target.value })} className="min-h-[64px] w-full rounded-[10px] border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))] p-3 text-sm text-[var(--nimi-text-primary)] outline-none focus:border-[var(--nimi-field-focus)] focus:bg-white focus:ring-2 focus:ring-mint-100" /></div></div>)}</div>
        <SectionHeader title="Voice Workflow Models" actionLabel="Add Workflow" onAction={() => props.onChange({ ...props.formState, workflows: [...props.formState.workflows, createEmptyWorkflowRow()] })} />
        <div className="space-y-3">{props.formState.workflows.map((workflow, index) => <div key={`workflow-${index}`} className="grid gap-3 rounded-2xl border border-[var(--nimi-border-subtle)] p-3 md:grid-cols-3"><Input label="Workflow Model ID" value={workflow.workflowModelId} onChange={(value) => updateWorkflow(index, { workflowModelId: value })} /><Input label="Workflow Type" value={workflow.workflowType} onChange={(value) => updateWorkflow(index, { workflowType: value })} /><Input label="Input Contract Ref" value={workflow.inputContractRef} onChange={(value) => updateWorkflow(index, { inputContractRef: value })} /><Input label="Output Persistence" value={workflow.outputPersistence} onChange={(value) => updateWorkflow(index, { outputPersistence: value })} /><Input label="Target Model Refs" value={workflow.targetModelRefs} onChange={(value) => updateWorkflow(index, { targetModelRefs: value })} placeholder={props.formState.modelId || 'model-id'} /><Input label="Langs" value={workflow.langs} onChange={(value) => updateWorkflow(index, { langs: value })} /><Input label="Source URL" value={workflow.sourceUrl} onChange={(value) => updateWorkflow(index, { sourceUrl: value })} /><Input label="Retrieved At" value={workflow.sourceRetrievedAt} onChange={(value) => updateWorkflow(index, { sourceRetrievedAt: value })} /><Input label="Note" value={workflow.sourceNote} onChange={(value) => updateWorkflow(index, { sourceNote: value })} /></div>)}</div>
        <div className="mt-4 grid gap-3 md:grid-cols-2"><Input label="Binding Workflow Refs" value={props.formState.bindingRefsText} onChange={(value) => setField('bindingRefsText', value)} placeholder="workflow-a, workflow-b" /><Input label="Binding Workflow Types" value={props.formState.bindingTypesText} onChange={(value) => setField('bindingTypesText', value)} placeholder="tts_v2v, tts_t2v" /></div>
        <div className="mt-5 flex items-center justify-end gap-2"><Button variant="secondary" onClick={props.onClose}>Cancel</Button><Button onClick={props.onSubmit} disabled={props.saving}>{props.saving ? 'Saving...' : 'Save Model'}</Button></div>
      </ScrollArea>
    </div>
  );
}

function JsonArea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <div><label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">{label}</label><textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="min-h-[96px] w-full rounded-[10px] border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))] p-3 font-mono text-xs text-[var(--nimi-text-primary)] outline-none focus:border-[var(--nimi-field-focus)] focus:bg-white focus:ring-2 focus:ring-mint-100" /></div>;
}

function SectionHeader({ title, actionLabel, onAction }: { title: string; actionLabel: string; onAction: () => void }) {
  return <div className="mt-5 mb-3 flex items-center justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--nimi-text-muted)]">{title}</p><Button variant="secondary" size="sm" onClick={onAction}>{actionLabel}</Button></div>;
}
