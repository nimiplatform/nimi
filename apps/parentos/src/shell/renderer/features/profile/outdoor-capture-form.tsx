import { useState } from 'react';
import { Sun } from 'lucide-react';
import { S } from '../../app-shell/page-style.js';
import { insertOutdoorRecord } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { ProfileDatePicker } from './profile-date-picker.js';

const PRESET_DURATIONS = [15, 30, 45, 60, 90, 120];

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

  const inputCls = `w-full ${S.radiusSm} px-3 py-2 text-[14px] outline-none transition-shadow focus:ring-2 focus:ring-[#4ECCA3]/50`;
  const inputSty = {
    borderColor: S.border,
    borderWidth: 1,
    borderStyle: 'solid' as const,
    background: '#fafaf8',
  };

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

  return (
    <div className="flex flex-col w-full max-h-[85vh] overflow-y-auto">
      <div className="flex items-center justify-between px-6 pt-6 pb-3">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#fef3c7' }}>
            <Sun size={18} strokeWidth={1.5} style={{ color: '#b45309' }} />
          </span>
          <h2 className="text-[16px] font-bold" style={{ color: S.text }}>记录户外活动</h2>
        </div>
        <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#f0f0ec]" style={{ color: S.sub }}>✕</button>
      </div>

      <div className="px-6 pb-2 space-y-4 flex-1">
        <div>
          <label className="text-[13px] mb-1 block font-medium" style={{ color: S.sub }}>活动日期</label>
          <ProfileDatePicker value={activityDate} onChange={setActivityDate} className={inputCls} style={inputSty} />
        </div>

        <div>
          <label className="text-[13px] mb-1 block font-medium" style={{ color: S.sub }}>时长（分钟）</label>
          <input
            type="number"
            min="1"
            value={durationMinutes}
            onChange={(event) => setDurationMinutes(event.target.value)}
            className={inputCls}
            style={inputSty}
          />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {PRESET_DURATIONS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setDurationMinutes(String(preset))}
                className={`px-3 py-1 text-[12px] font-medium ${S.radiusSm}`}
                style={
                  parseInt(durationMinutes, 10) === preset
                    ? { background: S.accent, color: '#fff' }
                    : { background: '#f4f4f2', color: S.sub, border: `1px solid ${S.border}` }
                }
              >
                {preset} 分钟
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[13px] mb-1 block font-medium" style={{ color: S.sub }}>备注</label>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="例如：公园骑车、放风筝..."
            rows={2}
            className={`${inputCls} resize-none`}
            style={inputSty}
          />
        </div>

        {error ? (
          <div className={`${S.radiusSm} px-3 py-2 text-[13px]`} style={{ background: '#fef2f2', color: '#b91c1c' }}>
            {error}
          </div>
        ) : null}
      </div>

      <div className="px-6 pt-3 pb-5 mt-1">
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className={`px-4 py-2 text-[14px] ${S.radiusSm} transition-colors hover:bg-[#e8e8e4]`} style={{ background: '#f0f0ec', color: S.sub }}>
            取消
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className={`px-5 py-2 text-[14px] font-medium text-white ${S.radiusSm} transition-colors hover:brightness-110 disabled:opacity-50`}
            style={{ background: S.accent }}
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
