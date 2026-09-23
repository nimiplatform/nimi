import { InlineAlert } from '@nimiplatform/kit/ui';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { activitySourceLabel, mergeActivitySnapshots } from '../home/home-app-activity-model.js';
import { useHomeAppActivity } from '../home/home-app-activity.js';
import {
  hasHiddenMessages,
  useHomeMessagePreferences,
  type HomeMessagePreferencesController,
  type HomeMessagePreferencesStorage,
} from '../home/home-messages-preferences.js';
import { Button, Card, Section, ToggleRow } from './settings-layout-components.js';

export type HomeMessageAppSource = Readonly<{
  sourceRef: string;
  label: string;
  available: boolean;
}>;

export type HomeMessageAppSourcesStatus = 'loading' | 'ready' | 'unavailable';

// @nimi-authority: rule.nimi.desktop.product-surfaces.r037
/**
 * Settings > Notifications > Home messages. Saved and reported apart from the
 * Realm notification form; it only changes what the Home preview shows.
 */
export function HomeMessagesSettingsSection() {
  const authUser = useAppStore((state) => state.auth.user);
  const authStatus = useAppStore((state) => state.auth.status);
  const accountKey = (authStatus === 'authenticated' || authStatus === 'refresh-pending') && authUser?.id
    ? String(authUser.id)
    : null;
  // Preferences and sources belong to one account; another account remounts them.
  return accountKey ? <HomeMessagesSettingsContent key={accountKey} /> : null;
}

function HomeMessagesSettingsContent() {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const storage = useMemo<HomeMessagePreferencesStorage>(() => ({
    readJson: (relativePath) => sdk.appProduct().storage.readJson(relativePath),
    writeJson: (relativePath, value) => sdk.appProduct().storage.writeJson(relativePath, value),
  }), [sdk]);
  const preferences = useHomeMessagePreferences(storage);
  // Sources come from the same public activity read Home uses, not from an
  // App or permission directory, so Settings works without Home mounted.
  const app = useHomeAppActivity();
  const unknownSource = t('runtimeConfig.overview.appActivity.unknownSource');
  const sources = useMemo(() => {
    const bySourceRef = new Map<string, HomeMessageAppSource>();
    for (const record of mergeActivitySnapshots(app.pending, app.recent)) {
      if (record.source.kind !== 'app' || bySourceRef.has(record.source.sourceRef)) continue;
      bySourceRef.set(record.source.sourceRef, {
        sourceRef: record.source.sourceRef,
        label: activitySourceLabel(record) ?? unknownSource,
        available: record.source.available,
      });
    }
    return [...bySourceRef.values()].sort((left, right) => (
      left.label.localeCompare(right.label) || left.sourceRef.localeCompare(right.sourceRef)
    ));
  }, [app.pending, app.recent, unknownSource]);
  const sourcesStatus: HomeMessageAppSourcesStatus = app.pending.status === 'unavailable' || app.recent.status === 'unavailable'
    ? 'unavailable'
    : app.recent.status === 'loading' && !app.recent.records.length
      ? 'loading'
      : 'ready';
  return (
    <HomeMessagesSettingsView
      preferences={preferences}
      sources={sources}
      sourcesStatus={sourcesStatus}
      sourcesComplete={app.recent.complete}
      hasMoreSources={app.recent.hasMore && app.recent.status === 'ready'}
      onLoadMoreSources={() => app.loadMore('recent')}
      onRetrySources={app.retry}
    />
  );
}

