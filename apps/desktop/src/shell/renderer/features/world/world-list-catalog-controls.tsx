import { Grid2X2, Heart, List } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SegmentedControl, SelectField, Surface } from '@nimiplatform/kit/ui';
import { WORLD_ATLAS_VISIBLE_CATEGORY_TABS, type CategoryId, type SortId, type ViewMode } from './world-list-catalog-model';
import { WORLD_EXPLORER_THEME } from './world-list-theme';

export function AtlasCategoryTabs({
  active,
  onChange,
  followedCount = 0,
  view,
  onViewChange,
  sort,
  onSortChange,
}: {
  active: CategoryId;
  onChange: (category: CategoryId) => void;
  followedCount?: number;
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  sort: SortId;
  onSortChange: (sort: SortId) => void;
}) {
  const { t } = useTranslation();
  const categoryItems = WORLD_ATLAS_VISIBLE_CATEGORY_TABS.map((category) => {
    const isFollowed = category.id === 'followed';
    return {
      value: category.id,
      icon: isFollowed ? <Heart size={13} fill={followedCount > 0 ? 'currentColor' : 'none'} aria-hidden="true" /> : undefined,
      label: (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className="truncate">{t(`World.atlas.category.${category.id}`)}</span>
          {isFollowed && followedCount > 0 ? (
            <span className="inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--world-explorer-brand-soft)] px-1 text-[length:var(--nimi-type-caption-size)] font-bold text-[var(--world-explorer-brand)]">
              {followedCount}
            </span>
          ) : null}
        </span>
      ),
    };
  });
  return (
    <Surface
      as="nav"
      aria-label={t('World.atlas.categories')}
      data-testid="world-atlas-category-tabs"
      tone="panel"
      material="solid"
      elevation="base"
      padding="sm"
      className="min-h-[54px] min-w-0 max-w-full overflow-hidden rounded-[24px]"
      style={WORLD_EXPLORER_THEME.nav}
    >
      <div className="flex min-w-0 flex-col gap-2 min-[640px]:flex-row min-[640px]:items-center">
        <SegmentedControl
          ariaLabel={t('World.atlas.categories')}
          className="min-w-0 max-w-full flex-1 flex-wrap overflow-visible border-transparent bg-transparent shadow-none min-[900px]:flex-nowrap [&_.nimi-segmented-control__item]:min-h-8 [&_.nimi-segmented-control__item]:shrink-0 [&_.nimi-segmented-control__item]:gap-1 [&_.nimi-segmented-control__item]:px-[7px] [&_.nimi-segmented-control__item]:text-[13px] [&_.nimi-segmented-control__item]:font-semibold [&_.nimi-segmented-control__item]:text-[var(--world-explorer-text-secondary)] [&_.nimi-segmented-control__item--selected]:bg-[var(--world-explorer-brand-soft)] [&_.nimi-segmented-control__item--selected]:text-[var(--world-explorer-brand)] [&_.nimi-segmented-control__item--selected]:shadow-none"
          items={categoryItems}
          size="sm"
          value={active}
          onValueChange={(value) => onChange(value as CategoryId)}
        />
        <div className="ml-0 flex w-full min-w-0 items-center gap-2 min-[640px]:ml-auto min-[640px]:w-auto min-[640px]:shrink-0">
          <SegmentedControl
            ariaLabel={t('World.toolbar.viewMode')}
            className="shrink-0 rounded-[16px] border border-[var(--world-explorer-border)] bg-[var(--world-explorer-surface)] shadow-none [&_.nimi-segmented-control__item]:aspect-square [&_.nimi-segmented-control__item]:px-2 [&_.nimi-segmented-control__item]:text-[var(--world-explorer-text-secondary)] [&_.nimi-segmented-control__item--selected]:bg-[var(--world-explorer-brand-soft)] [&_.nimi-segmented-control__item--selected]:text-[var(--world-explorer-brand)]"
            items={[
              { value: 'grid', label: <span className="sr-only">{t('World.toolbar.gridView')}</span>, icon: <Grid2X2 size={14} aria-hidden="true" /> },
              { value: 'list', label: <span className="sr-only">{t('World.toolbar.listView')}</span>, icon: <List size={14} aria-hidden="true" /> },
            ]}
            size="sm"
            value={view}
            onValueChange={(value) => onViewChange(value as ViewMode)}
          />
          <SelectField
            aria-label={t('World.toolbar.sortLabel')}
            className="min-w-0 flex-1 rounded-[16px] border-[var(--world-explorer-border)] bg-[var(--world-explorer-surface)] text-[var(--world-explorer-text)] min-[640px]:w-[124px] min-[640px]:max-w-[124px] min-[640px]:flex-none"
            options={[
              { value: 'active', label: t('World.atlas.sort.active') },
              { value: 'recent', label: t('World.atlas.sort.recent') },
              { value: 'sources', label: t('World.atlas.sort.sources') },
              { value: 'alpha', label: t('World.atlas.sort.alpha') },
            ]}
            value={sort}
            onValueChange={(value) => onSortChange(value as SortId)}
          />
        </div>
      </div>
    </Surface>
  );
}
