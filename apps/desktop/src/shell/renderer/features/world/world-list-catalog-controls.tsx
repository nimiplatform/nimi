import { Grid2X2, Heart, List } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SegmentedControl, SelectField, Surface } from '@nimiplatform/kit/ui';
import { CATEGORY_TABS, type CategoryId, type SortId, type ViewMode } from './world-list-catalog-model';
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
  const categoryItems = CATEGORY_TABS.map((category) => {
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
      className="min-h-[54px] rounded-[24px]"
      style={WORLD_EXPLORER_THEME.nav}
    >
      <div className="flex min-w-0 items-center gap-2">
        <SegmentedControl
          ariaLabel={t('World.atlas.categories')}
          className="min-w-0 flex-1 overflow-x-auto border-transparent bg-transparent shadow-none [&_.nimi-segmented-control__item]:min-h-9 [&_.nimi-segmented-control__item]:px-4 [&_.nimi-segmented-control__item]:font-semibold [&_.nimi-segmented-control__item]:text-[var(--world-explorer-text-secondary)] [&_.nimi-segmented-control__item--selected]:bg-[var(--world-explorer-brand-soft)] [&_.nimi-segmented-control__item--selected]:text-[var(--world-explorer-brand)] [&_.nimi-segmented-control__item--selected]:shadow-none"
          items={categoryItems}
          size="sm"
          value={active}
          onValueChange={(value) => onChange(value as CategoryId)}
        />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <SegmentedControl
            ariaLabel={t('World.toolbar.viewMode')}
            className="rounded-[16px] border border-[var(--world-explorer-border)] bg-[var(--world-explorer-surface)] shadow-none [&_.nimi-segmented-control__item]:aspect-square [&_.nimi-segmented-control__item]:px-2 [&_.nimi-segmented-control__item]:text-[var(--world-explorer-text-secondary)] [&_.nimi-segmented-control__item--selected]:bg-[var(--world-explorer-brand-soft)] [&_.nimi-segmented-control__item--selected]:text-[var(--world-explorer-brand)]"
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
            className="min-w-[124px] rounded-[16px] border-[var(--world-explorer-border)] bg-[var(--world-explorer-surface)] text-[var(--world-explorer-text)]"
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
