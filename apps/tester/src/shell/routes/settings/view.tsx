import { ProgressIndicator, SelectField, Surface, Toggle } from '@nimiplatform/kit/ui';
import type {
  AccountDataProjectionState,
  AccountSettingsProjectionState,
  GroupChatProjectionState,
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

export type SettingsRefreshAction = () => void | Promise<void>;

export type SettingsRouteViewProps = {
  readonly localDrafts: boolean;
  readonly setLocalDrafts: (value: boolean) => void;
  readonly notificationProjection: NotificationProjectionState;
  readonly refreshNotificationProjection: SettingsRefreshAction;
  readonly notificationListProjection: NotificationListProjectionState;
  readonly refreshNotificationListProjection: SettingsRefreshAction;
  readonly accountDataProjection: AccountDataProjectionState;
  readonly requestAccountDataExportProjection: SettingsRefreshAction;
  readonly accountSettingsProjection: AccountSettingsProjectionState;
  readonly refreshAccountSettingsProjection: SettingsRefreshAction;
  readonly humanChatProjection: HumanChatProjectionState;
  readonly refreshHumanChatProjection: SettingsRefreshAction;
  readonly groupChatProjection: GroupChatProjectionState;
  readonly refreshGroupChatProjection: SettingsRefreshAction;
};

export function SettingsRouteView(props: SettingsRouteViewProps) {
  const { t } = useTranslation();
  return (
    <Surface className="grid gap-3" material="glass-thin" tone="panel">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <h2 className="m-0 text-sm font-semibold tracking-normal text-[var(--nimi-text-primary)]">{t('Settings.title')}</h2>
        <ProgressIndicator value={props.localDrafts ? 72 : 46} showValue />
      </div>
      <label className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>{t('Settings.localDrafts')}</span>
        <Toggle checked={props.localDrafts} onChange={props.setLocalDrafts} />
      </label>
      <label className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>{t('Common.language')}</span>
        <SelectField
          aria-label={t('Common.language')}
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
  );
}
