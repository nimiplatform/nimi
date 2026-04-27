import { useEffect, useState } from 'react';
import {
  getOrthodonticDashboard,
  type OrthodonticDashboardProjection,
} from '../../bridge/sqlite-bridge.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { S } from '../../app-shell/page-style.js';

interface Props {
  childId: string;
  /** Switch to the orthodontic tab from CTAs inside this view. */
  onOpenOrthodontic: () => void;
}

export function DentalOverviewTab({ childId, onOpenOrthodontic }: Props) {
  const [dashboard, setDashboard] = useState<OrthodonticDashboardProjection | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorMsg(null);
    getOrthodonticDashboard(childId)
      .then((value) => { if (!cancelled) setDashboard(value); })
      .catch((error) => {
        catchLog('dental', 'action:load-ortho-dashboard-failed')(error);
        if (!cancelled) setErrorMsg(error instanceof Error ? error.message : String(error));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [childId]);

  if (loading) {
    return <div className="p-6 text-[14px]" style={{ color: S.sub }}>加载中...</div>;
  }

  if (errorMsg) {
    return (
      <div role="alert" className="p-4 rounded-xl text-[14px]"
        style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}>
        加载失败：{errorMsg}
      </div>
    );
  }

  if (!dashboard) {
    return <div className="p-6 text-[14px]" style={{ color: S.sub }}>暂无数据</div>;
  }

  const activeCase = dashboard.activeCase;
  const compliance = dashboard.compliance30d;
  const hasOrthoTreatment = activeCase !== null;

  return (
    <div className="flex flex-col gap-4">
      {/* Ortho status card */}
      <div className="p-5 rounded-2xl" style={{ background: S.card, boxShadow: S.shadow }}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
              正畸状态
            </div>
            <div className="mt-1.5 text-[18px] font-semibold" style={{ color: S.text }}>
              {hasOrthoTreatment
                ? `${caseTypeLabel(activeCase.caseType)} · ${stageLabel(activeCase.stage)}`
                : '暂无进行中正畸疗程'}
            </div>
            {hasOrthoTreatment && activeCase.providerInstitution && (
              <div className="mt-1 text-[14px]" style={{ color: S.sub }}>{activeCase.providerInstitution}</div>
            )}
          </div>
          <button
            type="button"
            onClick={onOpenOrthodontic}
            className="text-[14px] font-semibold text-white hover:opacity-90 transition-opacity"
            style={{ background: S.accent, padding: '8px 14px', borderRadius: 10, border: 0, cursor: 'pointer' }}
          >
            {hasOrthoTreatment ? '查看正畸' : '开始正畸'}
          </button>
        </div>
      </div>

      {/* Next review + upcoming tasks */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-4 rounded-2xl" style={{ background: S.card, boxShadow: S.shadow }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
            下次复诊
          </div>
          <div className="mt-2 text-[18px] font-semibold" style={{ color: S.text }}>
            {dashboard.nextReviewDate ?? '未安排'}
          </div>
          {dashboard.activeAppliances.length > 0 && (
            <div className="mt-1 text-[13px]" style={{ color: S.sub }}>
              活跃装置 {dashboard.activeAppliances.length} 件
            </div>
          )}
        </div>
        <div className="p-4 rounded-2xl" style={{ background: S.card, boxShadow: S.shadow }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
            近 30 天依从率
          </div>
          {compliance.total === 0 ? (
            <div className="mt-2 text-[14px]" style={{ color: S.sub }}>暂无打卡</div>
          ) : (
            <>
              <div className="mt-2 text-[18px] font-semibold" style={{ color: S.text }}>
                {Math.round((compliance.done / compliance.total) * 100)}%
              </div>
              <div className="mt-1 text-[13px]" style={{ color: S.sub }}>
                达成 {compliance.done} · 部分 {compliance.partial} · 缺席 {compliance.missed}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Compliance disclaimer per PO-ORTHO-008. */}
      <div className="px-4 py-3 rounded-xl text-[13px]"
        style={{ background: 'rgba(148,163,184,0.08)', color: '#64748b', border: '1px dashed rgba(148,163,184,0.3)' }}>
        {compliance.note}
      </div>
    </div>
  );
}

function caseTypeLabel(t: string): string {
  switch (t) {
    case 'early-intervention': return '早期矫治';
    case 'fixed-braces':       return '固定矫治';
    case 'clear-aligners':     return '隐形矫治';
    case 'unknown-legacy':     return '历史疗程（待确认）';
    default:                   return t;
  }
}

function stageLabel(s: string): string {
  switch (s) {
    case 'assessment': return '初评';
    case 'planning':   return '方案规划';
    case 'active':     return '治疗中';
    case 'retention':  return '保持期';
    case 'completed':  return '已完成';
    default:           return s;
  }
}
