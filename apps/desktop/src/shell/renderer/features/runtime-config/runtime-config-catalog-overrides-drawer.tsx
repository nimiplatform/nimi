import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InlineAlert, OverlayShell } from '@nimiplatform/kit/ui';
import type { JsonObject } from '@nimiplatform/sdk/types';

import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import {
  createRuntimeConfigCatalogClient,
  type NimiRuntimeCatalogModelDetail,
  type NimiRuntimeCatalogModelOverlayInput,
  type NimiRuntimeCatalogProviderModelsResponse,
  type NimiRuntimeCatalogVoiceEntry,
} from './runtime-config-catalog-sdk-service';
import { Button, Card, Input, RuntimeSelect } from './runtime-config-primitives';

// @nimi-authority: rule.nimi.runtime.model-catalog.r009

const CATALOG_CAPABILITIES = [
  'text.generate',
  'text.embed',
  'image.generate',
  'video.generate',
  'audio.synthesize',
  'audio.transcribe',
  'music.generate',
  'voice.create',
  'world.generate',
] as const;

type CatalogCapability = (typeof CATALOG_CAPABILITIES)[number];

type CustomModelFormState = {
  modelId: string;
  modelType: string;
  capabilities: CatalogCapability[];
  updatedAt: string;
  sourceUrl: string;
  sourceRetrievedAt: string;
  sourceNote: string;
  pricingUnit: string;
  pricingInput: string;
  pricingOutput: string;
  pricingCurrency: string;
  pricingAsOf: string;
  pricingNotes: string;
  voiceSetId: string;
  voiceId: string;
  voiceName: string;
  voiceLangs: string;
  videoModes: string;
  videoInputRolesJson: string;
  videoLimitsJson: string;
  videoOptionSupports: string;
  videoConstraintsJson: string;
  videoOutputVideoUrl: boolean;
  videoOutputLastFrameUrl: boolean;
};

type FormErrors = Partial<Record<
  'modelId' | 'capabilities' | 'sourceUrl' | 'voiceSetId' | 'voiceId' | 'video' | 'submit',
  string
>>;

type ConfirmAction =
  | { kind: 'discard' }
  | { kind: 'reload' }
  | { kind: 'restore-all' }
  | { kind: 'restore-model'; modelId: string; source: string };

type CatalogOverridesDrawerProps = {
  open: boolean;
  providerId: string;
  onClose: () => void;
};

function dateFromNow(now: () => number): string {
  return new Date(now()).toISOString().slice(0, 10);
}

function createCustomModelForm(now: () => number): CustomModelFormState {
  const today = dateFromNow(now);
  return {
    modelId: '',
    modelType: 'text',
    capabilities: ['text.generate'],
    updatedAt: today,
    sourceUrl: '',
    sourceRetrievedAt: today,
    sourceNote: '',
    pricingUnit: 'token',
    pricingInput: 'unknown',
    pricingOutput: 'unknown',
    pricingCurrency: 'USD',
    pricingAsOf: today,
    pricingNotes: 'unknown',
    voiceSetId: '',
    voiceId: '',
    voiceName: '',
    voiceLangs: '',
    videoModes: 't2v',
    videoInputRolesJson: '{\n  "t2v": ["prompt"]\n}',
    videoLimitsJson: '{}',
    videoOptionSupports: '',
    videoConstraintsJson: '{}',
    videoOutputVideoUrl: true,
    videoOutputLastFrameUrl: false,
  };
}

function splitList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

