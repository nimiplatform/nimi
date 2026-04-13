import { S } from '../../app-shell/page-style.js';
import type { MedicalAnalysis } from '../../engine/smart-alerts.js';
import {
  ALERT_STYLES,
  EVENT_TYPE_LABELS,
} from './medical-events-page-shared.js';

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
    <section className={S.radius + ' mb-6 p-5'} style={{ background: S.card, boxShadow: S.shadow }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-[16px]">🔍</span>
              <h2 className="text-[14px] font-semibold" style={{ color: S.text }}>智能识别分析</h2>
            </div>
            <button
              onClick={onRefresh}
              disabled={aiLoading}
              className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full transition-colors hover:bg-[#f0f0ec] disabled:opacity-40"
              style={{ color: S.sub }}
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
                const style = ALERT_STYLES[alert.level];
                return (
                  <div key={index} className={S.radiusSm + ' px-4 py-3'} style={{ background: style.bg, border: `1px solid ${style.border}` }}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[13px]">{style.icon}</span>
                      <span className="text-[12px] font-semibold" style={{ color: S.text }}>{alert.title}</span>
                    </div>
                    <p className="text-[11px] ml-6" style={{ color: S.sub }}>{alert.message}</p>
                  </div>
                );
              })}
            </div>
          ) : null}

          {analysis.diagnoses.length > 0 ? (
            <div className="mb-4">
              <h3 className="text-[12px] font-semibold mb-2" style={{ color: S.text }}>诊断汇总</h3>
              <div className="flex flex-wrap gap-1.5">
                {analysis.diagnoses.slice(0, 12).map((diagnosis) => (
                  <button
                    key={diagnosis.diagnosis}
                    onClick={() => onSelectDiagnosis(diagnosis.diagnosis)}
                    className={S.radiusSm + ' text-[11px] px-2.5 py-1 transition-colors hover:opacity-80'}
                    style={{ background: S.accent + '18', color: S.accent, border: `1px solid ${S.accent}33` }}
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
              <h3 className="text-[12px] font-semibold mb-2" style={{ color: S.text }}>用药汇总</h3>
              <div className="flex flex-wrap gap-1.5">
                {analysis.medications.slice(0, 12).map((medication) => (
                  <button
                    key={medication.name}
                    onClick={() => onSelectMedication(medication.name)}
                    className={S.radiusSm + ' text-[11px] px-2.5 py-1 transition-colors hover:opacity-80'}
                    style={{ background: S.blue + '18', color: S.blue, border: `1px solid ${S.blue}33` }}
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
              <div key={type} className="text-[11px] flex items-center gap-1" style={{ color: S.sub }}>
                <span className="font-medium" style={{ color: S.text }}>{EVENT_TYPE_LABELS[type] ?? type}</span>
                <span>{count}次</span>
              </div>
            ))}
            {analysis.frequentHospitals.length > 0 ? (
              <div className="text-[11px]" style={{ color: S.sub }}>
                常去：{analysis.frequentHospitals.join('、')}
              </div>
            ) : null}
          </div>

          {aiLoading && !aiInsight ? (
            <div className="space-y-2 animate-pulse">
              <div className="h-3 rounded-full w-full" style={{ background: '#eceeed' }} />
              <div className="h-3 rounded-full w-4/5" style={{ background: '#eceeed' }} />
            </div>
          ) : aiInsight ? (
            <div className={S.radiusSm + ' p-3'} style={{ background: '#f9faf7', border: `1px solid ${S.border}` }}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[12px]">✨</span>
                <span className="text-[11px] font-semibold" style={{ color: S.text }}>AI 综合分析</span>
              </div>
              <p className="text-[12px] leading-relaxed" style={{ color: S.text }}>{aiInsight}</p>
            </div>
          ) : null}
    </section>
  );
}
