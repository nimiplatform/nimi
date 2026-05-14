import { Surface } from '@nimiplatform/nimi-kit/ui';
import type { MedicalAnalysis } from '../../engine/smart-alerts.js';
import { EVENT_TYPE_LABELS } from './medical-events-page-shared.js';

export function MedicalEventsAnalysisPanel({
  analysis,
  aiInsight,
  aiLoading,
  onRefresh,
  onSelectDiagnosis,
  onSelectMedication,
}: {
  analysis: MedicalAnalysis;
  aiInsight: string | null;
  aiLoading: boolean;
  onRefresh: () => void;
  onSelectDiagnosis: (diagnosis: string) => void;
  onSelectMedication: (name: string) => void;
}) {
  return (
    <Surface as="section" tone="card" material="glass-regular" elevation="raised" padding="none" className="mb-6 rounded-3xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-[16px]">🔍</span>
              <h2 className="text-[16px] font-semibold text-[var(--nimi-text-primary)]">智能识别分析</h2>
            </div>
            <button
              onClick={onRefresh}
              disabled={aiLoading}
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)] disabled:opacity-40"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={aiLoading ? 'animate-spin' : ''}>
                <path d="M21 12a9 9 0 1 1-6.22-8.56" />
              </svg>
              {aiLoading ? 'AI 分析中' : 'AI 深度分析'}
            </button>
          </div>

          {analysis.alerts.length > 0 ? (
            <div className="space-y-2 mb-4">
              {analysis.alerts.map((alert, index) => {
                const style = alertLevelStyle(alert.level);
                return (
                  <div key={index} className={`rounded-2xl border px-4 py-3 ${style.className}`}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[14px]">{style.icon}</span>
                      <span className="text-[14px] font-semibold text-[var(--nimi-text-primary)]">{alert.title}</span>
                    </div>
                    <p className="text-[13px] ml-6 text-[var(--nimi-text-muted)]">{alert.message}</p>
                  </div>
                );
              })}
            </div>
          ) : null}

          {analysis.diagnoses.length > 0 ? (
            <div className="mb-4">
              <h3 className="text-[14px] font-semibold mb-2 text-[var(--nimi-text-primary)]">诊断汇总</h3>
              <div className="flex flex-wrap gap-1.5">
                {analysis.diagnoses.slice(0, 12).map((diagnosis) => (
                  <button
                    key={diagnosis.diagnosis}
                    onClick={() => onSelectDiagnosis(diagnosis.diagnosis)}
                    className="rounded-2xl border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_20%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_9%,transparent)] px-2.5 py-1 text-[13px] text-[var(--nimi-action-primary-bg)] transition-colors hover:opacity-80"
                  >
                    {diagnosis.diagnosis}
                    <span className="ml-1 opacity-60">x{diagnosis.count}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {analysis.medications.length > 0 ? (
            <div className="mb-4">
              <h3 className="text-[14px] font-semibold mb-2 text-[var(--nimi-text-primary)]">用药汇总</h3>
              <div className="flex flex-wrap gap-1.5">
                {analysis.medications.slice(0, 12).map((medication) => (
                  <button
                    key={medication.name}
                    onClick={() => onSelectMedication(medication.name)}
                    className="rounded-2xl border border-[color-mix(in_srgb,var(--nimi-status-info)_20%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-info)_9%,transparent)] px-2.5 py-1 text-[13px] text-[var(--nimi-status-info)] transition-colors hover:opacity-80"
                  >
                    {medication.name}
                    {medication.dosage ? <span className="ml-1 opacity-60">{medication.dosage}</span> : null}
                    <span className="ml-1 opacity-60">x{medication.count}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex gap-3 flex-wrap mb-4">
            {Object.entries(analysis.eventsByType).map(([type, count]) => (
              <div key={type} className="text-[13px] flex items-center gap-1 text-[var(--nimi-text-muted)]">
                <span className="font-medium text-[var(--nimi-text-primary)]">{EVENT_TYPE_LABELS[type] ?? type}</span>
                <span>{count}次</span>
              </div>
            ))}
            {analysis.frequentHospitals.length > 0 ? (
              <div className="text-[13px] text-[var(--nimi-text-muted)]">
                常去：{analysis.frequentHospitals.join('、')}
              </div>
            ) : null}
          </div>

          {aiLoading && !aiInsight ? (
            <div className="space-y-2 animate-pulse">
              <div className="h-3 w-full rounded-full bg-[var(--nimi-surface-panel)]" />
              <div className="h-3 w-4/5 rounded-full bg-[var(--nimi-surface-panel)]" />
            </div>
          ) : aiInsight ? (
            <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[14px]">✨</span>
                <span className="text-[13px] font-semibold text-[var(--nimi-text-primary)]">AI 综合分析</span>
              </div>
              <p className="text-[14px] leading-relaxed text-[var(--nimi-text-primary)]">{aiInsight}</p>
            </div>
          ) : null}
    </Surface>
  );
}

function alertLevelStyle(level: string): { icon: string; className: string } {
  if (level === 'critical') {
    return { icon: '🚨', className: 'border-[color-mix(in_srgb,var(--nimi-status-danger)_34%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,var(--nimi-surface-card))]' };
  }
  if (level === 'warning') {
    return { icon: '⚠️', className: 'border-[color-mix(in_srgb,var(--nimi-status-warning)_34%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))]' };
  }
  return { icon: 'ℹ️', className: 'border-[color-mix(in_srgb,var(--nimi-status-info)_28%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-info)_8%,var(--nimi-surface-card))]' };
}
