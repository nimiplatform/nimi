import { useEffect, useState } from 'react';
import type { NimiReasoningInputCapabilities, NimiRuntimeAIReasoningOptions } from '@nimiplatform/sdk/ai';
import { TextField, SelectField } from '@nimiplatform/kit/ui';
import { subscribeStudioAIConfigRefresh } from '../../ai-studio-core/ai-config.js';
import { useLabRendererHost } from '../../renderer/context.js';
import { useTranslation } from '../../shell/i18n/index.js';

// @nimi-authority: rule.nimi.runtime.ai-provider.r088
// The current exact Runtime adapter supplies primitive controls. Combination
// admission still occurs in Runtime, never in an App model-name table.
export function LabReasoningControls(props: {
  readonly value: NimiRuntimeAIReasoningOptions | undefined;
  readonly onChange: (value: NimiRuntimeAIReasoningOptions | undefined) => void;
  readonly disabled?: boolean;
}) {
  const { t } = useTranslation();
  const client = useLabRendererHost().sdk.localAppClient;
  const [support, setSupport] = useState<NimiReasoningInputCapabilities>();
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
  const activation = props.value?.activation ?? 'default';
  const explicit = props.value?.activation === 'required' || props.value?.activation === 'adaptive' ? props.value : undefined;
  const options = [
    { value: 'default', label: t('CapabilityTests.reasoning.modelDefault') },
    ...(support?.supportsDisabled ? [{ value: 'disabled', label: t('CapabilityTests.reasoning.disabled') }] : []),
    ...(support?.supportsRequired ? [{ value: 'required', label: t('CapabilityTests.reasoning.required') }] : []),
    ...(support?.supportsAdaptive ? [{ value: 'adaptive', label: t('CapabilityTests.reasoning.adaptive') }] : []),
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
        onValueChange={(value) => props.onChange(value === 'default' ? undefined : value === 'disabled' ? { activation: 'disabled' }
          : { activation: value === 'adaptive' ? 'adaptive' : 'required', presentation: 'hidden',
            ...(support?.efforts.length ? { effort: support.efforts[0]! } : { exactBudgetTokens: 1024 }) })} />
      <p className="studio-parameters__note">{t(unavailable ? 'CapabilityTests.reasoning.changedModel' : 'CapabilityTests.reasoning.defaultHint')}</p>
      {explicit && support ? <>
        {support.efforts.length ? <label className="studio-parameters__field">
          <span className="studio-parameters__label">{t('CapabilityTests.reasoning.effort')}</span>
          <SelectField value={explicit.effort ?? ''} aria-label={t('CapabilityTests.reasoning.effort')} disabled={props.disabled}
            options={support.efforts.map((effort) => ({ value: effort, label: t(`CapabilityTests.reasoning.efforts.${effort}`) }))}
            onValueChange={(effort) => props.onChange({ activation: explicit.activation, presentation: explicit.presentation, effort: effort as NonNullable<typeof explicit.effort> })} />
        </label> : support.supportsBudget ? <label className="studio-parameters__field">
          <span className="studio-parameters__label">{t('CapabilityTests.reasoning.budget')}</span>
          <TextField type="number" value={explicit.exactBudgetTokens ?? ''} min={1} max={0xffff_ffff} step={1} disabled={props.disabled}
            onChange={(event) => props.onChange({ activation: explicit.activation, presentation: explicit.presentation, exactBudgetTokens: Number(event.currentTarget.value) })} />
        </label> : null}
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
