import { useEffect, useRef, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, LoadingSkeleton } from '@nimiplatform/kit/ui';
import { isRealmOfflineErrorLike } from '@nimiplatform/sdk/types';
import type { RealmWorldData } from './data/realm-world-data.js';
import { WORLD_CATALOG_CONTRACT_VERSION } from './world-detail-queries.js';
import { toWorldListItem, type WorldListItem } from './world-list-model.js';
import { WorldTopicShelf, type WorldAtlasTopic, type WorldPeopleRenderer } from './world-atlas.js';

export type WorldAtlasSource = { data: RealmWorldData; realmBaseUrl: string; enabled: boolean; offline: boolean };

// Shelves query the canonical topic membership on Realm, never infer it from text or images.
export function WorldAtlasTopics({ topics, source, onSelect, renderPeople }: { topics: readonly WorldAtlasTopic[]; source: WorldAtlasSource; onSelect: (id: string) => void; renderPeople: WorldPeopleRenderer }) {
  const { t } = useTranslation();
  const results = useQueries({ queries: topics.map((topic) => ({
    queryKey: ['world-topic-preview', WORLD_CATALOG_CONTRACT_VERSION, source.realmBaseUrl, topic.id, 8],
    queryFn: async () => {
      const page = await source.data.loadWorldCatalogPage({ topicId: topic.id, limit: 8 });
      return { ...page, items: page.items.map(toWorldListItem) };
    },
    enabled: source.enabled && !source.offline,
    staleTime: 60_000,
    retry: false,
  })) });
  const pending = results.some((result) => result.isPending);
  const failed = results.some((result) => result.isError);
  const offline = source.offline || results.some((result) => result.isPaused || isRealmOfflineErrorLike(result.error));
  const hasWorlds = results.some((result) => result.data?.items.length);
  return <div className="world-atlas-topics">
    {results.map((result, index) => (
      result.data?.items.length ? (
        <WorldTopicShelf key={topics[index]!.id} topic={topics[index]!} worlds={result.data.items} onSelect={() => onSelect(topics[index]!.id)} renderPeople={renderPeople} />
      ) : null
    ))}
    {offline ? <p className="world-atlas-notice">{t('World.album.topicsOffline')}</p> : pending ? <LoadingSkeleton lines={2} label={t('World.loading')} /> : failed ? <div className="world-atlas-notice" role="status">{t('World.album.topicsError')} <Button tone="ghost" size="sm" onClick={() => results.forEach((result) => { if (result.isError) void result.refetch(); })}>{t('NotificationPanel.refresh')}</Button></div> : !hasWorlds && topics.length ? <p className="world-atlas-notice">{t('World.album.topicsEmpty')}</p> : null}
  </div>;
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
    {people.data?.length ? <>{people.data.map((person) => <span key={`${person.sourceKind}:${person.id}`} className="world-atlas-avatar" title={person.name}><span>{person.name.slice(0, 1)}</span>{person.avatarUrl ? <img key={person.avatarUrl} src={person.avatarUrl} alt={person.name} loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : null}</span>)}{count > people.data.length ? <span className="world-atlas-remainder">+{count - people.data.length}</span> : null}</> : <span className="world-album-count">{t('WorldDetail.discovery.peopleCount', { count })}</span>}
  </span>;
}
