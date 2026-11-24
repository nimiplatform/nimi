import { useEffect, useRef, useState } from 'react';
import type { NimiReasoningInputCapabilities, NimiRuntimeAIReasoningOptions } from '@nimiplatform/sdk/ai';
import { Button, TextField, SelectField } from '@nimiplatform/kit/ui';
import { subscribeStudioAIConfigRefresh } from '../../ai-studio-core/ai-config.js';
import { useLabRendererHost } from '../../renderer/context.js';
import { useTranslation } from '../../shell/i18n/index.js';

const MAX_REASONING_BUDGET_TOKENS = 0xffff_ffff;

export function parseLabReasoningBudgetDraft(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^[1-9]\d*$/u.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_REASONING_BUDGET_TOKENS) return null;
  return parsed;
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r088
// The current exact Runtime adapter supplies primitive controls. Combination
// admission still occurs in Runtime, never in an App model-name table.
export function LabReasoningControls(props: {
  readonly value: NimiRuntimeAIReasoningOptions | undefined;
  readonly onChange: (value: NimiRuntimeAIReasoningOptions | undefined) => void;
  readonly onValidityChange?: (valid: boolean) => void;
  readonly disabled?: boolean;
}) {
  const { t } = useTranslation();
  const client = useLabRendererHost().sdk.localAppClient;
  const [support, setSupport] = useState<NimiReasoningInputCapabilities>();
  const [budgetDraft, setBudgetDraft] = useState<string>(() => (
    props.value?.exactBudgetTokens !== undefined ? String(props.value.exactBudgetTokens) : ''
  ));
  const onValidityChangeRef = useRef(props.onValidityChange);
  onValidityChangeRef.current = props.onValidityChange;

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const snapshot = await client.aiConfig.get();
        if (active) setSupport(snapshot.effectiveSelections.find((entry) => entry.capabilityContract === 'text.generate' && entry.state === 'ready')?.reasoningInput);
      } catch { if (active) setSupport(undefined); }
    };
    void refresh();
    const dispose = subscribeStudioAIConfigRefresh(() => void refresh(), window, document);
    return () => { active = false; dispose(); };
  }, [client]);

  useEffect(() => {
    if (props.value?.exactBudgetTokens !== undefined) {
      setBudgetDraft(String(props.value.exactBudgetTokens));
    } else if (props.value?.activation !== 'required' && props.value?.activation !== 'adaptive') {
      setBudgetDraft('');
    }
  }, [props.value?.activation, props.value?.exactBudgetTokens]);

  const activation = props.value?.activation ?? 'default';
  const explicit = props.value?.activation === 'required' || props.value?.activation === 'adaptive' ? props.value : undefined;
  const budgetEditable = Boolean(explicit && support && !support.efforts.length && support.supportsBudget);
  const budgetInvalid = budgetEditable && parseLabReasoningBudgetDraft(budgetDraft) === null;

  useEffect(() => {
    onValidityChangeRef.current?.(!budgetInvalid);
  }, [budgetInvalid]);

  useEffect(() => () => {
    onValidityChangeRef.current?.(true);
  }, []);

  const hasExplicitIntensity = Boolean(support && (support.efforts.length > 0 || support.supportsBudget));
  const options = [
    { value: 'default', label: t('CapabilityTests.reasoning.modelDefault') },
    ...(support?.supportsDisabled ? [{ value: 'disabled', label: t('CapabilityTests.reasoning.disabled') }] : []),
    ...(support?.supportsRequired && hasExplicitIntensity ? [{ value: 'required', label: t('CapabilityTests.reasoning.required') }] : []),
    ...(support?.supportsAdaptive && hasExplicitIntensity ? [{ value: 'adaptive', label: t('CapabilityTests.reasoning.adaptive') }] : []),
  ];
  const unavailable = activation !== 'default' && (!options.some((option) => option.value === activation)
    || !!explicit && (!support?.presentations.includes(explicit.presentation ?? 'hidden')
      || explicit.effort !== undefined && !support?.efforts.includes(explicit.effort)
      || explicit.exactBudgetTokens !== undefined && !support?.supportsBudget));
  return (
    <fieldset className="studio-parameters__stack lab-reasoning" disabled={props.disabled}>
      <legend className="studio-parameters__label">{t('CapabilityTests.reasoning.title')}</legend>
      <SelectField value={activation} aria-label={t('CapabilityTests.reasoning.activation')} disabled={props.disabled}
        options={!options.some((option) => option.value === activation) ? [...options, { value: activation, label: t('CapabilityTests.reasoning.unavailable') }] : options}
        onValueChange={(value) => {
          if (value === 'default') {
            setBudgetDraft('');
            props.onChange(undefined);
            return;
          }
          if (value === 'disabled') {
            setBudgetDraft('');
            props.onChange({ activation: 'disabled' });
            return;
          }
          const nextActivation = value === 'adaptive' ? 'adaptive' : 'required';
          const presentation = support?.presentations.includes('hidden') ? 'hidden' : (support?.presentations[0] ?? 'hidden');
          if (support?.efforts.length) {
            setBudgetDraft('');
            props.onChange({ activation: nextActivation, presentation, effort: support.efforts[0]! });
            return;
          }
          if (support?.supportsBudget) {
            setBudgetDraft('1024');
            props.onChange({ activation: nextActivation, presentation, exactBudgetTokens: 1024 });
            return;
          }
          setBudgetDraft('');
          props.onChange(undefined);
        }} />
      <p className="studio-parameters__note">{t(unavailable ? 'CapabilityTests.reasoning.changedModel' : 'CapabilityTests.reasoning.defaultHint')}</p>
      {explicit && support ? <>
        {support.efforts.length ? <label className="studio-parameters__field">
          <span className="studio-parameters__label">{t('CapabilityTests.reasoning.effort')}</span>
          <SelectField value={explicit.effort ?? ''} aria-label={t('CapabilityTests.reasoning.effort')} disabled={props.disabled}
            options={support.efforts.map((effort) => ({ value: effort, label: t(`CapabilityTests.reasoning.efforts.${effort}`) }))}
            onValueChange={(effort) => props.onChange({ activation: explicit.activation, presentation: explicit.presentation, effort: effort as NonNullable<typeof explicit.effort> })} />
        </label> : support.supportsBudget ? <div className="studio-parameters__stack">
          <label className="studio-parameters__field">
            <span className="studio-parameters__label">{t('CapabilityTests.reasoning.budget')}</span>
            <TextField
              type="text"
              inputMode="numeric"
              value={budgetDraft}
              aria-invalid={budgetInvalid || undefined}
              disabled={props.disabled}
              onChange={(event) => {
                const raw = event.currentTarget.value;
                setBudgetDraft(raw);
                const parsed = parseLabReasoningBudgetDraft(raw);
                if (parsed !== null) {
                  props.onChange({
                    activation: explicit.activation,
                    presentation: explicit.presentation,
                    exactBudgetTokens: parsed,
                  });
                }
              }}
            />
          </label>
          {budgetInvalid ? (
            <div className="studio-parameters__stack">
              <p className="studio-parameters__note" role="alert">{t('CapabilityTests.reasoning.budgetInvalid')}</p>
              <Button
                type="button"
                size="sm"
                tone="ghost"
                disabled={props.disabled}
                onClick={() => {
                  setBudgetDraft('');
                  props.onChange(undefined);
                }}
              >
                {t('CapabilityTests.reasoning.resetToDefault')}
              </Button>
            </div>
          ) : null}
        </div> : null}
        <label className="studio-parameters__field">
          <span className="studio-parameters__label">{t('CapabilityTests.reasoning.presentation')}</span>
          <SelectField value={explicit.presentation ?? 'hidden'} aria-label={t('CapabilityTests.reasoning.presentation')} disabled={props.disabled}
            options={support.presentations.map((presentation) => ({ value: presentation, label: t(`CapabilityTests.reasoning.${presentation}`) }))}
            onValueChange={(presentation) => props.onChange({ ...explicit, presentation: presentation === 'summary' ? 'summary' : 'hidden' })} />
        </label>
      </> : null}
    </fieldset>
  );
}
