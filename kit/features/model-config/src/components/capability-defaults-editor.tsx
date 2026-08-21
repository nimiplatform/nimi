import { useId, useState } from 'react';
import type { NimiJsonObject } from '@nimiplatform/kit/core/sdk-contract';
import { SelectField, TextareaField, TextField } from '@nimiplatform/kit/ui';
import {
  capabilityDefaultFields,
  type CapabilityDefaultField,
} from '../capability-defaults.js';

export type CapabilityDefaultsEditorCopy = {
  readonly label: string;
  readonly hint: string;
  readonly unsetLabel: string;
  readonly trueLabel: string;
  readonly falseLabel: string;
  readonly listPlaceholder: string;
  readonly localEffectivePlaceholder: (value: string) => string;
  readonly cloudEffectivePlaceholder: string;
  readonly randomValue: string;
};

export type CapabilityDefaultsEditorProps = {
  readonly capabilityContract: string;
  readonly value: NimiJsonObject;
  readonly onChange: (value: NimiJsonObject) => void;
  readonly copy: CapabilityDefaultsEditorCopy;
  readonly route: 'local' | 'cloud' | null;
  readonly effectiveDefaults?: Readonly<Record<string, string>> | null;
  readonly disabled?: boolean;
};

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function setPath(
  source: Readonly<Record<string, unknown>>,
  path: readonly string[],
  value: unknown,
): NimiJsonObject {
  const [head, ...tail] = path;
  if (!head) return source as NimiJsonObject;
  const next: Record<string, unknown> = { ...source };
  if (tail.length === 0) {
    if (value === undefined) delete next[head];
    else next[head] = value;
    return next as NimiJsonObject;
  }
  const nested = setPath(asRecord(source[head]), tail, value);
  if (Object.keys(nested).length === 0) delete next[head];
  else next[head] = nested;
  return next as NimiJsonObject;
}

function displayValue(source: Readonly<Record<string, unknown>>, field: CapabilityDefaultField): unknown {
  return source[field.key];
}

