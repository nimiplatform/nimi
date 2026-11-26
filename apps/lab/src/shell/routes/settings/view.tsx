import { InlineAlert, SegmentedControl, SelectField, Surface, Toggle } from '@nimiplatform/kit/ui';
import type {
  AccountSettingsProjectionState,
  HumanChatProjectionState,
  NotificationListProjectionState,
  NotificationProjectionState,
} from './types.js';
import { SettingsRealmRows } from './realm-rows.js';
import {
  changeLocale,
  getCurrentLocale,
  useTranslation,
  type SupportedLocale,
} from '../../i18n/index.js';
import {
  useLabTheme,
  type LabDensityPreference,
  type LabThemePreference,
} from '../../theme.js';

export type SettingsRefreshAction = () => void | Promise<void>;

export type SettingsRouteViewProps = {
  readonly draftPersistence: boolean;
  readonly savingDraftPreference: boolean;
  readonly draftPreferenceError: string | null;
  readonly onDraftPersistenceChange: (value: boolean) => void | Promise<void>;
  readonly notificationProjection: NotificationProjectionState;
  readonly refreshNotificationProjection: SettingsRefreshAction;
  readonly notificationListProjection: NotificationListProjectionState;
  readonly refreshNotificationListProjection: SettingsRefreshAction;
  readonly accountSettingsProjection: AccountSettingsProjectionState;
  readonly refreshAccountSettingsProjection: SettingsRefreshAction;
  readonly humanChatProjection: HumanChatProjectionState;
  readonly refreshHumanChatProjection: SettingsRefreshAction;
};

export function SettingsRouteView(props: SettingsRouteViewProps) {
  const { t } = useTranslation();
  const { preference, setPreference, density, setDensity } = useLabTheme();
  return (
    <div className="lab-workspace-route">
      <div className="mx-auto max-w-3xl">
        <Surface className="grid content-start gap-3" material="glass-thin" tone="panel">
          <h1 className="m-0 text-sm font-semibold text-[var(--nimi-text-primary)]">{t('Settings.title')}</h1>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
            <div>
              <strong className="font-medium text-[var(--nimi-text-primary)]">{t('Settings.appearance')}</strong>
              <p className="m-0">{t('Settings.appearanceHint')}</p>
            </div>
            <SegmentedControl
              size="sm"
              ariaLabel={t('Settings.appearance')}
              value={preference}
              items={[
                { value: 'system', label: t('Settings.appearanceSystem') },
                { value: 'light', label: t('Settings.appearanceLight') },
                { value: 'dark', label: t('Settings.appearanceDark') },
              ]}
              onValueChange={(value) => setPreference(value as LabThemePreference)}
            />
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
            <div>
              <strong className="font-medium text-[var(--nimi-text-primary)]">{t('Settings.density')}</strong>
              <p className="m-0">{t('Settings.densityHint')}</p>
            </div>
            <SegmentedControl
              size="sm"
              ariaLabel={t('Settings.density')}
              value={density}
              items={[
                { value: 'compact', label: t('Settings.densityCompact') },
                { value: 'regular', label: t('Settings.densityRegular') },
              ]}
              onValueChange={(value) => setDensity(value as LabDensityPreference)}
            />
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
            <div>
              <strong className="font-medium text-[var(--nimi-text-primary)]">{t('Settings.localDrafts')}</strong>
              <p className="m-0">{t('Settings.draftPersistenceHint')}</p>
            </div>
            <Toggle
              ariaLabel={t('Settings.localDrafts')}
              checked={props.draftPersistence}
              disabled={props.savingDraftPreference}
              onChange={(enabled) => void props.onDraftPersistenceChange(enabled)}
            />
          </div>
          {props.draftPreferenceError ? <InlineAlert tone="warning">{props.draftPreferenceError}</InlineAlert> : null}
          <label className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
            <span>{t('Common.language')}</span>
            <SelectField
              aria-label={t('Common.language')}
              className="max-w-44"
              value={getCurrentLocale()}
              options={[
                { value: 'en', label: t('Common.languageEnglish') },
                { value: 'zh', label: t('Common.languageChinese') },
              ]}
              onValueChange={(value) => {
                void changeLocale(value as SupportedLocale);
              }}
            />
          </label>
          <SettingsRealmRows {...props} />
        </Surface>
      </div>
    </div>
  );
}
