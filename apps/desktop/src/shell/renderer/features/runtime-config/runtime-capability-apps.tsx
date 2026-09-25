import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { AppArtworkIcon } from '../apps/apps-card-visuals.js';
import type { DesktopAppsEntry, DesktopAppsPanelProjection } from '../apps/apps-panel-projection.js';
import { useAppsOverview } from '../apps/use-apps-overview.js';

export type CapabilityAppsView = {
  /** One row per App on this device whose declaration names the capability. */
  readonly apps: readonly DesktopAppsEntry[];
  /** Some App facts could not be read, so an App may be missing from the rows. */
  readonly incomplete: boolean;
};

/**
 * Installed and local-development Apps whose declared capability_contract_refs
 * name this capability. A declaration says the App uses the capability; it is
 * never a claim that the App is running or currently using it. Catalog Apps
 * that are not on this device are left out.
 */
export function capabilityApps(
  projection: Extract<DesktopAppsPanelProjection, { status: 'loaded' }>,
  capability: string,
): CapabilityAppsView {
  const byApp = new Map<string, DesktopAppsEntry>();
  let incomplete = projection.runtimeError !== null;
  for (const entry of projection.entries) {
    if (!entry.committedRelease && !entry.localDevelopment) continue;
    const refs = entry.localDevelopment?.capabilityContractRefs ?? entry.appInfo?.capabilityContractRefs;
    if (!refs) {
      incomplete = true;
      continue;
    }
    if (!refs.includes(capability)) continue;
    // An App both installed and registered for development is one row; the installed release names it.
    const current = byApp.get(entry.identity.appId);
    if (!current || (!current.committedRelease && entry.committedRelease)) byApp.set(entry.identity.appId, entry);
  }
  return {
    apps: [...byApp.values()].sort((left, right) => left.identity.displayName.localeCompare(right.identity.displayName)),
    incomplete,
  };
}

/** What the Apps column beside a capability's tab content shows. */
export type CapabilityAppsColumn = 'unavailable' | CapabilityAppsView;

/**
 * The column is left out while the Apps are loading and when no App on this
 * device uses the capability. Unreadable App facts keep it, so unknown never
 * reads as "no App uses this".
 */
export function capabilityAppsColumn(
  overview: {
    readonly isPending: boolean;
    readonly isError: boolean;
    readonly data?: DesktopAppsPanelProjection;
  },
  capability: string,
): CapabilityAppsColumn | null {
  if (overview.isPending) return null;
  if (overview.isError || overview.data?.status !== 'loaded') return 'unavailable';
  const view = capabilityApps(overview.data, capability);
  return view.apps.length || view.incomplete ? view : null;
}

/** The Apps column for the capability shown in the detail; null leaves it out. */
export function useCapabilityAppsColumn(capability: string | null): CapabilityAppsColumn | null {
  // Only a capability detail reads the Apps; the AI Capabilities home does not.
  const overview = useAppsOverview({ enabled: capability !== null });
  return capability ? capabilityAppsColumn(overview, capability) : null;
}

export function RuntimeCapabilityAppsCard(props: {
  readonly state: CapabilityAppsColumn;
  readonly onOpen: (entry: DesktopAppsEntry) => void;
}) {
  const { t } = useTranslation();
  const { state } = props;
  return (
    <section className="rounded-2xl bg-[var(--nimi-surface-card)] p-3" data-testid="capability-apps">
      <h2 className="px-2 pb-2 pt-1 text-sm font-semibold text-[var(--nimi-text-primary)]">
        {t('runtimeConfig.capabilities.apps.title')}
      </h2>
      {state === 'unavailable' ? (
        <p className="px-2 pb-1 text-xs leading-relaxed text-[var(--nimi-text-muted)]">
          {t('runtimeConfig.capabilities.apps.unavailable')}
        </p>
      ) : (
        <>
          {state.apps.length ? (
            // One column beside the tab content; several when the column stacks below it.
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-0.5">
              {state.apps.map((entry) => (
                <li key={entry.identity.appId}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-[var(--nimi-radius-md)] px-2 py-1.5 text-left transition-colors hover:bg-[var(--nimi-surface-active)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
                    title={entry.identity.displayName}
                    onClick={() => props.onOpen(entry)}
                    data-testid={`capability-app:${entry.identity.appId}`}
                  >
                    <AppArtworkIcon
                      appId={entry.identity.appId}
                      displayName={entry.identity.displayName}
                      iconUrl={entry.iconUrl}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--nimi-text-primary)]">
                      {entry.identity.displayName}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {state.incomplete ? (
            <p className="px-2 pb-1 pt-1 text-xs leading-relaxed text-[var(--nimi-text-muted)]">
              {t('runtimeConfig.capabilities.apps.incomplete')}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

/** Apps on this device that use the capability; a row opens that App's detail. */
export function RuntimeCapabilityApps(props: { readonly state: CapabilityAppsColumn }) {
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setAppsDetailAppId = useAppStore((state) => state.setAppsDetailAppId);
  return (
    <RuntimeCapabilityAppsCard
      state={props.state}
      onOpen={(entry) => {
        setAppsDetailAppId(entry.identity.appId, null, entry.identity.entryKey);
        setActiveTab('apps');
      }}
    />
  );
}