export function CatalogOverridesDrawer(props: CatalogOverridesDrawerProps) {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const client = useMemo(
    () => createRuntimeConfigCatalogClient(() => bindings.sdk.connectorAdmin()),
    [bindings.sdk],
  );
  const [response, setResponse] = useState<NimiRuntimeCatalogProviderModelsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [initialYaml, setInitialYaml] = useState('');
  const [yamlDraft, setYamlDraft] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [addingModel, setAddingModel] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  const dirty = yamlDraft !== initialYaml;
  const provider = response?.provider ?? null;
  const customModels = useMemo(
    () => response?.models.filter((model) => model.userScoped || model.source === 'custom' || model.source === 'overridden') ?? [],
    [response],
  );

  const loadProvider = useCallback(async () => {
    if (!props.providerId) return;
    setLoading(true);
    setFeedback(null);
    try {
      const next = await client.listProviderModels(props.providerId);
      setResponse(next);
      const nextYaml = next.provider.yaml || '';
      setInitialYaml(nextYaml);
      setYamlDraft(nextYaml);
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: t('runtimeConfig.catalogOverrides.loadFailed', {
          defaultValue: 'Could not load custom models: {{message}}',
          message: formatError(error),
        }),
      });
    } finally {
      setLoading(false);
    }
  }, [client, props.providerId, t]);

  useEffect(() => {
    if (!props.open) return;
    setAdvancedOpen(false);
    setAddingModel(false);
    setConfirmAction(null);
    void loadProvider();
  }, [loadProvider, props.open]);

  const requestClose = () => {
    if (busy) return;
    if (dirty) {
      setConfirmAction({ kind: 'discard' });
      return;
    }
    props.onClose();
  };

  const requestReload = () => {
    if (dirty) {
      setConfirmAction({ kind: 'reload' });
      return;
    }
    void loadProvider();
  };

  const saveYaml = async () => {
    if (!props.providerId || !dirty || !yamlDraft.trim()) return;
    setBusy(true);
    setFeedback(null);
    try {
      await client.upsertProvider(props.providerId, yamlDraft);
      await loadProvider();
      setFeedback({
        kind: 'success',
        message: t('runtimeConfig.catalogOverrides.saved', { defaultValue: 'Custom overrides saved.' }),
      });
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: t('runtimeConfig.catalogOverrides.saveFailed', {
          defaultValue: 'Could not save custom overrides: {{message}}',
          message: formatError(error),
        }),
      });
    } finally {
      setBusy(false);
    }
  };

  const runConfirmedAction = async () => {
    const action = confirmAction;
    if (!action) return;
    setConfirmAction(null);
    if (action.kind === 'discard') {
      setYamlDraft(initialYaml);
      props.onClose();
      return;
    }
    if (action.kind === 'reload') {
      await loadProvider();
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      if (action.kind === 'restore-all') {
        await client.deleteProvider(props.providerId);
      } else {
        await client.deleteModelOverlay(props.providerId, action.modelId);
      }
      await loadProvider();
      setFeedback({
        kind: 'success',
        message: t('runtimeConfig.catalogOverrides.restored', { defaultValue: 'Nimi built-in values restored.' }),
      });
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: t('runtimeConfig.catalogOverrides.restoreFailed', {
          defaultValue: 'Could not restore Nimi defaults: {{message}}',
          message: formatError(error),
        }),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <OverlayShell
        open={props.open}
        kind="drawer"
        size="L"
        onClose={requestClose}
        panelClassName="flex max-h-screen flex-col"
        contentClassName="min-h-0 flex-1 overflow-y-auto"
        title={(
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--nimi-text-muted)]">
              {props.providerId}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-[var(--nimi-text-primary)]">
              {t('runtimeConfig.catalogOverrides.title', { defaultValue: 'Custom models' })}
            </h2>
          </div>
        )}
        footer={(
          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" onClick={requestReload} disabled={loading || busy}>
              {t('runtimeConfig.catalogOverrides.reload', { defaultValue: 'Reload' })}
            </Button>
            <Button variant="secondary" onClick={requestClose} disabled={busy}>
              {t('runtimeConfig.catalogOverrides.close', { defaultValue: 'Close' })}
            </Button>
          </div>
        )}
      >
        <div className="mt-4 space-y-4">
          {feedback ? <InlineAlert tone={feedback.kind === 'error' ? 'danger' : 'success'}>{feedback.message}</InlineAlert> : null}
          {loading && !provider ? (
            <Card hoverMotion={false} className="p-5 text-sm text-[var(--nimi-text-muted)]">
              {t('runtimeConfig.catalogOverrides.loading', { defaultValue: 'Loading model information…' })}
            </Card>
          ) : null}

          {provider ? (
            <CatalogProviderSummary
              provider={provider}
              onRestoreAll={() => setConfirmAction({ kind: 'restore-all' })}
              restoring={busy}
            />
          ) : null}

          {provider?.inventoryMode === 'dynamic_endpoint' ? (
            <InlineAlert tone="info">
              {t('runtimeConfig.catalogOverrides.dynamicInventory', {
                defaultValue: 'Models for this provider are discovered by the connector. Nimi does not maintain a static provider list here.',
              })}
            </InlineAlert>
          ) : null}

          {provider && provider.inventoryMode !== 'dynamic_endpoint' ? (
            <>
              <Card hoverMotion={false} className="overflow-hidden p-0">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--nimi-border-subtle)] px-4 py-3">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                      {t('runtimeConfig.catalogOverrides.customModels', { defaultValue: 'Your custom models' })}
                    </h3>
                    <p className="mt-0.5 text-xs text-[var(--nimi-text-muted)]">
                      {t('runtimeConfig.catalogOverrides.customModelsHint', {
                        defaultValue: 'Custom entries supplement or override Nimi built-in model information for this provider.',
                      })}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => setAddingModel((value) => !value)} disabled={busy}>
                    {addingModel
                      ? t('runtimeConfig.catalogOverrides.cancelAdd', { defaultValue: 'Cancel' })
                      : t('runtimeConfig.catalogOverrides.addModel', { defaultValue: 'Add custom model' })}
                  </Button>
                </div>

                {addingModel ? (
                  <AddCustomModelForm
                    providerId={props.providerId}
                    now={bindings.clock.now}
                    busy={busy}
                    onBusyChange={setBusy}
                    onSaved={async () => {
                      setAddingModel(false);
                      await loadProvider();
                      setFeedback({
                        kind: 'success',
                        message: t('runtimeConfig.catalogOverrides.modelSaved', { defaultValue: 'Custom model saved.' }),
                      });
                    }}
                    onError={(message) => setFeedback({ kind: 'error', message })}
                  />
                ) : null}

                {!addingModel ? (
                  customModels.length > 0 ? (
                    <div className="divide-y divide-[var(--nimi-border-subtle)]">
                      {customModels.map((model) => (
                        <div key={model.modelId} className="flex items-center justify-between gap-4 px-4 py-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{model.modelId}</p>
                              <span className="rounded-full bg-[var(--nimi-status-info-soft-bg)] px-2 py-0.5 text-xs text-[var(--nimi-status-info-soft-text)]">
                                {model.source === 'overridden'
                                  ? t('runtimeConfig.catalogOverrides.overridden', { defaultValue: 'Overridden' })
                                  : t('runtimeConfig.catalogOverrides.custom', { defaultValue: 'Custom' })}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                              {model.capabilities.join(' · ') || model.modelType}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => setConfirmAction({ kind: 'restore-model', modelId: model.modelId, source: model.source })}
                          >
                            {model.source === 'overridden'
                              ? t('runtimeConfig.catalogOverrides.restoreModel', { defaultValue: 'Restore built-in' })
                              : t('runtimeConfig.catalogOverrides.removeModel', { defaultValue: 'Remove' })}
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-7 text-center">
                      <p className="text-sm text-[var(--nimi-text-secondary)]">
                        {t('runtimeConfig.catalogOverrides.noCustomModels', { defaultValue: 'No custom models for this provider.' })}
                      </p>
                      <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                        {t('runtimeConfig.catalogOverrides.usingBuiltIn', { defaultValue: 'Nimi built-in model information is active.' })}
                      </p>
                    </div>
                  )
                ) : null}
              </Card>

              <Card hoverMotion={false} className="p-0">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  aria-expanded={advancedOpen}
                  onClick={() => setAdvancedOpen((value) => !value)}
                >
                  <span>
                    <span className="block text-sm font-semibold text-[var(--nimi-text-primary)]">
                      {t('runtimeConfig.catalogOverrides.advancedYaml', { defaultValue: 'Advanced: YAML import' })}
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--nimi-text-muted)]">
                      {t('runtimeConfig.catalogOverrides.advancedYamlHint', { defaultValue: 'Use only when the structured editor cannot express the required provider metadata.' })}
                    </span>
                  </span>
                  <span aria-hidden="true" className="text-[var(--nimi-text-muted)]">{advancedOpen ? '−' : '+'}</span>
                </button>
                {advancedOpen ? (
                  <div className="space-y-4 border-t border-[var(--nimi-border-subtle)] p-4">
                    <LabeledTextarea
                      label={t('runtimeConfig.catalogOverrides.yourOverrides', { defaultValue: 'Your overrides (editable)' })}
                      description={t('runtimeConfig.catalogOverrides.yourOverridesHint', { defaultValue: 'Only provider-scoped custom fragments belong here.' })}
                      value={yamlDraft}
                      onChange={setYamlDraft}
                      readOnly={false}
                      tone="light"
                    />
                    <LabeledTextarea
                      label={t('runtimeConfig.catalogOverrides.effectiveConfiguration', { defaultValue: 'Effective configuration (read only)' })}
                      description={t('runtimeConfig.catalogOverrides.effectiveConfigurationHint', { defaultValue: 'Nimi built-in information merged with your custom entries.' })}
                      value={provider.effectiveYaml}
                      onChange={() => undefined}
                      readOnly
                      tone="dark"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="secondary" size="sm" disabled={!dirty || busy} onClick={() => setYamlDraft(initialYaml)}>
                        {t('runtimeConfig.catalogOverrides.discardChanges', { defaultValue: 'Discard changes' })}
                      </Button>
                      <Button size="sm" disabled={!dirty || !yamlDraft.trim() || busy} onClick={() => void saveYaml()}>
                        {busy
                          ? t('runtimeConfig.catalogOverrides.saving', { defaultValue: 'Saving…' })
                          : t('runtimeConfig.catalogOverrides.saveOverrides', { defaultValue: 'Save overrides' })}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </Card>
            </>
          ) : null}
        </div>
      </OverlayShell>

      <CatalogConfirmationDialog
        action={confirmAction}
        busy={busy}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => void runConfirmedAction()}
      />
    </>
  );
}

