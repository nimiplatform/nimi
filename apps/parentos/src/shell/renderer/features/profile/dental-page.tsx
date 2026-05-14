import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAppStore, computeAgeMonths } from '../../app-shell/app-store.js';
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
      <div className="mx-auto max-w-3xl px-6 pb-6 pt-[72px]">
        <div className="p-8 text-[14px] text-[var(--nimi-text-muted)]">请先添加孩子</div>
      </div>
    );
  }

  const ageMonths = computeAgeMonths(child.birthDate);

  // Wave D keeps this page slightly wider than profile reading pages so the
  // ortho hero / tray / next-visit triad has breathing room.
  return (
    <div className="mx-auto min-h-full max-w-4xl px-6 pb-6 pt-[72px]">
      <div className="flex items-center gap-2 mb-3">
        <Link
          to="/profile"
          className="text-[14px] hover:underline flex items-center gap-1.5 text-[var(--nimi-text-muted)]"
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
          <h1 className="m-0 text-[36px] font-bold leading-[1.1] text-[var(--nimi-text-primary)]">
            口腔档案
          </h1>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabNav activeTab={activeTab} onChange={setActiveTab} />
        {activeTab === 'orthodontic' && (
          <AddApplianceButton
            onClick={() => setActionRequest({ kind: 'add-appliance', nonce: Date.now() })}
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
 * "添加矫治器" button next to the tab strip on the orthodontic tab.
 *
 * Earlier this slot held a dropdown with "添加矫治器" + "记录临床事件" siblings.
 * The clinical-event entry was retired (the contextual `记录就诊` and
 * `记录异常` buttons inside the treatment card cover that flow), so the
 * dropdown layer is dropped and the single remaining action is surfaced
 * directly as a plain button.
 */
function AddApplianceButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      onClick={onClick}
      tone="secondary"
      size="sm"
      className="rounded-full whitespace-nowrap"
      leadingIcon={
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
      }
    >
      添加矫治器
    </Button>
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
    <Surface
      tone="card"
      material="glass-regular"
      elevation="base"
      padding="none"
      className="inline-flex w-fit rounded-full p-1"
    >
      {tabs.map((tab) => {
        const active = activeTab === tab.key;
        return (
          <Button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            tone={active ? 'primary' : 'ghost'}
            size="sm"
            className="rounded-full whitespace-nowrap"
            aria-pressed={active}
          >
            {tab.label}
          </Button>
        );
      })}
    </Surface>
  );
}
