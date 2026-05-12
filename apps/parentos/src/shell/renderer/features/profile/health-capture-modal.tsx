import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { computeAgeMonths, computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { saveHealthRecordCapture, type SaveHealthRecordCaptureResult } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import type { HealthCaptureProtocolId, HealthMetricDefinition, HealthMetricId } from '../../knowledge-base/index.js';
import {
  buildHealthCaptureEventInput,
  createDefaultHealthCaptureIntent,
  getCaptureMetrics,
  getHealthRecordEventCaptureProtocolOptions,
  type HealthCaptureDraftValue,
  type HealthCaptureIntent,
} from './health-capture-orchestrator.js';
import { groupLabel, metricLabel, protocolLabel } from './health-record-display.js';
import { GrowthAddRecordContent } from './growth-curve-add-record-modal.js';
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
import { useAppStore } from '../../app-shell/app-store.js';
import {
  CancelButton,
  ChipGroup,
  DateField,
  FormField,
  FormGrid,
  HEALTH_MODAL_TOKENS,
  HealthRecordModalShell,
  HealthRecordSidebar,
  type HealthRecordSidebarItem,
  type HealthModalSize,
  InlineError,
  Input,
  ModalContent,
  ModalFooter,
  ModalHeader,
  PrimaryButton,
  SectionCard,
  SmartInputButton,
} from './health-record-modal-shell.js';

interface HealthCaptureModalProps {
  open: boolean;
  childId: string;
  childBirthDate: string;
  initialIntent?: HealthCaptureIntent | null;
  initialGroupId?: string | null;
  initialMetricId?: string | null;
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
  fitness: 'L',
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
  fitness: '🏃',
  vision: '👁️',
  dental: '🦷',
  medical: '🏥',
  development: '🌱',
};

const SIDEBAR_GROUP_ORDER: readonly string[] = [
  'growth',
  'fitness',
  'sleep',
  'outdoor',
  'vision',
  'dental',
  'medical',
  'development',
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
  if (props.initialIntent) {
    return <LegacyHealthCaptureModal {...props} />;
  }
  return <SidebarHealthCaptureModal {...props} />;
}

function SidebarHealthCaptureModal({
  childId,
  childBirthDate,
  initialGroupId,
  initialMetricId,
  onClose,
  onSaved,
}: HealthCaptureModalProps) {
  const { t } = useTranslation();
  const ageMonths = computeAgeMonths(childBirthDate);
  const isUnder6 = ageMonths <= 72;
  const options = useMemo(() => sortOptionsForSidebar(getHealthRecordEventCaptureProtocolOptions()), []);
  const [selectedGroupId, setSelectedGroupId] = useState(() => {
    if (initialGroupId && options.some((option) => option.group.groupId === initialGroupId)) {
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

  const sidebarItems: HealthRecordSidebarItem[] = options.map((option) => ({
    id: option.group.groupId,
    emoji: GROUP_EMOJI[option.group.groupId],
    label: groupLabel(option.group.groupId, option.group.displayName, t),
    disabled: !PROTOTYPE_GROUPS.has(option.group.groupId),
  }));

  const renderContent = () => {
    if (selectedGroupId === 'growth') {
      return (
        <GrowthAddRecordContent
          childId={childId}
          birthDate={childBirthDate}
          isUnder6={isUnder6}
          onSaved={handleSavedFromGroup}
          onClose={onClose}
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
        />
      );
    }
    if (selectedGroupId === 'outdoor') {
      return (
        <OutdoorCaptureContent child={{ childId }} onSaved={handleSavedFromGroup} onClose={onClose} />
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
    return <ComingSoonPanel onClose={onClose} />;
  };

  const size: HealthModalSize = GROUP_SIZE[selectedGroupId] ?? 'M';

  return (
    <HealthRecordModalShell
      open
      size={size}
      onClose={onClose}
      sidebar={
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
          <p className="mb-2 text-[15px] font-semibold" style={{ color: HEALTH_MODAL_TOKENS.text }}>
            {t('Profile.capture.comingSoonTitle', { defaultValue: '该分组录入即将上线' })}
          </p>
          <p className="text-[13px]" style={{ color: HEALTH_MODAL_TOKENS.sub }}>
            {t('Profile.capture.comingSoonDesc', { defaultValue: '该分类正在迁移到统一录入界面。' })}
          </p>
        </div>
      </ModalContent>
      <ModalFooter>
        <CancelButton onClick={onClose}>关闭</CancelButton>
      </ModalFooter>
    </>
  );
}

/* ── Legacy capture modal (intent-driven; kept for reminder/protocol flow) ─ */

function LegacyHealthCaptureModal({
  childId,
  childBirthDate,
  initialIntent,
  onClose,
  onSaved,
}: HealthCaptureModalProps) {
  const { t } = useTranslation();
  const options = useMemo(() => sortOptionsForSidebar(getHealthRecordEventCaptureProtocolOptions()), []);
  const firstProtocol = options[0]?.protocols[0];
  const initialProtocolId = initialIntent?.protocolId ?? firstProtocol?.protocolId;
  const [selectedGroupId, setSelectedGroupId] = useState(initialIntent?.protocolId ? null : options[0]?.group.groupId ?? null);
  const [protocolId, setProtocolId] = useState<HealthCaptureProtocolId | null>(initialProtocolId ?? null);
  const [effectiveDate, setEffectiveDate] = useState(initialIntent?.effectiveDate ?? new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState(initialIntent?.notes ?? '');
  const [draftValues, setDraftValues] = useState<Partial<Record<HealthMetricId, HealthCaptureDraftValue>>>(
    initialIntent?.prefillValues ?? {},
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingMetricIds, setMissingMetricIds] = useState<ReadonlySet<HealthMetricId>>(() => new Set());
  const protocolLocked = initialIntent?.mode === 'reminder';

  useEffect(() => {
    const nextProtocolId = initialIntent?.protocolId ?? firstProtocol?.protocolId ?? null;
    setProtocolId(nextProtocolId);
    setSelectedGroupId(
      options.find((option) => option.protocols.some((protocol) => protocol.protocolId === nextProtocolId))?.group.groupId ??
        options[0]?.group.groupId ??
        null,
    );
    setEffectiveDate(initialIntent?.effectiveDate ?? new Date().toISOString().slice(0, 10));
    setNotes(initialIntent?.notes ?? '');
    setDraftValues(initialIntent?.prefillValues ?? {});
    setError(null);
    setMissingMetricIds(new Set());
  }, [firstProtocol?.protocolId, initialIntent, options]);

  const selectedOption = options.find((option) => option.group.groupId === selectedGroupId) ?? options[0] ?? null;
  const selectedProtocol =
    selectedOption?.protocols.find((protocol) => protocol.protocolId === protocolId) ??
    options.flatMap((option) => option.protocols).find((protocol) => protocol.protocolId === protocolId) ??
    selectedOption?.protocols[0] ??
    null;
  const metricSections = selectedProtocol ? getCaptureMetrics(selectedProtocol) : { required: [], optional: [] };

  const setMetricValue = (metricId: HealthMetricId, value: string) => {
    setDraftValues((previous) => ({ ...previous, [metricId]: { ...(previous[metricId] ?? {}), value } }));
    if (missingMetricIds.has(metricId) && value.trim().length > 0) {
      setMissingMetricIds((previous) => {
        const next = new Set(previous);
        next.delete(metricId);
        return next;
      });
    }
  };

  const handleProtocolChange = (nextProtocolId: HealthCaptureProtocolId) => {
    setProtocolId(nextProtocolId);
    setDraftValues({});
    setError(null);
    setMissingMetricIds(new Set());
  };

  const handleSave = async () => {
    if (!selectedProtocol) return;

    const missing = metricSections.required
      .filter((metric) => {
        const draft = draftValues[metric.metricId];
        return !draft || draft.value.trim().length === 0;
      })
      .map((metric) => metric.metricId);

    if (missing.length > 0) {
      setMissingMetricIds(new Set(missing));
      setError(t('Profile.capture.fixRequiredFields', { defaultValue: 'Some required fields are missing — please complete them before saving.' }));
      return;
    }

    setMissingMetricIds(new Set());
    setSaving(true);
    setError(null);
    const nowIso = isoNow();
    try {
      const intent: HealthCaptureIntent = initialIntent
        ? { ...initialIntent, protocolId: selectedProtocol.protocolId, effectiveDate, notes }
        : createDefaultHealthCaptureIntent(selectedProtocol.protocolId, 'manual', effectiveDate);
      const capture = buildHealthCaptureEventInput({
        childId,
        ageMonths: computeAgeMonthsAt(childBirthDate, effectiveDate),
        intent: { ...intent, effectiveDate, notes },
        draftValues,
        nowIso,
        makeId: ulid,
      });
      const result = await saveHealthRecordCapture(capture);
      onSaved?.(result);
      onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('Profile.capture.saveFailed', { defaultValue: 'Capture save failed.' }));
    } finally {
      setSaving(false);
    }
  };

  const sidebarItems: HealthRecordSidebarItem[] = options.map((option) => ({
    id: option.group.groupId,
    emoji: GROUP_EMOJI[option.group.groupId],
    label: groupLabel(option.group.groupId, option.group.displayName, t),
    disabled: protocolLocked,
  }));

  const protocolChipOptions = selectedOption?.protocols.map((protocol) => ({
    value: protocol.protocolId,
    label: protocolLabel(protocol.protocolId, protocol.displayName, t),
  })) ?? [];

  return (
    <HealthRecordModalShell
      open
      size="M"
      onClose={onClose}
      sidebar={
        <HealthRecordSidebar
          items={sidebarItems}
          selected={selectedGroupId ?? ''}
          onSelect={(id) => {
            if (protocolLocked) return;
            const option = options.find((item) => item.group.groupId === id);
            if (!option) return;
            setSelectedGroupId(option.group.groupId);
            handleProtocolChange(option.protocols[0]!.protocolId);
          }}
        />
      }
    >
      <ModalHeader
        title={t('Profile.capture.title', { defaultValue: 'Add health data' })}
        subtitle={
          selectedProtocol
            ? protocolLabel(selectedProtocol.protocolId, selectedProtocol.displayName, t)
            : t('Profile.capture.selectProtocol', { defaultValue: 'Select a protocol' })
        }
        onClose={onClose}
      />
      <ModalContent>
        <div className="space-y-4">
          {protocolChipOptions.length > 1 ? (
            <ChipGroup
              size="sm"
              options={protocolChipOptions}
              value={selectedProtocol?.protocolId ?? ''}
              onChange={(value) => {
                if (protocolLocked) return;
                handleProtocolChange(value as HealthCaptureProtocolId);
              }}
            />
          ) : null}

          <FormGrid cols={2}>
            <FormField label={t('Profile.capture.recordDate', { defaultValue: 'Record date' })}>
              <DateField value={effectiveDate} onChange={setEffectiveDate} />
            </FormField>
            <FormField label={t('Profile.capture.notes', { defaultValue: 'Notes' })}>
              <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
            </FormField>
          </FormGrid>

          <MetricFieldSet
            title={t('Profile.capture.required', { defaultValue: 'Required' })}
            metrics={metricSections.required}
            values={draftValues}
            onChange={setMetricValue}
            t={t}
            isRequired
            missingMetricIds={missingMetricIds}
          />
          {metricSections.optional.length > 0 ? (
            <MetricFieldSet
              title={t('Profile.capture.optional', { defaultValue: 'Optional' })}
              metrics={metricSections.optional}
              values={draftValues}
              onChange={setMetricValue}
              t={t}
            />
          ) : null}

          {error ? <InlineError>{error}</InlineError> : null}
        </div>
      </ModalContent>
      <ModalFooter>
        <CancelButton onClick={onClose}>{t('Profile.capture.cancel', { defaultValue: 'Cancel' })}</CancelButton>
        <PrimaryButton onClick={() => void handleSave()} disabled={saving || !selectedProtocol}>
          {saving
            ? t('Profile.capture.saving', { defaultValue: 'Saving' })
            : t('Profile.capture.save', { defaultValue: 'Save' })}
        </PrimaryButton>
      </ModalFooter>
    </HealthRecordModalShell>
  );
}

function MetricFieldSet({
  title,
  metrics,
  values,
  onChange,
  t,
  isRequired = false,
  missingMetricIds,
}: {
  title: string;
  metrics: readonly HealthMetricDefinition[];
  values: Partial<Record<HealthMetricId, HealthCaptureDraftValue>>;
  onChange: (metricId: HealthMetricId, value: string) => void;
  t: ReturnType<typeof useTranslation>['t'];
  isRequired?: boolean;
  missingMetricIds?: ReadonlySet<HealthMetricId>;
}) {
  if (metrics.length === 0) return null;
  return (
    <SectionCard title={title}>
      <FormGrid cols={2}>
        {metrics.map((metric) => {
          const label = metricLabel(metric, t);
          const isMissing = isRequired && (missingMetricIds?.has(metric.metricId) ?? false);
          const labelText = `${label}${metric.unit ? ` (${metric.unit})` : ''}`;
          return (
            <FormField
              key={metric.metricId}
              label={labelText}
              required={isRequired}
              error={
                isMissing
                  ? t('Profile.capture.fieldRequired', { field: label, defaultValue: `Please enter ${label}` })
                  : null
              }
            >
              <Input
                type={metric.valueShape === 'number' || metric.valueShape === 'duration' ? 'number' : 'text'}
                step={metric.precision != null ? String(1 / 10 ** metric.precision) : undefined}
                value={values[metric.metricId]?.value ?? ''}
                onChange={(event) => onChange(metric.metricId, event.target.value)}
                invalid={isMissing}
              />
            </FormField>
          );
        })}
      </FormGrid>
    </SectionCard>
  );
}
