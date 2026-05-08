import { useEffect, useMemo, useState } from 'react';
import { S } from '../../app-shell/page-style.js';
import { saveAttachment, upsertMilestoneRecord } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { MILESTONE_CATALOG } from '../../knowledge-base/index.js';
import type { MilestoneDomain } from '../../knowledge-base/gen/milestone-catalog.gen.js';
import { ProfileDatePicker } from './profile-date-picker.js';
import { PhotoGrid, type PendingPhoto } from './photo-grid.js';

const DOMAINS: Array<{ key: MilestoneDomain; label: string; emoji: string }> = [
  { key: 'gross-motor', label: '大运动', emoji: '🏃' },
  { key: 'fine-motor', label: '精细动作', emoji: '✋' },
  { key: 'language', label: '语言', emoji: '💬' },
  { key: 'cognitive', label: '认知', emoji: '🧠' },
  { key: 'social-emotional', label: '社交情绪', emoji: '🤝' },
  { key: 'self-care', label: '自理', emoji: '🪥' },
];

export function hasMilestoneCandidatesForAge(ageMonths: number): boolean {
  for (const milestone of MILESTONE_CATALOG) {
    const lowerBound = milestone.typicalAge.rangeStart - 12;
    const upperBound = milestone.typicalAge.rangeEnd + 6;
    if (ageMonths >= lowerBound && ageMonths <= upperBound) return true;
  }
  return false;
}

type MilestoneCaptureProps = {
  child: { childId: string };
  ageMonths: number;
  onSaved: () => void | Promise<void>;
  onClose: () => void;
};

