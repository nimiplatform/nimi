import { convertFileSrc } from '@tauri-apps/api/core';
import { Button, cn, DashedAddButton, TextField, TextareaField } from '@nimiplatform/nimi-kit/ui';
import type { AttachmentRow } from '../../bridge/sqlite-bridge.js';
import type { ReactNode } from 'react';
import { ProfileDatePicker } from './profile-date-picker.js';
import {
  ChipGroup,
  type ChipOption,
  FormField,
  FormGrid,
  HealthRecordModalShell,
  ModalContent,
  ModalFooter,
  ModalHeader,
  SectionCard,
} from './health-record-modal-shell.js';
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
  existingPhotoAttachments: AttachmentRow[];
  removedAttachmentIds: string[];
  formPhotoPreviews: string[];
  formPhotoFiles: PendingDentalPhoto[];
  setFormEventDate: (value: string) => void;
  setFormHospital: (value: string) => void;
  setFormNotes: (value: string) => void;
  setActiveEntryIdx: (value: number) => void;
  setPhotoDragOver: (value: boolean) => void;
  updateEntry: (idx: number, patch: Partial<EventEntry>) => void;
  removeEntry: (idx: number) => void;
  addEntry: () => void;
  resetForm: () => void;
  appendPhotoFiles: (files: FileList | File[]) => Promise<void>;
  pickPhotoFiles: () => Promise<void>;
  removePhotoAt: (idx: number) => void;
  removeExistingPhoto: (attachmentId: string) => void;
  handleSubmit: () => Promise<void>;
  /** Optional inline error rendered at the end of the scrollable content. */
  inlineFooterContent?: ReactNode;
};

export function DentalRecordFormModal(props: DentalRecordFormModalProps) {
  if (!props.show) return null;
  return (
    <HealthRecordModalShell open size="XL" onClose={props.resetForm}>
      <DentalRecordFormBody {...props} />
    </HealthRecordModalShell>
  );
}

const SEVERITY_OPTIONS = ['mild', 'moderate', 'severe'] as const;
const SEVERITY_ACTIVE_BG: Record<(typeof SEVERITY_OPTIONS)[number], string> = {
  mild: 'var(--nimi-action-primary-bg)',
  moderate: 'var(--nimi-status-warning)',
  severe: 'var(--nimi-status-danger)',
};

