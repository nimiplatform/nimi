import type { ReactNode } from 'react';
import { Button, TextField, Toggle } from '@nimiplatform/kit/ui';
import { ChevronDown } from 'lucide-react';

import type {
  StudioParameterContract,
  StudioParameterValue,
  StudioRunTargetSource,
} from './parameters.js';

export type StudioParameterTranslate = (
  key: string,
  values?: Readonly<Record<string, unknown>>,
) => string;

export type StudioParameterPanelProps = {
  readonly capabilityId: string;
  readonly contract: StudioParameterContract;
  readonly source: StudioRunTargetSource;
  readonly parameters: StudioParameterValue;
  readonly disabled: boolean;
  readonly onChange: (parameters: StudioParameterValue) => void;
};

export type StudioParameterFieldDefinition = {
  readonly field: string;
  readonly label: string;
  readonly render: (routeDisabled: boolean) => ReactNode;
};

export function StudioParameterPanelFrame({
  translate,
  disabled,
  onReset,
  children,
}: {
  readonly translate: StudioParameterTranslate;
  readonly disabled: boolean;
  readonly onReset: () => void;
  readonly children: ReactNode;
}) {
  return (
    <section className="studio-parameters" aria-label={translate('Studio.parameters.title')}>
      <div className="studio-parameters__head">
        <span>{translate('Studio.parameters.presenceHint')}</span>
        <Button type="button" tone="ghost" size="sm" disabled={disabled} onClick={onReset}>
          {translate('Studio.parameters.reset')}
        </Button>
      </div>
      {children}
    </section>
  );
}

export function StudioParameterField({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <label className="studio-parameters__field">
      <span className="studio-parameters__label">{label}</span>
      {children}
    </label>
  );
}

export function StudioRouteAwareParameterFields({
  contract,
  source,
  fields,
  translate,
  contentClassName = 'studio-parameters__grid',
}: {
  readonly contract: StudioParameterContract;
  readonly source: StudioRunTargetSource;
  readonly fields: readonly StudioParameterFieldDefinition[];
  readonly translate: StudioParameterTranslate;
  readonly contentClassName?: string;
}) {
  const presentation = new Map(
    contract.presentation(source).map((item) => [item.field, item]),
  );
  const available = fields.filter((field) => presentation.get(field.field)?.state !== 'disabled');
  const routeUnavailable = fields.filter((field) => (
    presentation.get(field.field)?.state === 'disabled'
    && presentation.get(field.field)?.unavailableBecause === 'route'
  ));
  const surfaceUnavailable = fields.filter((field) => (
    presentation.get(field.field)?.state === 'disabled'
    && presentation.get(field.field)?.unavailableBecause === 'local-app-surface'
  ));
  const renderAvailable = (field: StudioParameterFieldDefinition) => {
    const item = presentation.get(field.field);
    if (item?.state === 'fixed') {
      return (
        <StudioParameterField key={field.field} label={field.label}>
          <span className="studio-parameters__fixed" role="status">
            {translate('Studio.parameters.fixedValue', { value: item.fixedValue })}
          </span>
        </StudioParameterField>
      );
    }
    return <div className="studio-parameters__field-slot" key={field.field}>{field.render(false)}</div>;
  };
  return (
    <>
      <div className={contentClassName}>{available.map(renderAvailable)}</div>
      {routeUnavailable.length > 0 && (source === 'local' || source === 'cloud') ? (
        <details className="studio-parameters__route-group">
          <summary>
            <span>
              <strong>{translate(source === 'local' ? 'Studio.parameters.cloudOnlyGroup' : 'Studio.parameters.localOnlyGroup')}</strong>
              <small>{translate(source === 'local' ? 'Studio.parameters.switchToCloudHint' : 'Studio.parameters.switchToLocalHint')}</small>
            </span>
            <ChevronDown size={15} aria-hidden="true" />
          </summary>
          <div className={contentClassName} aria-disabled="true">
            {routeUnavailable.map((field) => (
              <div className="studio-parameters__field-slot" key={field.field}>{field.render(true)}</div>
            ))}
          </div>
        </details>
      ) : null}
      {surfaceUnavailable.length > 0 ? (
        <details className="studio-parameters__route-group">
          <summary>
            <span>
              <strong>{translate('Studio.parameters.localAppUnavailableGroup')}</strong>
              <small>{translate('Studio.parameters.localAppUnavailableHint')}</small>
            </span>
            <ChevronDown size={15} aria-hidden="true" />
          </summary>
          <div className={contentClassName} aria-disabled="true">
            {surfaceUnavailable.map((field) => (
              <div className="studio-parameters__field-slot" key={field.field}>{field.render(true)}</div>
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}

export function optionalStudioText<T extends object>(current: T, key: keyof T, value: string): T {
  if (value.length > 0) return { ...current, [key]: value };
  const next = { ...current };
  delete next[key];
  return next;
}

export function optionalStudioNumber<T extends object>(current: T, key: keyof T, value: string): T {
  if (value !== '' && Number.isFinite(Number(value))) return { ...current, [key]: Number(value) };
  const next = { ...current };
  delete next[key];
  return next;
}

export function StudioNumberParameter<T extends object>({
  current,
  field,
  label,
  onChange,
  disabled,
  min,
  max,
  step = 'any',
}: {
  readonly current: T;
  readonly field: keyof T;
  readonly label: string;
  readonly onChange: (next: T) => void;
  readonly disabled: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number | 'any';
}) {
  const value = current[field];
  return (
    <StudioParameterField label={label}>
      <TextField
        type="number"
        value={typeof value === 'number' ? value : ''}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => onChange(optionalStudioNumber(current, field, event.currentTarget.value))}
      />
    </StudioParameterField>
  );
}

export function StudioTextParameter<T extends object>({
  current,
  field,
  label,
  onChange,
  disabled,
  placeholder,
}: {
  readonly current: T;
  readonly field: keyof T;
  readonly label: string;
  readonly onChange: (next: T) => void;
  readonly disabled: boolean;
  readonly placeholder?: string;
}) {
  const value = current[field];
  return (
    <StudioParameterField label={label}>
      <TextField
        value={typeof value === 'string' ? value : ''}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(optionalStudioText(current, field, event.currentTarget.value))}
      />
    </StudioParameterField>
  );
}

export function StudioBooleanParameter<T extends object>({
  current,
  field,
  label,
  onChange,
  disabled,
}: {
  readonly current: T;
  readonly field: keyof T;
  readonly label: string;
  readonly onChange: (next: T) => void;
  readonly disabled: boolean;
}) {
  return (
    <StudioParameterField label={label}>
      <Toggle
        checked={current[field] === true}
        disabled={disabled}
        ariaLabel={label}
        onChange={(checked) => onChange({ ...current, [field]: checked })}
      />
    </StudioParameterField>
  );
}
