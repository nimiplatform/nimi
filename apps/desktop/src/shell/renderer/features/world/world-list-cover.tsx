import type { CSSProperties, ReactNode } from 'react';
import { WORLD_EXPLORER_THEME, WORLD_NEUTRAL_COVER_BACKGROUND } from './world-list-theme';
import type { WorldListItem } from './world-list-model';

type WorldCoverVariant = 'thumb' | 'featured' | 'panel' | 'row' | 'banner';

// A World without a banner gets one neutral abstract cover. The cover never
// classifies the World from its name, genre, era, themes, or entity kinds,
// because WorldListItem declares no cover style.
function coverBackground(world: WorldListItem): string {
  if (!world.bannerUrl) {
    return WORLD_NEUTRAL_COVER_BACKGROUND;
  }
  const safeUrl = world.bannerUrl.replace(/"/g, '%22');
  return `url("${safeUrl}") center/cover no-repeat`;
}

const variantClassName: Record<WorldCoverVariant, string> = {
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
    background: coverBackground(world),
  };
  return (
    <span
      role={children ? undefined : 'img'}
      aria-label={children ? undefined : world.name}
      data-world-cover={variant}
      className={`${variantClassName[variant]} ${className}`}
      style={style}
    >
      {overlay ? <span aria-hidden="true" className="absolute inset-0" style={WORLD_EXPLORER_THEME.coverOverlay} /> : null}
      {children}
    </span>
  );
}