function CatalogProviderSummary(props: {
  provider: NimiRuntimeCatalogProviderModelsResponse['provider'];
  onRestoreAll: () => void;
  restoring: boolean;
}) {
  const { t } = useTranslation();
  const sourceLabel = props.provider.source === 'overridden'
    ? t('runtimeConfig.catalogOverrides.sourceOverridden', { defaultValue: 'Built-in + custom' })
    : props.provider.source === 'custom'
      ? t('runtimeConfig.catalogOverrides.sourceCustom', { defaultValue: 'Custom' })
      : props.provider.inventoryMode === 'dynamic_endpoint'
        ? t('runtimeConfig.catalogOverrides.sourceLive', { defaultValue: 'Connector discovery' })
        : t('runtimeConfig.catalogOverrides.sourceBuiltIn', { defaultValue: 'Nimi built-in' });
  return (
    <Card hoverMotion={false} className="p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryValue label={t('runtimeConfig.catalogOverrides.source', { defaultValue: 'Source' })} value={sourceLabel} />
        <SummaryValue label={t('runtimeConfig.catalogOverrides.version', { defaultValue: 'Catalog version' })} value={props.provider.catalogVersion || '—'} />
        <SummaryValue label={t('runtimeConfig.catalogOverrides.models', { defaultValue: 'Models' })} value={String(props.provider.modelCount)} />
        <SummaryValue
          label={t('runtimeConfig.catalogOverrides.customCount', { defaultValue: 'Custom / overridden' })}
          value={`${props.provider.customModelCount} / ${props.provider.overriddenModelCount}`}
        />
      </div>
      {props.provider.hasOverlay ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--nimi-border-subtle)] pt-3">
          <p className="text-xs text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.catalogOverrides.lastUpdated', {
              defaultValue: 'Custom overrides updated {{date}}',
              date: props.provider.overlayUpdatedAt || '—',
            })}
          </p>
          <Button variant="ghost" size="sm" disabled={props.restoring} onClick={props.onRestoreAll}>
            {t('runtimeConfig.catalogOverrides.restoreAll', { defaultValue: 'Restore all Nimi defaults' })}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function SummaryValue(props: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-[var(--nimi-text-muted)]">{props.label}</p>
      <p className="mt-1 text-sm font-medium text-[var(--nimi-text-primary)]">{props.value}</p>
    </div>
  );
}

