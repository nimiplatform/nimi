import { Grid2X2, Heart, List } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, SegmentedControl, SelectField, Surface } from '@nimiplatform/kit/ui';
import { CATEGORY_TABS, type CategoryId, type SortId, type ViewMode } from './world-list-catalog-model';

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
            <span className="inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--nimi-surface-active)] px-1 text-[length:var(--nimi-type-caption-size)] font-bold text-[var(--nimi-action-primary-bg)]">
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
      material="glass-regular"
      elevation="base"
      padding="sm"
      className="min-h-[54px] rounded-[var(--nimi-radius-xl)] shadow-none"
      style={{ boxShadow: 'none' }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <SegmentedControl
          ariaLabel={t('World.atlas.categories')}
          className="min-w-0 flex-1 overflow-x-auto border-transparent bg-transparent shadow-none [&_.nimi-segmented-control__item]:min-h-9 [&_.nimi-segmented-control__item]:px-4 [&_.nimi-segmented-control__item--selected]:bg-[var(--nimi-surface-card)] [&_.nimi-segmented-control__item--selected]:text-[var(--nimi-status-info)] [&_.nimi-segmented-control__item--selected]:shadow-none"
          items={categoryItems}
          size="sm"
          value={active}
          onValueChange={(value) => onChange(value as CategoryId)}
        />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <SegmentedControl
            ariaLabel={t('World.toolbar.viewMode')}
            className="rounded-[var(--nimi-radius-lg)] bg-[var(--nimi-surface-card)] shadow-none [&_.nimi-segmented-control__item]:aspect-square [&_.nimi-segmented-control__item]:px-2 [&_.nimi-segmented-control__item--selected]:text-[var(--nimi-status-info)]"
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
            className="min-w-[124px] rounded-[var(--nimi-radius-lg)] bg-[var(--nimi-surface-card)]"
            options={[
              { value: 'active', label: t('World.atlas.sort.active') },
              { value: 'recent', label: t('World.atlas.sort.recent') },
              { value: 'sources', label: t('World.atlas.sort.sources') },
              { value: 'alpha', label: t('World.atlas.sort.alpha') },
            ]}
            value={sort}
            onValueChange={(value) => onSortChange(value as SortId)}
          />
          <Button tone="ghost" size="sm">
            {t('World.atlas.more')}
          </Button>
        </div>
      </div>
    </Surface>
  );
}
