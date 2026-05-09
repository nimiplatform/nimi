import { useState } from 'react';
import { computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { insertDentalRecord, saveAttachment } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { readImageFileAsDataUrl } from './checkup-ocr.js';
import {
  joinDentalToothIds,
  makeEventEntry,
  NEEDS_SEVERITY,
  PHOTO_MAX,
  type EventEntry,
  type PendingDentalPhoto,
} from './dental-page-domain.js';
import { DentalRecordFormBody } from './dental-page-form-modal.js';
import { EVENT_TYPES } from './dental-page-domain.js';
import { InlineError } from './health-record-modal-shell.js';

const AVAILABLE_EVENT_TYPES = EVENT_TYPES;

type DentalCaptureChild = {
  childId: string;
  birthDate: string;
};

type DentalCaptureProps = {
  child: DentalCaptureChild;
  ageMonths: number;
  onSaved: () => void | Promise<void>;
  onClose: () => void;
};

export function DentalCaptureContent({ child, ageMonths, onSaved, onClose }: DentalCaptureProps) {
  const [eventEntries, setEventEntries] = useState<EventEntry[]>(() => [makeEventEntry(ageMonths)]);
  const [activeEntryIdx, setActiveEntryIdx] = useState(0);
  const [formEventDate, setFormEventDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formHospital, setFormHospital] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formPhotoPreviews, setFormPhotoPreviews] = useState<string[]>([]);
  const [formPhotoFiles, setFormPhotoFiles] = useState<PendingDentalPhoto[]>([]);
  const [photoDragOver, setPhotoDragOver] = useState(false);
  const [photoDropHover, setPhotoDropHover] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const updateEntry = (idx: number, patch: Partial<EventEntry>) => {
    setEventEntries((prev) => prev.map((entry, i) => (i === idx ? { ...entry, ...patch } : entry)));
  };

  const removeEntry = (idx: number) => {
    setEventEntries((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, i) => i !== idx);
      setActiveEntryIdx((current) => Math.min(current, next.length - 1));
      return next;
    });
  };

  const addEntry = () => {
    setEventEntries((prev) => {
      const next = [...prev, makeEventEntry(ageMonths)];
      setActiveEntryIdx(next.length - 1);
      return next;
    });
  };

  const appendPhotoFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    const remainingSlots = PHOTO_MAX - formPhotoFiles.length;
    if (remainingSlots <= 0) return;
    const toProcess = list.slice(0, remainingSlots);

    const newPhotos: PendingDentalPhoto[] = [];
    const newPreviews: string[] = [];
    for (const file of toProcess) {
      try {
        const base64 = await readImageFileAsDataUrl(file);
        newPhotos.push({ base64, mimeType: file.type || 'image/jpeg', fileName: file.name });
        newPreviews.push(base64);
      } catch (error) {
        catchLog('dental-capture', 'action:read-photo-failed')(error);
      }
    }
    if (newPhotos.length > 0) {
      setFormPhotoFiles((prev) => [...prev, ...newPhotos]);
      setFormPhotoPreviews((prev) => [...prev, ...newPreviews]);
    }
  };

  const pickPhotoFiles = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = async () => {
      if (input.files) await appendPhotoFiles(input.files);
    };
    input.click();
  };

  const removePhotoAt = (idx: number) => {
    setFormPhotoFiles((prev) => prev.filter((_, i) => i !== idx));
    setFormPhotoPreviews((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    if (!formEventDate || eventEntries.length === 0) return;
    const now = isoNow();
    const age = computeAgeMonthsAt(child.birthDate, formEventDate);
    setErrorMsg(null);
    try {
      const recordIds: string[] = [];
      for (const entry of eventEntries) {
        const recordId = ulid();
        recordIds.push(recordId);
        await insertDentalRecord({
          recordId,
          childId: child.childId,
          eventType: entry.eventType,
          toothId: joinDentalToothIds(entry.toothIds),
          toothSet: entry.toothSet,
          eventDate: formEventDate,
          ageMonths: age,
          severity: NEEDS_SEVERITY.has(entry.eventType) ? entry.severity || null : null,
          hospital: formHospital || null,
          notes: formNotes || null,
          photoPath: null,
          now,
        });
      }

      if (formPhotoFiles.length > 0 && recordIds[0]) {
        for (const photo of formPhotoFiles) {
          await saveAttachment({
            attachmentId: ulid(),
            childId: child.childId,
            ownerTable: 'health_record_events',
            ownerId: recordIds[0],
            fileName: photo.fileName,
            mimeType: photo.mimeType,
            imageBase64: photo.base64,
            caption: null,
            now,
          });
        }
      }

      await onSaved();
      onClose();
    } catch (error) {
      catchLog('dental-capture', 'action:submit-failed')(error);
      setErrorMsg(error instanceof Error ? error.message : '保存失败，请重试');
    }
  };

  // toothStatus mirrors detail-page logic for the live tooth-chart preview.
  const toothStatus = new Map<string, string>();
  for (const entry of eventEntries) {
    for (const toothId of entry.toothIds) {
      toothStatus.set(toothId, entry.eventType);
    }
  }

  return (
    <DentalRecordFormBody
      show={true}
      isEditing={false}
      ageMonths={ageMonths}
      eventEntries={eventEntries}
      activeEntryIdx={activeEntryIdx}
      availableEventTypes={AVAILABLE_EVENT_TYPES}
      toothStatus={toothStatus}
      formEventDate={formEventDate}
      formHospital={formHospital}
      formNotes={formNotes}
      photoDragOver={photoDragOver}
      photoDropHover={photoDropHover}
      existingPhotoAttachments={[]}
      removedAttachmentIds={[]}
      formPhotoPreviews={formPhotoPreviews}
      formPhotoFiles={formPhotoFiles}
      setFormEventDate={setFormEventDate}
      setFormHospital={setFormHospital}
      setFormNotes={setFormNotes}
      setActiveEntryIdx={setActiveEntryIdx}
      setPhotoDragOver={setPhotoDragOver}
      setPhotoDropHover={setPhotoDropHover}
      updateEntry={updateEntry}
      removeEntry={removeEntry}
      addEntry={addEntry}
      resetForm={onClose}
      appendPhotoFiles={appendPhotoFiles}
      pickPhotoFiles={pickPhotoFiles}
      removePhotoAt={removePhotoAt}
      removeExistingPhoto={() => undefined}
      handleSubmit={handleSubmit}
      inlineFooterContent={errorMsg ? <InlineError>{errorMsg}</InlineError> : null}
    />
  );
}
