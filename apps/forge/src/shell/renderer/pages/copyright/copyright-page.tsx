/**
 * Copyright Management Page (FG-IP-002..005)
 *
 * IP registration, license management, attribution tracking, infringement reports.
 * This module is deferred from the current Forge scope and remains a placeholder.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

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

  const tabs: { id: CopyrightTab; label: string }[] = [
    { id: 'registrations', label: t('copyright.tabRegistrations', 'Registrations') },
    { id: 'licenses', label: t('copyright.tabLicenses', 'Licenses') },
    { id: 'attributions', label: t('copyright.tabAttributions', 'Attributions') },
    { id: 'infringements', label: t('copyright.tabInfringements', 'Infringements') },
  ];

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white">{t('pages.copyrightManagement')}</h1>
          <p className="mt-1 text-sm text-neutral-400">
            {t('copyright.subtitle', 'Register, license, and protect your creative works')}
          </p>
        </div>

        {/* Scope notice */}
        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3">
          <p className="text-sm text-yellow-400 font-medium mb-1">
            {t('copyright.backendNotice', 'Copyright Deferred')}
          </p>
          <p className="text-xs text-yellow-400/70">
            {t('copyright.backendNoticeDetail', 'Copyright is not part of the current Forge delivery scope. This page remains a placeholder until a smaller extension is explicitly approved.')}
          </p>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-neutral-800">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab.id
                  ? 'border-white text-white'
                  : 'border-transparent text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'registrations' && <RegistrationsTab />}
        {activeTab === 'licenses' && <LicensesTab />}
        {activeTab === 'attributions' && <AttributionsTab />}
        {activeTab === 'infringements' && <InfringementsTab />}
      </div>
    </div>
  );
}

function RegistrationsTab() {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-neutral-500">
          {t('copyright.registrationsHint', 'Register your original content with verifiable timestamps and content hashes.')}
        </p>
        <button
          onClick={() => setShowForm(!showForm)}
          disabled
          className="rounded-lg bg-white/30 px-4 py-2 text-sm font-medium text-white/50 cursor-not-allowed"
        >
          {t('copyright.register', 'Register Content')}
        </button>
      </div>

      {showForm && (
        <div className="rounded-lg border border-neutral-700 bg-neutral-900 p-4 space-y-3">
          <div>
            <label className="block text-xs text-neutral-400 mb-1">Content Type</label>
            <div className="flex flex-wrap gap-1.5">
              {CONTENT_TYPES.map((ct) => (
                <button
                  key={ct.value}
                  className="rounded px-3 py-1.5 text-xs font-medium bg-neutral-800 text-neutral-400"
                >
                  {ct.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-neutral-400 mb-1">Title</label>
            <input
              type="text"
              disabled
              placeholder="Registration title..."
              className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-white placeholder-neutral-500 focus:outline-none disabled:opacity-50"
            />
          </div>
        </div>
      )}

      <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-8 text-center">
        <div className="text-3xl text-neutral-700 mb-2">📜</div>
        <p className="text-sm text-neutral-500">
          {t('copyright.noRegistrations', 'No copyright registrations yet.')}
        </p>
      </div>
    </div>
  );
}

function LicensesTab() {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-500">
        {t('copyright.licensesHint', 'Assign usage licenses to your registered works.')}
      </p>

      {/* License type preview */}
      <div className="grid grid-cols-3 gap-2">
        {LICENSE_TYPES.map((lt) => (
          <div
            key={lt.value}
            className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-3 py-2.5"
          >
            <p className="text-xs font-medium text-white">{lt.short}</p>
            <p className="text-[10px] text-neutral-500 mt-0.5">{lt.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-8 text-center">
        <p className="text-sm text-neutral-500">
          {t('copyright.noLicenses', 'No licenses configured yet. Register content first.')}
        </p>
      </div>
    </div>
  );
}

function AttributionsTab() {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-500">
        {t('copyright.attributionsHint', 'Track attribution chains between original and derivative works.')}
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5 text-center">
          <p className="text-sm font-medium text-white mb-1">
            {t('copyright.incoming', 'Incoming')}
          </p>
          <p className="text-xs text-neutral-500">
            {t('copyright.incomingHint', 'Others referencing your work')}
          </p>
          <p className="text-2xl font-bold text-neutral-600 mt-3">0</p>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5 text-center">
          <p className="text-sm font-medium text-white mb-1">
            {t('copyright.outgoing', 'Outgoing')}
          </p>
          <p className="text-xs text-neutral-500">
            {t('copyright.outgoingHint', 'Your references to others')}
          </p>
          <p className="text-2xl font-bold text-neutral-600 mt-3">0</p>
        </div>
      </div>
    </div>
  );
}

function InfringementsTab() {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-neutral-500">
          {t('copyright.infringementsHint', 'Report and track content infringement cases.')}
        </p>
        <button
          disabled
          className="rounded-lg bg-white/30 px-4 py-2 text-sm font-medium text-white/50 cursor-not-allowed"
        >
          {t('copyright.reportInfringement', 'Report Infringement')}
        </button>
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-8 text-center">
        <div className="text-3xl text-neutral-700 mb-2">🛡️</div>
        <p className="text-sm text-neutral-500">
          {t('copyright.noInfringements', 'No infringement reports.')}
        </p>
      </div>
    </div>
  );
}
