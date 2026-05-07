import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonths } from '../../app-shell/app-store.js';
import { S } from '../../app-shell/page-style.js';
import { DentalHistoryView } from './dental-history-view.js';
import { OrthodonticPage } from './orthodontic-page.js';

type DentalTab = 'history' | 'orthodontic';

/**
 * Top-level dental page. Responsibility is shell chrome (back link, title,
 * tab nav) + delegating to one of two admitted tabs. Child switching
 * is handled by the global header next to the ParentOS logo.
 *
 *  - 口腔记录: dental_records clinical timeline (includes ortho clinical events)
 *  - 正畸治疗: case + appliance + daily checkin surface
 */
export default function DentalPage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [activeTab, setActiveTab] = useState<DentalTab>('history');

  if (!child) {
    return (
      <div className={S.container} style={{ paddingTop: S.topPad }}>
        <div className="p-8 text-[14px]" style={{ color: S.sub }}>请先添加孩子</div>
      </div>
    );
  }

  const ageMonths = computeAgeMonths(child.birthDate);

  return (
    <div className={S.container} style={{ paddingTop: S.topPad, minHeight: '100%' }}>
      <div className="flex items-center gap-2 mb-3">
        <Link to="/profile" className="text-[14px] hover:underline flex items-center gap-1.5" style={{ color: S.sub }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          返回档案
        </Link>
      </div>

      <div className="flex items-end justify-between gap-4 flex-wrap mb-4">
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: '-0.025em', color: S.text }}>口腔档案</h1>
        </div>
      </div>

      <TabNav activeTab={activeTab} onChange={setActiveTab} />

      <div className="mt-4">
        {activeTab === 'history' && <DentalHistoryView />}
        {activeTab === 'orthodontic' && (
          <OrthodonticPage childId={child.childId} childBirthDate={child.birthDate} ageMonths={ageMonths} />
        )}
      </div>
    </div>
  );
}
/* ── Tab nav ─────────────────────────────────────────────── */

function TabNav({ activeTab, onChange }: { activeTab: DentalTab; onChange: (tab: DentalTab) => void }) {
  const tabs: Array<{ key: DentalTab; label: string }> = [
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