export function DentalRecordFormBody(props: DentalRecordFormModalProps) {
  const visibleExistingPhotoAttachments = props.existingPhotoAttachments.filter(
    (attachment) => !props.removedAttachmentIds.includes(attachment.attachmentId),
  );
  const totalPhotoCount = visibleExistingPhotoAttachments.length + props.formPhotoFiles.length;

  const eventTypeChips: ChipOption<string>[] = props.availableEventTypes.map((item) => ({
    value: item.key,
    label: item.label,
    emoji: item.emoji,
  }));

  return (
    <>
      <ModalHeader
        title={props.isEditing ? '编辑口腔记录' : '添加口腔记录'}
        icon={props.isEditing ? '✏️' : '🦷'}
        onClose={props.resetForm}
      />
      <ModalContent>
        <div className="space-y-5">
          <FormGrid cols={2}>
            <FormField label="就诊日期">
              <ProfileDatePicker value={props.formEventDate} onChange={props.setFormEventDate} className="h-12" />
            </FormField>
            <FormField label="医院/诊所">
              <TextField
                value={props.formHospital}
                onChange={(event) => props.setFormHospital(event.target.value)}
                placeholder="选填"
                className="w-full min-h-12"
              />
            </FormField>
          </FormGrid>

          {props.eventEntries.map((entry, idx) => {
            const isActive = idx === props.activeEntryIdx;
            const eventMeta = EVENT_TYPES.find((item) => item.key === entry.eventType);
            const entryNeedsTooth = NEEDS_TOOTH.has(entry.eventType);
            const entryNeedsSeverity = NEEDS_SEVERITY.has(entry.eventType);
            const toothSetOptions = (
              ['primary', ...(props.ageMonths >= 60 ? (['permanent'] as const) : [])] as const
            ).map((value) => ({
              value: value as 'primary' | 'permanent',
              label: value === 'primary' ? '乳牙' : '恒牙',
            }));
            return (
              <div
                key={idx}
                className={cn(
                  'cursor-pointer rounded-2xl border p-4 transition-all',
                  isActive
                    ? 'border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_38%,var(--nimi-border-subtle))] bg-[var(--nimi-surface-card)]'
                    : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]',
                )}
                onClick={() => props.setActiveEntryIdx(idx)}
              >
                <div className="mb-2 flex items-center justify-between">
                  <p
                    className={cn(
                      'text-[13px] font-semibold',
                      isActive ? 'text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-primary)]',
                    )}
                  >
                    事件 {idx + 1} {eventMeta ? `· ${eventMeta.emoji} ${eventMeta.label}` : ''}
                    {entry.toothIds.length > 0 ? (
                      <span className="font-normal text-[var(--nimi-text-muted)]">
                        {' '}
                        · {entry.toothIds.length} 颗牙
                      </span>
                    ) : null}
                  </p>
                  {props.eventEntries.length > 1 ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        props.removeEntry(idx);
                      }}
                      className="rounded-full px-2 py-0.5 text-[12px] text-[var(--nimi-status-danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)]"
                    >
                      删除
                    </button>
                  ) : null}
                </div>

                {isActive ? (
                  <div className="mt-2 space-y-3" onClick={(event) => event.stopPropagation()}>
                    <FormField label="类型">
                      <ChipGroup
                        size="sm"
                        options={eventTypeChips}
                        value={entry.eventType}
                        onChange={(value) =>
                          props.updateEntry(idx, { eventType: value, toothIds: [], severity: '' })
                        }
                      />
                    </FormField>

                    {entryNeedsTooth ? (
                      <div>
                        <div className="mb-2 flex items-center gap-3">
                          <p className="text-[12px] text-[var(--nimi-text-muted)]">
                            牙位
                          </p>
                          <ChipGroup
                            size="sm"
                            options={toothSetOptions.map((opt) => ({ value: opt.value as string, label: opt.label }))}
                            value={entry.toothSet}
                            onChange={(value) =>
                              props.updateEntry(idx, {
                                toothSet: value as 'primary' | 'permanent',
                                toothIds: [],
                              })
                            }
                          />
                        </div>
                        <ToothChart
                          selectedTeeth={entry.toothIds}
                          onToggle={(id) =>
                            props.updateEntry(idx, {
                              toothIds: entry.toothIds.includes(id)
                                ? entry.toothIds.filter((toothId) => toothId !== id)
                                : [...entry.toothIds, id],
                            })
                          }
                          toothSet={entry.toothSet}
                          recordedTeeth={props.toothStatus}
                        />
                      </div>
                    ) : null}

                    {entryNeedsSeverity ? (
                      <FormField label="严重程度">
                        <ChipGroup
                          size="sm"
                          layout="fill"
                          clearable
                          options={SEVERITY_OPTIONS.map((severity) => ({
                            value: severity,
                            label: SEVERITY_LABELS[severity] ?? severity,
                          }))}
                          value={entry.severity}
                          onChange={(value) =>
                            props.updateEntry(idx, { severity: value as (typeof SEVERITY_OPTIONS)[number] })
                          }
                          activeColor={SEVERITY_ACTIVE_BG[entry.severity as (typeof SEVERITY_OPTIONS)[number]] ?? 'var(--nimi-action-primary-bg)'}
                        />
                      </FormField>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}

          {!props.isEditing ? (
            <DashedAddButton shape="row" onClick={props.addEntry} label="添加另一个事件" />
          ) : null}

          <FormField label="备注">
            <TextareaField
              value={props.formNotes}
              onChange={(event) => props.setFormNotes(event.target.value)}
              placeholder="选填"
              rows={2}
              className="w-full"
            />
          </FormField>

          <SectionCard
            title={`照片${props.formPhotoFiles.length > 0 ? ` (${props.formPhotoFiles.length}/${PHOTO_MAX})` : ''}`}
            variant="plain"
          >
            <div className="space-y-2">
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
                className="grid grid-cols-4 gap-2"
              >
                {visibleExistingPhotoAttachments.map((attachment) => (
                  <div key={attachment.attachmentId} className="group relative">
                    <img
                      src={convertFileSrc(attachment.filePath)}
                      alt={attachment.fileName}
                      className="h-24 w-full rounded-xl object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => props.removeExistingPhoto(attachment.attachmentId)}
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--nimi-surface-overlay)] text-[12px] text-[var(--nimi-text-primary)] opacity-0 shadow-[var(--nimi-elevation-base)] transition-opacity group-hover:opacity-100"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {props.formPhotoPreviews.map((src, idx) => (
                  <div key={idx} className="group relative">
                    <img src={src} alt={`preview-${idx}`} className="h-24 w-full rounded-xl object-cover" />
                    <button
                      type="button"
                      onClick={() => props.removePhotoAt(idx)}
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--nimi-surface-overlay)] text-[12px] text-[var(--nimi-text-primary)] opacity-0 shadow-[var(--nimi-elevation-base)] transition-opacity group-hover:opacity-100"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {totalPhotoCount < PHOTO_MAX ? (
                  <DashedAddButton
                    shape="tile"
                    active={props.photoDragOver}
                    onClick={() => void props.pickPhotoFiles()}
                    className={totalPhotoCount === 0 ? 'col-span-4' : undefined}
                    label={
                      props.formPhotoFiles.length === 0
                        ? `点击或拖拽上传口腔照片（最多 ${PHOTO_MAX} 张）`
                        : '添加更多'
                    }
                  />
                ) : null}
              </div>
            </div>
          </SectionCard>

          {props.inlineFooterContent}
        </div>
      </ModalContent>
      <ModalFooter>
        <Button type="button" onClick={props.resetForm} tone="ghost" size="md">取消</Button>
        <Button type="button" onClick={() => void props.handleSubmit()} tone="primary" size="md">
          {props.isEditing ? '保存修改' : '保存'}
        </Button>
      </ModalFooter>
    </>
  );
}
