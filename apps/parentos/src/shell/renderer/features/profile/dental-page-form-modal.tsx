import { convertFileSrc } from '@tauri-apps/api/core';
import type { AttachmentRow } from '../../bridge/sqlite-bridge.js';
import { S } from '../../app-shell/page-style.js';
import { ProfileDatePicker } from './profile-date-picker.js';
import {
  EVENT_TYPES,
  NEEDS_SEVERITY,
  NEEDS_TOOTH,
  PHOTO_MAX,
  SEVERITY_LABELS,
  type EventEntry,
  type PendingDentalPhoto,
} from './dental-page-domain.js';
import { ToothChart } from './dental-page-tooth-chart.js';

type DentalRecordFormModalProps = {
  show: boolean;
  isEditing: boolean;
  ageMonths: number;
  eventEntries: EventEntry[];
  activeEntryIdx: number;
  availableEventTypes: readonly (typeof EVENT_TYPES)[number][];
  toothStatus: Map<string, string>;
  formEventDate: string;
  formHospital: string;
  formNotes: string;
  photoDragOver: boolean;
  photoDropHover: boolean;
  existingPhotoAttachments: AttachmentRow[];
  removedAttachmentIds: string[];
  formPhotoPreviews: string[];
  formPhotoFiles: PendingDentalPhoto[];
  setFormEventDate: (value: string) => void;
  setFormHospital: (value: string) => void;
  setFormNotes: (value: string) => void;
  setActiveEntryIdx: (value: number) => void;
  setPhotoDragOver: (value: boolean) => void;
  setPhotoDropHover: (value: boolean) => void;
  updateEntry: (idx: number, patch: Partial<EventEntry>) => void;
  removeEntry: (idx: number) => void;
  addEntry: () => void;
  resetForm: () => void;
  appendPhotoFiles: (files: FileList | File[]) => Promise<void>;
  pickPhotoFiles: () => Promise<void>;
  removePhotoAt: (idx: number) => void;
  removeExistingPhoto: (attachmentId: string) => void;
  handleSubmit: () => Promise<void>;
};

