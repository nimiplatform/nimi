import type { CSSProperties, ReactNode } from 'react';
import { WORLD_ABSTRACT_COVER_BACKGROUNDS, WORLD_EXPLORER_THEME } from './world-list-theme';
import type { WorldListItem } from './world-list-model';

type WorldCoverTone = keyof typeof WORLD_ABSTRACT_COVER_BACKGROUNDS;
type WorldCoverVariant = 'thumb' | 'featured' | 'panel';

function worldCoverTone(world: WorldListItem): WorldCoverTone {
  const haystack = [
    world.name,
    world.genre,
    world.era,
    ...world.themes,
    ...world.entityKinds,
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();

  if (/(?:sci|space|future|科幻|星际|星云|太空)/i.test(haystack)) {
    return 'sciFi';
  }
  if (/(?:nature|forest|mountain|自然|森林|山水|植物)/i.test(haystack)) {
    return 'nature';
  }
  if (/(?:fantasy|xianxia|magic|奇幻|修仙|仙侠|玄幻)/i.test(haystack)) {
    return 'fantasy';
  }
  if (/(?:history|historical|scholarly|cbdb|历史|朝|代|文人|书院|学术)/i.test(haystack)) {
    return 'history';
  }
  return 'sandbox';
}

export function worldAbstractCoverBackground(world: WorldListItem): string {
  return WORLD_ABSTRACT_COVER_BACKGROUNDS[worldCoverTone(world)];
}

function coverBackground(world: WorldListItem): string {
  if (!world.bannerUrl) {
    return worldAbstractCoverBackground(world);
  }
  const safeUrl = world.bannerUrl.replace(/"/g, '%22');
  return `url("${safeUrl}") center/cover no-repeat`;
}

const variantClassName: Record<WorldCoverVariant, string> = {
  thumb: 'relative block h-[72px] w-[86px] shrink-0 overflow-hidden rounded-[16px]',
  featured: 'absolute inset-0 block overflow-hidden rounded-[16px]',
  panel: 'relative block h-[192px] shrink-0 overflow-hidden rounded-[20px]',
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
      data-world-cover-tone={worldCoverTone(world)}
      data-world-cover={variant}
      className={`${variantClassName[variant]} ${className}`}
      style={style}
    >
      {overlay ? <span aria-hidden="true" className="absolute inset-0" style={WORLD_EXPLORER_THEME.coverOverlay} /> : null}
      {children}
    </span>
  );
}
