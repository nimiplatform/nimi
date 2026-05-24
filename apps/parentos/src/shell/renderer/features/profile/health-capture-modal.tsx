import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { computeAgeMonths } from '../../app-shell/app-store.js';
import type { SaveHealthRecordCaptureResult } from '../../bridge/sqlite-bridge.js';
import { getHealthRecordEventCaptureProtocolOptions, type LinkedHealthRecordReminder } from './health-capture-orchestrator.js';
import { groupLabel } from './health-record-display.js';
import { GrowthAddRecordContent } from './growth-capture-content.js';
import { VisionBatchFormContent } from './vision-batch-form.js';
import { SleepFormContent } from './sleep-record-form.js';
import { FitnessAssessmentFormContent } from './fitness-assessment-form.js';
import {
  EMPTY_SMART_INPUT_STATE,
  MedicalEventFormContent,
  type SmartInputState,
} from './medical-events-form.js';
import { MilestoneCaptureContent } from './milestone-capture-form.js';
import { OutdoorCaptureContent } from './outdoor-capture-form.js';
import { DentalCaptureContent } from './dental-capture-form.js';
import { hasMilestoneCandidatesForAge } from './milestone-capture-form.js';
import { TannerCaptureContent } from './tanner-assessment-form.js';
import { PostureCaptureContent } from './posture-capture-form.js';
import { VaccineCaptureContent } from './vaccine-capture-form.js';
import { Button } from '@nimiplatform/kit/ui';
import { useAppStore } from '../../app-shell/app-store.js';
import {
  ChipGroup,
  HealthRecordModalShell,
  HealthRecordSidebar,
  type HealthRecordSidebarItem,
  type HealthModalSize,
  ModalContent,
  ModalFooter,
  ModalHeader,
  SmartInputButton,
} from './health-record-modal-shell.js';

interface HealthCaptureModalProps {
  open: boolean;
  childId: string;
  childBirthDate: string;
  initialGroupId?: string | null;
  initialMetricId?: string | null;
  /**
   * Set when the modal is opened from a record_data reminder. Per-group forms
   * thread these IDs into the underlying insert so health_record_events rows
   * land with linkedReminderStateId/linkedReminderRuleId (capture-orchestrator-
   * contract.md, local-storage.yaml).
   */
  linkedReminder?: LinkedHealthRecordReminder | null;
  /**
   * When set, the left domain sidebar is hidden and the modal is locked to
   * `initialGroupId`. Detail pages (`/profile/*`) open the modal this way so
   * their "添加" button shows only the relevant domain's capture form — the
   * same right-pane form as the `/profile` 添加健康数据 modal, without the
   * domain switcher.
   */
  hideSidebar?: boolean;
  onClose: () => void;
  onSaved?: (result: SaveHealthRecordCaptureResult) => void;
}

/**
 * Map each capture group to its modal size per the unified spec.
 *  M (720)  → growth, sleep, outdoor
 *  L (920)  → fitness
 *  XL (1040) → vision, dental, medical, development (Tanner / milestone)
 */
const GROUP_SIZE: Record<string, HealthModalSize> = {
  growth: 'M',
  sleep: 'M',
  outdoor: 'M',
  vaccine: 'M',
  fitness: 'L',
  posture: 'L',
  vision: 'XL',
  dental: 'XL',
  medical: 'XL',
  development: 'XL',
};

const PROTOTYPE_GROUPS = new Set(Object.keys(GROUP_SIZE));

const GROUP_EMOJI: Record<string, string> = {
  growth: '📏',
  sleep: '🌙',
  outdoor: '☀️',
  vaccine: '💉',
  fitness: '🏃',
  posture: '🧍',
  vision: '👁️',
  dental: '🦷',
  medical: '🏥',
  development: '🌱',
};

const SIDEBAR_GROUP_ORDER: readonly string[] = [
  'growth',
  'fitness',
  'posture',
  'sleep',
  'outdoor',
  'vision',
  'vaccine',
  'dental',
  'medical',
  'development',
];

/**
 * Sidebar entries that are not spec-derived `HEALTH_METRIC_GROUPS` capture
 * options. `vaccine` is a retained-owner stateful domain
 * (health-record-console-contract.md#PO-HREC-007) — it writes to
 * `vaccine_records`, so it has no `health_record_events` capture protocol.
 */
const VIRTUAL_SIDEBAR_ITEMS: ReadonlyArray<{ id: string; emoji: string; label: string }> = [
  { id: 'posture', emoji: '🧍', label: '体态' },
  { id: 'vaccine', emoji: '💉', label: '疫苗' },
];

function sortOptionsForSidebar<T extends { group: { groupId: string } }>(options: readonly T[]): T[] {
  const indexOf = (groupId: string) => {
    const idx = SIDEBAR_GROUP_ORDER.indexOf(groupId);
    return idx === -1 ? SIDEBAR_GROUP_ORDER.length : idx;
  };
  return [...options].sort((a, b) => indexOf(a.group.groupId) - indexOf(b.group.groupId));
}