export function MilestoneCaptureContent({ child, ageMonths, onSaved, onClose }: MilestoneCaptureProps) {
  const isAgeRelevant = (milestone: typeof MILESTONE_CATALOG[number]) => {
    const lowerBound = milestone.typicalAge.rangeStart - 12;
    const upperBound = milestone.typicalAge.rangeEnd + 6;
    return ageMonths >= lowerBound && ageMonths <= upperBound;
  };

  const availableDomains = useMemo(() => {
    const seen = new Set<MilestoneDomain>();
    for (const milestone of MILESTONE_CATALOG) {
      if (isAgeRelevant(milestone)) seen.add(milestone.domain);
    }
    return DOMAINS.filter((option) => seen.has(option.key));
  }, [ageMonths]);

  const [domain, setDomain] = useState<MilestoneDomain>(() => availableDomains[0]?.key ?? 'gross-motor');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [saving, setSaving] = useState(false);

  const candidates = useMemo(() => {
    return MILESTONE_CATALOG.filter((milestone) => milestone.domain === domain && isAgeRelevant(milestone));
  }, [domain, ageMonths]);

  useEffect(() => {
    if (candidates.length === 1) {
      setSelectedId(candidates[0]!.milestoneId);
    }
  }, [candidates]);

  const milestone = candidates.find((item) => item.milestoneId === selectedId) ?? null;
  const showMilestoneList = candidates.length > 1;

  const handleSave = async () => {
    if (!milestone) return;
    setSaving(true);
    const now = isoNow();
    const recordId = ulid();
    try {
      await upsertMilestoneRecord({
        recordId,
        childId: child.childId,
        milestoneId: milestone.milestoneId,
        achievedAt: date ? new Date(date).toISOString() : now,
        ageMonthsWhenAchieved: ageMonths,
        notes: notes.trim() || null,
        photoPath: null,
        now,
      });
      for (const photo of photos) {
        await saveAttachment({
          attachmentId: ulid(),
          childId: child.childId,
          ownerTable: 'milestone_records',
          ownerId: recordId,
          fileName: photo.fileName,
          mimeType: photo.mimeType,
          imageBase64: photo.base64,
          caption: null,
          now,
        });
      }
      await onSaved();
      onClose();
    } catch {
      /* bridge unavailable */
    } finally {
      setSaving(false);
    }
  };

  if (availableDomains.length === 0) {
    return (
      <div className="flex flex-col w-full max-h-[85vh]">
        <div className="flex items-center justify-between px-6 pt-6 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-[20px]">🎯</span>
            <h2 className="text-[16px] font-bold" style={{ color: S.text }}>记录里程碑</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#f0f0ec]" style={{ color: S.sub }}>✕</button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-8 py-12 text-center">
          <div className="text-[36px] mb-3">🎓</div>
          <p className="text-[14px] font-medium mb-1" style={{ color: S.text }}>已超出里程碑数据范围</p>
          <p className="text-[13px]" style={{ color: S.sub }}>里程碑库只覆盖 0–6 岁。该孩子的年龄段已无新可记录条目。</p>
        </div>
        <div className="px-6 pt-3 pb-5">
          <div className="flex justify-end">
            <button onClick={onClose} className={`px-4 py-2 text-[14px] ${S.radiusSm} transition-colors hover:bg-[#e8e8e4]`} style={{ background: '#f0f0ec', color: S.sub }}>
              关闭
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full max-h-[85vh] overflow-y-auto">
      <div className="flex items-center justify-between px-6 pt-6 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-[20px]">🎯</span>
          <h2 className="text-[16px] font-bold" style={{ color: S.text }}>记录里程碑</h2>
        </div>
        <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#f0f0ec]" style={{ color: S.sub }}>✕</button>
      </div>

      <div className="px-6 pb-2 space-y-4 flex-1">
        <div>
          <label className="text-[13px] mb-1 block font-medium" style={{ color: S.sub }}>领域</label>
          <div className="flex flex-wrap gap-1.5">
            {availableDomains.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => {
                  setDomain(option.key);
                  setSelectedId(null);
                }}
                className={`px-3 py-1.5 text-[13px] font-medium ${S.radiusSm} transition-colors`}
                style={
                  domain === option.key
                    ? { background: S.accent, color: '#fff' }
                    : { background: '#f4f4f2', color: S.sub, border: `1px solid ${S.border}` }
                }
              >
                {option.emoji} {option.label}
              </button>
            ))}
          </div>
        </div>

        {showMilestoneList ? (
          <div>
            <label className="text-[13px] mb-1 block font-medium" style={{ color: S.sub }}>选择里程碑（按当前月龄过滤）</label>
            <div className="space-y-1.5 max-h-[200px] overflow-y-auto pr-1">
              {candidates.map((item) => (
                <button
                  key={item.milestoneId}
                  type="button"
                  onClick={() => setSelectedId(item.milestoneId)}
                  className={`w-full text-left ${S.radiusSm} px-3 py-2 transition-colors`}
                  style={
                    selectedId === item.milestoneId
                      ? { background: 'rgba(78,204,163,0.14)', border: `1px solid ${S.accent}` }
                      : { background: '#fafaf8', border: `1px solid ${S.border}` }
                  }
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium" style={{ color: S.text }}>{item.title}</span>
                    <span className="text-[12px]" style={{ color: S.sub }}>
                      {item.typicalAge.rangeStart}-{item.typicalAge.rangeEnd} 月
                    </span>
                  </div>
                  <p className="text-[12px] mt-0.5" style={{ color: S.sub }}>{item.description}</p>
                </button>
              ))}
            </div>
          </div>
        ) : milestone ? (
          <div className={`${S.radiusSm} px-3 py-2`} style={{ background: 'rgba(78,204,163,0.14)', border: `1px solid ${S.accent}` }}>
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium" style={{ color: S.text }}>{milestone.title}</span>
              <span className="text-[12px]" style={{ color: S.sub }}>
                {milestone.typicalAge.rangeStart}-{milestone.typicalAge.rangeEnd} 月
              </span>
            </div>
            <p className="text-[12px] mt-0.5" style={{ color: S.sub }}>{milestone.description}</p>
          </div>
        ) : null}

        {milestone ? (
          <>
            <div>
              <label className="text-[13px] mb-1 block font-medium" style={{ color: S.sub }}>达成日期</label>
              <ProfileDatePicker value={date} onChange={setDate} style={{ borderColor: S.border, borderWidth: 1, borderStyle: 'solid', background: '#fafaf8' }} />
            </div>

            <div>
              <label className="text-[13px] mb-1 block font-medium" style={{ color: S.sub }}>记录小故事</label>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="例如：第一次找到藏起来的球，开心地咯咯笑..."
                rows={3}
                className={`w-full ${S.radiusSm} px-3 py-2 text-[14px] resize-none outline-none transition-shadow focus:ring-2 focus:ring-[#4ECCA3]/50`}
                style={{ borderColor: S.border, borderWidth: 1, borderStyle: 'solid', background: '#fafaf8' }}
              />
            </div>

            <div>
              <label className="text-[13px] mb-1 block font-medium" style={{ color: S.sub }}>
                照片 {photos.length > 0 ? `(${photos.length}/9)` : ''}
              </label>
              <PhotoGrid
                photos={photos}
                maxPhotos={9}
                hint="点击或拖拽上传里程碑照片（最多 9 张）"
                onChange={setPhotos}
              />
            </div>
          </>
        ) : null}
      </div>

      <div className="px-6 pt-3 pb-5 mt-1">
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className={`px-4 py-2 text-[14px] ${S.radiusSm} transition-colors hover:bg-[#e8e8e4]`} style={{ background: '#f0f0ec', color: S.sub }}>
            取消
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving || !milestone}
            className={`px-5 py-2 text-[14px] font-medium text-white ${S.radiusSm} transition-colors hover:brightness-110 disabled:opacity-50`}
            style={{ background: S.accent }}
          >
            {saving ? '保存中...' : '✅ 记录达成'}
          </button>
        </div>
      </div>
    </div>
  );
}
