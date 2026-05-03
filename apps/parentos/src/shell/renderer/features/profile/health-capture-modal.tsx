import { useEffect, useMemo, useState } from 'react';
import { Save, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { S } from '../../app-shell/page-style.js';
import { saveHealthRecordCapture, type SaveHealthRecordCaptureResult } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import type { HealthCaptureProtocolId, HealthMetricDefinition, HealthMetricId } from '../../knowledge-base/index.js';
import { ProfileDatePicker } from './profile-date-picker.js';
import {
  buildHealthCaptureEventInput,
  createDefaultHealthCaptureIntent,
  getCaptureMetrics,
  getHealthCaptureProtocolOptions,
  type HealthCaptureDraftValue,
  type HealthCaptureIntent,
} from './health-capture-orchestrator.js';
import { groupLabel, metricLabel, protocolLabel } from './health-record-display.js';

interface HealthCaptureModalProps {
  open: boolean;
  childId: string;
  childBirthDate: string;
  initialIntent?: HealthCaptureIntent | null;
  onClose: () => void;
  onSaved?: (result: SaveHealthRecordCaptureResult) => void;
}

export function HealthCaptureModal({
  open,
  childId,
  childBirthDate,
  initialIntent,
  onClose,
  onSaved,
}: HealthCaptureModalProps) {
  const { t } = useTranslation();
  const options = useMemo(() => getHealthCaptureProtocolOptions(), []);
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
    if (!open) return;
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
  }, [firstProtocol?.protocolId, initialIntent, open, options]);

  const selectedOption = options.find((option) => option.group.groupId === selectedGroupId) ?? options[0] ?? null;
  const selectedProtocol =
    selectedOption?.protocols.find((protocol) => protocol.protocolId === protocolId) ??
    options.flatMap((option) => option.protocols).find((protocol) => protocol.protocolId === protocolId) ??
    selectedOption?.protocols[0] ??
    null;
  const metricSections = selectedProtocol ? getCaptureMetrics(selectedProtocol) : { required: [], optional: [] };

  if (!open) return null;

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--nimi-scrim-modal)' }}
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-label="health-capture-modal"
        className={`w-[760px] max-h-[88vh] overflow-hidden ${S.radius} shadow-xl flex`}
        style={{ background: S.card }}
        onClick={(event) => event.stopPropagation()}
      >
        <aside className="w-[210px] shrink-0 border-r p-4" style={{ borderColor: S.border, background: '#fafaf8' }}>
          <div className="text-[12px] font-semibold uppercase mb-3" style={{ color: S.sub, letterSpacing: 0 }}>
            {t('Profile.capture.group', { defaultValue: 'Group' })}
          </div>
          <div className="flex flex-col gap-1.5">
            {options.map((option) => (
              <button
                key={option.group.groupId}
                type="button"
                className={`${S.radiusSm} px-3 py-2 text-left text-[13px] font-medium transition-colors`}
                style={
                  selectedGroupId === option.group.groupId
                    ? { background: S.accent, color: '#fff' }
                    : { background: 'transparent', color: S.text }
                }
                disabled={protocolLocked}
                onClick={() => {
                  if (protocolLocked) return;
                  setSelectedGroupId(option.group.groupId);
                  handleProtocolChange(option.protocols[0]!.protocolId);
                }}
              >
                {groupLabel(option.group.groupId, option.group.displayName, t)}
              </button>
            ))}
          </div>
        </aside>

        <div className="flex-1 min-w-0 flex flex-col">
          <header className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: S.border }}>
            <div>
              <h2 className="text-[17px] font-bold" style={{ color: S.text }}>{t('Profile.capture.title', { defaultValue: 'Add health data' })}</h2>
              <p className="text-[12px] mt-0.5" style={{ color: S.sub }}>
                {selectedProtocol
                  ? protocolLabel(selectedProtocol.protocolId, selectedProtocol.displayName, t)
                  : t('Profile.capture.selectProtocol', { defaultValue: 'Select a protocol' })}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('Profile.capture.close', { defaultValue: 'Close' })}
              className="h-8 w-8 rounded-full grid place-items-center hover:bg-[#f0f0ec]"
              style={{ color: S.sub }}
            >
              <X size={16} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {selectedOption ? (
              <div className="flex flex-wrap gap-2">
                {selectedOption.protocols.map((protocol) => (
                  <button
                    key={protocol.protocolId}
                    type="button"
                    className={`${S.radiusSm} px-3 py-1.5 text-[13px] font-medium transition-colors`}
                    style={
                      selectedProtocol?.protocolId === protocol.protocolId
                        ? { background: 'rgba(78,204,163,0.14)', color: S.accent, border: `1px solid ${S.accent}` }
                        : { background: '#f4f4f2', color: S.sub, border: `1px solid ${S.border}` }
                    }
                    disabled={protocolLocked}
                    onClick={() => handleProtocolChange(protocol.protocolId)}
                  >
                    {protocolLabel(protocol.protocolId, protocol.displayName, t)}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[13px] font-medium" style={{ color: S.sub }}>{t('Profile.capture.recordDate', { defaultValue: 'Record date' })}</span>
                <ProfileDatePicker
                  value={effectiveDate}
                  onChange={setEffectiveDate}
                  className={`${S.radiusSm} px-3 py-2 text-[14px] outline-none`}
                  style={{ border: `1px solid ${S.border}`, color: S.text, background: '#fafaf8' }}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[13px] font-medium" style={{ color: S.sub }}>{t('Profile.capture.notes', { defaultValue: 'Notes' })}</span>
                <input
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  className={`${S.radiusSm} px-3 py-2 text-[14px] outline-none`}
                  style={{ border: `1px solid ${S.border}`, color: S.text, background: '#fafaf8' }}
                />
              </label>
            </div>

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

            {error ? (
              <div className={`${S.radiusSm} px-3 py-2 text-[13px]`} style={{ background: '#fef2f2', color: '#b91c1c' }}>
                {error}
              </div>
            ) : null}
          </div>

          <footer className="flex items-center justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: S.border }}>
            <button type="button" onClick={onClose} className={`${S.radiusSm} px-4 py-2 text-[14px]`} style={{ background: '#f0f0ec', color: S.sub }}>
              {t('Profile.capture.cancel', { defaultValue: 'Cancel' })}
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || !selectedProtocol}
              className={`${S.radiusSm} inline-flex items-center gap-2 px-4 py-2 text-[14px] font-medium text-white disabled:opacity-40`}
              style={{ background: S.accent }}
            >
              <Save size={15} />
              {saving ? t('Profile.capture.saving', { defaultValue: 'Saving' }) : t('Profile.capture.save', { defaultValue: 'Save' })}
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
}

const ERROR_BORDER = '#dc2626';
const ERROR_TEXT = '#b91c1c';

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
    <section>
      <h3 className="text-[13px] font-semibold mb-2" style={{ color: S.text }}>{title}</h3>
      <div className="grid grid-cols-2 gap-3">
        {metrics.map((metric) => {
          const label = metricLabel(metric, t);
          const isMissing = isRequired && (missingMetricIds?.has(metric.metricId) ?? false);
          const borderColor = isMissing ? ERROR_BORDER : S.border;
          const labelText = `${label}${metric.unit ? ` (${metric.unit})` : ''}`;
          return (
            <label key={metric.metricId} className="flex flex-col gap-1">
              <span className="text-[13px] font-medium inline-flex items-start gap-0.5" style={{ color: S.sub }}>
                <span>{labelText}</span>
                {isRequired ? (
                  <span aria-hidden="true" style={{ color: ERROR_TEXT, lineHeight: 1 }}>※</span>
                ) : null}
              </span>
              {metric.valueShape === 'event' || metric.valueShape === 'composite' ? (
                <textarea
                  value={values[metric.metricId]?.value ?? ''}
                  onChange={(event) => onChange(metric.metricId, event.target.value)}
                  rows={3}
                  aria-invalid={isMissing || undefined}
                  className={`${S.radiusSm} px-3 py-2 text-[14px] outline-none resize-none`}
                  style={{ border: `1px solid ${borderColor}`, color: S.text, background: '#fafaf8' }}
                />
              ) : (
                <input
                  type={metric.valueShape === 'number' || metric.valueShape === 'duration' ? 'number' : 'text'}
                  step={metric.precision != null ? String(1 / 10 ** metric.precision) : undefined}
                  value={values[metric.metricId]?.value ?? ''}
                  onChange={(event) => onChange(metric.metricId, event.target.value)}
                  aria-invalid={isMissing || undefined}
                  className={`${S.radiusSm} px-3 py-2 text-[14px] outline-none`}
                  style={{ border: `1px solid ${borderColor}`, color: S.text, background: '#fafaf8' }}
                />
              )}
              {isMissing ? (
                <span className="text-[12px]" style={{ color: ERROR_TEXT }}>
                  {t('Profile.capture.fieldRequired', { field: label, defaultValue: `Please enter ${label}` })}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </section>
  );
}