export function HealthCaptureModal(props: HealthCaptureModalProps) {
  if (!props.open) return null;
  return <SidebarHealthCaptureModal {...props} />;
}

function SidebarHealthCaptureModal({
  childId,
  childBirthDate,
  initialGroupId,
  initialMetricId,
  linkedReminder,
  hideSidebar,
  onClose,
  onSaved,
}: HealthCaptureModalProps) {
  const { t } = useTranslation();
  const ageMonths = computeAgeMonths(childBirthDate);
  const isUnder6 = ageMonths <= 72;
  const options = useMemo(() => sortOptionsForSidebar(getHealthRecordEventCaptureProtocolOptions()), []);
  const [selectedGroupId, setSelectedGroupId] = useState(() => {
    const isOption = options.some((option) => option.group.groupId === initialGroupId);
    const isVirtual = VIRTUAL_SIDEBAR_ITEMS.some((item) => item.id === initialGroupId);
    if (initialGroupId && (isOption || isVirtual)) {
      return initialGroupId;
    }
    return options[0]?.group.groupId ?? 'growth';
  });
  const milestoneAvailable = hasMilestoneCandidatesForAge(ageMonths);
  const initialDevelopmentTab: 'milestone' | 'tanner' =
    initialMetricId && initialMetricId !== 'development.milestone'
      ? 'tanner'
      : milestoneAvailable
        ? 'milestone'
        : 'tanner';
  const [developmentTab, setDevelopmentTab] = useState<'milestone' | 'tanner'>(initialDevelopmentTab);
  const [smartInput, setSmartInput] = useState<SmartInputState>(EMPTY_SMART_INPUT_STATE);
  const { children } = useAppStore();
  const child = children.find((item) => item.childId === childId);

  const handleSavedFromGroup = () => {
    onSaved?.({ eventId: '' } as SaveHealthRecordCaptureResult);
  };

  const sidebarItems: HealthRecordSidebarItem[] = [
    ...options.map((option) => ({
      id: option.group.groupId,
      emoji: GROUP_EMOJI[option.group.groupId],
      label: groupLabel(option.group.groupId, option.group.displayName, t),
      disabled: !PROTOTYPE_GROUPS.has(option.group.groupId),
    })),
    ...VIRTUAL_SIDEBAR_ITEMS.map((item) => ({
      id: item.id,
      emoji: item.emoji,
      label: item.label,
      disabled: false,
    })),
  ].sort((a, b) => {
    const indexOf = (id: string) => {
      const idx = SIDEBAR_GROUP_ORDER.indexOf(id);
      return idx === -1 ? SIDEBAR_GROUP_ORDER.length : idx;
    };
    return indexOf(a.id) - indexOf(b.id);
  });

  const renderContent = () => {
    if (selectedGroupId === 'growth') {
      return (
        <GrowthAddRecordContent
          childId={childId}
          birthDate={childBirthDate}
          isUnder6={isUnder6}
          onSaved={handleSavedFromGroup}
          onClose={onClose}
          linkedReminder={linkedReminder}
        />
      );
    }
    if (selectedGroupId === 'vision') {
      return (
        <VisionBatchFormContent
          childId={childId}
          birthDate={childBirthDate}
          onSave={handleSavedFromGroup}
          onClose={onClose}
        />
      );
    }
    if (selectedGroupId === 'sleep') {
      return (
        <SleepFormContent
          child={{ childId, birthDate: childBirthDate }}
          onSaved={handleSavedFromGroup}
          onClose={onClose}
        />
      );
    }
    if (selectedGroupId === 'fitness') {
      return (
        <FitnessAssessmentFormContent
          child={{ childId, birthDate: childBirthDate, gender: child?.gender ?? 'male' }}
          ageMonths={ageMonths}
          onSaved={handleSavedFromGroup}
          onClose={onClose}
          linkedReminder={linkedReminder}
        />
      );
    }
    if (selectedGroupId === 'medical') {
      return (
        <MedicalEventFormContent
          child={{
            childId,
            birthDate: childBirthDate,
            gender: child?.gender ?? 'male',
            displayName: child?.displayName ?? '',
          }}
          onSaved={handleSavedFromGroup}
          onClose={onClose}
          onSmartInputStateChange={setSmartInput}
        />
      );
    }
    if (selectedGroupId === 'development') {
      const tabs = milestoneAvailable
        ? ([
            { value: 'milestone' as const, label: '里程碑', emoji: '🎯' },
            { value: 'tanner' as const, label: '青春期评估', emoji: '🌱' },
          ] as const)
        : ([{ value: 'tanner' as const, label: '青春期评估', emoji: '🌱' }] as const);
      return (
        <DevelopmentTabContent
          tabs={tabs}
          activeTab={developmentTab}
          onTabChange={setDevelopmentTab}
          milestoneAvailable={milestoneAvailable}
          childId={childId}
          birthDate={childBirthDate}
          gender={child?.gender ?? 'male'}
          ageMonths={ageMonths}
          onClose={onClose}
          onSaved={handleSavedFromGroup}
          linkedReminder={linkedReminder}
        />
      );
    }
    if (selectedGroupId === 'outdoor') {
      return (
        <OutdoorCaptureContent
          child={{ childId }}
          onSaved={handleSavedFromGroup}
          onClose={onClose}
          linkedReminder={linkedReminder}
        />
      );
    }
    if (selectedGroupId === 'dental') {
      return (
        <DentalCaptureContent
          child={{ childId, birthDate: childBirthDate }}
          ageMonths={ageMonths}
          onSaved={handleSavedFromGroup}
          onClose={onClose}
        />
      );
    }
    if (selectedGroupId === 'posture') {
      return (
        <PostureCaptureContent
          child={{ childId, birthDate: childBirthDate }}
          onSaved={handleSavedFromGroup}
          onClose={onClose}
        />
      );
    }
    if (selectedGroupId === 'vaccine') {
      return (
        <VaccineCaptureContent
          child={{ childId, birthDate: childBirthDate }}
          onSaved={handleSavedFromGroup}
          onClose={onClose}
        />
      );
    }
    return <ComingSoonPanel onClose={onClose} />;
  };

  const size: HealthModalSize = GROUP_SIZE[selectedGroupId] ?? 'M';

  return (
    <HealthRecordModalShell
      open
      size={size}
      onClose={onClose}
      sidebar={
        hideSidebar ? undefined : (
          <HealthRecordSidebar
            items={sidebarItems}
            selected={selectedGroupId}
            onSelect={setSelectedGroupId}
            footer={
              smartInput.onUpload ? (
                <SmartInputButton
                  loading={smartInput.loading}
                  error={smartInput.error}
                  imageName={smartInput.imageName}
                  onUpload={smartInput.onUpload}
                />
              ) : null
            }
          />
        )
      }
    >
      {renderContent()}
    </HealthRecordModalShell>
  );
}

