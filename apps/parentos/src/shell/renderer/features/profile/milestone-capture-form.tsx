import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Surface } from '@nimiplatform/nimi-kit/ui';
import { saveAttachment, upsertMilestoneRecord } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { MILESTONE_CATALOG } from '../../knowledge-base/index.js';
import type { MilestoneDomain } from '../../knowledge-base/gen/milestone-catalog.gen.js';
import { PhotoGrid, type PendingPhoto } from './photo-grid.js';
import {
  CancelButton,
  ChipGroup,
  type ChipOption,
  DateField,
  FormField,
  ModalContent,
  ModalFooter,
  ModalHeader,
  PrimaryButton,
  TextArea,
  UploadBox,
} from './health-record-modal-shell.js';

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
  /** Optional trailing slot in the modal header (e.g., milestone/tanner tab switcher). */
  headerTrailing?: ReactNode;
};

export function MilestoneCaptureContent({ child, ageMonths, onSaved, onClose, headerTrailing }: MilestoneCaptureProps) {
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
      <>
        <ModalHeader title="记录里程碑" icon="🎯" onClose={onClose} trailing={headerTrailing} />
        <ModalContent>
          <div className="flex h-full flex-col items-center justify-center px-8 py-12 text-center">
            <div className="mb-3 text-[36px]">🎓</div>
            <p className="mb-1 text-[14px] font-medium text-[var(--nimi-text-primary)]">
              已超出里程碑数据范围
            </p>
            <p className="text-[13px] text-[var(--nimi-text-muted)]">
              里程碑库只覆盖 0–6 岁。该孩子的年龄段已无新可记录条目。
            </p>
          </div>
        </ModalContent>
        <ModalFooter>
          <CancelButton onClick={onClose}>关闭</CancelButton>
        </ModalFooter>
      </>
    );
  }

  const domainChips: ChipOption<MilestoneDomain>[] = availableDomains.map((option) => ({
    value: option.key,
    label: option.label,
    emoji: option.emoji,
  }));

  return (
    <>
      <ModalHeader title="记录里程碑" icon="🎯" onClose={onClose} trailing={headerTrailing} />
      <ModalContent>
        <div className="space-y-5">
          <FormField label="领域">
            <ChipGroup
              options={domainChips}
              value={domain}
              onChange={(next) => {
                setDomain(next);
                setSelectedId(null);
              }}
            />
          </FormField>

          {showMilestoneList ? (
            <FormField label="选择里程碑（按当前月龄过滤）">
              <div className="max-h-[260px] space-y-1.5 overflow-y-auto pr-1">
                {candidates.map((item) => (
                  <Surface
                    as="button"
                    key={item.milestoneId}
                    type="button"
                    onClick={() => setSelectedId(item.milestoneId)}
                    tone="card"
                    elevation="base"
                    padding="none"
                    material="solid"
                    interactive
                    active={selectedId === item.milestoneId}
                    className="w-full px-4 py-3 text-left"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-medium text-[var(--nimi-text-primary)]">
                        {item.title}
                      </span>
                      <span className="text-[12px] text-[var(--nimi-text-muted)]">
                        {item.typicalAge.rangeStart}-{item.typicalAge.rangeEnd} 月
                      </span>
                    </div>
                    <p className="mt-0.5 text-[12px] text-[var(--nimi-text-muted)]">
                      {item.description}
                    </p>
                  </Surface>
                ))}
              </div>
            </FormField>
          ) : milestone ? (
            <Surface tone="card" elevation="base" padding="none" material="solid" active className="px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-[var(--nimi-text-primary)]">
                  {milestone.title}
                </span>
                <span className="text-[12px] text-[var(--nimi-text-muted)]">
                  {milestone.typicalAge.rangeStart}-{milestone.typicalAge.rangeEnd} 月
                </span>
              </div>
              <p className="mt-0.5 text-[12px] text-[var(--nimi-text-muted)]">
                {milestone.description}
              </p>
            </Surface>
          ) : null}

          {milestone ? (
            <>
              <FormField label="达成日期">
                <DateField value={date} onChange={setDate} />
              </FormField>

              <FormField label="记录小故事">
                <TextArea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="例如：第一次找到藏起来的球，开心地咯咯笑..."
                  rows={3}
                />
              </FormField>

              <FormField label={`照片${photos.length > 0 ? ` (${photos.length}/9)` : ''}`}>
                <UploadBox>
                  <PhotoGrid
                    photos={photos}
                    maxPhotos={9}
                    hint="点击或拖拽上传里程碑照片（最多 9 张）"
                    onChange={setPhotos}
                  />
                </UploadBox>
              </FormField>
            </>
          ) : null}
        </div>
      </ModalContent>
      <ModalFooter>
        <CancelButton onClick={onClose} />
        <PrimaryButton onClick={() => void handleSave()} disabled={saving || !milestone}>
          {saving ? '保存中...' : '记录达成'}
        </PrimaryButton>
      </ModalFooter>
    </>
  );
}
