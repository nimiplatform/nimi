// @nimi-authority: rule.nimi.desktop.ai-consumption.r023

import { TextField } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import { patchLoadoutTextContextOption } from './runtime-config-loadout-model-display.js';

export function RuntimeTextContextSizeField(props: {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly disabled?: boolean;
  readonly testId?: string;
}) {
  const { t } = useTranslation();
  const parsed = patchLoadoutTextContextOption({}, props.value);
  const invalid = !parsed.valid;
  return (
    <div className="space-y-1.5" data-testid={props.testId ?? 'runtime-text-context-size-field'}>
      <label className="grid gap-1.5 text-xs font-semibold text-[var(--nimi-text-secondary)]">
        <span>{t('runtimeConfig.loadouts.contextSize')}</span>
        <TextField
          aria-label={t('runtimeConfig.loadouts.contextSize')}
          inputMode="numeric"
          placeholder={t('runtimeConfig.loadouts.contextSizeAuto')}
          value={props.value}
          disabled={props.disabled}
          tone={invalid ? 'danger' : 'default'}
          onChange={(event) => props.onChange(event.currentTarget.value)}
        />
      </label>
      <p className={`text-xs ${invalid ? 'text-[var(--nimi-status-danger)]' : 'text-[var(--nimi-text-muted)]'}`}>
        {invalid ? t('runtimeConfig.loadouts.contextSizeInvalid') : t('runtimeConfig.loadouts.contextSizeHint')}
      </p>
    </div>
  );
}
