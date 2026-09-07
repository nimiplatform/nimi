import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppCardActionId } from './apps-card-actions.js';
import { AppArtworkIcon } from './apps-card-visuals.js';
import { AppRowActionButton, AppRunStatusText } from './apps-list-row.js';
import type { DesktopAppsEntry } from './apps-panel-projection.js';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-001a

/**
 * "常用" strip. This is a presentation derivation from owner data, not a
 * separate favorites store: the caller passes running-first / recently-updated
 * entries, and the section is hidden while searching or filtering.
 */
export function FrequentAppsSection({
  entries,
  activeAction,
  onAction,
}: {
  readonly entries: readonly DesktopAppsEntry[];
  readonly activeAction: Readonly<{ entryKey: string; action: AppCardActionId }> | null;
  readonly onAction: (entryKey: string, action: AppCardActionId) => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <section data-testid="apps-frequent-section" aria-label={t('Apps.library.frequentTitle')}>
      <h2 className="px-1 text-base font-semibold leading-6 text-[color:var(--nimi-text-primary)]">
        {t('Apps.library.frequentTitle')}
      </h2>
      <div className="mt-3 grid grid-cols-1 gap-1 rounded-3xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-2 shadow-[var(--nimi-elevation-base)] sm:grid-cols-2 xl:grid-cols-3">
        {entries.map((entry) => (
          <div
            key={entry.identity.entryKey}
            data-testid={`apps-frequent-${entry.identity.entryKey}`}
            className="group relative flex min-w-0 items-center gap-3 rounded-2xl px-3 py-3 transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--nimi-surface-active)_45%,transparent)]"
          >
            <AppArtworkIcon
              appId={entry.identity.appId}
              displayName={entry.identity.displayName}
              iconUrl={entry.iconUrl}
              size="lg"
              className="shadow-[var(--nimi-elevation-base)]"
            />
            <div className="min-w-0 flex-1">
              <button
                type="button"
                data-testid={`apps-frequent-${entry.identity.entryKey}-name`}
                className="block w-full truncate text-left text-sm font-semibold leading-5 text-[color:var(--nimi-text-primary)] outline-none after:absolute after:inset-0 after:content-[''] focus-visible:text-[var(--nimi-action-primary-bg)]"
                onClick={() => onAction(entry.identity.entryKey, 'details')}
              >
                {entry.identity.displayName}
              </button>
              <div className="mt-1">
                {entry.localDevelopment !== null ? <AppRunStatusText entry={entry} /> : null}
              </div>
            </div>
            <div className="relative z-10 shrink-0">
              <AppRowActionButton
                entry={entry}
                activeAction={activeAction && activeAction.entryKey === entry.identity.entryKey ? activeAction.action : null}
                onAction={(action) => onAction(entry.identity.entryKey, action)}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
