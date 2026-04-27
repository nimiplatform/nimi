import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AIConfig } from '@nimiplatform/sdk/mod';
import {
  CapabilityModelCard,
  type ModelConfigCapabilityItem,
  type ModelConfigRouteBinding,
  type VideoParamsState,
} from '@nimiplatform/nimi-kit/features/model-config';
import {
  CANONICAL_CAPABILITY_CATALOG_BY_ID,
} from '@nimiplatform/nimi-kit/core/runtime-capabilities';
import type { RouteModelPickerDataProvider } from '@nimiplatform/nimi-kit/features/model-picker';
import type {
  AppModelConfigSurface,
} from '@nimiplatform/nimi-kit/core/model-config';

export type TesterVideoSectionBodyProps = {
  params: VideoParamsState;
  onParamsChange: (next: VideoParamsState) => void;
  surface: AppModelConfigSurface;
  config: AIConfig;
};

function readBinding(config: AIConfig, capabilityId: string): ModelConfigRouteBinding | null {
  const stored = config.capabilities.selectedBindings?.[capabilityId];
  if (!stored) return null;
  return {
    source: stored.source === 'cloud' ? 'cloud' : 'local',
    connectorId: stored.connectorId || '',
    model: stored.model || '',
    modelId: stored.modelId || undefined,
    modelLabel: stored.modelLabel || undefined,
    localModelId: stored.localModelId || undefined,
    provider: stored.provider || undefined,
    engine: stored.engine || undefined,
    adapter: stored.adapter || undefined,
    endpoint: stored.endpoint || undefined,
    goRuntimeLocalModelId: stored.goRuntimeLocalModelId || undefined,
    goRuntimeStatus: stored.goRuntimeStatus || undefined,
    providerHints: stored.providerHints || undefined,
  };
}

function writeBinding(
  surface: AppModelConfigSurface,
  capabilityId: string,
  next: ModelConfigRouteBinding | null,
): void {
  const service = surface.aiConfigService;
  const current = service.aiConfig.get(surface.scopeRef);
  const nextBindings = { ...current.capabilities.selectedBindings };
  nextBindings[capabilityId] = next
    ? {
      source: next.source,
      connectorId: next.connectorId,
      model: next.model,
      modelId: next.modelId,
      modelLabel: next.modelLabel,
      localModelId: next.localModelId,
      engine: next.engine,
      provider: next.provider,
    }
    : null;
  service.aiConfig.update(surface.scopeRef, {
    ...current,
    capabilities: {
      ...current.capabilities,
      selectedBindings: nextBindings,
    },
  });
}

function PickerOnly({ capabilityId, surface, config, label, detail }: {
  capabilityId: string;
  surface: AppModelConfigSurface;
  config: AIConfig;
  label: string;
  detail?: string;
}) {
  const descriptor = CANONICAL_CAPABILITY_CATALOG_BY_ID[capabilityId];
  const handleBindingChange = React.useCallback((next: ModelConfigRouteBinding | null) => {
    writeBinding(surface, capabilityId, next);
  }, [capabilityId, surface]);
  if (!descriptor) return null;
  const provider = (surface.providerResolver(descriptor.sourceRef.capability) || null) as RouteModelPickerDataProvider | null;
  const projection = surface.projectionResolver(capabilityId);
  const item: ModelConfigCapabilityItem = {
    capabilityId: descriptor.capabilityId,
    routeCapability: descriptor.sourceRef.capability,
    label,
    detail: detail ?? '',
    binding: readBinding(config, capabilityId),
    provider,
    onBindingChange: handleBindingChange,
    status: projection,
    editor: null,
    showEditorWhen: 'always',
    runtimeNotReadyLabel: surface.runtimeNotReadyLabel,
  };
  return <CapabilityModelCard item={item} />;
}

function FieldRow(props: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs font-medium text-[var(--nimi-text-primary)]">{props.label}</div>
      {props.children}
      {props.hint ? (
        <div className="text-[11px] leading-relaxed text-[var(--nimi-text-muted)]">{props.hint}</div>
      ) : null}
    </div>
  );
}

function inputClassName(): string {
  return 'w-full rounded-[var(--nimi-radius-sm)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 text-sm text-[var(--nimi-text-primary)] outline-none transition-colors focus:border-[var(--nimi-action-primary-bg)] placeholder:text-[var(--nimi-text-muted)]';
}

export function TesterVideoSectionBody(props: TesterVideoSectionBodyProps) {
  const { params, onParamsChange, surface, config } = props;
  const { t } = useTranslation();

  const update = React.useCallback((patch: Partial<VideoParamsState>) => {
    onParamsChange({ ...params, ...patch });
  }, [params, onParamsChange]);

  return (
    <div className="flex flex-col gap-5">
      <PickerOnly
        capabilityId="video.generate"
        surface={surface}
        config={config}
        label={t('Tester.videoSettings.generationModel', { defaultValue: 'Generation Model' })}
      />

      <div className="flex flex-col gap-1">
        <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {t('Tester.videoSettings.advanced', { defaultValue: 'Advanced' })}
        </div>
        <p className="text-[11px] leading-relaxed text-[var(--nimi-text-muted)]">
          {t('Tester.videoSettings.advancedHint', { defaultValue: 'These rarely need changing — leave blank to let the model decide.' })}
        </p>
      </div>

      <FieldRow
        label={t('Tester.videoSettings.fps', { defaultValue: 'Frame Rate (FPS)' })}
        hint={t('Tester.videoSettings.fpsHint', { defaultValue: 'How smooth the motion looks. Leave blank for auto.' })}
      >
        <input
          type="number"
          value={params.fps}
          onChange={(event) => update({ fps: event.target.value })}
          placeholder={t('Tester.videoSettings.fpsPlaceholder', { defaultValue: 'Auto' })}
          className={inputClassName()}
        />
      </FieldRow>

      <FieldRow
        label={t('Tester.videoSettings.seed', { defaultValue: 'Seed' })}
        hint={t('Tester.videoSettings.seedHint', { defaultValue: 'Set a number to reproduce the same result. Leave blank for randomness.' })}
      >
        <input
          type="number"
          value={params.seed}
          onChange={(event) => update({ seed: event.target.value })}
          placeholder={t('Tester.videoSettings.seedPlaceholder', { defaultValue: 'Random' })}
          className={inputClassName()}
        />
      </FieldRow>

      <FieldRow
        label={t('Tester.videoSettings.timeoutMs', { defaultValue: 'Timeout (ms)' })}
        hint={t('Tester.videoSettings.timeoutHint', { defaultValue: 'How long to wait before giving up. Default 10 minutes.' })}
      >
        <input
          type="number"
          value={params.timeoutMs}
          onChange={(event) => update({ timeoutMs: event.target.value })}
          placeholder={t('Tester.videoSettings.timeoutPlaceholder', { defaultValue: '600000' })}
          className={`font-mono text-xs ${inputClassName()}`}
        />
      </FieldRow>
    </div>
  );
}
