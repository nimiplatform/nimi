import { MediaImage } from '@nimiplatform/kit/features/media';
import { useEffect, useRef, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { RealmWorldData } from './data/realm-world-data.js';
import { fetchWorldListItem, worldListItemQueryKey, WORLD_CATALOG_CONTRACT_VERSION } from './world-detail-queries.js';
import type { WorldListItem } from './world-list-model.js';
import { WORLD_ATLAS_LEAD_WORLD_IDS } from './world-list-catalog-model.js';

export type WorldAtlasSource = { data: RealmWorldData; realmBaseUrl: string; enabled: boolean; offline: boolean };

// Spotlight entries must be available before their catalog page is loaded.
export function useWorldAtlasLeadWorlds(source: WorldAtlasSource) {
  const queries = useQueries({ queries: WORLD_ATLAS_LEAD_WORLD_IDS.map((worldId) => ({
    queryKey: worldListItemQueryKey(source.realmBaseUrl, worldId),
    queryFn: () => fetchWorldListItem(source.data, worldId),
    enabled: source.enabled && !source.offline,
    staleTime: 60_000,
    retry: false,
  })) });
  const loading = source.enabled && !source.offline && queries.some((query) => query.isPending && !query.isPaused);
  return {
    worlds: queries.flatMap((query) => query.data ? [query.data] : []),
    loading,
    error: source.enabled && !loading && queries.some((query) => !query.data),
    retry: () => { for (const query of queries) void query.refetch(); },
  };
}

export async function loadWorldAtlasPeople(data: RealmWorldData, world: WorldListItem) {
  const characters = world.characterCount > 0 ? (await data.loadWorldCharacterPage(world.id, { limit: 3 })).items : [];
  const personas = characters.length < 3 && world.personaCharacterCount > 0
    ? (await data.loadPersonaCharacterCatalogPage({ worldId: world.id, limit: 3 - characters.length })).items : [];
  return [...characters, ...personas].slice(0, 3);
}

export function WorldAtlasPeople({ world, source }: { world: WorldListItem; source: WorldAtlasSource }) {
  const { t } = useTranslation();
  const anchor = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = anchor.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) { setVisible(true); observer.disconnect(); } });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const people = useQuery({
    queryKey: ['world-atlas-people', WORLD_CATALOG_CONTRACT_VERSION, source.realmBaseUrl, world.id, world.characterCount, world.personaCharacterCount],
    queryFn: () => loadWorldAtlasPeople(source.data, world),
    enabled: source.enabled && !source.offline && visible && world.characterCount + world.personaCharacterCount > 0,
    staleTime: 60_000,
    retry: false,
  });
  const count = world.characterCount + world.personaCharacterCount;
  return <span ref={anchor} className="world-atlas-people" aria-label={t('WorldDetail.discovery.peopleCount', { count })} title={t('WorldDetail.discovery.peopleCount', { count })}>
    {people.data?.length ? <>{people.data.map((person) => <span key={`${person.sourceKind}:${person.id}`} className="world-atlas-avatar" title={person.name}><span>{person.name.slice(0, 1)}</span><MediaImage delivery={person.avatarMedia} externalUrl={person.avatarUrl} purpose="avatar" sizes="20px" alt={person.name} className="h-full w-full object-cover" /></span>)}{count > people.data.length ? <span className="world-atlas-remainder">+{count - people.data.length}</span> : null}</> : <span className="world-album-count">{t('WorldDetail.discovery.peopleCount', { count })}</span>}
  </span>;
}
