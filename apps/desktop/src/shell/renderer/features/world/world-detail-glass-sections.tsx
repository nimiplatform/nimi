import { useTranslation } from 'react-i18next';
import type { WorldCharacter, WorldDetailData } from './world-detail-types.js';
import { detailHeroBackground, worldSummary } from './world-detail-template-model';
import { GLASS_STRONG_STYLE, GLASS_STRONG_SURFACE_CLASS, GlassButton, IconArrowLeft, IconDots, IconShare, Seal } from './world-detail-glass-primitives';
import { worldInitial } from './world-list-atoms';

function IconFollow({ filled = false }: { filled?: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19.5 12.572 12 20l-7.5-7.428A5 5 0 1 1 12 6.006a5 5 0 1 1 7.5 6.566z" />
    </svg>
  );
}

export function DetailHero({
  world,
  onBack,
  onScrollTo,
  onFollowWorld,
  worldFollowed = false,
}: {
  world: WorldDetailData;
  characters: readonly WorldCharacter[];
  onBack?: () => void;
  onScrollTo: (id: string) => void;
  onFollowWorld?: (world: WorldDetailData) => Promise<void> | void;
  worldFollowed?: boolean;
}) {
  const { t } = useTranslation();
  const banner = world.bannerUrl;
  const tabs = [
    { id: 'world-detail-lore', label: t('WorldDetail.glass.nav.lore') },
    { id: 'world-detail-rules', label: t('WorldDetail.glass.nav.rules') },
    { id: 'world-detail-characters', label: t('WorldDetail.glass.nav.characters') },
    { id: 'world-detail-scenes', label: t('WorldDetail.glass.nav.scenes') },
    { id: 'world-detail-timeline', label: t('WorldDetail.glass.nav.timeline') },
  ];
  return (
    <section
      className={GLASS_STRONG_SURFACE_CLASS}
      data-nimi-material="glass-thick"
      data-nimi-tone="hero"
      style={{
        ...GLASS_STRONG_STYLE,
        position: 'relative',
        minHeight: 302,
        borderRadius: 24,
        overflow: 'hidden',
        background: detailHeroBackground(banner),
      }}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(9,21,40,0.58), rgba(9,21,40,0.10) 56%, rgba(9,21,40,0.34))' }} />
      {banner ? null : (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color: 'rgba(255,255,255,0.20)',
            fontSize: 150,
            fontWeight: 950,
          }}
        >
          {worldInitial(world.name)}
        </div>
      )}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 18 }}>
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
          {onBack ? (
            <button
              type="button"
              aria-label={t('WorldDetail.glass.backToAtlas')}
              onClick={onBack}
              style={{
                width: 42,
                height: 42,
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.24)',
                background: 'rgba(8,23,36,0.36)',
                color: '#8ff0d0',
                display: 'grid',
                placeItems: 'center',
                cursor: 'pointer',
              }}
            >
              <IconArrowLeft />
            </button>
          ) : null}
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onScrollTo(tab.id)}
              style={{
                height: 38,
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.18)',
                background: 'rgba(8,23,36,0.42)',
                color: '#ffffff',
                padding: '0 14px',
                fontSize: 13,
                fontWeight: 850,
                fontFamily: 'var(--nimi-font-sans)',
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
          {onFollowWorld ? (
            <button
              type="button"
              data-testid="world-detail-hero-world-follow"
              aria-pressed={worldFollowed}
              onClick={() => onFollowWorld(world)}
              style={{
                height: 38,
                borderRadius: 999,
                border: worldFollowed ? '1px solid rgba(143,240,208,0.85)' : '1px solid rgba(143,240,208,0.5)',
                background: worldFollowed ? 'rgba(29,95,67,0.95)' : 'rgba(29,95,67,0.82)',
                color: '#eafff6',
                padding: '0 18px',
                fontSize: 13,
                fontWeight: 850,
                fontFamily: 'var(--nimi-font-sans)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
              }}
            >
              <IconFollow filled={worldFollowed} />
              {worldFollowed ? t('WorldDetail.paper.rail.followingWorld') : t('WorldDetail.paper.rail.followWorld')}
            </button>
          ) : null}
          <GlassButton label={t('World.atlas.actions.shareWorld')}><IconShare /></GlassButton>
          <GlassButton label={t('World.atlas.actions.moreWorldActions')}><IconDots /></GlassButton>
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          zIndex: 1,
          left: 30,
          right: 30,
          bottom: 28,
          display: 'grid',
          gridTemplateColumns: '72px minmax(0,1fr)',
          gap: 18,
          alignItems: 'end',
        }}
      >
        <Seal name={world.name} imageUrl={world.iconUrl} size={72} />
        <div style={{ minWidth: 0, color: '#ffffff' }}>
          <div style={{ color: '#8ff0d0', fontSize: 11, lineHeight: 1.2, fontWeight: 950, letterSpacing: 1.6, textTransform: 'uppercase', marginBottom: 12 }}>
            {world.tagline || world.motto || t('WorldDetail.glass.publicSettingBackground')}
          </div>
          <h1 style={{ margin: 0, fontSize: 40, lineHeight: 1, fontWeight: 950, letterSpacing: 0 }}>{world.name}</h1>
          <p style={{ margin: '12px 0 0', maxWidth: 740, color: 'rgba(255,255,255,0.88)', fontSize: 14, lineHeight: 1.48, fontWeight: 650 }}>
            {worldSummary(world)}
          </p>
        </div>
      </div>
    </section>
  );
}
