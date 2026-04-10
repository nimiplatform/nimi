import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useAppStore, computeAgeMonths, type ChildProfile } from '../../app-shell/app-store.js';
import { getAppSetting, setAppSetting } from '../../bridge/sqlite-bridge.js';
import type { MeasurementRow } from '../../bridge/sqlite-bridge.js';
import { isoNow } from '../../bridge/ulid.js';
import { Settings } from 'lucide-react';
import { C, ALL_METRICS, METRIC_MAP, DEFAULT_METRICS, SETTING_KEY, type MetricDef } from './timeline-data.js';

/* ================================================================
   SHARED UI
   ================================================================ */

export function Cd({ children, cls = '', style }: { children: React.ReactNode; cls?: string; style?: React.CSSProperties }) {
  return <div className={`bg-white ${C.radius} p-5 ${cls}`} style={{ boxShadow: C.shadow, ...style }}>{children}</div>;
}

export function Bar({ pct, h = 6 }: { pct: number; h?: number }) {
  return (
    <div className="w-full rounded-full bg-[#e8e5e0] overflow-hidden" style={{ height: h }}>
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, pct)}%`, background: C.accent }} />
    </div>
  );
}

export function Ring({ pct, size = 56, sw = 5, dark = false }: { pct: number; size?: number; sw?: number; dark?: boolean }) {
  const r = (size - sw) / 2, ci = 2 * Math.PI * r, off = ci - (Math.min(100, pct) / 100) * ci;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={dark ? 'rgba(255,255,255,0.2)' : '#e8e5e0'} strokeWidth={sw} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.accent} strokeWidth={sw}
          strokeDasharray={ci} strokeDashoffset={off} strokeLinecap="round" className="transition-all duration-700" />
      </svg>
      <span className={`absolute inset-0 flex items-center justify-center text-xs font-bold ${dark ? 'text-white' : ''}`} style={{ color: dark ? '#fff' : C.text }}>{pct}%</span>
    </div>
  );
}

export function Hdr({ title, to, link = '查看全部' }: { title: string; to?: string; link?: string }) {
  const isPlus = link === '+';
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-[13px] font-semibold" style={{ color: C.text }}>{title}</h3>
      {to && (
        isPlus ? (
          <Link to={to} className="flex items-center justify-center w-[24px] h-[24px] rounded-full transition-colors hover:bg-[#e0e2de]" style={{ background: '#eceeed' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8a8f9a" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </Link>
        ) : (
          <Link to={to} className="text-[11px] hover:underline" style={{ color: C.sub }}>{link}</Link>
        )
      )}
    </div>
  );
}

/* ================================================================
   METRIC SETTINGS MODAL
   ================================================================ */

export function MetricSettingsModal({ selected, onSave, onClose }: {
  selected: string[]; onSave: (ids: string[]) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState<Set<string>>(() => new Set(selected));

  const toggle = (id: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { if (next.size > 3) next.delete(id); } // min 3
      else { if (next.size < 6) next.add(id); } // max 6
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.3)' }} onClick={onClose}>
      <div className="w-[400px] rounded-[18px] p-6 shadow-xl" style={{ background: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-[16px] font-bold" style={{ color: C.text }}>自定义监测指标</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#f0f0ec]" style={{ color: C.sub }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <p className="text-[11px] mb-4" style={{ color: C.sub }}>选择 3-6 个指标展示在成长数据监测中</p>

        <div className="grid grid-cols-3 gap-2 mb-5">
          {ALL_METRICS.map((m) => {
            const on = draft.has(m.id);
            return (
              <button key={m.id} onClick={() => toggle(m.id)}
                className="flex flex-col items-center gap-1 py-3 rounded-[12px] border-[1.5px] transition-all duration-150"
                style={{
                  borderColor: on ? '#94A533' : '#e8eae6',
                  background: on ? '#f4f7ea' : '#fff',
                }}>
                <span className="text-[20px]">{m.emoji}</span>
                <span className="text-[10px] font-medium" style={{ color: on ? '#94A533' : C.sub }}>{m.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex gap-2">
          <button onClick={() => { onSave(Array.from(draft)); onClose(); }}
            className="flex-1 py-2 rounded-[10px] text-[13px] font-medium text-white transition-colors hover:opacity-90"
            style={{ background: '#94A533' }}>
            保存
          </button>
          <button onClick={onClose}
            className="px-4 py-2 rounded-[10px] text-[13px] font-medium transition-colors hover:bg-[#e8eae6]"
            style={{ color: C.sub, background: '#f0f0ec' }}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   CHILD OVERVIEW CARD — age-adaptive summary
   ================================================================ */

export function ChildOverviewCard({ latest, vaccineCount, vacTotal, vacPct, msPct, sleepDays, measurements }: {
  latest: Map<string, MeasurementRow>;
  vacPct: number; vaccineCount: number; vacTotal: number; msPct: number;
  sleepDays: number; measurements: MeasurementRow[];
}) {
  const [showSettings, setShowSettings] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>(DEFAULT_METRICS);

  // Load persisted preference
  useEffect(() => {
    getAppSetting(SETTING_KEY).then((v) => {
      if (v) { try { const arr = JSON.parse(v); if (Array.isArray(arr) && arr.length >= 3) setSelectedIds(arr); } catch { /* ignore */ } }
    }).catch(() => {});
  }, []);

  const handleSave = (ids: string[]) => {
    setSelectedIds(ids);
    setAppSetting(SETTING_KEY, JSON.stringify(ids), isoNow()).catch(() => {});
  };

  const extra = { sleepDays, vaccineCount, vacTotal, vacPct, msPct };
  const visibleMetrics = selectedIds.map((id) => METRIC_MAP.get(id)).filter(Boolean) as MetricDef[];

  // Split into rows of 3
  const row1 = visibleMetrics.slice(0, 3);
  const row2 = visibleMetrics.slice(3, 6);

  const renderGrid = (items: MetricDef[]) => (
    <div className="grid grid-cols-3 gap-3">
      {items.map((m) => {
        const { value, sub } = m.getValue(latest, extra);
        return (
          <div key={m.id} className="rounded-[14px] p-3 transition-colors hover:bg-[#f0f2ee]" style={{ background: '#f7f8f6' }}>
            <div className="flex items-start justify-between mb-3">
              <div className="w-[36px] h-[36px] rounded-[10px] flex items-center justify-center text-[18px]" style={{ background: '#fff' }}>{m.emoji}</div>
              <span className="text-[11px] font-medium" style={{ color: C.sub }}>{m.label}</span>
            </div>
            <p className="text-[20px] font-bold leading-none" style={{ color: C.text }}>{value}</p>
            <p className="text-[10px] mt-1" style={{ color: C.sub }}>{sub}</p>
          </div>
        );
      })}
    </div>
  );

  return (
    <Cd cls="col-span-6 row-span-2">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <h3 className="text-[14px] font-bold" style={{ color: C.text }}>成长数据</h3>
          <span className="text-[10px]" style={{ color: C.sub }}>
            {(() => {
              if (measurements.length === 0) return '暂无记录';
              const latest_ = measurements.reduce((a, b) => a.measuredAt > b.measuredAt ? a : b);
              const d = new Date(latest_.measuredAt);
              const now = new Date();
              const diffD = Math.floor((now.getTime() - d.getTime()) / 86400000);
              if (diffD === 0) return `今天 ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 更新`;
              if (diffD === 1) return '昨天更新';
              if (diffD < 7) return `${diffD}天前更新`;
              return `${d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })} 更新`;
            })()}
          </span>
        </div>
        <button onClick={() => setShowSettings(true)}
          className="w-[28px] h-[28px] rounded-full flex items-center justify-center transition-colors hover:bg-[#e8eae6]"
          style={{ color: C.sub }} title="自定义指标">
          <Settings size={16} strokeWidth={1.8} />
        </button>
      </div>

      <div className="mt-3 space-y-3">
        {renderGrid(row1)}
        {row2.length > 0 && renderGrid(row2)}
      </div>

      {showSettings && (
        <MetricSettingsModal selected={selectedIds} onSave={handleSave} onClose={() => setShowSettings(false)} />
      )}
    </Cd>
  );
}

/* ================================================================
   CHILD PROFILE CARD (with flip-to-switch animation)
   ================================================================ */

export function ChildProfileCard({ child, childList, ageY, ageR, pct }: {
  child: ChildProfile; childList: ChildProfile[]; ageY: number; ageR: number; pct: number;
}) {
  const { setActiveChildId } = useAppStore();
  const [flipping, setFlipping] = useState(false);
  const [pickerMounted, setPickerMounted] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pendingChildRef = useRef<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const openPicker = useCallback(() => {
    setPickerMounted(true);
    // rAF so the DOM is painted before triggering the CSS transition
    requestAnimationFrame(() => requestAnimationFrame(() => setPickerOpen(true)));
  }, []);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    // unmount after transition (200ms)
  }, []);

  const switchTo = useCallback((targetId: string) => {
    if (targetId === child.childId) { closePicker(); return; }
    pendingChildRef.current = targetId;
    closePicker();
    setFlipping(true);
  }, [child.childId, closePicker]);

  const handleAnimEnd = () => {
    if (pendingChildRef.current) {
      setActiveChildId(pendingChildRef.current);
      pendingChildRef.current = null;
    }
    setFlipping(false);
  };

  // Close picker on outside click
  useEffect(() => {
    if (!pickerMounted) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) closePicker();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pickerMounted, closePicker]);

  return (
    <div className={`col-span-2 row-span-2 ${C.radius} relative overflow-hidden`}
      style={{ perspective: 800, boxShadow: C.shadow }}>
      <div
        onAnimationEnd={handleAnimEnd}
        className={`w-full h-full ${C.radius} p-6 relative`}
        style={{
          background: C.cardProfile,
          transformStyle: 'preserve-3d',
          animation: flipping ? 'cardFlip 0.5s ease-in-out' : undefined,
        }}
      >
        {/* Switch-child button (top-right) */}
        {childList.length > 1 && (
          <div ref={pickerRef} className="absolute top-4 right-4 z-20">
            <button onClick={() => pickerOpen ? closePicker() : openPicker()}
              className="w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-white/20"
              style={{ color: 'rgba(255,255,255,0.7)' }} title="切换孩子">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
                <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
              </svg>
            </button>
            {/* Child picker popover */}
            {pickerMounted && (
              <div
                className="absolute right-0 top-9 min-w-[180px] rounded-xl p-1.5"
                onTransitionEnd={() => { if (!pickerOpen) setPickerMounted(false); }}
                style={{
                  background: '#fff',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                  opacity: pickerOpen ? 1 : 0,
                  transform: pickerOpen ? 'translateY(0) scale(1)' : 'translateY(-8px) scale(0.95)',
                  transformOrigin: 'top right',
                  transition: 'opacity 0.2s ease, transform 0.2s ease',
                  pointerEvents: pickerOpen ? 'auto' : 'none',
                }}>
                {childList.map((c, idx) => {
                  const am = computeAgeMonths(c.birthDate);
                  const y = Math.floor(am / 12);
                  const m = am % 12;
                  const isActive = c.childId === child.childId;
                  return (
                    <button key={c.childId} onClick={() => switchTo(c.childId)}
                      className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-left transition-colors hover:bg-[#f5f3ef]"
                      style={{
                        ...(isActive ? { background: '#EEF3F1' } : undefined),
                        opacity: pickerOpen ? 1 : 0,
                        transform: pickerOpen ? 'translateY(0)' : 'translateY(-4px)',
                        transition: `opacity 0.2s ease ${idx * 0.03}s, transform 0.2s ease ${idx * 0.03}s`,
                      }}>
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                        style={{ background: isActive ? C.cardProfile : '#e0e4e8', color: isActive ? '#fff' : C.text }}>
                        {c.displayName.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <span className="block text-[12px] font-medium truncate" style={{ color: C.text }}>{c.displayName}</span>
                        <span className="block text-[10px]" style={{ color: '#8a8f9a' }}>
                          {y > 0 ? `${y}岁` : ''}{m > 0 ? `${m}个月` : ''} · {c.gender === 'female' ? '女孩' : '男孩'}
                        </span>
                      </div>
                      {isActive && (
                        <svg className="ml-auto shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.cardProfile} strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="relative flex flex-col items-center text-center h-full justify-center">
          {child.avatarPath ? (
            <img src={convertFileSrc(child.avatarPath)} alt="" className="w-[80px] h-[80px] rounded-full object-cover border-[3px] shadow-sm mb-3" style={{ borderColor: 'rgba(255,255,255,0.5)' }} />
          ) : (
            <div className="w-[80px] h-[80px] rounded-full flex items-center justify-center border-[3px] mb-3" style={{ background: 'rgba(255,255,255,0.35)', borderColor: 'rgba(255,255,255,0.5)' }}>
              <span className="text-3xl font-bold text-white">{child.displayName.charAt(0)}</span>
            </div>
          )}
          <h2 className="text-lg font-bold text-white">{child.displayName}</h2>
          <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
            {ageY > 0 ? `${ageY}岁` : ''}{ageR > 0 ? `${ageR}个月` : ''} · {child.gender === 'female' ? '女孩' : '男孩'}
          </p>
          {/* Record button */}
          <Link to="/profile/growth" className="flex items-center gap-1.5 mt-4 px-5 py-2 rounded-full text-[12px] font-semibold transition-all hover:shadow-lg hover:scale-105"
            style={{ background: '#fff', color: C.cardProfile, boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            记录数据
          </Link>
        </div>
      </div>
    </div>
  );
}
