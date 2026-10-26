import { MediaImage } from '@nimiplatform/kit/features/media';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { isMainWorld, type WorldListItem } from './world-list-model.js';

export type WorldAtlasTopic = { id: string; title: string; titleEn: string; description?: string };
export type WorldPeopleRenderer = (world: WorldListItem) => ReactNode;

export function WorldAtlasImage({ world, eager = false }: { world: WorldListItem; eager?: boolean }) {
  const delivery = eager ? world.heroMedia ?? world.bannerMedia : world.bannerMedia ?? world.heroMedia;
  return <span className="world-atlas-image" role="img" aria-label={world.name}>
    <MediaImage delivery={delivery} externalUrl={world.bannerUrl} purpose={eager ? 'hero' : 'card'} sizes={eager ? 'auto' : 'auto, 320px'} alt=""
      className="h-full w-full object-cover" loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : 'auto'} />
  </span>;
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r003
export function WorldAlbumCard({ world, renderPeople }: { world: WorldListItem; renderPeople?: WorldPeopleRenderer }) {
  const { t } = useTranslation();
  const navigation = useHomeNavigation();
  return <article className="world-album-card" data-testid="world-discovery-card">
    <button className="world-album-link" aria-label={t('WorldDetail.discovery.enterNamedWorld', { name: world.name })} onClick={() => void navigation.push({ id: 'world-detail', worldId: world.id })}>
      <WorldAtlasImage world={world} />
      <div className="world-album-caption"><h2 title={world.name}>{world.name}</h2>
        {renderPeople ? renderPeople(world) : <span className="world-album-count">{t('WorldDetail.discovery.peopleCount', { count: world.characterCount + world.personaCharacterCount })}</span>}
      </div>
    </button>
  </article>;
}

export function WorldAtlasHero({ worlds }: { worlds: WorldListItem[] }) {
  const { t } = useTranslation();
  const navigation = useHomeNavigation();
  const candidates = worlds.filter((world) => !isMainWorld(world) && (world.heroMedia || world.bannerMedia || world.bannerUrl)).slice(0, 5);
  const [index, setIndex] = useState(0);
  const position = index % (candidates.length || 1);
  const world = candidates[position];
  if (!world) return null;
  const openWorld = () => void navigation.push({ id: 'world-detail', worldId: world.id });
  const openLabel = t('World.album.showWorld', { name: world.name });
  return <section className="world-atlas-hero" aria-label={t('World.album.spotlight')} aria-roledescription={t('World.album.carousel')}>
    <div className="world-atlas-hero-art"><button className="world-atlas-hero-open" aria-label={openLabel} onClick={openWorld}><WorldAtlasImage key={world.id} world={world} eager /></button>
      <div className="world-atlas-hero-progress"><span>{String(position + 1).padStart(2, '0')} / {String(candidates.length).padStart(2, '0')}</span>
        <div className="world-atlas-hero-dots">{candidates.map((item, itemIndex) => <button key={item.id} aria-label={t('World.album.showWorld', { name: item.name })} aria-current={position === itemIndex ? 'true' : undefined} onClick={() => setIndex(itemIndex)}><span /></button>)}</div>
      </div>
    </div>
    <div className="world-atlas-hero-copy" aria-live="polite">
      <button className="world-atlas-hero-copy-open" aria-label={openLabel} onClick={openWorld}>
        <span className="world-atlas-kicker">{t('World.album.spotlight')}</span>
        <h2 title={world.name}>{world.name}</h2>
        <p className="world-atlas-meta">{[world.genre, world.era, t('WorldDetail.discovery.peopleCount', { count: world.characterCount + world.personaCharacterCount })].filter(Boolean).join(' · ')}</p>
        <p className="world-atlas-description">{world.tagline || world.description}</p>
      </button>
      {candidates.length > 1 ? <div className="world-atlas-hero-actions"><div className="world-atlas-arrows"><button aria-label={t('World.album.previous')} onClick={() => setIndex((position + candidates.length - 1) % candidates.length)}><ChevronLeft size={20} /></button><button aria-label={t('World.album.next')} onClick={() => setIndex((position + 1) % candidates.length)}><ChevronRight size={20} /></button></div></div> : null}
    </div>
  </section>;
}

export function WorldTopicShelf({ topic, worlds, onSelect, renderPeople }: { topic: WorldAtlasTopic; worlds: WorldListItem[]; onSelect: () => void; renderPeople?: WorldPeopleRenderer }) {
  const { t, i18n } = useTranslation();
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const title = i18n.language.startsWith('zh') ? topic.title : topic.titleEn;
  const updateEdges = () => { const node = track.current; if (node) setEdges({ start: node.scrollLeft < 2, end: node.scrollLeft + node.clientWidth >= node.scrollWidth - 2 }); };
  useEffect(() => {
    updateEdges();
    const node = track.current;
    if (!node) return;
    const observer = new ResizeObserver(updateEdges);
    observer.observe(node);
    return () => observer.disconnect();
  }, [worlds]);
  return <section className="world-atlas-section" aria-label={title}>
    <div className="world-atlas-section-heading"><div><h2>{title}</h2></div><button onClick={onSelect}>{t('World.album.viewAll')}</button></div>
    <div className="world-atlas-shelf"><div className="world-atlas-track" ref={track} onScroll={updateEdges}>
      {worlds.map((world) => <WorldAlbumCard key={world.id} world={world} renderPeople={renderPeople} />)}
    </div>{worlds.length > 1 ? <div className="world-atlas-shelf-controls"><button disabled={edges.start} aria-label={t('World.album.previousTopic', { topic: title })} onClick={() => track.current?.scrollBy({ left: -track.current.clientWidth })}><ChevronLeft size={18} /></button><button aria-label={t('World.album.nextTopic', { topic: title })} disabled={edges.end} onClick={() => track.current?.scrollBy({ left: track.current.clientWidth })}><ChevronRight size={18} /></button></div> : null}</div>
  </section>;
}
