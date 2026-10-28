import { MediaImage } from '@nimiplatform/kit/features/media';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { useHomeNavigation } from '../../app-shell/providers/app-store.js';
import type { WorldListItem } from './world-list-model.js';

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
export function WorldAlbumCard({ world, renderPeople, viewKey }: { world: WorldListItem; renderPeople?: WorldPeopleRenderer; viewKey?: string }) {
  const { t } = useTranslation();
  const navigation = useHomeNavigation();
  return <article className="world-album-card" data-testid="world-discovery-card">
    <button data-view-key={viewKey ?? `world:${world.id}`} className="world-album-link" aria-label={t('WorldDetail.discovery.enterNamedWorld', { name: world.name })} onClick={() => void navigation.push({ id: 'world-detail', worldId: world.id })}>
      <WorldAtlasImage world={world} />
      <div className="world-album-caption"><h2 title={world.name}>{world.name}</h2>
        {renderPeople ? renderPeople(world) : <span className="world-album-count">{t('WorldDetail.discovery.peopleCount', { count: world.characterCount + world.personaCharacterCount })}</span>}
      </div>
    </button>
  </article>;
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r003
export function WorldDiscoveryCard({ world, featured = false }: { world: WorldListItem; featured?: boolean }) {
  const { t } = useTranslation();
  const navigation = useHomeNavigation();
  const summary = world.tagline || world.description;
  return <article className={`world-discovery-card${featured ? ' world-discovery-card-featured' : ''}`} data-testid={featured ? 'world-featured-card' : 'world-discovery-card'}>
    <button className="world-discovery-link" data-view-key={`${featured ? 'featured' : 'all'}:${world.id}`} aria-label={t('WorldDetail.discovery.enterNamedWorld', { name: world.name })} onClick={() => void navigation.push({ id: 'world-detail', worldId: world.id })}>
      <WorldAtlasImage world={world} eager={featured} />
      <div className="world-discovery-caption">
        <div className="world-discovery-copy"><h3 title={world.name}>{world.name}</h3>{summary ? <p>{summary}</p> : null}</div>
        <span className="world-discovery-arrow" aria-hidden="true"><ArrowRight size={18} /></span>
      </div>
    </button>
  </article>;
}

export function WorldAtlasHero({ worlds }: { worlds: WorldListItem[] }) {
  const { t } = useTranslation();
  const navigation = useHomeNavigation();
  const [index, setIndex] = useState(0);
  const position = index % (worlds.length || 1);
  const world = worlds[position];
  if (!world) return null;
  const openWorld = () => void navigation.push({ id: 'world-detail', worldId: world.id });
  const openLabel = t('World.album.showWorld', { name: world.name });
  return <section className="world-atlas-hero" data-world-id={world.id} aria-label={t('World.album.spotlight')} aria-roledescription={t('World.album.carousel')}>
    <div className="world-atlas-hero-art"><button className="world-atlas-hero-open" aria-label={openLabel} onClick={openWorld}><WorldAtlasImage key={world.id} world={world} eager /></button>
      <div className="world-atlas-hero-progress"><span>{String(position + 1).padStart(2, '0')} / {String(worlds.length).padStart(2, '0')}</span>
        <div className="world-atlas-hero-dots">{worlds.map((item, itemIndex) => <button key={item.id} aria-label={t('World.album.showWorld', { name: item.name })} aria-current={position === itemIndex ? 'true' : undefined} onClick={() => setIndex(itemIndex)}><span /></button>)}</div>
      </div>
    </div>
    <div className="world-atlas-hero-copy" aria-live="polite">
      <button className="world-atlas-hero-copy-open" aria-label={openLabel} onClick={openWorld}>
        <span className="world-atlas-kicker">{t('World.album.spotlight')}</span>
        <h2 title={world.name}>{world.name}</h2>
        <p className="world-atlas-meta">{[world.genre, world.era, t('WorldDetail.discovery.peopleCount', { count: world.characterCount + world.personaCharacterCount })].filter(Boolean).join(' · ')}</p>
        <p className="world-atlas-description">{world.tagline || world.description}</p>
      </button>
      {worlds.length > 1 ? <div className="world-atlas-hero-actions"><div className="world-atlas-arrows"><button aria-label={t('World.album.previous')} onClick={() => setIndex((position + worlds.length - 1) % worlds.length)}><ChevronLeft size={20} /></button><button aria-label={t('World.album.next')} onClick={() => setIndex((position + 1) % worlds.length)}><ChevronRight size={20} /></button></div></div> : null}
    </div>
  </section>;
}
