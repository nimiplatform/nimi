import { MediaImage } from '@nimiplatform/kit/features/media';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { useHomeNavigation } from '../../app-shell/providers/app-store.js';
import type { WorldListItem } from './world-list-model.js';

export type WorldAtlasTopic = { id: string; title: string; titleEn: string; description?: string };

export function WorldAtlasImage({ world, eager = false, purpose = eager ? 'hero' : 'card' }: { world: WorldListItem; eager?: boolean; purpose?: 'card' | 'hero' }) {
  const delivery = purpose === 'hero' ? world.heroMedia ?? world.bannerMedia : world.bannerMedia ?? world.heroMedia;
  return <span className="world-atlas-image" role="img" aria-label={world.name}>
    <MediaImage delivery={delivery} externalUrl={world.bannerUrl} purpose={purpose} sizes={eager ? 'auto' : 'auto, 320px'} alt=""
      className="h-full w-full object-cover" loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : 'auto'} />
  </span>;
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r003
export function WorldAlbumCard({ world, viewKey }: { world: WorldListItem; viewKey?: string }) {
  const { t } = useTranslation();
  const navigation = useHomeNavigation();
  const summary = world.tagline || world.description;
  return <article className="world-album-card" data-testid="world-discovery-card">
    <button data-view-key={viewKey ?? `world:${world.id}`} className="world-album-link" aria-label={t('WorldDetail.discovery.enterNamedWorld', { name: world.name })} onClick={() => void navigation.push({ id: 'world-detail', worldId: world.id })}>
      <WorldAtlasImage world={world} purpose="hero" />
      <div className="world-album-caption"><h2 title={world.name}>{world.name}</h2>
        {summary ? <p>{summary}</p> : null}
      </div>
    </button>
  </article>;
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r003
export function WorldDiscoveryCard({ world }: { world: WorldListItem }) {
  const { t } = useTranslation();
  const navigation = useHomeNavigation();
  return <article className="world-discovery-card" data-testid="world-discovery-card">
    <button className="world-discovery-link" data-view-key={`all:${world.id}`} aria-label={t('WorldDetail.discovery.enterNamedWorld', { name: world.name })} onClick={() => void navigation.push({ id: 'world-detail', worldId: world.id })}>
      <WorldAtlasImage world={world} purpose="hero" />
      <div className="world-discovery-caption">
        <div className="world-discovery-copy"><h3 title={world.name}>{world.name}</h3></div>
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
        <h2 title={world.name}>{world.name}</h2>
        {world.tagline || world.description ? <p className="world-atlas-description">{world.tagline || world.description}</p> : null}
      </button>
      {worlds.length > 1 ? <div className="world-atlas-hero-actions"><div className="world-atlas-arrows"><button aria-label={t('World.album.previous')} onClick={() => setIndex((position + worlds.length - 1) % worlds.length)}><ChevronLeft size={20} /></button><button aria-label={t('World.album.next')} onClick={() => setIndex((position + 1) % worlds.length)}><ChevronRight size={20} /></button></div></div> : null}
    </div>
  </section>;
}
