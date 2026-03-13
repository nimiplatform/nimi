/**
 * Template Browse Page (FG-TPL-004)
 *
 * Marketplace for browsing/searching world templates.
 * This module is deferred from the current Forge scope and remains a placeholder.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

const CATEGORIES = [
  'ALL', 'FANTASY', 'SCIFI', 'MODERN', 'HISTORICAL',
  'HORROR', 'ROMANCE', 'MYSTERY', 'EDUCATIONAL', 'OTHER',
] as const;

type SortBy = 'newest' | 'most_forked' | 'highest_rated' | 'price_low' | 'price_high';

export default function TemplateBrowsePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const [sortBy, setSortBy] = useState<SortBy>('newest');

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">{t('pages.templateBrowse')}</h1>
            <p className="mt-1 text-sm text-neutral-400">
              {t('templates.subtitle', 'Discover and fork world templates from other creators')}
            </p>
          </div>
          <button
            onClick={() => navigate('/templates/mine')}
            className="rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 transition-colors"
          >
            {t('templates.myTemplates', 'My Templates')}
          </button>
        </div>

        {/* Scope notice */}
        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3">
          <p className="text-sm text-yellow-400 font-medium mb-1">
            {t('templates.backendNotice', 'Template Marketplace Deferred')}
          </p>
          <p className="text-xs text-yellow-400/70">
            {t('templates.backendNoticeDetail', 'Template workflows are deferred until they are redesigned against world-studio and world draft semantics.')}
          </p>
        </div>

        {/* Search + filters */}
        <div className="space-y-3">
          <div className="flex gap-3">
            <input
              type="text"
              placeholder={t('templates.searchPlaceholder', 'Search templates...')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
            />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-500 focus:outline-none"
            >
              <option value="newest">Newest</option>
              <option value="most_forked">Most Forked</option>
              <option value="highest_rated">Highest Rated</option>
              <option value="price_low">Price: Low to High</option>
              <option value="price_high">Price: High to Low</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  category === cat
                    ? 'bg-white text-black'
                    : 'bg-neutral-800 text-neutral-400 hover:text-white'
                }`}
              >
                {cat === 'ALL' ? t('templates.categoryAll', 'All') : cat}
              </button>
            ))}
          </div>
        </div>

        {/* Empty grid */}
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-12 text-center">
          <div className="text-4xl text-neutral-700 mb-3">🏗️</div>
          <p className="text-sm text-neutral-400">
            {t('templates.noTemplates', 'Template marketplace is deferred in the current Forge scope.')}
          </p>
        </div>
      </div>
    </div>
  );
}