// Complete base-10 literal only; intermediate typing states such as "-", "0.",
// or "1e" intentionally fail so they stay draft-only until committed or blurred.
const COMPLETE_NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function parseNumericDraft(kind: 'number' | 'integer', raw: string): number | undefined | null {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (!COMPLETE_NUMBER_PATTERN.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  if (kind === 'integer' && !Number.isInteger(parsed)) return null;
  return parsed;
}

function NumericDefaultField(props: {
  readonly controlId: string;
  readonly parameterPath: string;
  readonly kind: 'number' | 'integer';
  readonly value: unknown;
  readonly placeholder: string;
  readonly disabled?: boolean;
  readonly onCommit: (next: number | undefined) => void;
}) {
  // draft === null mirrors the committed prop value; a string means the user is editing.
  const [draft, setDraft] = useState<string | null>(null);
  const committed = typeof props.value === 'number' ? String(props.value) : '';
  return (
    <TextField
      id={props.controlId}
      aria-label={props.parameterPath}
      type="number"
      step={props.kind === 'integer' ? 1 : 'any'}
      value={draft ?? committed}
      placeholder={props.placeholder}
      disabled={props.disabled}
      onChange={(event) => {
        const raw = event.currentTarget.value;
        setDraft(raw);
        const next = parseNumericDraft(props.kind, raw);
        if (next !== null) props.onCommit(next);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

function DefaultFieldControl(props: {
  readonly field: CapabilityDefaultField;
  readonly source: Readonly<Record<string, unknown>>;
  readonly path: readonly string[];
  readonly rootValue: NimiJsonObject;
  readonly onChange: (value: NimiJsonObject) => void;
  readonly copy: CapabilityDefaultsEditorCopy;
  readonly route: 'local' | 'cloud' | null;
  readonly effectiveDefaults?: Readonly<Record<string, string>> | null;
  readonly disabled?: boolean;
}) {
  const controlId = useId();
  const path = [...props.path, props.field.key];
  const parameterPath = path.join('.');
  const value = displayValue(props.source, props.field);
  const update = (next: unknown) => props.onChange(setPath(props.rootValue, path, next));
  const effectiveValue = props.effectiveDefaults?.[parameterPath];
  const unsetPlaceholder = props.route === 'cloud'
    ? props.copy.cloudEffectivePlaceholder
    : props.route === 'local' && effectiveValue
      ? props.copy.localEffectivePlaceholder(
          effectiveValue === 'random' ? props.copy.randomValue : effectiveValue,
        )
      : props.copy.unsetLabel;

  if (props.field.kind === 'object') {
    const nested = asRecord(value);
    return (
      <fieldset
        className="col-span-full grid min-w-0 grid-cols-1 gap-3 rounded-[var(--nimi-radius-sm)] border border-[var(--nimi-border-subtle)] p-3 sm:grid-cols-2"
        data-nimi-default-parameter-group={parameterPath}
      >
        <legend className="px-1 font-mono text-[length:var(--nimi-type-overline-size)] font-semibold text-[var(--nimi-text-secondary)]">
          {props.field.key}
        </legend>
        {(props.field.fields || []).map((field) => (
          <DefaultFieldControl
            key={field.key}
            field={field}
            source={nested}
            path={path}
            rootValue={props.rootValue}
            onChange={props.onChange}
            copy={props.copy}
            route={props.route}
            effectiveDefaults={props.effectiveDefaults}
            disabled={props.disabled}
          />
        ))}
      </fieldset>
    );
  }

  let control;
  if (props.field.kind === 'boolean') {
    control = (
      <SelectField
        id={controlId}
        aria-label={parameterPath}
        value={typeof value === 'boolean' ? String(value) : 'unset'}
        disabled={props.disabled}
        options={[
          { value: 'unset', label: unsetPlaceholder },
          { value: 'true', label: props.copy.trueLabel },
          { value: 'false', label: props.copy.falseLabel },
        ]}
        onValueChange={(next) => update(next === 'unset' ? undefined : next === 'true')}
      />
    );
  } else if (props.field.kind === 'string-list') {
    control = (
      <TextareaField
        id={controlId}
        aria-label={parameterPath}
        value={Array.isArray(value) ? value.join('\n') : ''}
        placeholder={props.route === null || (props.route === 'local' && !effectiveValue)
          ? props.copy.listPlaceholder
          : unsetPlaceholder}
        disabled={props.disabled}
        rows={3}
        onChange={(event) => {
          const entries = event.currentTarget.value
            .split('\n')
            .map((entry) => entry.trim())
            .filter(Boolean);
          update(entries.length > 0 ? entries : undefined);
        }}
      />
    );
  } else if (props.field.kind === 'number' || props.field.kind === 'integer') {
    control = (
      <NumericDefaultField
        controlId={controlId}
        parameterPath={parameterPath}
        kind={props.field.kind}
        value={value}
        placeholder={unsetPlaceholder}
        disabled={props.disabled}
        onCommit={update}
      />
    );
  } else {
    control = (
      <TextField
        id={controlId}
        aria-label={parameterPath}
        type="text"
        value={typeof value === 'string' ? value : ''}
        placeholder={unsetPlaceholder}
        disabled={props.disabled}
        onChange={(event) => {
          const raw = event.currentTarget.value;
          update(raw.trim() ? raw : undefined);
        }}
      />
    );
  }

  return (
    <div
      className="grid min-w-0 gap-1.5 text-xs text-[var(--nimi-text-primary)]"
      data-nimi-default-parameter={parameterPath}
    >
      <label htmlFor={controlId} className="font-mono text-[length:var(--nimi-type-overline-size)] font-semibold text-[var(--nimi-text-secondary)]">
        {props.field.key}
      </label>
      {control}
    </div>
  );
}

export function CapabilityDefaultsEditor(props: CapabilityDefaultsEditorProps) {
  const fields = capabilityDefaultFields(props.capabilityContract);
  if (!fields) return null;
  const source = asRecord(props.value);

  return (
    <details
      className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]"
      data-nimi-model-config-defaults={props.capabilityContract}
    >
      <summary className="cursor-pointer list-none px-3 py-2.5 text-xs font-semibold text-[var(--nimi-text-primary)]">
        <span className="flex items-center justify-between gap-3">
          <span>{props.copy.label}</span>
          <span aria-hidden="true" className="text-[var(--nimi-text-muted)]">⌄</span>
        </span>
      </summary>
      <div className="space-y-3 border-t border-[var(--nimi-border-subtle)] p-3">
        <p className="m-0 text-[length:var(--nimi-type-overline-size)] leading-relaxed text-[var(--nimi-text-muted)]">{props.copy.hint}</p>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          {fields.map((field) => (
            <DefaultFieldControl
              key={field.key}
              field={field}
              source={source}
              path={[]}
              rootValue={props.value}
              onChange={props.onChange}
              copy={props.copy}
              route={props.route}
              effectiveDefaults={props.effectiveDefaults}
              disabled={props.disabled}
            />
          ))}
        </div>
      </div>
    </details>
  );
}
