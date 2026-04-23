/**
 * Template Browse Page (FG-TPL-004)
 *
 * Marketplace for browsing/searching world templates.
 * This module is deferred from the current Forge scope and remains a placeholder.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, SearchField, Surface } from '@nimiplatform/nimi-kit/ui';
import { ForgePage, ForgePageHeader, ForgeEmptyState } from '@renderer/components/page-layout.js';
import { LabeledSelectField } from '@renderer/components/form-fields.js';
import { ForgeSegmentControl, type SegmentOption } from '@renderer/components/segment-control.js';

const CATEGORIES = [
  'ALL', 'FANTASY', 'SCIFI', 'MODERN', 'HISTORICAL',
  'HORROR', 'ROMANCE', 'MYSTERY', 'EDUCATIONAL', 'OTHER',
] as const;

type SortBy = 'newest' | 'most_forked' | 'highest_rated' | 'price_low' | 'price_high';

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'most_forked', label: 'Most Forked' },
  { value: 'highest_rated', label: 'Highest Rated' },
  { value: 'price_low', label: 'Price: Low to High' },
  { value: 'price_high', label: 'Price: High to Low' },
];

export default function TemplateBrowsePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const [sortBy, setSortBy] = useState<SortBy>('newest');

  const categoryOptions: SegmentOption[] = CATEGORIES.map((cat) => ({
    value: cat,
    label: cat === 'ALL' ? t('templates.categoryAll', 'All') : cat,
  }));

  return (
    <ForgePage maxWidth="max-w-5xl">
      <ForgePageHeader
        title={t('pages.templateBrowse')}
        subtitle={t('templates.subtitle', 'Discover and fork world templates from other creators')}
        actions={
          <Button tone="secondary" size="sm" onClick={() => navigate('/templates/mine')}>
            {t('templates.myTemplates', 'My Templates')}
          </Button>
        }
      />

      {/* Scope notice */}
      <Surface tone="card" material="glass-thin" padding="md" className="border-[var(--nimi-status-warning)]">
        <p className="text-sm font-medium text-[var(--nimi-status-warning)]">
          {t('templates.backendNotice', 'Template Marketplace Deferred')}
        </p>
        <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
          {t('templates.backendNoticeDetail', 'Template workflows are deferred until they are redesigned against world-studio and world draft semantics.')}
        </p>
      </Surface>

      {/* Search + filters */}
      <div className="space-y-3">
        <div className="flex gap-3">
          <div className="flex-1">
            <SearchField
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('templates.searchPlaceholder', 'Search templates...')}
            />
          </div>
          <LabeledSelectField
            label=""
            value={sortBy}
            options={SORT_OPTIONS}
            onChange={(v) => setSortBy(v as SortBy)}
          />
        </div>
        <ForgeSegmentControl options={categoryOptions} value={category} onChange={setCategory} />
      </div>

      {/* Empty grid */}
      <ForgeEmptyState message={t('templates.noTemplates', 'Template marketplace is deferred in the current Forge scope.')} />
    </ForgePage>
  );
}
