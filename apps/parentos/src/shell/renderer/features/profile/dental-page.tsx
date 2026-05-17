import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppStore, computeAgeMonths } from '../../app-shell/app-store.js';
import { DentalHistoryView } from './dental-history-view.js';
import { OrthodonticPage } from './orthodontic-page.js';
import { NoActiveChildPlaceholder } from './_shared/no-active-child-placeholder.js';
import { ProfileDetailShell } from './_shared/profile-detail-shell.js';

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
 *
 * The per-tab primary action ("添加记录" / "添加矫治器") lives inline at the
 * top of each tab's content area, not in the shell header — both tabs render
 * their action button via the same right-aligned in-content row pattern.
 */
export default function DentalPage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<DentalTab>(() => readInitialTab(searchParams));

  if (!child) {
    return (
      <ProfileDetailShell title="口腔档案">
        <NoActiveChildPlaceholder />
      </ProfileDetailShell>
    );
  }

  const ageMonths = computeAgeMonths(child.birthDate);

  return (
    <ProfileDetailShell
      title="口腔档案"
      subnav={<TabNav activeTab={activeTab} onChange={setActiveTab} />}
    >
      {activeTab === 'history' && <DentalHistoryView />}
      {activeTab === 'orthodontic' && (
        <OrthodonticPage
          childId={child.childId}
          childBirthDate={child.birthDate}
          ageMonths={ageMonths}
        />
      )}
    </ProfileDetailShell>
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