/* ── Development tab (milestone / tanner) ─────────────────────────────── */

type DevelopmentTabValue = 'milestone' | 'tanner';

type DevelopmentTabContentProps = {
  tabs: ReadonlyArray<{ value: DevelopmentTabValue; label: string; emoji: string }>;
  activeTab: DevelopmentTabValue;
  onTabChange: (next: DevelopmentTabValue) => void;
  milestoneAvailable: boolean;
  childId: string;
  birthDate: string;
  gender: string;
  ageMonths: number;
  onClose: () => void;
  onSaved: () => void;
  linkedReminder?: LinkedHealthRecordReminder | null;
};

function DevelopmentTabContent({
  tabs,
  activeTab,
  onTabChange,
  milestoneAvailable,
  childId,
  birthDate,
  gender,
  ageMonths,
  onClose,
  onSaved,
  linkedReminder,
}: DevelopmentTabContentProps) {
  const trailing =
    tabs.length > 1 ? (
      <ChipGroup
        size="sm"
        options={tabs.map((tab) => ({ value: tab.value, label: tab.label, emoji: tab.emoji }))}
        value={activeTab}
        onChange={(next) => onTabChange(next as DevelopmentTabValue)}
      />
    ) : null;

  if (activeTab === 'milestone' && milestoneAvailable) {
    return (
      <MilestoneCaptureContent
        child={{ childId }}
        ageMonths={ageMonths}
        onSaved={onSaved}
        onClose={onClose}
        headerTrailing={trailing}
      />
    );
  }
  return (
    <TannerCaptureContent
      child={{ childId, birthDate, gender: gender === 'female' ? 'female' : 'male' }}
      onSaved={onSaved}
      onClose={onClose}
      headerTrailing={trailing}
      linkedReminder={linkedReminder}
    />
  );
}

/* ── Coming-soon placeholder ──────────────────────────────────────────── */

function ComingSoonPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <ModalHeader title={t('Profile.capture.title', { defaultValue: '添加健康数据' })} onClose={onClose} />
      <ModalContent>
        <div className="flex h-full flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 text-[40px]">🚧</div>
          <p className="mb-2 text-[15px] font-semibold" style={{ color: 'var(--nimi-text-primary)' }}>
            {t('Profile.capture.comingSoonTitle', { defaultValue: '该分组录入即将上线' })}
          </p>
          <p className="text-[13px]" style={{ color: 'var(--nimi-text-muted)' }}>
            {t('Profile.capture.comingSoonDesc', { defaultValue: '该分类正在迁移到统一录入界面。' })}
          </p>
        </div>
      </ModalContent>
      <ModalFooter>
        <Button type="button" onClick={onClose} tone="ghost" size="md">关闭</Button>
      </ModalFooter>
    </>
  );
}
