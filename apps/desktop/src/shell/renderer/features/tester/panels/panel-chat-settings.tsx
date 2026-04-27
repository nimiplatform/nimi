import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AIConfig } from '@nimiplatform/sdk/mod';
import {
  CapabilityModelCard,
  DEFAULT_TEXT_GENERATE_PARAMS,
  TEXT_RESPONSE_STOP_SEQUENCES_MAX,
  parseTextGenerateParams,
  type ModelConfigCapabilityItem,
  type ModelConfigRouteBinding,
  type TextGenerateParamsState,
} from '@nimiplatform/nimi-kit/features/model-config';
import { CANONICAL_CAPABILITY_CATALOG_BY_ID } from '@nimiplatform/nimi-kit/core/runtime-capabilities';
import type { RouteModelPickerDataProvider } from '@nimiplatform/nimi-kit/features/model-picker';
import type { AppModelConfigSurface } from '@nimiplatform/nimi-kit/core/model-config';

export type TesterChatSectionBodyProps = {
  surface: AppModelConfigSurface;
  config: AIConfig;
};

const CHEVRON_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

function inputClassName(): string {
  return 'w-full rounded-[var(--nimi-radius-sm)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 text-sm text-[var(--nimi-text-primary)] outline-none transition-colors focus:border-[var(--nimi-action-primary-bg)] placeholder:text-[var(--nimi-text-muted)]';
}

function rangeClassName(): string {
  return 'h-1 w-full cursor-pointer appearance-none rounded-full bg-[var(--nimi-border-subtle)] outline-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--nimi-action-primary-bg)] [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[var(--nimi-action-primary-bg)] [&::-moz-range-thumb]:bg-white';
}

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

function writeParams(
  surface: AppModelConfigSurface,
  capabilityId: string,
  next: TextGenerateParamsState,
): void {
  const service = surface.aiConfigService;
  const current = service.aiConfig.get(surface.scopeRef);
  service.aiConfig.update(surface.scopeRef, {
    ...current,
    capabilities: {
      ...current.capabilities,
      selectedParams: {
        ...current.capabilities.selectedParams,
        [capabilityId]: { ...DEFAULT_TEXT_GENERATE_PARAMS, ...next },
      },
    },
  });
}

