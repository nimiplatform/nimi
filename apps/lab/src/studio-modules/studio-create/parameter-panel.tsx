import { Button, TextareaField } from '@nimiplatform/kit/ui';
import { Plus, Trash2 } from 'lucide-react';

import {
  StudioNumberParameter,
  StudioParameterField,
  StudioParameterPanelFrame,
  StudioRouteAwareParameterFields,
  type StudioParameterFieldDefinition,
  type StudioParameterPanelProps,
  type StudioParameterTranslate,
} from '../../ai-studio-core/parameter-fields.js';
import { useAIStudioHost } from '../../ai-studio-core/host-context.js';
import type { StudioEmbeddingParameters, StudioTextGenerationParameters } from './parameters.js';

function TextGenerationFields(props: StudioParameterPanelProps) {
  const { translate: t } = useAIStudioHost();
  const translate: StudioParameterTranslate = (key, values) => t(key, values);
  const parameters = props.parameters as StudioTextGenerationParameters;
  const update = props.onChange as (next: StudioTextGenerationParameters) => void;
  const numberField = (
    field: keyof StudioTextGenerationParameters,
    label: string,
    options: { min?: number; max?: number; step?: number | 'any' } = {},
  ): StudioParameterFieldDefinition => ({
    field,
    label,
    render: (routeDisabled) => (
      <StudioNumberParameter
        current={parameters}
        field={field}
        label={label}
        onChange={update}
        disabled={props.disabled || routeDisabled}
        {...options}
      />
    ),
  });
  const stopLabel = t('Studio.parameters.fields.stop');
  const fields: StudioParameterFieldDefinition[] = [
    numberField('temperature', t('Studio.parameters.fields.temperature')),
    numberField('topP', t('Studio.parameters.fields.topP'), { min: 0, max: 1 }),
    numberField('maxTokens', t('Studio.parameters.fields.maxTokens'), { min: 0, step: 1 }),
    numberField('topK', t('Studio.parameters.fields.topK'), { min: 0, step: 1 }),
    numberField('presencePenalty', t('Studio.parameters.fields.presencePenalty')),
    numberField('frequencyPenalty', t('Studio.parameters.fields.frequencyPenalty')),
    {
      field: 'stop',
      label: stopLabel,
      render: (routeDisabled) => (
        <StudioParameterField label={stopLabel}>
          <TextareaField
            rows={3}
            value={parameters.stop?.join('\n') ?? ''}
            placeholder={t('Studio.parameters.stopPlaceholder')}
            disabled={props.disabled || routeDisabled}
            onChange={(event) => {
              const values = event.currentTarget.value.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean);
              if (values.length > 0) update({ ...parameters, stop: values });
              else {
                const next = { ...parameters };
                delete next.stop;
                update(next);
              }
            }}
          />
        </StudioParameterField>
      ),
    },
    numberField('seed', t('Studio.parameters.fields.seed'), { step: 1 }),
  ];
  return (
    <StudioRouteAwareParameterFields
      contract={props.contract}
      source={props.source}
      fields={fields}
      translate={translate}
    />
  );
}

function EmbeddingFields(props: StudioParameterPanelProps) {
  const { translate: t } = useAIStudioHost();
  const translate: StudioParameterTranslate = (key, values) => t(key, values);
  const parameters = props.parameters as StudioEmbeddingParameters;
  const values = parameters.inputs?.length ? parameters.inputs : [''];
  const updateValues = (nextValues: string[]) => {
    if (nextValues.some((value) => value.trim())) props.onChange({ inputs: nextValues });
    else props.onChange({});
  };
  const label = t('Studio.parameters.fields.inputs');
  const fields: StudioParameterFieldDefinition[] = [{
    field: 'inputs',
    label,
    render: (routeDisabled) => (
      <div className="studio-parameters__stack">
        {values.map((value, index) => (
          <div className="studio-parameters__repeat" key={index}>
            <TextareaField
              rows={2}
              value={value}
              disabled={props.disabled || routeDisabled}
              aria-label={t('Studio.parameters.embeddingInput', { index: index + 1 })}
              placeholder={t('Studio.parameters.embeddingInputPlaceholder')}
              onChange={(event) => updateValues(values.map((entry, itemIndex) => itemIndex === index ? event.currentTarget.value : entry))}
            />
            {values.length > 1 ? (
              <Button type="button" tone="ghost" size="sm" disabled={props.disabled || routeDisabled} onClick={() => updateValues(values.filter((_, itemIndex) => itemIndex !== index))} aria-label={t('Studio.parameters.removeInput', { index: index + 1 })}>
                <Trash2 size={14} aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        ))}
        <Button type="button" tone="ghost" size="sm" disabled={props.disabled || routeDisabled} leadingIcon={<Plus size={14} aria-hidden="true" />} onClick={() => updateValues([...values, ''])}>
          {t('Studio.parameters.addInput')}
        </Button>
      </div>
    ),
  }];
  return (
    <StudioRouteAwareParameterFields
      contract={props.contract}
      source={props.source}
      fields={fields}
      translate={translate}
      contentClassName="studio-parameters__stack"
    />
  );
}

export function StudioCreateParameterPanel(props: StudioParameterPanelProps) {
  const { translate: t } = useAIStudioHost();
  const translate: StudioParameterTranslate = (key, values) => t(key, values);
  const fields = props.capabilityId === 'text.embed'
    ? <EmbeddingFields {...props} />
    : <TextGenerationFields {...props} />;
  return (
    <StudioParameterPanelFrame
      translate={translate}
      disabled={props.disabled}
      onReset={() => props.onChange(props.contract.initial())}
    >
      {fields}
    </StudioParameterPanelFrame>
  );
}
