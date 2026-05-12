import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAppStore, computeAgeMonths } from '../../app-shell/app-store.js';
import { S } from '../../app-shell/page-style.js';
import { DentalHistoryView } from './dental-history-view.js';
import {
  OrthodonticPage,
  type OrthodonticActionRequest,
} from './orthodontic-page.js';

type DentalTab = 'history' | 'orthodontic';

function readInitialTab(searchParams: URLSearchParams): DentalTab {
  return searchParams.get('tab') === 'orthodontic' ? 'orthodontic' : 'history';
}

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
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<DentalTab>(() => readInitialTab(searchParams));
  const [actionRequest, setActionRequest] = useState<OrthodonticActionRequest | null>(null);

  if (!child) {
    return (
      <div className={S.container} style={{ paddingTop: S.topPad }}>
        <div className="p-8 text-[14px]" style={{ color: S.sub }}>请先添加孩子</div>
      </div>
    );
  }

  const ageMonths = computeAgeMonths(child.birthDate);

  // Wave D widens the dental page container to 880 px so the new
  // ortho hero / tray / next-visit triad has breathing room. Scoped here
  // rather than touching the shared `S.container` so other profile pages
  // keep their 768 px reading rhythm.
  return (
    <div
      style={{
        maxWidth: 880,
        margin: '0 auto',
        padding: '0 24px 24px',
        paddingTop: S.topPad,
        minHeight: '100%',
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Link
          to="/profile"
          className="text-[14px] hover:underline flex items-center gap-1.5"
          style={{ color: S.sub }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          返回档案
        </Link>
      </div>

      <div className="flex items-end justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1
            style={{
              margin: 0,
              fontFamily: 'inherit',
              fontSize: 36,
              fontWeight: 700,
              letterSpacing: '-0.025em',
              lineHeight: 1.1,
              color: S.text,
            }}
          >
            口腔档案
          </h1>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <TabNav activeTab={activeTab} onChange={setActiveTab} />
        {activeTab === 'orthodontic' && (
          <OrthodonticToolbarMenu
            onRequest={(kind) => setActionRequest({ kind, nonce: Date.now() })}
          />
        )}
      </div>

      <div className="mt-4">
        {activeTab === 'history' && <DentalHistoryView />}
        {activeTab === 'orthodontic' && (
          <OrthodonticPage
            childId={child.childId}
            childBirthDate={child.birthDate}
            ageMonths={ageMonths}
            actionRequest={actionRequest}
            onActionRequestHandled={() => setActionRequest(null)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * "+" menu next to the tab strip. Wave D audit follow-up (W-D-1): the page
 * recomposition deleted the legacy footer buttons for "添加装置" / "记录临床
 * 事件" but did not surface a replacement, leaving "add a second appliance"
 * and "free-form clinical event" without an entry point. This menu is the
 * dedicated home for both — visible only on the orthodontic tab, dispatches
 * a typed `OrthodonticActionRequest` to the underlying page.
 */
function OrthodonticToolbarMenu({
  onRequest,
}: {
  onRequest: (kind: OrthodonticActionRequest['kind']) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (containerRef.current && !containerRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          padding: '6px 14px',
          borderRadius: 999,
          fontSize: 13,
          fontWeight: 500,
          background: 'transparent',
          border: '1px solid var(--nimi-border-subtle)',
          color: 'var(--nimi-text-secondary)',
          cursor: 'pointer',
          fontFamily: 'inherit',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          whiteSpace: 'nowrap',
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        添加
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 6px)',
            zIndex: 20,
            background: '#ffffff',
            border: '1px solid rgba(226,232,240,0.8)',
            borderRadius: 12,
            boxShadow: '0 12px 32px rgba(15,23,42,0.12)',
            minWidth: 200,
            padding: 4,
          }}
        >
          <ToolbarMenuItem
            label="添加装置"
            description="新增一副牙套或保持器"
            onClick={() => {
              setOpen(false);
              onRequest('add-appliance');
            }}
          />
          <ToolbarMenuItem
            label="记录临床事件"
            description="复诊 / 调整 / 不适记录"
            onClick={() => {
              setOpen(false);
              onRequest('log-clinical-event');
            }}
          />
        </div>
      )}
    </div>
  );
}

function ToolbarMenuItem({
  label,
  description,
  onClick,
}: {
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '8px 12px',
        border: 0,
        background: 'transparent',
        cursor: 'pointer',
        fontFamily: 'inherit',
        borderRadius: 8,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--nimi-surface-active)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--nimi-text-primary)' }}>
        {label}
      </div>
      <div style={{ fontSize: 12, color: 'var(--nimi-text-muted)', marginTop: 2 }}>
        {description}
      </div>
    </button>
  );
}
/* ── Tab nav ─────────────────────────────────────────────── */

function TabNav({
  activeTab,
  onChange,
}: {
  activeTab: DentalTab;
  onChange: (tab: DentalTab) => void;
}) {
  const tabs: Array<{ key: DentalTab; label: string }> = [
    { key: 'history', label: '口腔记录' },
    { key: 'orthodontic', label: '正畸治疗' },
  ];
  return (
    <div
      style={{
        display: 'inline-flex',
        padding: 4,
        borderRadius: 999,
        background: 'rgba(255,255,255,0.55)',
        border: '1px solid var(--nimi-border-subtle)',
        backdropFilter: 'blur(18px)',
        width: 'fit-content',
      }}
    >
      {tabs.map((tab) => {
        const active = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            style={{
              padding: '8px 18px',
              borderRadius: 999,
              border: 0,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              background: active ? S.text : 'transparent',
              color: active ? '#ffffff' : 'var(--nimi-text-secondary)',
              fontSize: 13,
              fontWeight: active ? 600 : 500,
              fontFamily: 'inherit',
              boxShadow: active ? '0 4px 14px rgba(15,23,42,0.18)' : 'none',
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
