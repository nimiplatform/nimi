/**
 * Template Detail Page (FG-TPL-004/005)
 *
 * Template preview with fork action.
 * This module is deferred from the current Forge scope and remains a placeholder.
 */

import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

export default function TemplateDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { templateId } = useParams<{ templateId: string }>();

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/templates')}
            className="rounded px-2 py-1 text-sm text-neutral-400 hover:text-white transition-colors"
          >
            &larr; {t('templates.backToMarketplace', 'Marketplace')}
          </button>
          <h1 className="text-2xl font-bold text-white">{t('pages.templateDetail')}</h1>
        </div>

        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3">
          <p className="text-xs text-yellow-400">
            {t('templates.backendNoticeDetail', 'Template workflows are deferred until they are redesigned against world-studio and world draft semantics.')}
          </p>
        </div>

        <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-8 text-center">
          <p className="text-sm text-neutral-500">
            Template {templateId} — this detail view remains deferred in the current Forge scope.
          </p>
        </div>
      </div>
    </div>
  );
}
