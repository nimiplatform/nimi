import type { ReactNode } from 'react';
import {
  Button,
  SelectField,
  type SelectFieldOption,
  SettingsCard,
} from '@nimiplatform/nimi-kit/ui';
import type { UseModelPickerResult } from '../headless.js';
import { ModelPicker } from './model-picker.js';

export type RouteModelPickerSource = 'local' | 'cloud';

export type RouteModelPickerSourceOption = {
  value: RouteModelPickerSource;
  label: ReactNode;
  disabled?: boolean;
};

export type RouteModelPickerBanner = {
  tone: 'warning' | 'danger' | 'info';
  message: ReactNode;
};

export type RouteModelPickerPanelProps<TModel> = {
  state: UseModelPickerResult<TModel>;
  sourceValue: RouteModelPickerSource;
  sourceOptions: readonly RouteModelPickerSourceOption[];
  onSourceChange?: (value: RouteModelPickerSource) => void;
  loading?: boolean;
  loadingMessage?: ReactNode;
  unavailable?: boolean;
  unavailableMessage?: ReactNode;
  sourceLabel?: ReactNode;
  connectorLabel?: ReactNode;
  connectorValue?: string;
  connectorOptions?: readonly SelectFieldOption[];
  onConnectorChange?: (value: string) => void;
  showConnector?: boolean;
  modelLabel?: ReactNode;
  selectedModelLabel?: ReactNode;
  selectedModelValue?: ReactNode;
  resolvedRouteLabel?: ReactNode;
  resolvedRouteValue?: ReactNode;
  resetLabel?: ReactNode;
  onReset?: () => void;
  banners?: readonly RouteModelPickerBanner[];
  emptyMessage?: ReactNode;
  className?: string;
  pickerClassName?: string;
};

function bannerClassName(tone: RouteModelPickerBanner['tone']) {
  if (tone === 'danger') {
    return 'border-[color-mix(in_srgb,var(--nimi-status-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,var(--nimi-surface-card))] text-[var(--nimi-status-danger)]';
  }
  if (tone === 'warning') {
    return 'border-[color-mix(in_srgb,var(--nimi-status-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))] text-[var(--nimi-status-warning)]';
  }
  return 'border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] text-[var(--nimi-text-secondary)]';
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--nimi-text-muted)]">
      {children}
    </p>
  );
}

export function RouteModelPickerPanel<TModel>({
  state,
  sourceValue,
  sourceOptions,
  onSourceChange,
  loading = false,
  loadingMessage = 'Loading models...',
  unavailable = false,
  unavailableMessage = 'Route options unavailable.',
  sourceLabel = 'Source',
  connectorLabel = 'Connector',
  connectorValue,
  connectorOptions = [],
  onConnectorChange,
  showConnector = false,
  modelLabel = 'Model',
  selectedModelLabel = 'Active',
  selectedModelValue,
  resolvedRouteLabel = 'Resolved Route',
  resolvedRouteValue,
  resetLabel = 'Reset',
  onReset,
  banners = [],
  emptyMessage = 'No models are available for this route.',
  className,
  pickerClassName,
}: RouteModelPickerPanelProps<TModel>) {
  const activeModelValue = selectedModelValue
    ?? (state.selectedModel ? state.adapter.getTitle(state.selectedModel) : undefined);

  if (loading) {
    return <p className={className ? className : 'text-sm text-[color:var(--nimi-text-secondary)]'}>{loadingMessage}</p>;
  }

  if (unavailable) {
    return <p className={className ? className : 'text-sm text-[color:var(--nimi-text-secondary)]'}>{unavailableMessage}</p>;
  }

  return (
    <div className={className}>
      <div className="space-y-4">
        <div className="space-y-2">
          <FieldLabel>{sourceLabel}</FieldLabel>
          <div className="flex gap-2">
            {sourceOptions.map((option) => (
              <Button
                key={option.value}
                tone={option.value === sourceValue ? 'primary' : 'secondary'}
                size="sm"
                fullWidth
                disabled={option.disabled}
                onClick={() => onSourceChange?.(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>

        {showConnector && connectorOptions.length > 0 ? (
          <label className="flex min-h-11 flex-col gap-1">
            <FieldLabel>{connectorLabel}</FieldLabel>
            <SelectField
              value={connectorValue}
              onValueChange={onConnectorChange}
              options={connectorOptions.slice()}
              placeholder="Select connector"
              selectClassName="font-normal"
            />
          </label>
        ) : null}

        {banners.map((banner, index) => (
          <SettingsCard key={`${banner.tone}-${index}`} className={`rounded-2xl border px-3 py-2 text-sm ${bannerClassName(banner.tone)}`}>
            {banner.message}
          </SettingsCard>
        ))}

        <div className="space-y-2">
          <FieldLabel>{modelLabel}</FieldLabel>
          {activeModelValue ? (
            <SettingsCard className="rounded-2xl px-3 py-2 text-sm text-[color:var(--nimi-text-secondary)]">
              {selectedModelLabel}: <span className="text-[color:var(--nimi-text-primary)]">{activeModelValue}</span>
            </SettingsCard>
          ) : null}

          {state.models.length > 0 ? (
            <ModelPicker
              state={state}
              className={pickerClassName}
              loadingMessage={loadingMessage}
              emptyMessage={emptyMessage}
            />
          ) : (
            <SettingsCard className="rounded-2xl px-3 py-3 text-sm text-[color:var(--nimi-text-secondary)]">
              {emptyMessage}
            </SettingsCard>
          )}
        </div>

        {resolvedRouteValue || onReset ? (
          <div className="flex items-center justify-between gap-3">
            {resolvedRouteValue ? (
              <p className="min-w-0 truncate text-sm text-[color:var(--nimi-text-secondary)]">
                {resolvedRouteLabel}: <span className="text-[color:var(--nimi-text-primary)]">{resolvedRouteValue}</span>
              </p>
            ) : <span />}
            {onReset ? (
              <Button tone="ghost" size="sm" onClick={onReset}>
                {resetLabel}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