function ChatModelPicker({ surface, config, label }: {
  surface: AppModelConfigSurface;
  config: AIConfig;
  label: string;
}) {
  const capabilityId = 'text.generate';
  const descriptor = CANONICAL_CAPABILITY_CATALOG_BY_ID[capabilityId];
  const handleBindingChange = React.useCallback((next: ModelConfigRouteBinding | null) => {
    writeBinding(surface, capabilityId, next);
  }, [surface]);
  if (!descriptor) return null;
  const provider = (surface.providerResolver(descriptor.sourceRef.capability) || null) as RouteModelPickerDataProvider | null;
  const projection = surface.projectionResolver(capabilityId);
  const item: ModelConfigCapabilityItem = {
    capabilityId: descriptor.capabilityId,
    routeCapability: descriptor.sourceRef.capability,
    label,
    detail: '',
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

function Accordion(props: {
  title: string;
  defaultOpen?: boolean;
  topBorder?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(props.defaultOpen ?? false);
  return (
    <div className={props.topBorder !== false ? 'border-t border-[var(--nimi-border-subtle)]' : ''}>
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

function ControlGroup(props: {
  label: React.ReactNode;
  valueText?: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs font-medium text-[var(--nimi-text-primary)]">
        <span>{props.label}</span>
        {props.valueText !== undefined && props.valueText !== null && props.valueText !== '' ? (
          <span className="font-normal text-[var(--nimi-text-muted)]">{props.valueText}</span>
        ) : null}
      </div>
      {props.children}
      {props.hint ? (
        <div className="text-[11px] text-[var(--nimi-text-muted)]">{props.hint}</div>
      ) : null}
    </div>
  );
}

function stopSequencesToText(sequences: string[]): string {
  return sequences.join('\n');
}

function stopSequencesFromText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .slice(0, TEXT_RESPONSE_STOP_SEQUENCES_MAX);
}

export function TesterChatSectionBody(props: TesterChatSectionBodyProps) {
  const { surface, config } = props;
  const { t } = useTranslation();
  const capabilityId = 'text.generate';

  const stored = (config.capabilities.selectedParams?.[capabilityId] ?? {}) as Record<string, unknown>;
  const params = React.useMemo(() => parseTextGenerateParams(stored), [stored]);

  const updateParam = React.useCallback(
    <K extends keyof TextGenerateParamsState>(key: K, value: TextGenerateParamsState[K]) => {
      writeParams(surface, capabilityId, { ...params, [key]: value });
    },
    [surface, params],
  );

  const temperatureValue = params.temperature === '' ? 0.7 : Number(params.temperature);
  const topPValue = params.topP === '' ? 0.95 : Number(params.topP);

  return (
    <div className="flex flex-col gap-5">
      <ChatModelPicker
        surface={surface}
        config={config}
        label={t('Tester.chatSettings.generationModel', { defaultValue: 'Chat Model' })}
      />

      <div>
        <Accordion
          title={t('Tester.chatSettings.generationDefaults', { defaultValue: 'Generation Defaults' })}
          defaultOpen
          topBorder={false}
        >
          <ControlGroup
            label={t('Tester.chatSettings.temperature', { defaultValue: 'Temperature' })}
            valueText={Number.isFinite(temperatureValue) ? temperatureValue.toFixed(2) : '0.70'}
          >
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={Number.isFinite(temperatureValue) ? temperatureValue : 0.7}
              onChange={(event) => updateParam('temperature', event.target.value)}
              className={rangeClassName()}
            />
          </ControlGroup>

          <ControlGroup
            label={t('Tester.chatSettings.maxTokens', { defaultValue: 'Max Tokens' })}
          >
            <input
              type="number"
              min={1}
              value={params.maxTokens}
              onChange={(event) => updateParam('maxTokens', event.target.value)}
              placeholder="2048"
              className={inputClassName()}
            />
          </ControlGroup>

          <ControlGroup
            label={t('Tester.chatSettings.topP', { defaultValue: 'Top P' })}
            valueText={Number.isFinite(topPValue) ? topPValue.toFixed(2) : '0.95'}
          >
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={Number.isFinite(topPValue) ? topPValue : 0.95}
              onChange={(event) => updateParam('topP', event.target.value)}
              className={rangeClassName()}
            />
          </ControlGroup>

          <ControlGroup
            label={t('Tester.chatSettings.topK', { defaultValue: 'Top K' })}
          >
            <input
              type="number"
              min={0}
              value={params.topK}
              onChange={(event) => updateParam('topK', event.target.value)}
              placeholder="40"
              className={inputClassName()}
            />
          </ControlGroup>
        </Accordion>

        <Accordion title={t('Tester.chatSettings.responseControls', { defaultValue: 'Response Controls' })}>
          <ControlGroup
            label={t('Tester.chatSettings.timeoutMs', { defaultValue: 'Timeout (ms)' })}
          >
            <input
              type="number"
              min={0}
              value={params.timeoutMs}
              onChange={(event) => updateParam('timeoutMs', event.target.value)}
              placeholder="120000"
              className={inputClassName()}
            />
          </ControlGroup>

          <ControlGroup
            label={t('Tester.chatSettings.stopSequences', { defaultValue: 'Stop Sequences' })}
            hint={t('Tester.chatSettings.stopSequencesHint', {
              defaultValue: 'One per line · up to {max}',
              max: TEXT_RESPONSE_STOP_SEQUENCES_MAX,
            })}
          >
            <textarea
              value={stopSequencesToText(params.stopSequences)}
              onChange={(event) => updateParam('stopSequences', stopSequencesFromText(event.target.value))}
              placeholder={t('Tester.chatSettings.stopSequencesPlaceholder', { defaultValue: 'e.g.\\n\\n###' })}
              className={`h-20 resize-y font-mono text-xs ${inputClassName()}`}
            />
          </ControlGroup>
        </Accordion>

        <Accordion title={t('Tester.chatSettings.advanced', { defaultValue: 'Advanced' })}>
          <ControlGroup
            label={t('Tester.chatSettings.presencePenalty', { defaultValue: 'Presence Penalty' })}
            hint={t('Tester.chatSettings.penaltyRangeHint', { defaultValue: 'Range: -2.0 to 2.0' })}
          >
            <input
              type="number"
              min={-2}
              max={2}
              step={0.1}
              value={params.presencePenalty}
              onChange={(event) => updateParam('presencePenalty', event.target.value)}
              placeholder="0.0"
              className={inputClassName()}
            />
          </ControlGroup>

          <ControlGroup
            label={t('Tester.chatSettings.frequencyPenalty', { defaultValue: 'Frequency Penalty' })}
            hint={t('Tester.chatSettings.penaltyRangeHint', { defaultValue: 'Range: -2.0 to 2.0' })}
          >
            <input
              type="number"
              min={-2}
              max={2}
              step={0.1}
              value={params.frequencyPenalty}
              onChange={(event) => updateParam('frequencyPenalty', event.target.value)}
              placeholder="0.0"
              className={inputClassName()}
            />
          </ControlGroup>
        </Accordion>
      </div>
    </div>
  );
}
