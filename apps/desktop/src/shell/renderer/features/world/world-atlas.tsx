import { MediaImage } from '@nimiplatform/kit/features/media';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, ChevronLeft, ChevronRight, Globe2, UsersRound } from 'lucide-react';
import { useHomeNavigation } from '../../app-shell/providers/app-store.js';
import type { WorldListItem } from './world-list-model.js';
import { observeDiscoveryCover } from './world-cover-viewport.js';

export type WorldAtlasTopic = { id: string; title: string; titleEn: string; description?: string };

function resolveTopicLabels(
  world: Pick<WorldListItem, 'topicIds'>,
  topics: readonly WorldAtlasTopic[],
  isZh: boolean,
  limit = 2,
): string[] {
  if (!world.topicIds?.length || !topics.length) return [];
  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  const labels: string[] = [];
  for (const id of world.topicIds) {
    const topic = byId.get(id);
    if (!topic) continue;
    labels.push(isZh ? topic.title : topic.titleEn);
    if (labels.length >= limit) break;
  }
  return labels;
}

export function WorldAtlasImage({ world, eager = false, prioritizeVisible = false, purpose = eager ? 'hero' : 'card' }: {
  world: WorldListItem; eager?: boolean; prioritizeVisible?: boolean; purpose?: 'card' | 'hero';
}) {
  const cover = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState<boolean | null>(null);
  const delivery = purpose === 'hero' ? world.heroMedia ?? world.bannerMedia : world.bannerMedia ?? world.heroMedia;
  const hasArtwork = Boolean(delivery || world.bannerUrl);
  useLayoutEffect(() => {
    if (!prioritizeVisible || !cover.current) return;
    return observeDiscoveryCover(cover.current, next => {
      setVisible(previous => next === null ? (previous === null ? null : false) : next);
    });
  }, [prioritizeVisible, hasArtwork]);
  const priority = eager || visible ? 'high' : prioritizeVisible ? 'low' : 'auto';
  if (!hasArtwork) return <span className="world-atlas-image world-atlas-empty-art" aria-hidden="true"><Globe2 size={32} strokeWidth={1.25} /></span>;
  return <span ref={cover} className="world-atlas-image" role="img" aria-label={world.name}>
    {(!prioritizeVisible || visible !== null) && <MediaImage delivery={delivery} externalUrl={world.bannerUrl} purpose={purpose} sizes={eager ? 'auto' : 'auto, 320px'} alt=""
      className="h-full w-full object-cover" loading={eager || prioritizeVisible ? 'eager' : 'lazy'} fetchPriority={priority} />}
  </span>;
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r003
export function WorldAlbumCard({ world, viewKey, topics = [] }: {
  world: WorldListItem; viewKey?: string; topics?: readonly WorldAtlasTopic[];
}) {
  const { t, i18n } = useTranslation();
  const navigation = useHomeNavigation();
  const summary = world.tagline || world.description;
  const topicLabels = resolveTopicLabels(world, topics, i18n.language.startsWith('zh'), 2);
  const totalSources = world.characterCount + world.personaCharacterCount;
  return <article className="world-album-card" data-testid="world-discovery-card">
    <button data-view-key={viewKey ?? `world:${world.id}`} className="world-album-link" aria-label={t('WorldDetail.discovery.enterNamedWorld', { name: world.name })} onClick={() => void navigation.push({ id: 'world-detail', worldId: world.id })}>
      <WorldAtlasImage world={world} purpose="hero" />
      <div className="world-album-caption">
        {topicLabels.length > 0 || totalSources > 0 ? <div className="world-card-meta">
          {topicLabels.map((label) => <span key={label} className="world-card-topic-pill">{label}</span>)}
          {totalSources > 0 ? <span className="world-card-stat"><UsersRound size={12} aria-hidden />{t('World.atlas.sourceCount', { value: totalSources })}</span> : null}
        </div> : null}
        <h2 title={world.name}>{world.name}</h2>
        {summary ? <p>{summary}</p> : null}
      </div>
    </button>
  </article>;
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r003
export function WorldDiscoveryCard({ world, topics = [] }: {
  world: WorldListItem; topics?: readonly WorldAtlasTopic[];
}) {
  const { t, i18n } = useTranslation();
  const navigation = useHomeNavigation();
  const summary = world.tagline || world.description;
  const topicLabels = resolveTopicLabels(world, topics, i18n.language.startsWith('zh'), 2);
  const totalSources = world.characterCount + world.personaCharacterCount;
  return <article className="world-discovery-card" data-testid="world-discovery-card">
    <button className="world-discovery-link" data-view-key={`all:${world.id}`} aria-label={t('WorldDetail.discovery.enterNamedWorld', { name: world.name })} onClick={() => void navigation.push({ id: 'world-detail', worldId: world.id })}>
      <WorldAtlasImage world={world} purpose="hero" prioritizeVisible />
      <div className="world-discovery-caption">
        <div className="world-discovery-copy">
          {topicLabels.length > 0 || totalSources > 0 ? <div className="world-card-meta">
            {topicLabels.map((label) => <span key={label} className="world-card-topic-pill">{label}</span>)}
            {totalSources > 0 ? <span className="world-card-stat"><UsersRound size={12} aria-hidden />{t('World.atlas.sourceCount', { value: totalSources })}</span> : null}
          </div> : null}
          <h3 title={world.name}>{world.name}</h3>
          {summary ? <p className="world-discovery-summary">{summary}</p> : null}
        </div>
        <span className="world-discovery-arrow" aria-hidden="true"><ArrowRight size={18} /></span>
      </div>
    </button>
  </article>;
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r003
export function WorldAtlasHero({ worlds, topics = [] }: {
  worlds: WorldListItem[]; topics?: readonly WorldAtlasTopic[];
}) {
  const { t, i18n } = useTranslation();
  const navigation = useHomeNavigation();
  const [activeWorldId, setActiveWorldId] = useState<string | null>(() => worlds[0]?.id ?? null);
  const position = Math.max(0, worlds.findIndex((world) => world.id === activeWorldId));
  const world = worlds[position];
  useEffect(() => {
    if (world && world.id !== activeWorldId) {
      setActiveWorldId(world.id);
    }
  }, [world, activeWorldId]);
  if (!world) return null;
  const openWorld = () => void navigation.push({ id: 'world-detail', worldId: world.id });
  const openLabel = t('World.album.showWorld', { name: world.name });
  const topicLabels = resolveTopicLabels(world, topics, i18n.language.startsWith('zh'), 2);
  const totalSources = world.characterCount + world.personaCharacterCount;
  return <section className="world-atlas-hero" data-world-id={world.id} aria-label={t('World.album.spotlight')} aria-roledescription={t('World.album.carousel')}>
    <div className="world-atlas-hero-art"><button className="world-atlas-hero-open" aria-label={openLabel} onClick={openWorld}><WorldAtlasImage key={world.id} world={world} eager /></button>
      <div className="world-atlas-hero-progress"><span>{String(position + 1).padStart(2, '0')} / {String(worlds.length).padStart(2, '0')}</span>
        <div className="world-atlas-hero-dots">{worlds.map((item, itemIndex) => <button key={item.id} aria-label={t('World.album.showWorld', { name: item.name })} aria-current={position === itemIndex ? 'true' : undefined} onClick={() => setActiveWorldId(item.id)}><span /></button>)}</div>
      </div>
    </div>
    <div className="world-atlas-hero-copy" aria-live="polite">
      <button className="world-atlas-hero-copy-open" aria-label={openLabel} onClick={openWorld}>
        {topicLabels.length > 0 || totalSources > 0 ? <div className="world-atlas-hero-meta">
          {topicLabels.map((label) => <span key={label} className="world-card-topic-pill">{label}</span>)}
          {totalSources > 0 ? <span className="world-card-stat"><UsersRound size={13} aria-hidden />{t('World.atlas.sourceCount', { value: totalSources })}</span> : null}
        </div> : null}
        <h2 title={world.name}>{world.name}</h2>
        {world.tagline || world.description ? <p className="world-atlas-description">{world.tagline || world.description}</p> : null}
      </button>
      <div className="world-atlas-hero-actions">
        <button type="button" className="world-atlas-hero-cta" onClick={openWorld} data-testid="world-atlas-hero-cta">
          <span>{t('WorldDetail.discovery.enterWorld')}</span>
          <ArrowRight size={16} aria-hidden />
        </button>
        {worlds.length > 1 ? <div className="world-atlas-arrows"><button aria-label={t('World.album.previous')} onClick={() => setActiveWorldId(worlds[(position + worlds.length - 1) % worlds.length]!.id)}><ChevronLeft size={20} /></button><button aria-label={t('World.album.next')} onClick={() => setActiveWorldId(worlds[(position + 1) % worlds.length]!.id)}><ChevronRight size={20} /></button></div> : null}
      </div>
    </div>
  </section>;
}
