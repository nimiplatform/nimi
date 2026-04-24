import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonths, type ChildProfile } from '../../app-shell/app-store.js';
import { S } from '../../app-shell/page-style.js';
import { ChildAvatar } from '../../shared/child-avatar.js';
import { DentalHistoryView } from './dental-history-view.js';
import { DentalOverviewTab } from './dental-overview-tab.js';
import { OrthodonticTab } from './orthodontic-tab.js';

type DentalTab = 'overview' | 'history' | 'orthodontic';

/**
 * Top-level dental page. Responsibility is shell chrome (back link, title,
 * child switch pill, tab nav) + delegating to one of three admitted tabs.
 *
 * Admitted tabs come from orthodontic-contract.md#PO-ORTHO-001 three-layer model:
 *  - 概览: ortho dashboard approximation + next review date
 *  - 口腔记录: dental_records clinical timeline (includes ortho clinical events)
 *  - 正畸治疗: case + appliance + daily checkin surface
 */
export default function DentalPage() {
  const { activeChildId, setActiveChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [activeTab, setActiveTab] = useState<DentalTab>('overview');

  if (!child) {
    return (
      <div className={S.container} style={{ paddingTop: S.topPad }}>
        <div className="p-8 text-[13px]" style={{ color: S.sub }}>请先添加孩子</div>
      </div>
    );
  }

  const ageMonths = computeAgeMonths(child.birthDate);

  return (
    <div className={S.container} style={{ paddingTop: S.topPad, minHeight: '100%' }}>
      <div className="flex items-center gap-2 mb-3">
        <Link to="/profile" className="text-[12px] hover:underline flex items-center gap-1.5" style={{ color: S.sub }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          返回档案
        </Link>
      </div>

      <div className="flex items-end justify-between gap-4 flex-wrap mb-4">
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: '-0.025em', color: S.text }}>口腔档案</h1>
          <div className="mt-3">
            <ChildSwitchPill
              activeChildId={activeChildId}
              setActiveChildId={setActiveChildId}
              childList={children}
            />
          </div>
        </div>
      </div>

      <TabNav activeTab={activeTab} onChange={setActiveTab} />

      <div className="mt-4">
        {activeTab === 'overview' && (
          <DentalOverviewTab childId={child.childId} onOpenOrthodontic={() => setActiveTab('orthodontic')} />
        )}
        {activeTab === 'history' && <DentalHistoryView />}
        {activeTab === 'orthodontic' && (
          <OrthodonticTab childId={child.childId} childBirthDate={child.birthDate} ageMonths={ageMonths} />
        )}
      </div>
    </div>
  );
}

/* ── Tab nav ─────────────────────────────────────────────── */

function TabNav({ activeTab, onChange }: { activeTab: DentalTab; onChange: (tab: DentalTab) => void }) {
  const tabs: Array<{ key: DentalTab; label: string }> = [
    { key: 'overview', label: '概览' },
    { key: 'history', label: '口腔记录' },
    { key: 'orthodontic', label: '正畸治疗' },
  ];
  return (
    <div style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 12, background: 'rgba(226,232,240,0.45)', border: '1px solid rgba(226,232,240,0.6)', width: 'fit-content' }}>
      {tabs.map((tab) => {
        const active = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            style={{
              border: 0,
              background: active ? '#ffffff' : 'transparent',
              color: active ? S.text : '#64748b',
              fontWeight: active ? 600 : 500,
              fontSize: 13,
              padding: '8px 16px',
              borderRadius: 10,
              cursor: 'pointer',
              boxShadow: active ? '0 1px 3px rgba(15,23,42,0.08)' : 'none',
              transition: 'all 160ms',
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Child switch pill (owned by dental-page shell) ───────── */

function ChildSwitchPill({
  activeChildId,
  setActiveChildId,
  childList,
}: {
  activeChildId: string | null;
  setActiveChildId: (id: string | null) => void;
  childList: ChildProfile[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const activeChild = childList.find((c) => c.childId === activeChildId);
  if (!activeChild) return null;
  const canSwitch = childList.length > 1;
  const fmtAge = (am: number) => am < 24 ? `${am}月` : `${Math.floor(am / 12)}岁${am % 12 > 0 ? `${am % 12}月` : ''}`;

  const renderAvatar = (c: ChildProfile, size: number, active: boolean) => (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      display: 'grid', placeItems: 'center',
      flexShrink: 0, overflow: 'hidden',
      outline: active ? '2px solid rgba(78, 204, 163, 0.45)' : '1px solid rgba(226, 232, 240, 0.95)',
    }}>
      <ChildAvatar child={c} className="h-full w-full object-cover" />
    </div>
  );

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" onClick={() => { if (canSwitch) setOpen((v) => !v); }} disabled={!canSwitch}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '4px 10px 4px 4px', background: '#eef2f6',
          borderRadius: 999, border: 0,
          cursor: canSwitch ? 'pointer' : 'default',
        }}>
        {renderAvatar(activeChild, 26, false)}
        <span style={{ fontSize: 13, fontWeight: 600, color: S.text, letterSpacing: '-0.01em' }}>{activeChild.displayName}</span>
        <span style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1 }}>·</span>
        <span style={{ fontSize: 12, color: '#64748b' }}>{fmtAge(computeAgeMonths(activeChild.birthDate))}</span>
        {canSwitch && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round"
            style={{ marginLeft: 2, transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 160ms' }}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        )}
      </button>

      {canSwitch && open && (
        <div style={{
          position: 'absolute', left: 0, top: 'calc(100% + 6px)', minWidth: 220,
          background: '#ffffff', borderRadius: 14, padding: 6,
          boxShadow: '0 10px 32px rgba(15,23,42,0.12)',
          border: '1px solid rgba(226,232,240,0.9)', zIndex: 50,
        }}>
          {childList.map((c) => {
            const isActive = c.childId === activeChildId;
            return (
              <button key={c.childId} type="button"
                onClick={() => { setActiveChildId(c.childId); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '8px 10px', borderRadius: 10,
                  background: isActive ? 'rgba(78,204,163,0.10)' : 'transparent',
                  border: 0, cursor: 'pointer', textAlign: 'left',
                }}>
                {renderAvatar(c, 28, isActive)}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: isActive ? '#2F7D6B' : S.text }}>{c.displayName}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>
                    {fmtAge(computeAgeMonths(c.birthDate))} · {c.gender === 'female' ? '女孩' : '男孩'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