export function DentalRecordFormModal(props: DentalRecordFormModalProps) {
  const visibleExistingPhotoAttachments = props.existingPhotoAttachments.filter(
    (attachment) => !props.removedAttachmentIds.includes(attachment.attachmentId),
  );
  const totalPhotoCount = visibleExistingPhotoAttachments.length + props.formPhotoFiles.length;

  if (!props.show) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.25)' }}
      onClick={props.resetForm}
    >
      <div
        className={`flex max-h-[85vh] w-[680px] flex-col overflow-y-auto ${S.radius} shadow-xl`}
        style={{ background: S.card }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pb-3 pt-6">
          <div className="flex items-center gap-2">
            <span className="text-[20px]">{props.isEditing ? '✏️' : '🦷'}</span>
            <h2 className="text-[16px] font-bold" style={{ color: S.text }}>
              {props.isEditing ? '编辑口腔记录' : '添加口腔记录'}
            </h2>
          </div>
          <button type="button" onClick={props.resetForm} className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-[#f0f0ec]" style={{ color: S.sub }}>✕</button>
        </div>

        <div className="flex-1 space-y-4 px-6 pb-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1 text-[13px]" style={{ color: S.sub }}>就诊日期</p>
              <ProfileDatePicker value={props.formEventDate} onChange={props.setFormEventDate} style={{ background: '#fafaf8', color: S.text }} />
            </div>
            <div>
              <p className="mb-1 text-[13px]" style={{ color: S.sub }}>医院/诊所</p>
              <input
                value={props.formHospital}
                onChange={(event) => props.setFormHospital(event.target.value)}
                placeholder="选填"
                className={`w-full border-0 px-3 py-2 text-[14px] outline-none transition-shadow focus:ring-2 focus:ring-[#4ECCA3]/50 ${S.radiusSm}`}
                style={{ background: '#fafaf8', color: S.text }}
              />
            </div>
          </div>

          {props.eventEntries.map((entry, idx) => {
            const isActive = idx === props.activeEntryIdx;
            const eventMeta = EVENT_TYPES.find((item) => item.key === entry.eventType);
            const entryNeedsTooth = NEEDS_TOOTH.has(entry.eventType);
            const entryNeedsSeverity = NEEDS_SEVERITY.has(entry.eventType);
            return (
              <div
                key={idx}
                className={`${S.radiusSm} cursor-pointer p-3 transition-all`}
                style={{
                  background: isActive ? '#fafaf8' : '#f9faf7',
                  border: `1.5px solid ${isActive ? `${S.accent}60` : S.border}`,
                }}
                onClick={() => props.setActiveEntryIdx(idx)}
              >
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[13px] font-semibold" style={{ color: isActive ? S.accent : S.text }}>
                    事件 {idx + 1} {eventMeta ? `· ${eventMeta.emoji} ${eventMeta.label}` : ''}
                    {entry.toothIds.length > 0 ? <span className="font-normal" style={{ color: S.sub }}> · {entry.toothIds.length} 颗牙</span> : null}
                  </p>
                  {props.eventEntries.length > 1 ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        props.removeEntry(idx);
                      }}
                      className="rounded-full px-2 py-0.5 text-[12px] transition-colors hover:bg-red-50"
                      style={{ color: '#dc2626' }}
                    >
                      删除
                    </button>
                  ) : null}
                </div>

                {isActive ? (
                  <div className="mt-2 space-y-3">
                    <div>
                      <p className="mb-1.5 text-[12px]" style={{ color: S.sub }}>类型</p>
                      <div className="flex flex-wrap gap-1.5">
                        {props.availableEventTypes.map((item) => (
                          <button
                            key={item.key}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              props.updateEntry(idx, { eventType: item.key, toothIds: [], severity: '' });
                            }}
                            className={`flex items-center gap-1 px-2.5 py-1 text-[12px] transition-all ${S.radiusSm}`}
                            style={entry.eventType === item.key
                              ? { background: S.accent, color: '#fff' }
                              : { background: '#f0f0ec', color: S.sub }}
                          >
                            <span>{item.emoji}</span>
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {entryNeedsTooth ? (
                      <div>
                        <div className="mb-2 flex items-center gap-3">
                          <p className="text-[12px]" style={{ color: S.sub }}>牙位</p>
                          <div className="flex gap-1">
                            {(['primary', ...(props.ageMonths >= 60 ? ['permanent'] : [])] as const).map((toothSet) => (
                              <button
                                key={toothSet}
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  props.updateEntry(idx, { toothSet: toothSet as 'primary' | 'permanent', toothIds: [] });
                                }}
                                className="rounded-full px-2.5 py-0.5 text-[12px] font-medium transition-all"
                                style={entry.toothSet === toothSet
                                  ? { background: S.accent, color: '#fff' }
                                  : { background: '#f0f0ec', color: S.sub }}
                              >
                                {toothSet === 'primary' ? '乳牙' : '恒牙'}
                              </button>
                            ))}
                          </div>
                        </div>
                        <ToothChart
                          selectedTeeth={entry.toothIds}
                          onToggle={(id) =>
                            props.updateEntry(idx, {
                              toothIds: entry.toothIds.includes(id)
                                ? entry.toothIds.filter((toothId) => toothId !== id)
                                : [...entry.toothIds, id],
                            })}
                          toothSet={entry.toothSet}
                          recordedTeeth={props.toothStatus}
                        />
                      </div>
                    ) : null}

                    {entryNeedsSeverity ? (
                      <div>
                        <p className="mb-1.5 text-[12px]" style={{ color: S.sub }}>严重程度</p>
                        <div className="flex gap-1.5">
                          {(['mild', 'moderate', 'severe'] as const).map((severity) => (
                            <button
                              key={severity}
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                props.updateEntry(idx, { severity: entry.severity === severity ? '' : severity });
                              }}
                              className={`px-2.5 py-1 text-[12px] transition-all ${S.radiusSm}`}
                              style={entry.severity === severity
                                ? {
                                    background: severity === 'severe' ? '#dc2626' : severity === 'moderate' ? '#d97706' : S.accent,
                                    color: '#fff',
                                  }
                                : { background: '#f0f0ec', color: S.sub }}
                            >
                              {SEVERITY_LABELS[severity]}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}

          <button
            type="button"
            onClick={props.addEntry}
            hidden={props.isEditing}
            onMouseEnter={() => props.setPhotoDropHover(true)}
            onMouseLeave={() => props.setPhotoDropHover(false)}
            className={`flex w-full items-center justify-center gap-2 py-3 text-[13px] font-medium ${S.radiusSm}`}
            style={{
              border: `2px dashed ${props.photoDropHover ? '#4ECCA3' : '#d0d0cc'}`,
              background: props.photoDropHover ? '#f9fbf4' : '#fafaf8',
              color: props.photoDropHover ? S.accent : S.sub,
              transition: 'border-color 0.25s ease, background 0.25s ease, color 0.25s ease',
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth="1.5"
              strokeLinecap="round"
              style={{
                stroke: props.photoDropHover ? '#1e293b' : '#b0b0aa',
                transform: props.photoDropHover ? 'scale(1.15) rotate(90deg)' : 'scale(1) rotate(0deg)',
                transition: 'stroke 0.25s ease, transform 0.3s ease',
              }}
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            添加另一个事件
          </button>

          <div>
            <p className="mb-1 text-[13px]" style={{ color: S.sub }}>备注</p>
            <textarea
              value={props.formNotes}
              onChange={(event) => props.setFormNotes(event.target.value)}
              placeholder="选填"
              rows={1}
              ref={(el) => {
                if (!el) return;
                el.style.height = 'auto';
                el.style.height = `${el.scrollHeight}px`;
              }}
              onInput={(event) => {
                const el = event.currentTarget;
                el.style.height = 'auto';
                el.style.height = `${el.scrollHeight}px`;
              }}
              className={`w-full resize-none border-0 px-3 py-2 text-[14px] outline-none transition-shadow focus:ring-2 focus:ring-[#4ECCA3]/50 ${S.radiusSm}`}
              style={{ background: '#fafaf8', color: S.text, overflow: 'hidden' }}
            />
          </div>

          <div>
            <p className="mb-1 text-[13px]" style={{ color: S.sub }}>
              照片 {props.formPhotoFiles.length > 0 ? `(${props.formPhotoFiles.length}/${PHOTO_MAX})` : ''}
            </p>
            <div
              onDragOver={(event) => {
                event.preventDefault();
                props.setPhotoDragOver(true);
              }}
              onDragEnter={(event) => {
                event.preventDefault();
                props.setPhotoDragOver(true);
              }}
              onDragLeave={() => props.setPhotoDragOver(false)}
              onDrop={async (event) => {
                event.preventDefault();
                props.setPhotoDragOver(false);
                if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
                  await props.appendPhotoFiles(event.dataTransfer.files);
                }
              }}
              className="grid grid-cols-3 gap-2"
            >
              {visibleExistingPhotoAttachments.map((attachment) => (
                <div key={attachment.attachmentId} className="group relative">
                  <img src={convertFileSrc(attachment.filePath)} alt={attachment.fileName} className={`h-24 w-full object-cover ${S.radiusSm}`} />
                  <button
                    type="button"
                    onClick={() => props.removeExistingPhoto(attachment.attachmentId)}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-[12px] text-white opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              ))}
              {props.formPhotoPreviews.map((src, idx) => (
                <div key={idx} className="group relative">
                  <img src={src} alt={`preview-${idx}`} className={`h-24 w-full object-cover ${S.radiusSm}`} />
                  <button
                    type="button"
                    onClick={() => props.removePhotoAt(idx)}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-[12px] text-white opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {totalPhotoCount < PHOTO_MAX ? (
                <button
                  type="button"
                  onClick={() => void props.pickPhotoFiles()}
                  onMouseEnter={() => props.setPhotoDropHover(true)}
                  onMouseLeave={() => props.setPhotoDropHover(false)}
                  className={`flex h-24 w-full flex-col items-center justify-center gap-1.5 ${S.radiusSm}`}
                  style={{
                    border: `2px dashed ${props.photoDragOver || props.photoDropHover ? '#4ECCA3' : '#d0d0cc'}`,
                    background: '#fafaf8',
                    transition: 'border-color 0.25s ease',
                  }}
                >
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    style={{
                      stroke: props.photoDragOver || props.photoDropHover ? '#1e293b' : '#b0b0aa',
                      transform: props.photoDragOver || props.photoDropHover ? 'scale(1.15)' : 'scale(1)',
                      transition: 'stroke 0.25s ease, transform 0.25s ease',
                    }}
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  <span
                    className="px-1 text-center text-[12px]"
                    style={{
                      color: props.photoDragOver || props.photoDropHover ? '#1e293b' : '#a0a0a0',
                      transition: 'color 0.25s ease',
                    }}
                  >
                    {props.formPhotoFiles.length === 0 ? `点击或拖拽上传口腔照片（最多 ${PHOTO_MAX} 张）` : '添加更多'}
                  </span>
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-1 px-6 pb-5 pt-3">
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={props.resetForm} className={`px-4 py-2 text-[14px] transition-colors hover:bg-[#e8e8e4] ${S.radiusSm}`} style={{ background: '#f0f0ec', color: S.sub }}>取消</button>
            <button type="button" onClick={() => void props.handleSubmit()} className={`px-5 py-2 text-[14px] font-medium text-white transition-colors hover:brightness-110 ${S.radiusSm}`} style={{ background: S.accent }}>
              {props.isEditing ? '保存修改' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
