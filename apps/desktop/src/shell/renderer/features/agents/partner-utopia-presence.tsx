import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@nimiplatform/kit/ui';
import { Compass } from 'lucide-react';
import type { AgentCenterSession } from '@nimiplatform/kit/features/agent-center';
import type { NimiUtopiaSnapshot } from '@nimiplatform/sdk/app';
import { ReasonCode } from '@nimiplatform/sdk/runtime/wire-types';
import { useAppStoreApi, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { captureAccountActionScope } from '../../app-shell/providers/account-action-scope.js';
import { captureHomeNavigationScope } from '../../app-shell/providers/home-navigation.js';
import type { HomeNavigation } from '../../app-shell/providers/home-navigation.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import type { DesktopRendererCommandPort } from '../../renderer/contract.js';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast.js';
import { launchInstalledApp } from '../apps/apps-installed-bridge.js';

const UTOPIA_APP_ID = 'nimi.utopia';
const ACCEPTED_DEV_RUN_STATES = new Set([
  'preparing',
  'building',
  'starting',
  'running',
  'restarting',
]);

function formatSnapshotObservedTime(
  observedAt: NimiUtopiaSnapshot['observedAt'] | undefined,
  locale: string,
): string | null {
  if (!observedAt || typeof observedAt.seconds !== 'string') return null;
  const seconds = Number(observedAt.seconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const nanos = typeof observedAt.nanos === 'number' && Number.isFinite(observedAt.nanos)
    ? observedAt.nanos
    : 0;
  const epochMs = seconds * 1_000 + Math.floor(nanos / 1_000_000);
  try {
    return new Intl.DateTimeFormat(locale || undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(epochMs));
  } catch {
    return null;
  }
}

export type PartnerUtopiaPresenceProjection =
  | Readonly<{
      kind: 'shared';
      habitatTitle: string;
      placeLabel: string;
      activityLabel: string;
      partnerName: string | null;
    }>
  | Readonly<{
      kind: 'interacting';
      habitatTitle: string;
    }>
  | Readonly<{
      kind: 'located';
      habitatTitle: string;
      placeLabel: string;
      activityTitle: string | null;
      solitary: boolean;
    }>
  | Readonly<{
      kind: 'resting';
      habitatTitle: string;
      solitary: boolean;
    }>;

// @nimi-authority: rule.nimi.desktop.product-surfaces.partner-activity-and-use
export function projectPartnerUtopiaPresence(
  snapshot: NimiUtopiaSnapshot,
  agentHandle: string,
): PartnerUtopiaPresenceProjection | null {
  const resident = snapshot.residents.find(item => item.agentHandle === agentHandle);
  if (!resident) return null;
  const habitatTitle = snapshot.habitat.title;

  const activeShared = snapshot.sharedActivities.find(
    item => item.state === 'active'
      && (item.initiatorHandle === agentHandle || item.recipientHandle === agentHandle),
  );
  if (activeShared) {
    const peerHandle = activeShared.initiatorHandle === agentHandle
      ? activeShared.recipientHandle
      : activeShared.initiatorHandle;
    const peer = snapshot.residents.find(item => item.agentHandle === peerHandle);
    return {
      kind: 'shared',
      habitatTitle,
      placeLabel: activeShared.placeLabel,
      activityLabel: activeShared.activityLabel,
      partnerName: peer?.displayName ?? null,
    };
  }

  if (resident.current?.interaction) {
    return { kind: 'interacting', habitatTitle };
  }

  if (resident.current && resident.current.habitatActivationId === snapshot.habitatActivationId && resident.current.placeId) {
    const placeLabel = resident.current.placeLabel
      || (resident.current.placeId === 'personal-quarter'
        ? snapshot.habitat.personalQuarter.name
        : snapshot.habitat.places.find(place => place.id === resident.current?.placeId)?.name)
      || resident.current.placeId;
    const rawTitle = resident.current.title?.trim() ?? '';
    const activityTitle = !rawTitle || rawTitle === 'Activity' ? null : rawTitle;
    return {
      kind: 'located',
      habitatTitle,
      placeLabel,
      activityTitle,
      solitary: resident.solitary,
    };
  }

  return {
    kind: 'resting',
    habitatTitle,
    solitary: resident.solitary,
  };
}

export type OpenUtopiaFromHomeDeps = {
  readonly sdk: Pick<DesktopRendererSdkPort, 'machineProduct'>;
  readonly commands: Pick<
    DesktopRendererCommandPort,
    'listLocalDevelopmentRegistrations' | 'startLocalDevelopmentRegistration'
  >;
  readonly navigation: Pick<HomeNavigation, 'push'>;
  readonly launchInstalled?: typeof launchInstalledApp;
  readonly isCurrent: () => boolean;
};

export type OpenUtopiaFromHomeOutcome =
  | 'launched-dev'
  | 'launched-installed'
  | 'opened-apps'
  | 'opened-apps-ambiguous'
  | 'aborted';

export async function openOrFocusUtopiaFromHome(
  deps: OpenUtopiaFromHomeDeps,
): Promise<OpenUtopiaFromHomeOutcome> {
  if (!deps.isCurrent()) return 'aborted';

  const [devRegistrations, committed] = await Promise.all([
    deps.commands.listLocalDevelopmentRegistrations().catch(() => []),
    deps.sdk.machineProduct().apps.listCommittedAppReleases({}).catch(() => null),
  ]);
  if (!deps.isCurrent()) return 'aborted';

  const devMatches = devRegistrations.filter(item => item.appId === UTOPIA_APP_ID);
  const installedMatches = committed?.reasonCode === ReasonCode.ACTION_EXECUTED
    ? committed.releases.filter(item => item.appId === UTOPIA_APP_ID)
    : [];
  const totalCandidates = devMatches.length + installedMatches.length;

  if (totalCandidates === 0) {
    if (!deps.isCurrent()) return 'aborted';
    await deps.navigation.push({ id: 'apps', appId: UTOPIA_APP_ID });
    return 'opened-apps';
  }

  if (totalCandidates > 1) {
    if (!deps.isCurrent()) return 'aborted';
    await deps.navigation.push({ id: 'apps', appId: UTOPIA_APP_ID });
    return 'opened-apps-ambiguous';
  }

  if (devMatches.length === 1) {
    if (!deps.isCurrent()) return 'aborted';
    const run = await deps.commands.startLocalDevelopmentRegistration(devMatches[0]!.selector);
    if (!ACCEPTED_DEV_RUN_STATES.has(run.state)) {
      throw new Error(run.message || `NimiUtopia development launch failed (${run.state}).`);
    }
    return 'launched-dev';
  }

  if (!deps.isCurrent()) return 'aborted';
  const launch = deps.launchInstalled ?? launchInstalledApp;
  const run = await launch(installedMatches[0]!.launchSelector.slice());
  if (run.state !== 'launching' && run.state !== 'running') {
    throw new Error(run.message || `Installed NimiUtopia launch failed (${run.state}).`);
  }
  return 'launched-installed';
}

export function PartnerUtopiaPresence(props: {
  readonly session: AgentCenterSession;
  readonly agentHandle: string | null | undefined;
  readonly accountId: string;
  readonly scopeKey: string;
}) {
  const { session, agentHandle, accountId, scopeKey } = props;
  const { t, i18n } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const store = useAppStoreApi();
  const navigation = useHomeNavigation();
  const sessionSnapshot = useSyncExternalStore(
    useCallback(listener => session.subscribe(listener), [session]),
    useCallback(() => session.getSnapshot(), [session]),
  );
  const lifeEnabled = sessionSnapshot.state.autonomy.enabled === true;

  const utopiaQuery = useQuery({
    queryKey: ['home-utopia-snapshot', accountId, scopeKey],
    queryFn: () => bindings.sdk.appProduct().utopia.snapshot(),
    enabled: lifeEnabled && Boolean(agentHandle),
    staleTime: 15_000,
    refetchOnWindowFocus: 'always',
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
    retry: false,
  });

  const [launching, setLaunching] = useState(false);
  const busy = useRef(false);

  if (!lifeEnabled || !agentHandle || !utopiaQuery.data) {
    return null;
  }

  const presence = projectPartnerUtopiaPresence(utopiaQuery.data, agentHandle);
  if (!presence) {
    return null;
  }

  const renderDetailText = (): string => {
    switch (presence.kind) {
      case 'shared':
        return presence.partnerName
          ? t('runtimeConfig.partners.utopia.sharedWith', {
              place: presence.placeLabel,
              partner: presence.partnerName,
              activity: presence.activityLabel,
            })
          : t('runtimeConfig.partners.utopia.shared', {
              place: presence.placeLabel,
              activity: presence.activityLabel,
            });
      case 'interacting':
        return t('runtimeConfig.partners.utopia.interacting');
      case 'located': {
        const base = presence.activityTitle
          ? t('runtimeConfig.partners.utopia.locatedActivity', {
              place: presence.placeLabel,
              activity: presence.activityTitle,
            })
          : t('runtimeConfig.partners.utopia.located', { place: presence.placeLabel });
        return presence.solitary
          ? t('runtimeConfig.partners.utopia.solitary', { detail: base })
          : base;
      }
      case 'resting': {
        const base = t('runtimeConfig.partners.utopia.resting');
        return presence.solitary
          ? t('runtimeConfig.partners.utopia.solitary', { detail: base })
          : base;
      }
    }
  };

  const handleVisitUtopia = async () => {
    if (busy.current) return;
    const account = captureAccountActionScope(store);
    if (!account || account.accountId !== accountId) {
      account?.dispose();
      return;
    }
    const position = captureHomeNavigationScope(navigation);
    const isCurrent = () => account.isCurrent() && position.isCurrent();
    busy.current = true;
    setLaunching(true);
    try {
      const outcome = await openOrFocusUtopiaFromHome({
        sdk: bindings.sdk,
        commands: bindings.app.commands,
        navigation,
        isCurrent,
      });
      if (outcome === 'opened-apps' && isCurrent()) {
        emitFeedbackToast({
          kind: 'info',
          message: t('runtimeConfig.partners.utopia.openedApps'),
        });
      } else if (outcome === 'opened-apps-ambiguous' && isCurrent()) {
        emitFeedbackToast({
          kind: 'info',
          message: t('runtimeConfig.partners.utopia.chooseInApps'),
        });
      }
    } catch {
      if (isCurrent()) {
        emitFeedbackToast({
          kind: 'error',
          message: t('runtimeConfig.partners.utopia.launchFailed'),
        });
      }
    } finally {
      account.dispose();
      position.dispose();
      busy.current = false;
      setLaunching(false);
    }
  };

  const observedTime = formatSnapshotObservedTime(utopiaQuery.data.observedAt, i18n.language);

  return (
    <div
      data-testid="partner-utopia-presence"
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-4 py-3"
    >
      <div className="flex min-w-0 items-center gap-3">
        <Compass aria-hidden size={18} className="shrink-0 text-[var(--nimi-action-primary-bg)]" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <p className="truncate text-sm font-medium">
              {t('runtimeConfig.partners.utopia.habitat', { habitat: presence.habitatTitle })}
            </p>
            {observedTime && (
              <span className="text-[11px] text-[var(--nimi-text-secondary)]">
                {t('runtimeConfig.partners.utopia.observedAt', { time: observedTime })}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-[var(--nimi-text-secondary)]">
            {renderDetailText()}
          </p>
          {utopiaQuery.isRefetchError && (
            <p className="mt-1 flex items-center gap-2 text-xs text-[var(--nimi-status-warning)]">
              <span>{t('runtimeConfig.partners.utopia.staleNotice')}</span>
              <button
                type="button"
                className="underline"
                onClick={() => { void utopiaQuery.refetch(); }}
              >
                {t('runtimeConfig.partners.utopia.retryRefresh')}
              </button>
            </p>
          )}
        </div>
      </div>
      <Button
        tone="secondary"
        size="sm"
        loading={launching}
        onClick={() => { void handleVisitUtopia(); }}
      >
        {t('runtimeConfig.partners.utopia.visit')}
      </Button>
    </div>
  );
}
