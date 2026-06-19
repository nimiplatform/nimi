import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { CATEGORY_TABS, GLASS_CARD_CLASS, GLASS_CARD_STYLE, type CategoryId, type ViewMode } from './world-list-catalog-model';
import { IconGrid, IconList, IconSearch } from './world-list-catalog-primitives';

export function AtlasSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        height: 40,
        minWidth: 280,
        maxWidth: 420,
        flex: '1 1 320px',
        borderRadius: 14,
        padding: '0 14px',
        color: '#64748b',
        background: 'rgba(255,255,255,0.58)',
        border: '1px solid rgba(129,145,169,0.16)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.8)',
      }}
    >
      <IconSearch />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('World.searchPlaceholder')}
        style={{
          minWidth: 0,
          flex: 1,
          border: 0,
          outline: 0,
          background: 'transparent',
          color: '#162033',
          fontSize: 13,
          fontWeight: 600,
          fontFamily: 'var(--nimi-font-sans)',
        }}
      />
    </label>
  );
}

export function ViewToggle({
  view,
  onChange,
}: {
  view: ViewMode;
  onChange: (view: ViewMode) => void;
}) {
  const { t } = useTranslation();
  const buttonStyle = (active: boolean): CSSProperties => ({
    width: 36,
    height: 34,
    borderRadius: 11,
    border: active ? '1px solid rgba(76,125,245,0.16)' : '1px solid transparent',
    background: active ? '#ffffff' : 'transparent',
    color: active ? '#376af6' : '#64748b',
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
    boxShadow: active ? '0 8px 18px rgba(54,80,125,0.08)' : 'none',
  });
  return (
    <div
      style={{
        display: 'flex',
        gap: 2,
        padding: 3,
        borderRadius: 14,
        background: 'rgba(255,255,255,0.48)',
        border: '1px solid rgba(129,145,169,0.12)',
      }}
    >
      <button type="button" aria-label={t('World.toolbar.gridView')} aria-pressed={view === 'grid'} style={buttonStyle(view === 'grid')} onClick={() => onChange('grid')}>
        <IconGrid />
      </button>
      <button type="button" aria-label={t('World.toolbar.listView')} aria-pressed={view === 'list'} style={buttonStyle(view === 'list')} onClick={() => onChange('list')}>
        <IconList />
      </button>
    </div>
  );
}

export function AtlasCategoryTabs({
  active,
  onChange,
}: {
  active: CategoryId;
  onChange: (category: CategoryId) => void;
}) {
  const { t } = useTranslation();
  return (
    <nav
      className={GLASS_CARD_CLASS}
      aria-label={t('World.atlas.categories')}
      data-nimi-material="glass-regular"
      data-nimi-tone="panel"
      data-testid="world-atlas-category-tabs"
      style={{
        ...GLASS_CARD_STYLE,
        minHeight: 54,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: 7,
        borderRadius: 16,
        overflowX: 'auto',
      }}
    >
      {CATEGORY_TABS.map((category) => {
        const selected = category.id === active;
        return (
          <button
            key={category.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(category.id)}
            style={{
              flex: '0 0 auto',
              height: 38,
              border: '1px solid transparent',
              borderRadius: 12,
              padding: '0 16px',
              fontSize: 13,
              fontWeight: 800,
              fontFamily: 'var(--nimi-font-sans)',
              color: selected ? '#2563ff' : '#41516a',
              background: selected ? 'rgba(255,255,255,0.82)' : 'transparent',
              boxShadow: selected ? '0 10px 22px rgba(54,80,125,0.08)' : 'none',
              cursor: 'pointer',
            }}
          >
            {t(`World.atlas.category.${category.id}`)}
          </button>
        );
      })}
      <button
        type="button"
        style={{
          marginLeft: 'auto',
          height: 38,
          border: 0,
          borderRadius: 12,
          padding: '0 14px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 13,
          fontWeight: 800,
          color: '#41516a',
          background: 'transparent',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {t('World.atlas.more')}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
    </nav>
  );
}
