/**
 * My Templates Page (FG-TPL-007)
 *
 * Manage creator's own published templates.
 * This module is deferred from the current Forge scope and remains a placeholder.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

type TemplateStatus = 'ALL' | 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export default function TemplateMinePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<TemplateStatus>('ALL');

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/templates')}
              className="rounded px-2 py-1 text-sm text-neutral-400 hover:text-white transition-colors"
            >
              &larr; {t('templates.backToMarketplace', 'Marketplace')}
            </button>
            <h1 className="text-2xl font-bold text-white">{t('pages.templateMine')}</h1>
          </div>
          <button
            disabled
            className="rounded-lg bg-white/30 px-4 py-2 text-sm font-medium text-white/50 cursor-not-allowed"
          >
            {t('templates.createTemplate', 'Create Template')}
          </button>
        </div>

        {/* Status filter */}
        <div className="flex rounded-lg border border-neutral-700 overflow-hidden w-fit">
          {(['ALL', 'DRAFT', 'PUBLISHED', 'ARCHIVED'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-2 text-xs font-medium transition-colors ${
                statusFilter === status
                  ? 'bg-white text-black'
                  : 'bg-neutral-900 text-neutral-400 hover:text-white'
              }`}
            >
              {status === 'ALL' ? t('templates.filterAll', 'All') : status}
            </button>
          ))}
        </div>

        {/* Scope notice */}
        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3">
          <p className="text-xs text-yellow-400">
            {t('templates.backendNoticeDetail', 'Template workflows are deferred until they are redesigned against world-studio and world draft semantics.')}
          </p>
        </div>

        {/* Empty */}
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-8 text-center">
          <p className="text-sm text-neutral-500">
            {t('templates.noMyTemplates', 'You haven\'t published any templates yet.')}
          </p>
        </div>
      </div>
    </div>
  );
}
