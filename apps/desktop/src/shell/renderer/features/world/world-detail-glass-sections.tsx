import { Button, IconButton, NimiText, Surface, cn } from '@nimiplatform/kit/ui';
import { ArrowLeft, Heart } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WorldCharacter, WorldDetailData } from './world-detail-types.js';
import { detailHeroBackground, worldSummary } from './world-detail-template-model';
import { GLASS_STRONG_STYLE, GLASS_STRONG_SURFACE_CLASS, Seal } from './world-detail-glass-primitives';
import { worldInitial } from './world-list-atoms';

export function DetailHero({
  world,
  onBack,
  onFollowWorld,
  worldFollowed = false,
}: {
  world: WorldDetailData;
  characters: readonly WorldCharacter[];
  onBack?: () => void;
  onFollowWorld?: (world: WorldDetailData) => Promise<void> | void;
  worldFollowed?: boolean;
}) {
  const { t } = useTranslation();
  const banner = world.bannerUrl;
  return (
    <Surface
      as="section"
      tone="hero"
      material="glass-thick"
      elevation="raised"
      padding="none"
      className={cn(GLASS_STRONG_SURFACE_CLASS, 'relative min-h-[302px] overflow-hidden rounded-[var(--nimi-radius-xl)]')}
      style={{
        ...GLASS_STRONG_STYLE,
        borderRadius: 24,
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
            color: 'color-mix(in srgb, var(--nimi-text-inverse) 20%, transparent)',
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
            <IconButton
              aria-label={t('WorldDetail.glass.backToAtlas')}
              onClick={onBack}
              icon={<ArrowLeft aria-hidden className="h-[18px] w-[18px]" strokeWidth={2.2} />}
              tone="ghost"
              size="md"
              className="h-10 w-10 rounded-full border border-[var(--nimi-material-glass-thin-border)] bg-[var(--nimi-material-glass-thin-bg)] text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-raised)] nimi-material-glass-thin backdrop-blur-[var(--nimi-backdrop-blur-thin)] hover:bg-white/86 hover:text-[var(--nimi-action-primary-bg)]"
            />
          ) : null}
        </div>
        {onFollowWorld ? (
          <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
            <Button
              type="button"
              tone="primary"
              size="sm"
              data-testid="world-detail-hero-world-follow"
              aria-pressed={worldFollowed}
              onClick={() => onFollowWorld(world)}
              leadingIcon={<Heart aria-hidden="true" size={15} fill={worldFollowed ? 'currentColor' : 'none'} strokeWidth={1.9} />}
              className="h-[38px] min-h-0 px-[18px] font-extrabold"
            >
              {worldFollowed ? t('WorldDetail.paper.rail.followingWorld') : t('WorldDetail.paper.rail.followWorld')}
            </Button>
          </div>
        ) : null}
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
        <div style={{ minWidth: 0, color: 'var(--nimi-text-inverse)' }}>
          <NimiText as="div" role="caption" className="mb-3 uppercase text-[var(--nimi-action-primary-bg)]" style={{ letterSpacing: 1.6, fontWeight: 950 }}>
            {world.tagline || world.motto || t('WorldDetail.glass.publicSettingBackground')}
          </NimiText>
          <NimiText as="h1" role="page-title" className="m-0 text-[40px] leading-none text-[var(--nimi-text-inverse)]" style={{ fontWeight: 950, letterSpacing: 0 }}>
            {world.name}
          </NimiText>
          <NimiText as="p" role="body" className="mt-3 max-w-[740px]" style={{ fontWeight: 650, color: 'color-mix(in srgb, var(--nimi-text-inverse) 90%, transparent)' }}>
            {worldSummary(world)}
          </NimiText>
        </div>
      </div>
    </Surface>
  );
}
