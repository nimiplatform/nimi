import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AIConfig } from '@nimiplatform/sdk/mod';
import {
  CapabilityModelCard,
  type ModelConfigCapabilityItem,
  type ModelConfigRouteBinding,
} from '@nimiplatform/nimi-kit/features/model-config';
import {
  CANONICAL_CAPABILITY_CATALOG_BY_ID,
} from '@nimiplatform/nimi-kit/core/runtime-capabilities';
import type { RouteModelPickerDataProvider } from '@nimiplatform/nimi-kit/features/model-picker';
import type {
  AppModelConfigSurface,
} from '@nimiplatform/nimi-kit/core/model-config';
import type { CapabilityState, ImageWorkflowDraftState } from '../tester-types.js';
import { ImageInspectorBody } from './panel-image-inspector.js';

export type TesterImageSectionBodyProps = {
  state: CapabilityState;
  draft: ImageWorkflowDraftState;
  onDraftChange: React.Dispatch<React.SetStateAction<ImageWorkflowDraftState>>;
  surface: AppModelConfigSurface;
  config: AIConfig;
};

const CHEVRON_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

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

function Accordion(props: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(props.defaultOpen ?? false);
  return (
    <div className="border-t border-[var(--nimi-border-subtle)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between py-3 text-left text-sm font-semibold text-[var(--nimi-text-primary)]"
      >
        <span>{props.title}</span>
        <span className={`text-[var(--nimi-text-muted)] transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
          {CHEVRON_ICON}
        </span>
      </button>
      {open ? <div className="flex flex-col gap-4 pb-4">{props.children}</div> : null}
    </div>
  );
}

export function TesterImageSectionBody(props: TesterImageSectionBodyProps) {
  const { state, draft, onDraftChange, surface, config } = props;
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-5">
      <PickerOnly
        capabilityId="image.generate"
        surface={surface}
        config={config}
        label={t('Tester.imageSettings.generationModel')}
      />

      <ImageInspectorBody
        state={state}
        draft={draft}
        onDraftChange={onDraftChange}
        showTitle={false}
        defaultOpenAdvanced={false}
      />

      <Accordion title={t('Tester.imageSettings.editSection')}>
        <PickerOnly
          capabilityId="image.edit"
          surface={surface}
          config={config}
          label={t('Tester.imageSettings.editModel')}
        />
      </Accordion>
    </div>
  );
}
