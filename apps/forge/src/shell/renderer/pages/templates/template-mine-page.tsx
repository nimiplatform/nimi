/**
 * My Templates Page (FG-TPL-007)
 *
 * Manage creator's own published templates.
 * This module is deferred from the current Forge scope and remains a placeholder.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { ForgePage, ForgePageHeader, ForgeEmptyState } from '@renderer/components/page-layout.js';
import { ForgeSegmentControl, type SegmentOption } from '@renderer/components/segment-control.js';

type TemplateStatus = 'ALL' | 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

const STATUS_OPTIONS: SegmentOption<TemplateStatus>[] = [
  { value: 'ALL', label: 'All' },
  { value: 'DRAFT', label: 'DRAFT' },
  { value: 'PUBLISHED', label: 'PUBLISHED' },
  { value: 'ARCHIVED', label: 'ARCHIVED' },
];

export default function TemplateMinePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<TemplateStatus>('ALL');

  return (
    <ForgePage>
      <ForgePageHeader
        title={t('pages.templateMine')}
        actions={
          <div className="flex items-center gap-3">
            <Button tone="ghost" size="sm" onClick={() => navigate('/templates')}>
              &larr; {t('templates.backToMarketplace', 'Marketplace')}
            </Button>
            <Button tone="primary" size="sm" disabled>
              {t('templates.createTemplate', 'Create Template')}
            </Button>
          </div>
        }
      />

      <ForgeSegmentControl options={STATUS_OPTIONS} value={statusFilter} onChange={setStatusFilter} />

      {/* Scope notice */}
      <Surface tone="card" material="glass-thin" padding="md" className="border-[var(--nimi-status-warning)]">
        <p className="text-xs text-[var(--nimi-status-warning)]">
          {t('templates.backendNoticeDetail', 'Template workflows are deferred until they are redesigned against world-studio and world draft semantics.')}
        </p>
      </Surface>

      <ForgeEmptyState message={t('templates.noMyTemplates', 'You haven\'t published any templates yet.')} />
    </ForgePage>
  );
}
