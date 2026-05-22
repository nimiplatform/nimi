import { useState } from 'react';
import { Button, DatePicker, TextField, TextareaField } from '@nimiplatform/nimi-kit/ui';
import { insertOutdoorRecord } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import type { LinkedHealthRecordReminder } from './health-capture-orchestrator.js';
import {
  ChipGroup,
  FormField,
  InlineError,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from './health-record-modal-shell.js';

const PRESET_DURATIONS = [15, 30, 45, 60, 90, 120] as const;

type OutdoorCaptureProps = {
  child: { childId: string };
  onSaved: () => void | Promise<void>;
  onClose: () => void;
  linkedReminder?: LinkedHealthRecordReminder | null;
};

export function OutdoorCaptureContent({ child, onSaved, onClose, linkedReminder }: OutdoorCaptureProps) {
  const [activityDate, setActivityDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [durationMinutes, setDurationMinutes] = useState('60');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!activityDate) return;
    const minutes = parseInt(durationMinutes, 10);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      setError('请输入有效的活动时长（分钟）');
      return;
    }

    setError(null);
    setSaving(true);
    try {
      await insertOutdoorRecord({
        recordId: ulid(),
        childId: child.childId,
        activityDate,
        durationMinutes: minutes,
        note: note.trim() || null,
        now: isoNow(),
        linkedReminderStateId: linkedReminder?.stateId ?? null,
        linkedReminderRuleId: linkedReminder?.ruleId ?? null,
      });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const presetOptions = PRESET_DURATIONS.map((preset) => ({
    value: String(preset),
    label: `${preset} 分钟`,
  }));

  return (
    <>
      <ModalHeader title="记录户外活动" icon="☀️" onClose={onClose} />
      <ModalContent>
        <div className="space-y-5">
          <FormField label="活动日期">
            <DatePicker value={activityDate} onChange={setActivityDate} className="h-12" />
          </FormField>

          <FormField label="时长（分钟）">
            <TextField
              type="number"
              min="1"
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(event.target.value)}
              className="w-full min-h-12"
              inputClassName="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <div className="mt-2">
              <ChipGroup
                options={presetOptions}
                value={durationMinutes}
                onChange={(value) => setDurationMinutes(value)}
                size="sm"
              />
            </div>
          </FormField>

          <FormField label="备注">
            <TextareaField
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="例如：公园骑车、放风筝..."
              className="w-full"
            />
          </FormField>

          {error ? <InlineError>{error}</InlineError> : null}
        </div>
      </ModalContent>
      <ModalFooter>
        <Button type="button" onClick={onClose} tone="ghost" size="md">取消</Button>
        <Button type="button" onClick={() => void handleSave()} disabled={saving} tone="primary" size="md">
          {saving ? '保存中...' : '保存'}
        </Button>
      </ModalFooter>
    </>
  );
}
