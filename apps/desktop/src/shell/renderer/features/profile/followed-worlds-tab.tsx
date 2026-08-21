import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../../app-shell/providers/app-store';
import { CompactWorldCard } from '../world/world-list-compact-card';
import { useFollowedWorlds } from '../world/world-follow-store-context.js';
import {
  fetchWorldListItems,
  worldListQueryKey,
} from '../world/world-detail-queries';
import { ProfileDetailTabFallback } from '../relationship/profile-detail-view-content-shell.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { createRealmWorldData } from '../world/data/realm-world-data.js';

/**
 * Own-profile tab listing the worlds the signed-in user follows.
 *
 * Followed worlds are an account-scoped local projection (see
 * `world-follow-store`), so this surface only resolves for the current user;
 * it is not rendered on other people's profiles.
 */
export function FollowedWorldsTab() {
  const sdk = useDesktopRendererSdk();
  const { t } = useTranslation();
  const authStatus = useAppStore((state) => state.auth.status);
  const navigateToWorld = useAppStore((state) => state.navigateToWorld);
  const followed = useFollowedWorlds();

  const worldsQuery = useQuery({
    queryKey: worldListQueryKey(),
    queryFn: async () => fetchWorldListItems(createRealmWorldData(sdk)),
    enabled: authStatus === 'authenticated' && followed.ids.length > 0,
    staleTime: 30_000,
  });

  const followedWorlds = useMemo(() => {
    const items = worldsQuery.data ?? [];
    const byId = new Map(items.map((world) => [world.id, world]));
    return followed.ids
      .map((id) => byId.get(id))
      .filter((world): world is NonNullable<typeof world> => Boolean(world));
  }, [worldsQuery.data, followed.ids]);

  if (followed.ids.length === 0) {
    return (
      <div
        data-testid="profile-followed-worlds-empty"
        className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_50%,transparent)] px-6 py-12 text-center"
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-[var(--nimi-text-muted)]">
          <path d="M19.5 12.572 12 20l-7.5-7.428A5 5 0 1 1 12 6.006a5 5 0 1 1 7.5 6.566z" />
        </svg>
        <div className="text-[15px] font-semibold text-[var(--nimi-text-primary)]">{t('Profile.followedWorldsEmptyTitle')}</div>
        <div className="max-w-[360px] text-[12.5px] leading-relaxed text-[var(--nimi-text-secondary)]">{t('Profile.followedWorldsEmptyBody')}</div>
        {followed.error ? (
          <div className="text-xs font-medium text-[var(--nimi-status-danger)]">{t('World.atlas.followed.error')}</div>
        ) : null}
      </div>
    );
  }

  if (worldsQuery.isPending) {
    return <ProfileDetailTabFallback />;
  }

  if (worldsQuery.isError) {
    return (
      <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_50%,transparent)] px-6 py-10 text-center text-sm font-medium text-[var(--nimi-status-danger)]">
        {t('Profile.followedWorldsLoadError')}
      </div>
    );
  }

  return (
    <div
      data-testid="profile-followed-worlds-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
        gap: 12,
      }}
    >
      {followedWorlds.map((world) => (
        <CompactWorldCard
          key={world.id}
          world={world}
          view="grid"
          onOpen={() => navigateToWorld(world.id)}
          followed={followed.isFollowed(world.id)}
          followAvailable={followed.available}
          onToggleFollow={() => followed.toggle(world.id)}
        />
      ))}
    </div>
  );
}
