import { Surface } from '@nimiplatform/nimi-kit/ui';
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppStore, computeAgeMonths, computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import {
  insertDentalRecord,
  updateDentalRecord,
  deleteDentalRecord,
  getDentalRecords,
  saveAttachment,
  getAttachments,
  deleteAttachment,
} from '../../bridge/sqlite-bridge.js';
import type { DentalRecordRow, AttachmentRow } from '../../bridge/sqlite-bridge.js';
import { ulid, isoNow } from '../../bridge/ulid.js';
import { DentalInsightCard } from './dental-page-insight-card.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { readImageFileAsDataUrl } from './checkup-ocr.js';
import {
  buildDentalAttachmentMap,
  dentalEventLabelAndEmoji,
  EVENT_TYPES,
  formatDentalToothLabel,
  joinDentalToothIds,
  makeEventEntry,
  NEEDS_SEVERITY,
  ORTHO_EVENT_TYPES,
  ORTHO_GROUP_FILTER_KEY,
  ORTHO_GROUP_FILTER_LABEL,
  parseDentalToothIds,
  PHOTO_MAX,
  SEVERITY_LABELS,
  type EventEntry,
  type PendingDentalPhoto,
} from './dental-page-domain.js';
import { DentalRecordFormModal } from './dental-page-form-modal.js';
import { ToothStatusOverview } from './dental-page-tooth-status-overview.js';
import { DentalKPIStrip } from './dental-page-kpi-strip.js';
import { DentalEruptionScanModal } from './dental-eruption-scan-modal.js';
import { DentalHistoryRecordList } from './dental-history-record-list.js';
import { DentalHistoryActions } from './dental-history-actions.js';
import {
  analyzeDentalEruptionImage,
  getDentalScanDisplayMessage,
  type DentalEruptionCandidate,
} from './dental-eruption-scan.js';

/* ── Main view ───────────────────────────────────────────── */

