/**
 * Copyright Management Page (FG-IP-002..005)
 *
 * IP registration, license management, attribution tracking, infringement reports.
 * This module is deferred from the current Forge scope and remains a placeholder.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { ForgePage, ForgePageHeader, ForgeEmptyState, ForgeStatCard } from '@renderer/components/page-layout.js';
import { ForgeTabBar, type ForgeTab } from '@renderer/components/tab-bar.js';

type CopyrightTab = 'registrations' | 'licenses' | 'attributions' | 'infringements';

const CONTENT_TYPES = [
  { value: 'WORLD', label: 'World' },
  { value: 'AGENT', label: 'Agent' },
  { value: 'IMAGE', label: 'Image' },
  { value: 'VIDEO', label: 'Video' },
  { value: 'SONG', label: 'Song' },
  { value: 'LOREBOOK', label: 'Lorebook' },
  { value: 'EVENT_GRAPH', label: 'Event Graph' },
] as const;

const LICENSE_TYPES = [
  { value: 'CC_BY', label: 'CC Attribution', short: 'CC BY' },
  { value: 'CC_BY_SA', label: 'CC Attribution-ShareAlike', short: 'CC BY-SA' },
  { value: 'CC_BY_NC', label: 'CC Attribution-NonCommercial', short: 'CC BY-NC' },
  { value: 'CC_BY_ND', label: 'CC Attribution-NoDerivatives', short: 'CC BY-ND' },
  { value: 'EXCLUSIVE', label: 'Exclusive License', short: 'Exclusive' },
  { value: 'CUSTOM', label: 'Custom License', short: 'Custom' },
] as const;

export default function CopyrightPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<CopyrightTab>('registrations');

  const tabs: ForgeTab<CopyrightTab>[] = [
    { value: 'registrations', label: t('copyright.tabRegistrations', 'Registrations') },
    { value: 'licenses', label: t('copyright.tabLicenses', 'Licenses') },
    { value: 'attributions', label: t('copyright.tabAttributions', 'Attributions') },
    { value: 'infringements', label: t('copyright.tabInfringements', 'Infringements') },
  ];

  return (
    <ForgePage>
      <ForgePageHeader
        title={t('pages.copyrightManagement')}
        subtitle={t('copyright.subtitle', 'Register, license, and protect your creative works')}
      />

      {/* Scope notice */}
      <Surface tone="card" padding="md" className="border-[var(--nimi-status-warning)]">
        <p className="text-sm font-medium text-[var(--nimi-status-warning)]">
          {t('copyright.backendNotice', 'Copyright Deferred')}
        </p>
        <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
          {t('copyright.backendNoticeDetail', 'Copyright is not part of the current Forge delivery scope. This page remains a placeholder until a smaller extension is explicitly approved.')}
        </p>
      </Surface>

      <ForgeTabBar tabs={tabs} value={activeTab} onChange={setActiveTab} />

      {activeTab === 'registrations' && <RegistrationsTab />}
      {activeTab === 'licenses' && <LicensesTab />}
      {activeTab === 'attributions' && <AttributionsTab />}
      {activeTab === 'infringements' && <InfringementsTab />}
    </ForgePage>
  );
}

function RegistrationsTab() {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--nimi-text-muted)]">
          {t('copyright.registrationsHint', 'Register your original content with verifiable timestamps and content hashes.')}
        </p>
        <Button tone="primary" size="sm" disabled onClick={() => setShowForm(!showForm)}>
          {t('copyright.register', 'Register Content')}
        </Button>
      </div>

      {showForm && (
        <Surface tone="card" padding="md" className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs text-[var(--nimi-text-secondary)]">Content Type</label>
            <div className="flex flex-wrap gap-1.5">
              {CONTENT_TYPES.map((ct) => (
                <span
                  key={ct.value}
                  className="rounded-[var(--nimi-radius-action)] bg-[var(--nimi-surface-panel)] px-3 py-1.5 text-xs font-medium text-[var(--nimi-text-secondary)]"
                >
                  {ct.label}
                </span>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-[var(--nimi-text-secondary)]">Title</label>
            <input
              type="text"
              disabled
              placeholder="Registration title..."
              className="w-full rounded-[var(--nimi-radius-action)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3 py-1.5 text-sm text-[var(--nimi-text-primary)] placeholder-[var(--nimi-text-muted)] focus:outline-none disabled:opacity-50"
            />
          </div>
        </Surface>
      )}

      <ForgeEmptyState message={t('copyright.noRegistrations', 'No copyright registrations yet.')} />
    </div>
  );
}

function LicensesTab() {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--nimi-text-muted)]">
        {t('copyright.licensesHint', 'Assign usage licenses to your registered works.')}
      </p>

      <div className="grid grid-cols-3 gap-2">
        {LICENSE_TYPES.map((lt) => (
          <Surface key={lt.value} tone="card" padding="sm">
            <p className="text-xs font-medium text-[var(--nimi-text-primary)]">{lt.short}</p>
            <p className="mt-0.5 text-[10px] text-[var(--nimi-text-muted)]">{lt.label}</p>
          </Surface>
        ))}
      </div>

      <ForgeEmptyState message={t('copyright.noLicenses', 'No licenses configured yet. Register content first.')} />
    </div>
  );
}

function AttributionsTab() {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--nimi-text-muted)]">
        {t('copyright.attributionsHint', 'Track attribution chains between original and derivative works.')}
      </p>

      <div className="grid grid-cols-2 gap-4">
        <ForgeStatCard
          label={t('copyright.incoming', 'Incoming')}
          value={0}
          detail={t('copyright.incomingHint', 'Others referencing your work')}
        />
        <ForgeStatCard
          label={t('copyright.outgoing', 'Outgoing')}
          value={0}
          detail={t('copyright.outgoingHint', 'Your references to others')}
        />
      </div>
    </div>
  );
}

function InfringementsTab() {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--nimi-text-muted)]">
          {t('copyright.infringementsHint', 'Report and track content infringement cases.')}
        </p>
        <Button tone="primary" size="sm" disabled>
          {t('copyright.reportInfringement', 'Report Infringement')}
        </Button>
      </div>

      <ForgeEmptyState message={t('copyright.noInfringements', 'No infringement reports.')} />
    </div>
  );
}
