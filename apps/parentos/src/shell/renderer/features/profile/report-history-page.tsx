import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { S } from '../../app-shell/page-style.js';
import { useAppStore, computeAgeMonths } from '../../app-shell/app-store.js';
import { getGrowthReports } from '../../bridge/sqlite-bridge.js';
import { GROWTH_STANDARDS } from '../../knowledge-base/index.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';

/* ── types ────────────────────────────────────────────────── */

interface ReportRow {
  reportId: string;
  childId: string;
  reportType: string;
  periodStart: string;
  periodEnd: string;
  ageMonthsStart: number;
  ageMonthsEnd: number;
  content: string;
  generatedAt: string;
  createdAt: string;
}

interface OCRContent {
  imageName?: string;
  measurements: Array<{ typeId: string; value: number; measuredAt: string; notes: string | null }>;
}

/* ── helpers ──────────────────────────────────────────────── */

const TYPE_EMOJI: Record<string, string> = {
  height: '📏', weight: '⚖️', 'head-circumference': '📐', bmi: '🏃',
  'vision-left': '👁️', 'vision-right': '👁️',
  'corrected-vision-left': '👓', 'corrected-vision-right': '👓',
  'refraction-sph-left': '🔬', 'refraction-sph-right': '🔬',
  'refraction-cyl-left': '🔬', 'refraction-cyl-right': '🔬',
  'axial-length-left': '🔬', 'axial-length-right': '🔬',
  'lab-vitamin-d': '🧪', 'lab-ferritin': '🩸', 'lab-hemoglobin': '🩸',
  'lab-calcium': '🧪', 'lab-zinc': '🧪',
};

function getDisplayInfo(typeId: string) {
  const std = GROWTH_STANDARDS.find((s) => s.typeId === typeId);
  return { name: std?.displayName ?? typeId, unit: std?.unit ?? '', emoji: TYPE_EMOJI[typeId] ?? '📋' };
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

function fmtRelative(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff < 7) return `${diff}天前`;
  if (diff < 30) return `${Math.floor(diff / 7)}周前`;
  return fmtDate(dateStr);
}

function parseContent(content: string): OCRContent | null {
  try { return JSON.parse(content) as OCRContent; } catch { return null; }
}

/* ── Group reports by month ──────────────────────────────── */

function groupByMonth(reports: ReportRow[]): Array<{ monthLabel: string; items: ReportRow[] }> {
  const map = new Map<string, ReportRow[]>();
  for (const r of reports) {
    const d = new Date(r.generatedAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const arr = map.get(key);
    if (arr) arr.push(r); else map.set(key, [r]);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, items]) => {
      const [y, m] = key.split('-');
      return { monthLabel: `${y}年${parseInt(m!)}月`, items };
    });
}

/* ================================================================
   PAGE
   ================================================================ */

