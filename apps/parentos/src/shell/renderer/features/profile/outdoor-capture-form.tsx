import { useState } from 'react';
import { insertOutdoorRecord } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import {
  CancelButton,
  ChipGroup,
  DateField,
  FormField,
  InlineError,
  Input,
  ModalContent,
  ModalFooter,
  ModalHeader,
  PrimaryButton,
  TextArea,
} from './health-record-modal-shell.js';

const PRESET_DURATIONS = [15, 30, 45, 60, 90, 120] as const;

type OutdoorCaptureProps = {
  child: { childId: string };
  onSaved: () => void | Promise<void>;
  onClose: () => void;
};

export function OutdoorCaptureContent({ child, onSaved, onClose }: OutdoorCaptureProps) {
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
            <DateField value={activityDate} onChange={setActivityDate} />
          </FormField>

          <FormField label="时长（分钟）">
            <Input
              type="number"
              min="1"
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(event.target.value)}
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
            <TextArea
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="例如：公园骑车、放风筝..."
            />
          </FormField>

          {error ? <InlineError>{error}</InlineError> : null}
        </div>
      </ModalContent>
      <ModalFooter>
        <CancelButton onClick={onClose} />
        <PrimaryButton onClick={() => void handleSave()} disabled={saving}>
          {saving ? '保存中...' : '保存'}
        </PrimaryButton>
      </ModalFooter>
    </>
  );
}

