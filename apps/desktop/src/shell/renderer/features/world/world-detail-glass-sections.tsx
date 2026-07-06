import { Button, IconButton, NimiText, Surface, cn } from '@nimiplatform/kit/ui';
import { Heart } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WorldCharacter, WorldDetailData } from './world-detail-types.js';
import { detailHeroBackground, worldSummary } from './world-detail-template-model';
import { GLASS_STRONG_STYLE, GLASS_STRONG_SURFACE_CLASS, IconArrowLeft, Seal } from './world-detail-glass-primitives';
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
            <IconButton
              aria-label={t('WorldDetail.glass.backToAtlas')}
              onClick={onBack}
              icon={<IconArrowLeft />}
              tone="ghost"
              size="md"
              className="h-[42px] w-[42px] border border-white/25 bg-[rgba(8,23,36,0.36)] text-[#8ff0d0] hover:bg-[rgba(8,23,36,0.48)]"
              style={{
                borderColor: 'rgba(255,255,255,0.24)',
              }}
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
              className="h-[38px] min-h-0 px-[18px] font-extrabold text-[#eafff6]"
              style={{
                border: worldFollowed ? '1px solid rgba(143,240,208,0.85)' : '1px solid rgba(143,240,208,0.5)',
                background: worldFollowed ? 'rgba(29,95,67,0.95)' : 'rgba(29,95,67,0.82)',
                color: '#eafff6',
              }}
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
        <div style={{ minWidth: 0, color: '#ffffff' }}>
          <NimiText as="div" role="caption" className="mb-3 uppercase text-[#8ff0d0]" style={{ letterSpacing: 1.6, fontWeight: 950 }}>
            {world.tagline || world.motto || t('WorldDetail.glass.publicSettingBackground')}
          </NimiText>
          <NimiText as="h1" role="page-title" className="m-0 text-[40px] leading-none text-white" style={{ fontWeight: 950, letterSpacing: 0 }}>
            {world.name}
          </NimiText>
          <NimiText as="p" role="body" className="mt-3 max-w-[740px] text-white/90" style={{ fontWeight: 650 }}>
            {worldSummary(world)}
          </NimiText>
        </div>
      </div>
    </Surface>
  );
}