export default function ReportHistoryPage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (activeChildId) {
      getGrowthReports(activeChildId, 'ocr-upload').then(setReports).catch(catchLog('report-history', 'action:load-growth-reports-failed'));
    }
  }, [activeChildId]);

  if (!child) return <div className="flex items-center justify-center h-full" style={{ color: S.sub }}>请先添加孩子档案</div>;

  const grouped = useMemo(() => groupByMonth(reports), [reports]);

  return (
    <div className={S.container} style={{ paddingTop: S.topPad, minHeight: '100%' }}>
      <div className="flex items-center gap-2 mb-5">
        <Link to="/profile" className="text-[13px] hover:underline" style={{ color: S.sub }}>← 返回档案</Link>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold" style={{ color: S.text }}>单据记录</h1>
          <p className="text-[12px] mt-0.5" style={{ color: S.sub }}>
            共 {reports.length} 份已识别的医疗报告
          </p>
        </div>
        <Link to="/profile/report-upload"
          className={`px-4 py-2 text-[13px] font-medium text-white ${S.radiusSm} transition-colors hover:opacity-90`}
          style={{ background: S.accent }}>
          + 上传新报告
        </Link>
      </div>

      {reports.length === 0 ? (
        /* Empty state */
        <div className={`${S.radius} p-10 flex flex-col items-center`} style={{ background: S.card, boxShadow: S.shadow }}>
          <span className="text-[48px] mb-3">📄</span>
          <p className="text-[14px] font-medium" style={{ color: S.text }}>还没有上传过报告</p>
          <p className="text-[12px] mt-1 mb-4" style={{ color: S.sub }}>上传体检单、验血单等，AI 自动提取数据</p>
          <Link to="/profile/report-upload"
            className={`px-5 py-2 text-[13px] font-medium text-white ${S.radiusSm}`}
            style={{ background: S.accent }}>
            上传第一份报告
          </Link>
        </div>
      ) : (
        /* Timeline grouped by month */
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[18px] top-0 bottom-0 w-[2px]" style={{ background: S.border }} />

          {grouped.map((group) => (
            <div key={group.monthLabel} className="relative pl-10 pb-6">
              {/* Month dot */}
              <div className="absolute left-[11px] top-1 w-[16px] h-[16px] rounded-full border-[2px] flex items-center justify-center"
                style={{ background: S.accent, borderColor: S.accent }}>
                <div className="w-[6px] h-[6px] rounded-full bg-white" />
              </div>

              {/* Month label */}
              <p className="text-[13px] font-bold mb-3" style={{ color: S.text }}>{group.monthLabel}</p>

              {/* Report cards */}
              <div className="space-y-3">
                {group.items.map((report) => {
                  const data = parseContent(report.content);
                  const isExpanded = expandedId === report.reportId;

                  return (
                    <div key={report.reportId}
                      className={`${S.radiusSm} overflow-hidden transition-all`}
                      style={{ background: S.card, boxShadow: S.shadow }}>
                      {/* Header — clickable to expand */}
                      <button onClick={() => setExpandedId(isExpanded ? null : report.reportId)}
                        className="w-full flex items-center gap-3 p-4 text-left">
                        <div className="w-[36px] h-[36px] rounded-[10px] flex items-center justify-center text-[18px] shrink-0"
                          style={{ background: '#f4f7ea' }}>🔍</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-medium" style={{ color: S.text }}>
                            {data?.imageName ?? '智能识别报告'}
                          </p>
                          <p className="text-[10px]" style={{ color: S.sub }}>
                            {fmtRelative(report.generatedAt)} · 识别到 {data?.measurements.length ?? 0} 项数据
                          </p>
                        </div>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={S.sub} strokeWidth="2" strokeLinecap="round"
                          className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </button>

                      {/* Expanded detail */}
                      {isExpanded && data && (
                        <div className="px-4 pb-4" style={{ borderTop: `1px solid ${S.border}` }}>
                          <p className="text-[10px] py-2" style={{ color: S.sub }}>
                            数据日期: {report.periodStart} ~ {report.periodEnd} · 上传时间: {fmtDate(report.generatedAt)}
                          </p>
                          <div className="space-y-1.5">
                            {data.measurements.map((m, i) => {
                              const info = getDisplayInfo(m.typeId);
                              return (
                                <div key={i} className={`flex items-center gap-2.5 p-2.5 ${S.radiusSm}`}
                                  style={{ background: '#f9faf7' }}>
                                  <span className="text-[16px]">{info.emoji}</span>
                                  <span className="text-[12px] flex-1" style={{ color: S.text }}>{info.name}</span>
                                  <span className="text-[13px] font-bold" style={{ color: S.text }}>{m.value}</span>
                                  <span className="text-[10px] w-12" style={{ color: S.sub }}>{info.unit}</span>
                                  <span className="text-[10px]" style={{ color: S.sub }}>{m.measuredAt}</span>
                                </div>
                              );
                            })}
                          </div>
                          {data.measurements.some((m) => m.notes) && (
                            <div className="mt-2">
                              {data.measurements.filter((m) => m.notes).map((m, i) => (
                                <p key={i} className="text-[10px]" style={{ color: S.sub }}>📝 {m.notes}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
