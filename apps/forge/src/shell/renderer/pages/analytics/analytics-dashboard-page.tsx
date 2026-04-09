/**
 * Analytics Dashboard Page (FG-ANA-002..005)
 *
 * KPI overview, funnel, retention, content heatmap.
 * This module is deferred from the current Forge scope and remains a placeholder.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Surface } from '@nimiplatform/nimi-kit/ui';
import { ForgePage, ForgePageHeader, ForgeStatCard, ForgeEmptyState } from '@renderer/components/page-layout.js';
import { ForgeTabBar, type ForgeTab } from '@renderer/components/tab-bar.js';
import { ForgeSegmentControl, type SegmentOption } from '@renderer/components/segment-control.js';

type AnalyticsTab = 'overview' | 'funnel' | 'retention' | 'heatmap';
type Period = '7d' | '30d' | '90d';

const PERIOD_OPTIONS: SegmentOption<Period>[] = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
];

export default function AnalyticsDashboardPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('overview');
  const [period, setPeriod] = useState<Period>('30d');

  const tabs: ForgeTab<AnalyticsTab>[] = [
    { value: 'overview', label: t('analytics.tabOverview', 'Overview') },
    { value: 'funnel', label: t('analytics.tabFunnel', 'Funnel') },
    { value: 'retention', label: t('analytics.tabRetention', 'Retention') },
    { value: 'heatmap', label: t('analytics.tabHeatmap', 'Heatmap') },
  ];

  return (
    <ForgePage maxWidth="max-w-5xl">
      <ForgePageHeader
        title={t('pages.analyticsDashboard')}
        subtitle={t('analytics.subtitle', 'Data-driven insights into your content performance')}
        actions={<ForgeSegmentControl options={PERIOD_OPTIONS} value={period} onChange={setPeriod} />}
      />

      {/* Scope notice */}
      <Surface tone="card" padding="md" className="border-[var(--nimi-status-warning)]">
        <p className="text-sm font-medium text-[var(--nimi-status-warning)]">
          {t('analytics.backendNotice', 'Analytics Deferred')}
        </p>
        <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
          {t('analytics.backendNoticeDetail', 'Analytics is out of the current Forge scope. This page remains a placeholder until a separate analytics module is approved.')}
        </p>
      </Surface>

      <ForgeTabBar tabs={tabs} value={activeTab} onChange={setActiveTab} />

      {activeTab === 'overview' && <OverviewTab />}
      {activeTab === 'funnel' && <FunnelTab />}
      {activeTab === 'retention' && <RetentionTab />}
      {activeTab === 'heatmap' && <HeatmapTab />}
    </ForgePage>
  );
}

function OverviewTab() {
  const { t } = useTranslation();
  const kpis = [
    { label: t('analytics.totalViews', 'Total Views'), value: '\u2014' },
    { label: t('analytics.activeAgents', 'Active Agents'), value: '\u2014' },
    { label: t('analytics.engagementRate', 'Engagement'), value: '\u2014' },
    { label: t('analytics.revenuePerUser', 'Rev/User'), value: '\u2014' },
    { label: t('analytics.newUsers', 'New Users'), value: '\u2014' },
    { label: t('analytics.returningUsers', 'Returning'), value: '\u2014' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        {kpis.map((kpi) => (
          <ForgeStatCard key={kpi.label} label={kpi.label} value={kpi.value} />
        ))}
      </div>

      <Surface tone="card" padding="md">
        <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {t('analytics.trendChart', 'Trend')}
        </h3>
        <div className="mt-3 flex h-48 items-center justify-center text-sm text-[var(--nimi-text-muted)]">
          {t('analytics.noData', 'Analytics is deferred in the current Forge scope.')}
        </div>
      </Surface>
    </div>
  );
}

function FunnelTab() {
  const { t } = useTranslation();
  const stages = [
    { label: 'Discovery', count: '\u2014', rate: null },
    { label: 'Enter World', count: '\u2014', rate: '\u2014%' },
    { label: 'Agent Interaction', count: '\u2014', rate: '\u2014%' },
    { label: 'Monetization', count: '\u2014', rate: '\u2014%' },
  ];

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--nimi-text-muted)]">
        {t('analytics.funnelDesc', '4-stage conversion funnel: Discovery \u2192 Enter World \u2192 Agent Interaction \u2192 Monetization')}
      </p>
      <div className="space-y-2">
        {stages.map((stage, i) => (
          <div key={stage.label} className="flex items-center gap-3">
            <div className="w-6 text-center text-xs font-medium text-[var(--nimi-text-muted)]">{i + 1}</div>
            <Surface tone="card" padding="none" className="flex flex-1 items-center justify-between px-4 py-3">
              <span className="text-sm text-[var(--nimi-text-primary)]">{stage.label}</span>
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium text-[var(--nimi-text-secondary)]">{stage.count}</span>
                {stage.rate !== null && (
                  <span className="rounded-[var(--nimi-radius-action)] bg-[var(--nimi-surface-panel)] px-2 py-0.5 text-[10px] text-[var(--nimi-text-muted)]">
                    {stage.rate}
                  </span>
                )}
              </div>
            </Surface>
          </div>
        ))}
      </div>
    </div>
  );
}

function RetentionTab() {
  const { t } = useTranslation();
  const periods = ['Day 1', 'Day 7', 'Day 14', 'Day 30'];
  const cohorts = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--nimi-text-muted)]">
        {t('analytics.retentionDesc', 'User return rates by weekly cohort.')}
      </p>
      <Surface tone="card" padding="none" className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]">
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--nimi-text-muted)]">Cohort</th>
              {periods.map((p) => (
                <th key={p} className="px-4 py-2 text-center text-xs font-medium text-[var(--nimi-text-muted)]">{p}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohorts.map((cohort) => (
              <tr key={cohort} className="border-b border-[var(--nimi-border-subtle)]">
                <td className="px-4 py-2 text-[var(--nimi-text-secondary)]">{cohort}</td>
                {periods.map((p) => (
                  <td key={p} className="px-4 py-2 text-center">
                    <span className="inline-block w-12 rounded-[var(--nimi-radius-action)] bg-[var(--nimi-surface-panel)] py-1 text-xs text-[var(--nimi-text-muted)]">{'\u2014'}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Surface>
    </div>
  );
}

function HeatmapTab() {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--nimi-text-muted)]">
        {t('analytics.heatmapDesc', 'Content interaction intensity across events, agents, and lorebooks.')}
      </p>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: t('analytics.topEvents', 'Top Events') },
          { label: t('analytics.topAgents', 'Top Agents') },
          { label: t('analytics.topLorebooks', 'Top Lorebooks') },
        ].map((section) => (
          <Surface key={section.label} tone="card" padding="md">
            <h4 className="mb-3 text-xs font-medium text-[var(--nimi-text-primary)]">{section.label}</h4>
            <div className="space-y-1">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center justify-between py-1">
                  <span className="text-xs text-[var(--nimi-text-muted)]">{'\u2014'}</span>
                  <div className="h-2 w-16 rounded-[var(--nimi-radius-action)] bg-[var(--nimi-surface-panel)]" />
                </div>
              ))}
            </div>
          </Surface>
        ))}
      </div>
    </div>
  );
}