function AddCustomModelForm(props: {
  providerId: string;
  now: () => number;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const client = useMemo(
    () => createRuntimeConfigCatalogClient(() => bindings.sdk.connectorAdmin()),
    [bindings.sdk],
  );
  const [form, setForm] = useState<CustomModelFormState>(() => createCustomModelForm(props.now));
  const [errors, setErrors] = useState<FormErrors>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const needsVoice = form.capabilities.includes('audio.synthesize');
  const needsVideo = form.capabilities.includes('video.generate');

  const setField = <K extends keyof CustomModelFormState>(key: K, value: CustomModelFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const toggleCapability = (capability: CatalogCapability) => {
    setForm((current) => ({
      ...current,
      capabilities: current.capabilities.includes(capability)
        ? current.capabilities.filter((value) => value !== capability)
        : [...current.capabilities, capability],
    }));
  };

  const submit = async () => {
    const nextErrors: FormErrors = {};
    if (!form.modelId.trim()) nextErrors.modelId = t('runtimeConfig.catalogOverrides.modelIdRequired', { defaultValue: 'Enter a model ID.' });
    if (form.capabilities.length === 0) nextErrors.capabilities = t('runtimeConfig.catalogOverrides.capabilityRequired', { defaultValue: 'Select at least one capability.' });
    if (!form.sourceUrl.trim()) nextErrors.sourceUrl = t('runtimeConfig.catalogOverrides.sourceRequired', { defaultValue: 'Add the provider documentation URL used for this model.' });
    if (needsVoice && !form.voiceSetId.trim()) nextErrors.voiceSetId = t('runtimeConfig.catalogOverrides.voiceSetRequired', { defaultValue: 'Enter a voice set ID.' });
    if (needsVoice && !form.voiceId.trim()) nextErrors.voiceId = t('runtimeConfig.catalogOverrides.voiceRequired', { defaultValue: 'Enter at least one voice ID.' });

    let videoInputRoles: Record<string, string[]> = {};
    let videoLimits: JsonObject = {};
    let videoConstraints: JsonObject = {};
    if (needsVideo) {
      try {
        videoInputRoles = JSON.parse(form.videoInputRolesJson || '{}') as Record<string, string[]>;
        videoLimits = JSON.parse(form.videoLimitsJson || '{}') as JsonObject;
        videoConstraints = JSON.parse(form.videoConstraintsJson || '{}') as JsonObject;
      } catch (error) {
        nextErrors.video = t('runtimeConfig.catalogOverrides.videoJsonInvalid', {
          defaultValue: 'Video options contain invalid JSON: {{message}}',
          message: formatError(error),
        });
      }
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const sourceRef = {
      sourceKind: 'provider_documentation' as const,
      url: form.sourceUrl.trim(),
      retrievedAt: form.sourceRetrievedAt,
      note: form.sourceNote.trim(),
    };
    const detail: NimiRuntimeCatalogModelDetail = {
      provider: props.providerId,
      modelId: form.modelId.trim(),
      modelType: form.modelType,
      updatedAt: form.updatedAt,
      capabilities: form.capabilities,
      source: 'custom',
      userScoped: true,
      sourceNote: form.sourceNote.trim(),
      hasVoiceCatalog: needsVoice,
      hasVideoGeneration: needsVideo,
      pricing: {
        unit: form.pricingUnit,
        input: form.pricingInput || 'unknown',
        output: form.pricingOutput || 'unknown',
        currency: form.pricingCurrency,
        asOf: form.pricingAsOf,
        notes: form.pricingNotes || 'unknown',
      },
      voiceSetId: needsVoice ? form.voiceSetId.trim() : '',
      voiceDiscoveryMode: needsVoice ? 'static_catalog' : '',
      voiceRefKinds: needsVoice ? ['preset_voice_id'] : [],
      videoGeneration: needsVideo ? {
        modes: splitList(form.videoModes),
        inputRoles: Object.entries(videoInputRoles).map(([key, values]) => ({ key, values })),
        limits: videoLimits,
        optionSupports: splitList(form.videoOptionSupports),
        optionConstraints: videoConstraints,
        outputs: {
          videoUrl: form.videoOutputVideoUrl,
          lastFrameUrl: form.videoOutputLastFrameUrl,
        },
      } : null,
      sourceRef,
      warnings: [],
      voices: [],
      voiceWorkflowModels: [],
      modelWorkflowBinding: null,
    };
    const voices: NimiRuntimeCatalogVoiceEntry[] = needsVoice ? [{
      voiceSetId: form.voiceSetId.trim(),
      provider: props.providerId,
      voiceId: form.voiceId.trim(),
      name: form.voiceName.trim() || form.voiceId.trim(),
      langs: splitList(form.voiceLangs),
      modelIds: [form.modelId.trim()],
      sourceRef,
    }] : [];
    const input: NimiRuntimeCatalogModelOverlayInput = {
      model: detail,
      voices,
      voiceWorkflowModels: [],
      modelWorkflowBinding: null,
    };
    props.onBusyChange(true);
    try {
      await client.upsertModelOverlay(props.providerId, input);
      await props.onSaved();
    } catch (error) {
      props.onError(t('runtimeConfig.catalogOverrides.modelSaveFailed', {
        defaultValue: 'Could not save the custom model: {{message}}',
        message: formatError(error),
      }));
    } finally {
      props.onBusyChange(false);
    }
  };

  return (
    <div className="space-y-5 border-b border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_82%,var(--nimi-surface-panel))] p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Input
          label={t('runtimeConfig.catalogOverrides.modelId', { defaultValue: 'Model ID' })}
          value={form.modelId}
          onChange={(value) => setField('modelId', value)}
          placeholder={t('runtimeConfig.catalogOverrides.modelIdPlaceholder', { defaultValue: 'provider/model-id' })}
          required
          error={errors.modelId}
        />
        <div>
          <p className="mb-1.5 text-sm font-medium text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.catalogOverrides.modelType', { defaultValue: 'Model type' })}
          </p>
          <RuntimeSelect
            value={form.modelType}
            onChange={(value) => setField('modelType', value)}
            ariaLabel={t('runtimeConfig.catalogOverrides.modelType', { defaultValue: 'Model type' })}
            options={['text', 'image', 'video', 'tts', 'stt', 'music', 'voice', 'world'].map((value) => ({ value, label: value }))}
          />
        </div>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-[var(--nimi-text-secondary)]">
          {t('runtimeConfig.catalogOverrides.capabilities', { defaultValue: 'Capabilities' })}
        </legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {CATALOG_CAPABILITIES.map((capability) => (
            <label key={capability} className="flex min-h-10 items-center gap-2 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 text-sm text-[var(--nimi-text-secondary)]">
              <input type="checkbox" checked={form.capabilities.includes(capability)} onChange={() => toggleCapability(capability)} />
              {capability}
            </label>
          ))}
        </div>
        {errors.capabilities ? <p className="mt-1.5 text-xs text-[var(--nimi-status-danger)]">{errors.capabilities}</p> : null}
      </fieldset>

      <div className="grid gap-3 md:grid-cols-2">
        <Input
          label={t('runtimeConfig.catalogOverrides.sourceUrl', { defaultValue: 'Provider documentation URL' })}
          value={form.sourceUrl}
          onChange={(value) => setField('sourceUrl', value)}
          placeholder={t('runtimeConfig.catalogOverrides.sourceUrlPlaceholder', { defaultValue: 'https://provider.example/models/...' })}
          required
          error={errors.sourceUrl}
        />
        <Input
          label={t('runtimeConfig.catalogOverrides.retrievedAt', { defaultValue: 'Retrieved at' })}
          value={form.sourceRetrievedAt}
          onChange={(value) => setField('sourceRetrievedAt', value)}
          type="date"
        />
      </div>
      <LabeledTextarea
        label={t('runtimeConfig.catalogOverrides.sourceNote', { defaultValue: 'Source note' })}
        value={form.sourceNote}
        onChange={(value) => setField('sourceNote', value)}
        readOnly={false}
        tone="light"
        minHeightClass="min-h-20"
      />

      {needsVoice ? (
        <fieldset className="rounded-xl border border-[var(--nimi-border-subtle)] p-3">
          <legend className="px-1 text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.catalogOverrides.voiceDetails', { defaultValue: 'Voice details' })}
          </legend>
          <div className="grid gap-3 md:grid-cols-2">
            <Input label={t('runtimeConfig.catalogOverrides.voiceSetId', { defaultValue: 'Voice set ID' })} value={form.voiceSetId} onChange={(value) => setField('voiceSetId', value)} required error={errors.voiceSetId} />
            <Input label={t('runtimeConfig.catalogOverrides.voiceId', { defaultValue: 'Voice ID' })} value={form.voiceId} onChange={(value) => setField('voiceId', value)} required error={errors.voiceId} />
            <Input label={t('runtimeConfig.catalogOverrides.voiceName', { defaultValue: 'Voice name' })} value={form.voiceName} onChange={(value) => setField('voiceName', value)} />
            <Input label={t('runtimeConfig.catalogOverrides.languages', { defaultValue: 'Languages' })} value={form.voiceLangs} onChange={(value) => setField('voiceLangs', value)} placeholder="zh-cn, en-us" />
          </div>
        </fieldset>
      ) : null}

      {needsVideo ? (
        <fieldset className="rounded-xl border border-[var(--nimi-border-subtle)] p-3">
          <legend className="px-1 text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.catalogOverrides.videoDetails', { defaultValue: 'Video details' })}
          </legend>
          {errors.video ? <InlineAlert tone="danger" className="mb-3">{errors.video}</InlineAlert> : null}
          <div className="grid gap-3 md:grid-cols-2">
            <Input label={t('runtimeConfig.catalogOverrides.videoModes', { defaultValue: 'Modes' })} value={form.videoModes} onChange={(value) => setField('videoModes', value)} placeholder="t2v, i2v_first_frame" />
            <Input label={t('runtimeConfig.catalogOverrides.videoOptions', { defaultValue: 'Supported options' })} value={form.videoOptionSupports} onChange={(value) => setField('videoOptionSupports', value)} placeholder="resolution, ratio, duration_sec" />
            <LabeledTextarea label={t('runtimeConfig.catalogOverrides.videoInputRoles', { defaultValue: 'Input roles JSON' })} value={form.videoInputRolesJson} onChange={(value) => setField('videoInputRolesJson', value)} readOnly={false} tone="light" />
            <LabeledTextarea label={t('runtimeConfig.catalogOverrides.videoLimits', { defaultValue: 'Limits JSON' })} value={form.videoLimitsJson} onChange={(value) => setField('videoLimitsJson', value)} readOnly={false} tone="light" />
            <LabeledTextarea label={t('runtimeConfig.catalogOverrides.videoConstraints', { defaultValue: 'Option constraints JSON' })} value={form.videoConstraintsJson} onChange={(value) => setField('videoConstraintsJson', value)} readOnly={false} tone="light" />
            <div className="space-y-2 rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3">
              <p className="text-sm font-medium text-[var(--nimi-text-secondary)]">{t('runtimeConfig.catalogOverrides.outputs', { defaultValue: 'Outputs' })}</p>
              <label className="flex items-center gap-2 text-sm text-[var(--nimi-text-secondary)]"><input type="checkbox" checked={form.videoOutputVideoUrl} onChange={(event) => setField('videoOutputVideoUrl', event.target.checked)} />{t('runtimeConfig.catalogOverrides.videoUrl', { defaultValue: 'Video URL' })}</label>
              <label className="flex items-center gap-2 text-sm text-[var(--nimi-text-secondary)]"><input type="checkbox" checked={form.videoOutputLastFrameUrl} onChange={(event) => setField('videoOutputLastFrameUrl', event.target.checked)} />{t('runtimeConfig.catalogOverrides.lastFrameUrl', { defaultValue: 'Last frame URL' })}</label>
            </div>
          </div>
        </fieldset>
      ) : null}

      <div className="rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]">
        <button type="button" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((value) => !value)} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-medium text-[var(--nimi-text-secondary)]">
          {t('runtimeConfig.catalogOverrides.optionalPricing', { defaultValue: 'Optional pricing and dates' })}
          <span aria-hidden="true">{advancedOpen ? '−' : '+'}</span>
        </button>
        {advancedOpen ? (
          <div className="grid gap-3 border-t border-[var(--nimi-border-subtle)] p-3 md:grid-cols-2">
            <Input label={t('runtimeConfig.catalogOverrides.updatedAt', { defaultValue: 'Model updated at' })} value={form.updatedAt} onChange={(value) => setField('updatedAt', value)} type="date" />
            <Input label={t('runtimeConfig.catalogOverrides.pricingAsOf', { defaultValue: 'Pricing as of' })} value={form.pricingAsOf} onChange={(value) => setField('pricingAsOf', value)} type="date" />
            <Input label={t('runtimeConfig.catalogOverrides.pricingUnit', { defaultValue: 'Pricing unit' })} value={form.pricingUnit} onChange={(value) => setField('pricingUnit', value)} />
            <Input label={t('runtimeConfig.catalogOverrides.currency', { defaultValue: 'Currency' })} value={form.pricingCurrency} onChange={(value) => setField('pricingCurrency', value)} />
            <Input label={t('runtimeConfig.catalogOverrides.inputPrice', { defaultValue: 'Input price' })} value={form.pricingInput} onChange={(value) => setField('pricingInput', value)} />
            <Input label={t('runtimeConfig.catalogOverrides.outputPrice', { defaultValue: 'Output price' })} value={form.pricingOutput} onChange={(value) => setField('pricingOutput', value)} />
            <div className="md:col-span-2"><Input label={t('runtimeConfig.catalogOverrides.pricingNotes', { defaultValue: 'Pricing notes' })} value={form.pricingNotes} onChange={(value) => setField('pricingNotes', value)} /></div>
          </div>
        ) : null}
      </div>

      <div className="flex justify-end">
        <Button disabled={props.busy} onClick={() => void submit()}>
          {props.busy
            ? t('runtimeConfig.catalogOverrides.savingModel', { defaultValue: 'Saving model…' })
            : t('runtimeConfig.catalogOverrides.saveModel', { defaultValue: 'Save model' })}
        </Button>
      </div>
    </div>
  );
}

function LabeledTextarea(props: {
  label: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  tone: 'light' | 'dark';
  minHeightClass?: string;
}) {
  const id = useId();
  const descriptionId = `${id}-description`;
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-[var(--nimi-text-secondary)]">{props.label}</label>
      {props.description ? <p id={descriptionId} className="mt-1 text-xs text-[var(--nimi-text-muted)]">{props.description}</p> : null}
      <textarea
        id={id}
        aria-describedby={props.description ? descriptionId : undefined}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        readOnly={props.readOnly}
        spellCheck={false}
        className={`${props.minHeightClass || 'min-h-40'} mt-2 w-full rounded-xl border border-[var(--nimi-border-subtle)] p-3 font-mono text-xs outline-none focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)] ${props.tone === 'dark' ? 'bg-[var(--nimi-text-primary)] text-[var(--nimi-text-inverse)]' : 'bg-[var(--nimi-field-bg)] text-[var(--nimi-text-primary)]'}`}
      />
    </div>
  );
}

function CatalogConfirmationDialog(props: {
  action: ConfirmAction | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  if (!props.action) return null;
  const discarding = props.action.kind === 'discard' || props.action.kind === 'reload';
  const title = discarding
    ? t('runtimeConfig.catalogOverrides.discardTitle', { defaultValue: 'Discard unsaved changes?' })
    : t('runtimeConfig.catalogOverrides.restoreTitle', { defaultValue: 'Restore Nimi defaults?' });
  const body = props.action.kind === 'restore-model'
    ? props.action.source === 'overridden'
      ? t('runtimeConfig.catalogOverrides.restoreModelBody', { defaultValue: 'Your changes to {{model}} will be removed and the Nimi built-in entry will become active.', model: props.action.modelId })
      : t('runtimeConfig.catalogOverrides.removeModelBody', { defaultValue: 'The custom model {{model}} will be removed from your catalog.', model: props.action.modelId })
    : props.action.kind === 'restore-all'
      ? t('runtimeConfig.catalogOverrides.restoreAllBody', { defaultValue: 'All custom models and overrides for this provider will be removed.' })
      : t('runtimeConfig.catalogOverrides.discardBody', { defaultValue: 'Your YAML changes have not been saved.' });
  return (
    <OverlayShell
      open
      kind="dialog"
      size="S"
      onClose={props.onCancel}
      title={<h3 className="text-lg font-semibold text-[var(--nimi-text-primary)]">{title}</h3>}
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={props.onCancel} disabled={props.busy}>{t('runtimeConfig.catalogOverrides.keepEditing', { defaultValue: 'Keep editing' })}</Button>
          <Button onClick={props.onConfirm} disabled={props.busy}>
            {discarding
              ? t('runtimeConfig.catalogOverrides.discard', { defaultValue: 'Discard' })
              : t('runtimeConfig.catalogOverrides.restore', { defaultValue: 'Restore' })}
          </Button>
        </div>
      )}
    >
      <p className="mt-3 text-sm text-[var(--nimi-text-secondary)]">{body}</p>
    </OverlayShell>
  );
}