export function DentalHistoryView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [records, setRecords] = useState<DentalRecordRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const ageMonths = child ? computeAgeMonths(child.birthDate) : 0;

  const [eventEntries, setEventEntries] = useState<EventEntry[]>(() => [makeEventEntry(ageMonths)]);
  const [activeEntryIdx, setActiveEntryIdx] = useState(0);
  const [formEventDate, setFormEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [formHospital, setFormHospital] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [reminderMsg, setReminderMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [existingPhotoAttachments, setExistingPhotoAttachments] = useState<AttachmentRow[]>([]);
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState<string[]>([]);
  const [formPhotoPreviews, setFormPhotoPreviews] = useState<string[]>([]);
  const [formPhotoFiles, setFormPhotoFiles] = useState<PendingDentalPhoto[]>([]);
  const [photoDragOver, setPhotoDragOver] = useState(false);
  const [photoDropHover, setPhotoDropHover] = useState(false);
  const isEditing = editingRecordId !== null;
  const visibleExistingPhotoAttachments = existingPhotoAttachments.filter((attachment) => !removedAttachmentIds.includes(attachment.attachmentId));
  const totalPhotoCount = visibleExistingPhotoAttachments.length + formPhotoFiles.length;

  const [showScanModal, setShowScanModal] = useState(false);
  const [scanStage, setScanStage] = useState<'upload' | 'analyzing' | 'review' | 'saving'>('upload');
  const [scanPreviewUrl, setScanPreviewUrl] = useState<string | null>(null);
  const [scanPhoto, setScanPhoto] = useState<PendingDentalPhoto | null>(null);
  const [scanCandidates, setScanCandidates] = useState<DentalEruptionCandidate[]>([]);
  const [scanWarnings, setScanWarnings] = useState<string[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanEventDate, setScanEventDate] = useState(new Date().toISOString().slice(0, 10));

  const appendPhotoFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (list.length === 0) return;
    const remaining = Math.max(0, PHOTO_MAX - totalPhotoCount);
    if (remaining === 0) return;
    const slice = list.slice(0, remaining);
    const newPreviews: string[] = [];
    const newFiles: PendingDentalPhoto[] = [];
    for (const file of slice) {
      try {
        const dataUrl = await readImageFileAsDataUrl(file);
        const [, base64] = dataUrl.split(',');
        newPreviews.push(dataUrl);
        newFiles.push({ base64: base64 ?? '', mimeType: file.type, fileName: file.name });
      } catch { /* skip unreadable file */ }
    }
    if (newFiles.length === 0) return;
    setFormPhotoPreviews((prev) => [...prev, ...newPreviews]);
    setFormPhotoFiles((prev) => [...prev, ...newFiles]);
  };

  const removePhotoAt = (idx: number) => {
    setFormPhotoPreviews((prev) => prev.filter((_, i) => i !== idx));
    setFormPhotoFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const appendPhotoPaths = async (paths: string[]) => {
    const remaining = Math.max(0, PHOTO_MAX - totalPhotoCount);
    if (remaining === 0) return;
    const slice = paths.slice(0, remaining);
    const newPreviews: string[] = [];
    const newFiles: PendingDentalPhoto[] = [];
    for (const path of slice) {
      try {
        const payload = await invoke<{ fileName: string; mimeType: string; base64: string }>(
          'read_dropped_image_as_base64',
          { path },
        );
        if (!payload.base64) continue;
        newPreviews.push(`data:${payload.mimeType};base64,${payload.base64}`);
        newFiles.push({ base64: payload.base64, mimeType: payload.mimeType, fileName: payload.fileName });
      } catch { /* skip non-image / unreadable */ }
    }
    if (newFiles.length === 0) return;
    setFormPhotoPreviews((prev) => [...prev, ...newPreviews]);
    setFormPhotoFiles((prev) => [...prev, ...newFiles]);
  };

  const pickPhotoFiles = async () => {
    try {
      const paths = await invoke<string[]>('pick_image_files', { title: '选择口腔照片' });
      if (paths && paths.length > 0) await appendPhotoPaths(paths);
    } catch (error) {
      catchLog('dental', 'action:pick-photo-files-failed')(error);
    }
  };

  const resetScanState = () => {
    setScanStage('upload');
    setScanPreviewUrl(null);
    setScanPhoto(null);
    setScanCandidates([]);
    setScanWarnings([]);
    setScanError(null);
    setScanEventDate(new Date().toISOString().slice(0, 10));
  };

  const openScanModal = () => {
    resetScanState();
    setShowScanModal(true);
  };

  const closeScanModal = () => {
    setShowScanModal(false);
    resetScanState();
  };

  const runScan = async (photo: PendingDentalPhoto) => {
    setScanError(null);
    setScanStage('analyzing');
    try {
      const extraction = await analyzeDentalEruptionImage({
        imageUrl: `data:${photo.mimeType};base64,${photo.base64}`,
        ageMonths,
      });
      setScanCandidates(extraction.candidates);
      setScanWarnings(extraction.warnings);
      setScanStage('review');
    } catch (error) {
      catchLog('dental', 'action:dental-scan-failed')(error);
      setScanError(getDentalScanDisplayMessage(error));
      setScanStage('review');
    }
  };

  const pickScanPhoto = async () => {
    try {
      const paths = await invoke<string[]>('pick_image_files', { title: '选择口腔照片用于 AI 识别' });
      if (!paths || paths.length === 0) return;
      const [firstPath] = paths;
      if (!firstPath) return;
      const payload = await invoke<{ fileName: string; mimeType: string; base64: string }>(
        'read_dropped_image_as_base64',
        { path: firstPath },
      );
      if (!payload.base64) return;
      const photo: PendingDentalPhoto = {
        base64: payload.base64,
        mimeType: payload.mimeType,
        fileName: payload.fileName,
      };
      setScanPhoto(photo);
      setScanPreviewUrl(`data:${payload.mimeType};base64,${payload.base64}`);
      setScanCandidates([]);
      setScanWarnings([]);
      setScanError(null);
      await runScan(photo);
    } catch (error) {
      catchLog('dental', 'action:dental-scan-pick-failed')(error);
      setScanError(getDentalScanDisplayMessage(error));
    }
  };

  const retakeScanPhoto = () => {
    setScanPhoto(null);
    setScanPreviewUrl(null);
    setScanCandidates([]);
    setScanWarnings([]);
    setScanError(null);
    setScanStage('upload');
  };

  const reanalyzeScanPhoto = async () => {
    if (!scanPhoto) return;
    await runScan(scanPhoto);
  };

  const applyFlippedCandidates = (next: DentalEruptionCandidate[]) => {
    setScanCandidates(next);
  };

  const eruptionToothIdsByType = useMemo(() => {
    const primary = new Set<string>();
    const permanent = new Set<string>();
    for (const record of records) {
      if (record.eventType !== 'eruption') continue;
      for (const toothId of parseDentalToothIds(record.toothId)) {
        if (record.toothSet === 'permanent') permanent.add(toothId);
        else primary.add(toothId);
      }
    }
    return { primary, permanent };
  }, [records]);

  const alreadyRecordedErupted = useMemo(() => {
    return new Set<string>([...eruptionToothIdsByType.primary, ...eruptionToothIdsByType.permanent]);
  }, [eruptionToothIdsByType]);

  const confirmScanWrite = async (input: {
    eventDate: string;
    selectedToothIds: string[];
    candidates: DentalEruptionCandidate[];
  }) => {
    if (!child || !scanPhoto) return;
    if (!input.eventDate) return;
    const selectedSet = new Set(input.selectedToothIds);
    const toWrite = input.candidates.filter((candidate) => selectedSet.has(candidate.toothId));
    if (toWrite.length === 0) return;
    setScanStage('saving');
    setScanError(null);
    const now = isoNow();
    const age = computeAgeMonthsAt(child.birthDate, input.eventDate);
    try {
      const groups: Record<'primary' | 'permanent', string[]> = { primary: [], permanent: [] };
      for (const candidate of toWrite) {
        const existing = candidate.type === 'permanent'
          ? eruptionToothIdsByType.permanent
          : eruptionToothIdsByType.primary;
        if (existing.has(candidate.toothId)) continue;
        groups[candidate.type].push(candidate.toothId);
      }

      const writtenRecordIds: string[] = [];
      for (const toothSet of ['primary', 'permanent'] as const) {
        const toothIds = groups[toothSet];
        if (toothIds.length === 0) continue;
        const recordId = ulid();
        await insertDentalRecord({
          recordId,
          childId: child.childId,
          eventType: 'eruption',
          toothId: joinDentalToothIds(toothIds),
          toothSet,
          eventDate: input.eventDate,
          ageMonths: age,
          severity: null,
          hospital: null,
          notes: '[AI 识别] 由口腔照片/全景片 AI 识别导入',
          photoPath: null,
          now,
        });
        writtenRecordIds.push(recordId);
      }

      if (writtenRecordIds.length > 0 && writtenRecordIds[0]) {
        try {
          await saveAttachment({
            attachmentId: ulid(),
            childId: child.childId,
            ownerTable: 'health_record_events',
            ownerId: writtenRecordIds[0],
            fileName: scanPhoto.fileName,
            mimeType: scanPhoto.mimeType,
            imageBase64: scanPhoto.base64,
            caption: 'AI 识别源照片',
            now,
          });
        } catch (error) {
          catchLog('dental', 'action:dental-scan-save-attachment-failed')(error);
        }
      }

      await refreshDentalData(child.childId);
      setReminderMsg(t('Profile.rich.dental.scanSaved', { count: writtenRecordIds.length > 0 ? toWrite.length : 0 }));
      setTimeout(() => setReminderMsg(null), 5000);
      setShowScanModal(false);
      resetScanState();
    } catch (error) {
      catchLog('dental', 'action:dental-scan-save-failed')(error);
      setScanError(t('Profile.rich.vision.saveFailed'));
      setScanStage('review');
    }
  };

  const removeExistingPhoto = (attachmentId: string) => {
    setRemovedAttachmentIds((prev) => prev.includes(attachmentId) ? prev : [...prev, attachmentId]);
  };

  const [attachmentMap, setAttachmentMap] = useState<Map<string, AttachmentRow[]>>(new Map());

  const refreshDentalData = async (childId: string) => {
    const [nextRecords, nextAttachments] = await Promise.all([
      getDentalRecords(childId),
      getAttachments(childId),
    ]);
    setRecords(nextRecords);
    setAttachmentMap(buildDentalAttachmentMap(nextAttachments));
  };

  useEffect(() => {
    if (!showForm) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload as { type: string; paths?: string[] };
      if (payload.type === 'enter' || payload.type === 'over') {
        setPhotoDragOver(true);
      } else if (payload.type === 'leave') {
        setPhotoDragOver(false);
      } else if (payload.type === 'drop') {
        setPhotoDragOver(false);
        const paths = payload.paths ?? [];
        if (paths.length > 0) void appendPhotoPaths(paths);
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    }).catch(catchLog('dental', 'action:register-drag-drop-failed'));
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [showForm]);

  useEffect(() => {
    if (!activeChildId) return;
    void refreshDentalData(activeChildId).catch(catchLog('dental', 'action:load-dental-data-failed'));
  }, [activeChildId]);

  // Filter event types by child age
  const availableEventTypes = useMemo(
    () => EVENT_TYPES.filter((e) => ageMonths >= e.minAge),
    [ageMonths],
  );

  // Build tooth status map from records
  const toothStatus = useMemo(() => {
    const m = new Map<string, string>();
    const sorted = [...records].sort((a, b) => a.eventDate.localeCompare(b.eventDate));
    for (const r of sorted) {
      for (const toothId of parseDentalToothIds(r.toothId)) {
        m.set(toothId, r.eventType);
      }
    }
    return m;
  }, [records]);

  // Stats
  const cariesCount = records.filter((r) => r.eventType === 'caries').length;
  const eruptedToothIds = new Set(records.filter((r) => r.eventType === 'eruption').flatMap((r) => parseDentalToothIds(r.toothId)));
  const eruptedCount = eruptedToothIds.size;
  const permanentCount = [...eruptedToothIds].filter((id) => {
    const n = Number(id);
    return Number.isFinite(n) && ((n >= 11 && n <= 18) || (n >= 21 && n <= 28) || (n >= 31 && n <= 38) || (n >= 41 && n <= 48));
  }).length;

  if (!child) return <div className="p-8 text-[var(--nimi-text-muted)]">请先添加孩子</div>;

  const sortedRecords = [...records].sort((a, b) => b.eventDate.localeCompare(a.eventDate));
  // Build filter chips. All `ortho-*` events collapse into a single "正畸"
  // chip with key `ORTHO_GROUP_FILTER_KEY`; non-ortho types each get their
  // own chip in first-seen order. Individual cards still surface their own
  // specific label/emoji, so the merge is filter-only.
  const usedFilterKeys = (() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const r of sortedRecords) {
      const key = ORTHO_EVENT_TYPES.has(r.eventType) ? ORTHO_GROUP_FILTER_KEY : r.eventType;
      if (!seen.has(key)) { seen.add(key); ordered.push(key); }
    }
    return ordered;
  })();
  const filterTabs: Array<{ key: string | null; label: string }> = [
    { key: null, label: '全部' },
    ...usedFilterKeys.slice(0, 4).map((key) => ({
      key,
      label: key === ORTHO_GROUP_FILTER_KEY
        ? ORTHO_GROUP_FILTER_LABEL
        : dentalEventLabelAndEmoji(key).label,
    })),
  ];
  const filteredSortedRecords = typeFilter
    ? sortedRecords.filter((r) => {
        if (typeFilter === ORTHO_GROUP_FILTER_KEY) return ORTHO_EVENT_TYPES.has(r.eventType);
        return r.eventType === typeFilter;
      })
    : sortedRecords;
  const recordGroups: Array<[string, DentalRecordRow[]]> = (() => {
    const map = new Map<string, DentalRecordRow[]>();
    for (const r of filteredSortedRecords) {
      const d = r.eventDate.split('T')[0]!;
      const list = map.get(d);
      if (list) list.push(r);
      else map.set(d, [r]);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  })();
  const updateEntry = (idx: number, patch: Partial<EventEntry>) =>
    setEventEntries((prev) => prev.map((e, i) => i === idx ? { ...e, ...patch } : e));

  const addEntry = () => {
    const next = makeEventEntry(ageMonths);
    setEventEntries((prev) => [...prev, next]);
    setActiveEntryIdx(eventEntries.length);
  };

  const removeEntry = (idx: number) => {
    setEventEntries((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      setActiveEntryIdx((ai) => Math.min(ai, next.length - 1));
      return next;
    });
  };

  const resetForm = () => {
    setEventEntries([makeEventEntry(ageMonths)]);
    setActiveEntryIdx(0);
    setFormEventDate(new Date().toISOString().slice(0, 10));
    setFormHospital('');
    setFormNotes('');
    setEditingRecordId(null);
    setExistingPhotoAttachments([]);
    setRemovedAttachmentIds([]);
    setFormPhotoPreviews([]);
    setFormPhotoFiles([]);
    setPhotoDragOver(false);
    setPhotoDropHover(false);
    setShowForm(false);
  };

  const startEditingRecord = (record: DentalRecordRow) => {
    setEditingRecordId(record.recordId);
    setEventEntries([{
      eventType: record.eventType,
      toothIds: parseDentalToothIds(record.toothId),
      toothSet: record.toothSet === 'permanent' ? 'permanent' : 'primary',
      severity: record.severity ?? '',
    }]);
    setActiveEntryIdx(0);
    setFormEventDate(record.eventDate.split('T')[0] ?? record.eventDate);
    setFormHospital(record.hospital ?? '');
    setFormNotes(record.notes ?? '');
    setExistingPhotoAttachments(attachmentMap.get(record.recordId) ?? []);
    setRemovedAttachmentIds([]);
    setFormPhotoPreviews([]);
    setFormPhotoFiles([]);
    setPhotoDragOver(false);
    setPhotoDropHover(false);
    setShowForm(true);
  };

  const handleAskAiAboutRecord = (record: DentalRecordRow) => {
    const evtInfo = EVENT_TYPES.find((e) => e.key === record.eventType);
    const toothLabel = formatDentalToothLabel(record.toothId);
    const eventDate = record.eventDate.split('T')[0] ?? record.eventDate;
    const topic = t('Profile.rich.dental.recordTopic', {
      event: evtInfo?.label ?? record.eventType,
      tooth: toothLabel ? ` · ${toothLabel}` : '',
    });
    const descParts: string[] = [`日期：${eventDate}`];
    if (toothLabel) descParts.push(`牙位：${toothLabel}`);
    if (record.severity) descParts.push(t('Profile.rich.dental.severity', { severity: SEVERITY_LABELS[record.severity] ?? record.severity }));
    if (record.hospital) descParts.push(`机构：${record.hospital}`);
    if (record.notes) descParts.push(`备注：${record.notes}`);
    const params = new URLSearchParams({ topic, desc: descParts.join('；'), record: 'dental' });
    navigate(`/advisor?${params.toString()}`);
  };

  const handleDeleteRecord = async (record: DentalRecordRow) => {
    if (!window.confirm(t('Profile.rich.dental.deleteConfirm'))) return;
    try {
      for (const attachment of attachmentMap.get(record.recordId) ?? []) {
        await deleteAttachment(attachment.attachmentId);
      }
      await deleteDentalRecord(record.recordId);
      if (editingRecordId === record.recordId) {
        resetForm();
      }
      await refreshDentalData(child.childId);
    } catch (error) {
      catchLog('dental', 'action:delete-record-failed')(error);
      setErrorMsg(t('Profile.rich.dental.deleteFailed', { message: error instanceof Error ? error.message : String(error) }));
    }
  };

  const handleSubmit = async () => {
    if (!formEventDate || eventEntries.length === 0) return;
    const now = isoNow();
    const age = computeAgeMonthsAt(child.birthDate, formEventDate);
    setErrorMsg(null);
    try {
      if (editingRecordId) {
        const entry = eventEntries[0];
        if (!entry) return;
        await updateDentalRecord({
          recordId: editingRecordId,
          eventType: entry.eventType,
          toothId: joinDentalToothIds(entry.toothIds),
          toothSet: entry.toothSet,
          eventDate: formEventDate,
          ageMonths: age,
          severity: NEEDS_SEVERITY.has(entry.eventType) ? (entry.severity || null) : null,
          hospital: formHospital || null,
          notes: formNotes || null,
          photoPath: null,
          now,
        });

        for (const attachmentId of removedAttachmentIds) {
          await deleteAttachment(attachmentId);
        }
        for (const photo of formPhotoFiles) {
          await saveAttachment({
            attachmentId: ulid(),
            childId: child.childId,
            ownerTable: 'health_record_events',
            ownerId: editingRecordId,
            fileName: photo.fileName,
            mimeType: photo.mimeType,
            imageBase64: photo.base64,
            caption: null,
            now,
          });
        }

        await refreshDentalData(child.childId);
        resetForm();
        return;
      }

      const recordIds: string[] = [];
      for (const entry of eventEntries) {
        const recordId = ulid();
        recordIds.push(recordId);
        await insertDentalRecord({
          recordId, childId: child.childId, eventType: entry.eventType,
          toothId: joinDentalToothIds(entry.toothIds), toothSet: entry.toothSet,
          eventDate: formEventDate, ageMonths: age,
          severity: NEEDS_SEVERITY.has(entry.eventType) ? (entry.severity || null) : null,
          hospital: formHospital || null, notes: formNotes || null, photoPath: null, now,
        });
      }

      if (formPhotoFiles.length > 0 && recordIds[0]) {
        for (const photo of formPhotoFiles) {
          await saveAttachment({
            attachmentId: ulid(), childId: child.childId,
            ownerTable: 'health_record_events', ownerId: recordIds[0],
            fileName: photo.fileName, mimeType: photo.mimeType,
            imageBase64: photo.base64, caption: null, now,
          });
        }
      }

      await refreshDentalData(child.childId);
      resetForm();
    } catch (error) {
      catchLog('dental', 'action:submit-dental-record-failed')(error);
      setErrorMsg(t('Profile.rich.dental.saveFailed', { message: error instanceof Error ? error.message : String(error) }));
    }
  };

  const fmtAge = (am: number) => am < 24 ? `${am}月` : `${Math.floor(am / 12)}岁${am % 12 > 0 ? `${am % 12}月` : ''}`;

  return (
    <div style={{ minHeight: '100%' }}>
      <DentalHistoryActions
        show={!showForm}
        onScan={openScanModal}
        onAdd={() => setShowForm(true)}
        scanTitle={t('Profile.rich.dental.aiRecognizeHint')}
        scanLabel={t('Profile.rich.dental.aiRecognizeTeeth')}
        addLabel={t('Profile.rich.common.addRecord')}
      />

      {/* Reminder toast */}
      {reminderMsg && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-[color-mix(in_srgb,var(--nimi-status-success)_30%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-success)_8%,var(--nimi-surface-card))] px-4 py-2.5 text-[14px] font-medium text-[var(--nimi-status-success)]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
          {reminderMsg}
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-2xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_30%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,var(--nimi-surface-card))] px-4 py-2.5 text-[14px] font-medium text-[var(--nimi-status-danger)]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
          <span className="flex-1">{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="cursor-pointer border-0 bg-transparent text-[12px] text-[var(--nimi-status-danger)]"
             aria-label={t('Profile.rich.common.close')}
          >
            ×
          </button>
        </div>
      )}

      {/* Section label */}
      <div
        className="mb-3 px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--nimi-text-muted)]"
      >
        {t('Profile.rich.dental.statusOverview')}
      </div>

      {/* Tooth status overview — top of dental record */}
      <ToothStatusOverview records={records} />

      {/* KPI strip */}
      {records.length > 0 && (
        <DentalKPIStrip
          eruptedCount={eruptedCount}
          eruptedTotal={20}
          permanentCount={permanentCount}
          cariesCount={cariesCount}
          recordCount={records.length}
        />
      )}

      {records.length > 0 && (
        <DentalInsightCard
          childName={child.displayName}
          ageLabel={`${Math.floor(ageMonths / 12)}岁${ageMonths % 12}月`}
          records={records}
        />
      )}

      <DentalRecordFormModal
        show={showForm}
        isEditing={isEditing}
        ageMonths={ageMonths}
        eventEntries={eventEntries}
        activeEntryIdx={activeEntryIdx}
        availableEventTypes={availableEventTypes}
        toothStatus={toothStatus}
        formEventDate={formEventDate}
        formHospital={formHospital}
        formNotes={formNotes}
        photoDragOver={photoDragOver}
        photoDropHover={photoDropHover}
        existingPhotoAttachments={existingPhotoAttachments}
        removedAttachmentIds={removedAttachmentIds}
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
        resetForm={resetForm}
        appendPhotoFiles={appendPhotoFiles}
        pickPhotoFiles={pickPhotoFiles}
        removePhotoAt={removePhotoAt}
        removeExistingPhoto={removeExistingPhoto}
        handleSubmit={handleSubmit}
      />

      <DentalEruptionScanModal
        show={showScanModal}
        onClose={closeScanModal}
        onPickImage={pickScanPhoto}
        onAnalyze={reanalyzeScanPhoto}
        onConfirm={confirmScanWrite}
        onFlipCandidates={applyFlippedCandidates}
        onRetake={retakeScanPhoto}
        previewUrl={scanPreviewUrl}
        candidates={scanCandidates}
        warnings={scanWarnings}
        stage={scanStage}
        errorMessage={scanError}
        alreadyRecordedErupted={alreadyRecordedErupted}
        eventDate={scanEventDate}
        onEventDateChange={setScanEventDate}
      />

      {/* ── Records timeline ─────────────────────────────── */}
      <div className="mt-2 mb-4 flex items-center justify-between gap-3 flex-wrap px-1">
        <div className="flex items-baseline gap-2">
          <h3 className="m-0 text-[15px] font-semibold text-[var(--nimi-text-primary)]">{t('Profile.rich.dental.history')}</h3>
          <span className="font-mono text-[12px] text-[var(--nimi-text-muted)]">
            {t('Profile.rich.common.recordsCount', { count: sortedRecords.length })}
          </span>
        </div>
        {filterTabs.length > 1 && (
          <div className="flex gap-0.5 rounded-full border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-border-subtle)_45%,transparent)] p-[3px]">
            {filterTabs.map((tab) => {
              const active = typeFilter === tab.key;
              return (
                <button key={tab.key ?? 'all'} type="button" onClick={() => setTypeFilter(tab.key)}
                  className={`cursor-pointer rounded-full border-0 px-3 py-1.5 text-[12px] transition-all ${active ? 'bg-[var(--nimi-surface-card)] font-semibold text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-base)]' : 'bg-transparent font-normal text-[var(--nimi-text-muted)]'}`}>
                  {tab.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {sortedRecords.length === 0 && !showForm && (
        <Surface tone="card" material="glass-regular" elevation="raised" padding="lg" className="rounded-3xl p-8 text-center">
          <span className="text-[24px]">🦷</span>
          <p className="text-[14px] mt-2 font-medium text-[var(--nimi-text-primary)]">{t('Profile.rich.dental.empty')}</p>
          <p className="text-[13px] mt-1 text-[var(--nimi-text-muted)]">{t('Profile.rich.dental.emptyHint')}</p>
        </Surface>
      )}

      {sortedRecords.length > 0 && filteredSortedRecords.length === 0 && (
        <Surface tone="card" material="glass-regular" elevation="raised" padding="lg" className="rounded-3xl p-6 text-center">
          <p className="text-[14px] text-[var(--nimi-text-muted)]">{t('Profile.rich.dental.emptyFiltered')}</p>
        </Surface>
      )}

      {filteredSortedRecords.length > 0 && (
        <DentalHistoryRecordList
          recordGroups={recordGroups}
          attachmentMap={attachmentMap}
          fmtAge={fmtAge}
          onAskAi={handleAskAiAboutRecord}
          onEdit={startEditingRecord}
          onDelete={(r) => void handleDeleteRecord(r)}
        />
      )}
    </div>
  );
}