export function HomeMessagesSettingsView({ preferences, sources, sourcesStatus, sourcesComplete, hasMoreSources, onLoadMoreSources, onRetrySources }: {
  preferences: HomeMessagePreferencesController;
  sources: readonly HomeMessageAppSource[];
  sourcesStatus: HomeMessageAppSourcesStatus;
  sourcesComplete: boolean;
  hasMoreSources: boolean;
  onLoadMoreSources: () => void;
  onRetrySources: () => void;
}) {
  const { t } = useTranslation();
  const ready = preferences.state.status === 'ready' ? preferences.state.preferences : null;
  const disabled = !ready || preferences.saving;
  return (
    <Section title={t('Notifications.homeMessages.title')} description={t('Notifications.homeMessages.description')}>
      <Card>
        <div className="flex flex-col gap-2" data-testid="settings-home-messages">
          {preferences.state.status === 'loading' ? (
            <p className="py-1 text-sm text-[var(--nimi-text-secondary)]">{t('Notifications.homeMessages.loading')}</p>
          ) : null}
          {preferences.state.status === 'unavailable' ? (
            <InlineAlert
              tone="warning"
              data-testid="settings-home-messages-read-failed"
              action={<Button variant="ghost" size="sm" onClick={preferences.reload}>{t('Notifications.homeMessages.reload')}</Button>}
            >
              {t('Notifications.homeMessages.readFailed')}
            </InlineAlert>
          ) : null}
          {sourcesStatus === 'loading' ? (
            <p className="py-1 text-sm text-[var(--nimi-text-secondary)]">{t('Notifications.homeMessages.sourcesLoading')}</p>
          ) : null}
          {sourcesStatus === 'unavailable' ? (
            <InlineAlert
              tone="warning"
              action={<Button variant="ghost" size="sm" onClick={onRetrySources}>{t('Notifications.homeMessages.retry')}</Button>}
            >
              {t('Notifications.homeMessages.sourcesUnavailable')}
            </InlineAlert>
          ) : null}
          <div className="divide-y divide-[var(--nimi-border-subtle)]">
            {sources.map((source) => (
              <ToggleRow
                key={source.sourceRef}
                title={source.label}
                description={source.available
                  ? t('Notifications.homeMessages.appSourceDescription')
                  : t('Notifications.homeMessages.appSourceUnavailableDescription')}
                checked={ready ? !ready.appSourcesOffHome.includes(source.sourceRef) : true}
                disabled={disabled}
                onChange={(onHome) => void preferences.apply({ kind: 'app-source', sourceRef: source.sourceRef, onHome })}
              />
            ))}
            {sourcesStatus === 'ready' && sourcesComplete && !sources.length ? (
              <p className="py-3 text-sm text-[var(--nimi-text-secondary)]">{t('Notifications.homeMessages.noSources')}</p>
            ) : null}
            {sourcesStatus === 'ready' && !sourcesComplete ? (
              <div className="flex flex-wrap items-center gap-3 py-3">
                <p className="text-sm text-[var(--nimi-text-secondary)]">{t('Notifications.homeMessages.sourcesIncomplete')}</p>
                {hasMoreSources ? (
                  <Button variant="ghost" size="sm" onClick={onLoadMoreSources}>{t('Notifications.homeMessages.loadMoreSources')}</Button>
                ) : null}
              </div>
            ) : null}
            <ToggleRow
              title={t('Notifications.homeMessages.realmPosts')}
              description={t('Notifications.homeMessages.realmPostsDescription')}
              checked={ready?.realmPostsOnHome ?? true}
              disabled={disabled}
              onChange={(onHome) => void preferences.apply({ kind: 'realm-posts', onHome })}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled || !ready || !hasHiddenMessages(ready)}
              onClick={() => void preferences.apply({ kind: 'restore-hidden' })}
            >
              {t('Notifications.homeMessages.restoreHidden')}
            </Button>
            {ready && !hasHiddenMessages(ready) ? (
              <span className="text-xs text-[var(--nimi-text-muted)]">{t('Notifications.homeMessages.restoreHiddenNone')}</span>
            ) : null}
            {preferences.saving ? (
              <span role="status" className="text-xs text-[var(--nimi-text-secondary)]">{t('Notifications.homeMessages.saving')}</span>
            ) : null}
          </div>
          {preferences.saveFailed ? (
            <InlineAlert
              tone="warning"
              data-testid="settings-home-messages-save-failed"
              action={<Button variant="ghost" size="sm" onClick={preferences.retrySave}>{t('Notifications.homeMessages.retry')}</Button>}
            >
              {t('Notifications.homeMessages.saveFailed')}
            </InlineAlert>
          ) : null}
        </div>
      </Card>
    </Section>
  );
}
