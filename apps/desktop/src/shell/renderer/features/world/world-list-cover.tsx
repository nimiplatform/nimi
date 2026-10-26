import { MediaImage } from '@nimiplatform/kit/features/media';
import type { CSSProperties, ReactNode } from 'react';
import { WORLD_EXPLORER_THEME, WORLD_NEUTRAL_COVER_BACKGROUND } from './world-list-theme';
import type { WorldListItem } from './world-list-model';

type WorldCoverVariant = 'thumb' | 'featured' | 'panel' | 'row' | 'banner' | 'catalog';

// A World without a banner gets one neutral abstract cover. The cover never
// classifies the World from its name, genre, era, themes, or entity kinds,
// because WorldListItem declares no cover style.
const variantClassName: Record<WorldCoverVariant, string> = {
  catalog: 'relative block h-44 w-full shrink-0 overflow-hidden',
  thumb: 'relative block h-[86px] w-[86px] shrink-0 overflow-hidden rounded-[16px]',
  featured: 'absolute inset-0 block overflow-hidden rounded-[18px]',
  panel: 'relative block h-[232px] shrink-0 overflow-hidden rounded-[24px]',
  row: 'relative block h-10 w-10 shrink-0 overflow-hidden rounded-[12px]',
  banner: 'relative block h-[220px] w-full shrink-0 overflow-hidden sm:h-[280px]',
};

export function WorldCover({
  world,
  variant = 'thumb',
  className = '',
  children,
  overlay = false,
}: {
  world: WorldListItem;
  variant?: WorldCoverVariant;
  className?: string;
  children?: ReactNode;
  overlay?: boolean;
}) {
  const style: CSSProperties = {
    background: WORLD_NEUTRAL_COVER_BACKGROUND,
  };
  return (
    <span
      role={children ? undefined : 'img'}
      aria-label={children ? undefined : world.name}
      data-world-cover={variant}
      className={`${variantClassName[variant]} ${className}`}
      style={style}
    >
      <MediaImage delivery={world.bannerMedia ?? world.heroMedia} externalUrl={world.bannerUrl} purpose={variant === 'banner' || variant === 'panel' || variant === 'featured' ? 'hero' : 'card'} sizes="auto, 320px" alt="" className="absolute inset-0 h-full w-full object-cover" />
      {overlay ? <span aria-hidden="true" className="absolute inset-0" style={WORLD_EXPLORER_THEME.coverOverlay} /> : null}
      {children}
    </span>
  );
}
