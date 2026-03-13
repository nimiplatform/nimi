/**
 * Analytics Dashboard Page (FG-ANA-002..005)
 *
 * KPI overview, funnel, retention, content heatmap.
 * This module is deferred from the current Forge scope and remains a placeholder.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

type AnalyticsTab = 'overview' | 'funnel' | 'retention' | 'heatmap';
type Period = '7d' | '30d' | '90d';

export default function AnalyticsDashboardPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('overview');
  const [period, setPeriod] = useState<Period>('30d');

  const tabs: { id: AnalyticsTab; label: string }[] = [
    { id: 'overview', label: t('analytics.tabOverview', 'Overview') },
    { id: 'funnel', label: t('analytics.tabFunnel', 'Funnel') },
    { id: 'retention', label: t('analytics.tabRetention', 'Retention') },
    { id: 'heatmap', label: t('analytics.tabHeatmap', 'Heatmap') },
  ];

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">{t('pages.analyticsDashboard')}</h1>
            <p className="mt-1 text-sm text-neutral-400">
              {t('analytics.subtitle', 'Data-driven insights into your content performance')}
            </p>
          </div>
          <div className="flex gap-1.5">
            {(['7d', '30d', '90d'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                  period === p
                    ? 'bg-white text-black'
                    : 'bg-neutral-800 text-neutral-400 hover:text-white'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Scope notice */}
        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3">
          <p className="text-sm text-yellow-400 font-medium mb-1">
            {t('analytics.backendNotice', 'Analytics Deferred')}
          </p>
          <p className="text-xs text-yellow-400/70">
            {t('analytics.backendNoticeDetail', 'Analytics is out of the current Forge scope. This page remains a placeholder until a separate analytics module is approved.')}
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

        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'funnel' && <FunnelTab />}
        {activeTab === 'retention' && <RetentionTab />}
        {activeTab === 'heatmap' && <HeatmapTab />}
      </div>
    </div>
  );
}

function OverviewTab() {
  const { t } = useTranslation();
  const kpis = [
    { label: t('analytics.totalViews', 'Total Views'), value: '—', color: 'text-blue-400' },
    { label: t('analytics.activeAgents', 'Active Agents'), value: '—', color: 'text-green-400' },
    { label: t('analytics.engagementRate', 'Engagement'), value: '—', color: 'text-purple-400' },
    { label: t('analytics.revenuePerUser', 'Rev/User'), value: '—', color: 'text-yellow-400' },
    { label: t('analytics.newUsers', 'New Users'), value: '—', color: 'text-cyan-400' },
    { label: t('analytics.returningUsers', 'Returning'), value: '—', color: 'text-pink-400' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3">
            <p className="text-xs text-neutral-500">{kpi.label}</p>
            <p className={`text-xl font-bold mt-1 ${kpi.color}`}>{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5">
        <h3 className="text-sm font-semibold text-white mb-3">
          {t('analytics.trendChart', 'Trend')}
        </h3>
        <div className="h-48 flex items-center justify-center text-sm text-neutral-500">
          {t('analytics.noData', 'Analytics is deferred in the current Forge scope.')}
        </div>
      </div>
    </div>
  );
}

function FunnelTab() {
  const { t } = useTranslation();
  const stages = [
    { label: 'Discovery', count: '—', rate: null },
    { label: 'Enter World', count: '—', rate: '—%' },
    { label: 'Agent Interaction', count: '—', rate: '—%' },
    { label: 'Monetization', count: '—', rate: '—%' },
  ];

  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-500">
        {t('analytics.funnelDesc', '4-stage conversion funnel: Discovery → Enter World → Agent Interaction → Monetization')}
      </p>
      <div className="space-y-2">
        {stages.map((stage, i) => (
          <div key={stage.label} className="flex items-center gap-3">
            <div className="w-6 text-center text-xs text-neutral-600 font-medium">{i + 1}</div>
            <div className="flex-1 rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-white">{stage.label}</span>
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium text-neutral-400">{stage.count}</span>
                {stage.rate !== null && (
                  <span className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-500">
                    {stage.rate}
                  </span>
                )}
              </div>
            </div>
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
      <p className="text-xs text-neutral-500">
        {t('analytics.retentionDesc', 'User return rates by weekly cohort.')}
      </p>
      <div className="rounded-lg border border-neutral-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800 bg-neutral-900">
              <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500">Cohort</th>
              {periods.map((p) => (
                <th key={p} className="px-4 py-2 text-center text-xs font-medium text-neutral-500">{p}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohorts.map((cohort) => (
              <tr key={cohort} className="border-b border-neutral-800/50">
                <td className="px-4 py-2 text-neutral-400">{cohort}</td>
                {periods.map((p) => (
                  <td key={p} className="px-4 py-2 text-center">
                    <span className="inline-block w-12 rounded bg-neutral-800 py-1 text-xs text-neutral-600">—</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HeatmapTab() {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-500">
        {t('analytics.heatmapDesc', 'Content interaction intensity across events, agents, and lorebooks.')}
      </p>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: t('analytics.topEvents', 'Top Events'), icon: '📅' },
          { label: t('analytics.topAgents', 'Top Agents'), icon: '🤖' },
          { label: t('analytics.topLorebooks', 'Top Lorebooks'), icon: '📖' },
        ].map((section) => (
          <div key={section.label} className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
            <div className="flex items-center gap-2 mb-3">
              <span>{section.icon}</span>
              <h4 className="text-xs font-medium text-white">{section.label}</h4>
            </div>
            <div className="space-y-1">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center justify-between py-1">
                  <span className="text-xs text-neutral-500">—</span>
                  <div className="w-16 h-2 rounded bg-neutral-800" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
