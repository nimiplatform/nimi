/**
 * Template Detail Page (FG-TPL-004/005)
 *
 * Template preview with fork action.
 * This module is deferred from the current Forge scope and remains a placeholder.
 */

import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { ForgePage, ForgePageHeader, ForgeEmptyState } from '@renderer/components/page-layout.js';

export default function TemplateDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { templateId } = useParams<{ templateId: string }>();

  return (
    <ForgePage>
      <ForgePageHeader
        title={t('pages.templateDetail')}
        actions={
          <Button tone="ghost" size="sm" onClick={() => navigate('/templates')}>
            &larr; {t('templates.backToMarketplace', 'Marketplace')}
          </Button>
        }
      />

      <Surface tone="card" padding="md" className="border-[var(--nimi-status-warning)]">
        <p className="text-xs text-[var(--nimi-status-warning)]">
          {t('templates.backendNoticeDetail', 'Template workflows are deferred until they are redesigned against world-studio and world draft semantics.')}
        </p>
      </Surface>

      <ForgeEmptyState
        message={`Template ${templateId} \u2014 this detail view remains deferred in the current Forge scope.`}
      />
    </ForgePage>
  );
}
