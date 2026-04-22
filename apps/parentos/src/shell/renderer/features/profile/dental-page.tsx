import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAppStore, computeAgeMonths, computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import {
  insertDentalRecord,
  updateDentalRecord,
  deleteDentalRecord,
  getDentalRecords,
  upsertReminderState,
  saveAttachment,
  getAttachments,
  deleteAttachment,
} from '../../bridge/sqlite-bridge.js';
import type { DentalRecordRow, AttachmentRow } from '../../bridge/sqlite-bridge.js';
import { ulid, isoNow } from '../../bridge/ulid.js';
import { S } from '../../app-shell/page-style.js';
import { AppSelect } from '../../app-shell/app-select.js';
import { AISummaryCard } from './ai-summary-card.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { readImageFileAsDataUrl } from './checkup-ocr.js';
import {
  buildDentalAttachmentMap,
  DENTAL_REMINDER_INTERVALS,
  EVENT_TYPES,
  formatDentalToothLabel,
  joinDentalToothIds,
  makeEventEntry,
  NEEDS_SEVERITY,
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
import { DentalRecordActionMenu } from './dental-record-action-menu.js';
import { formatDateLabel } from '../journal/journal-page-helpers.js';
import {
  analyzeDentalEruptionImage,
  getDentalScanDisplayMessage,
  type DentalEruptionCandidate,
} from './dental-eruption-scan.js';

/* ── Main page ───────────────────────────────────────────── */

const DENTAL_TYPE_TONE_DEFAULT = { bg: 'rgba(100,116,139,0.12)', fg: '#475569' };
const DENTAL_TYPE_TONE: Record<string, { bg: string; fg: string }> = {
  eruption:            { bg: 'rgba(16,185,129,0.14)',  fg: '#047857' },
  loss:                { bg: 'rgba(245,158,11,0.14)',  fg: '#b45309' },
  caries:              { bg: 'rgba(236,72,153,0.12)',  fg: '#be185d' },
  filling:             { bg: 'rgba(20,184,166,0.14)',  fg: '#0f766e' },
  cleaning:            { bg: 'rgba(14,165,233,0.12)',  fg: '#0369a1' },
  fluoride:            { bg: 'rgba(59,130,246,0.12)',  fg: '#1d4ed8' },
  sealant:             { bg: 'rgba(99,102,241,0.12)',  fg: '#4338ca' },
  'ortho-assessment':  { bg: 'rgba(99,102,241,0.12)',  fg: '#4338ca' },
  'ortho-start':       { bg: 'rgba(168,85,247,0.12)',  fg: '#7e22ce' },
  checkup:             { bg: 'rgba(14,165,233,0.12)',  fg: '#0369a1' },
};

export default function DentalPage() {
  const navigate = useNavigate();
  const { activeChildId, setActiveChildId, children } = useAppStore();
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
            ownerTable: 'dental_records',
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
      setReminderMsg(`已通过 AI 识别写入 ${writtenRecordIds.length > 0 ? toWrite.length : 0} 颗牙齿萌出记录`);
      setTimeout(() => setReminderMsg(null), 5000);
      setShowScanModal(false);
      resetScanState();
    } catch (error) {
      catchLog('dental', 'action:dental-scan-save-failed')(error);
      setScanError('保存失败，请重试。');
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showForm]);

  useEffect(() => {
    if (!activeChildId) return;
    void refreshDentalData(activeChildId).catch(catchLog('dental', 'action:load-dental-data-failed'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  if (!child) return <div className="p-8" style={{ color: S.sub }}>请先添加孩子</div>;

  const sortedRecords = [...records].sort((a, b) => b.eventDate.localeCompare(a.eventDate));
  const usedEventTypes = (() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const r of sortedRecords) {
      if (!seen.has(r.eventType)) { seen.add(r.eventType); ordered.push(r.eventType); }
    }
    return ordered;
  })();
  const filterTabs: Array<{ key: string | null; label: string }> = [
    { key: null, label: '全部' },
    ...usedEventTypes.slice(0, 4).map((key) => ({
      key,
      label: EVENT_TYPES.find((e) => e.key === key)?.label ?? key,
    })),
  ];
  const filteredSortedRecords = typeFilter
    ? sortedRecords.filter((r) => r.eventType === typeFilter)
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
    const topic = `口腔记录 · ${evtInfo?.label ?? record.eventType}${toothLabel ? ` · ${toothLabel}` : ''}`;
    const descParts: string[] = [`日期：${eventDate}`];
    if (toothLabel) descParts.push(`牙位：${toothLabel}`);
    if (record.severity) descParts.push(`程度：${SEVERITY_LABELS[record.severity] ?? record.severity}`);
    if (record.hospital) descParts.push(`机构：${record.hospital}`);
    if (record.notes) descParts.push(`备注：${record.notes}`);
    const params = new URLSearchParams({ topic, desc: descParts.join('；'), record: 'dental' });
    navigate(`/advisor?${params.toString()}`);
  };

  const handleDeleteRecord = async (record: DentalRecordRow) => {
    if (!window.confirm('删除这条口腔记录后，相关照片也会一起删除，确定继续吗？')) return;
    try {
      for (const attachment of attachmentMap.get(record.recordId) ?? []) {
        await deleteAttachment(attachment.attachmentId);
      }
      await deleteDentalRecord(record.recordId);
      if (editingRecordId === record.recordId) {
        resetForm();
      }
      await refreshDentalData(child.childId);
    } catch { /* bridge */ }
  };

  const handleSubmit = async () => {
    if (!formEventDate || eventEntries.length === 0) return;
    const now = isoNow();
    const age = computeAgeMonthsAt(child.birthDate, formEventDate);
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
        });

        for (const attachmentId of removedAttachmentIds) {
          await deleteAttachment(attachmentId);
        }
        for (const photo of formPhotoFiles) {
          await saveAttachment({
            attachmentId: ulid(),
            childId: child.childId,
            ownerTable: 'dental_records',
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

        // Auto-create next-visit reminder if applicable
        const reminderCfg = DENTAL_REMINDER_INTERVALS[entry.eventType];
        if (reminderCfg) {
          const nextDate = new Date(formEventDate);
          nextDate.setMonth(nextDate.getMonth() + reminderCfg.months);
          const nextTrigger = nextDate.toISOString();
          try {
            await upsertReminderState({
              stateId: ulid(), childId: child.childId,
              ruleId: `dental-auto-${entry.eventType}-${formEventDate}`,
              status: 'pending', activatedAt: null, completedAt: null, dismissedAt: null,
              dismissReason: null, repeatIndex: 0,
              nextTriggerAt: nextTrigger,
              notes: `[dental-reminder] ${reminderCfg.title} · 上次: ${formEventDate} · 下次: ${nextTrigger.split('T')[0]}`,
              now,
            });
            const nextStr = nextTrigger.split('T')[0] ?? '';
            setReminderMsg(`已设置提醒：${reminderCfg.title} · ${nextStr}`);
            setTimeout(() => setReminderMsg(null), 5000);
          } catch { /* reminder creation failed, non-critical */ }
        }
      }

      // Save photos as attachments linked to the first dental record
      if (formPhotoFiles.length > 0 && recordIds[0]) {
        for (const photo of formPhotoFiles) {
          try {
            await saveAttachment({
              attachmentId: ulid(), childId: child.childId,
              ownerTable: 'dental_records', ownerId: recordIds[0],
              fileName: photo.fileName, mimeType: photo.mimeType,
              imageBase64: photo.base64, caption: null, now,
            });
          } catch { /* attachment save failed, non-critical */ }
        }
      }

      await refreshDentalData(child.childId);
      resetForm();
    } catch { /* bridge */ }
  };

  const fmtAge = (am: number) => am < 24 ? `${am}月` : `${Math.floor(am / 12)}岁${am % 12 > 0 ? `${am % 12}月` : ''}`;

  return (
    <div className={S.container} style={{ paddingTop: S.topPad, minHeight: '100%' }}>
      <div className="flex items-center gap-2 mb-3">
        <Link to="/profile" className="text-[12px] hover:underline flex items-center gap-1.5" style={{ color: S.sub }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          返回档案
        </Link>
      </div>

      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap mb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: '-0.025em', color: S.text }}>口腔记录</h1>
            <div className="group relative">
              <div className="w-[18px] h-[18px] rounded-full flex items-center justify-center cursor-help" style={{ color: '#94a3b8' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
                </svg>
              </div>
              <div className="pointer-events-none absolute left-0 top-7 z-50 w-[320px] rounded-xl p-4 text-[11px] leading-relaxed opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100"
                style={{ background: '#1e293b', color: '#e0e4e8', boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
                <p className="text-[12px] font-semibold text-white mb-2">参考标准</p>
                <ul className="space-y-2">
                  <li>
                    <span className="text-[#4ECCA3] font-medium">牙位编号 (FDI)</span>
                    <span className="block text-[10px] text-[#a0a8b4] mt-0.5">国际牙科联合会 (FDI) 两位数标记法 · ISO 3950</span>
                  </li>
                  <li>
                    <span className="text-[#4ECCA3] font-medium">乳牙萌出时间表</span>
                    <span className="block text-[10px] text-[#a0a8b4] mt-0.5">American Academy of Pediatric Dentistry (AAPD). Eruption charts, 2023.</span>
                  </li>
                  <li>
                    <span className="text-[#4ECCA3] font-medium">口腔检查建议</span>
                    <span className="block text-[10px] text-[#a0a8b4] mt-0.5">国家卫健委《儿童口腔保健指导技术规范》· 建议每半年口腔检查</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
          <div className="mt-3">
            <AppSelect value={activeChildId ?? ''} onChange={(v) => setActiveChildId(v || null)}
              options={children.map((c) => ({ value: c.childId, label: `${c.displayName}，${fmtAge(computeAgeMonths(c.birthDate))}` }))} />
          </div>
        </div>
        {!showForm && (
          <div className="flex items-center gap-2">
            <button
              onClick={openScanModal}
              title="上传口腔照片或全景片，由 AI 识别萌出情况"
              className="flex items-center gap-1.5 text-[13px] font-medium hover:opacity-90 transition-opacity"
              style={{
                background: '#ffffff',
                color: S.text,
                border: '1px solid rgba(226,232,240,0.9)',
                boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
                padding: '10px 16px',
                borderRadius: 12,
              }}
            >
              <span style={{ color: '#f59e0b', display: 'inline-flex' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2M7 12h10" />
                </svg>
              </span>
              AI 识别牙齿
            </button>
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-1.5 text-[13px] font-semibold text-white hover:opacity-90 transition-opacity"
              style={{
                background: S.accent,
                padding: '10px 16px',
                borderRadius: 12,
                boxShadow: '0 4px 12px rgba(78,204,163,0.35)',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              添加记录
            </button>
          </div>
        )}
      </div>

      {/* Reminder toast */}
      {reminderMsg && (
        <div className={`${S.radiusSm} px-4 py-2.5 mb-4 flex items-center gap-2 text-[12px] font-medium`}
          style={{ background: '#f0f7f0', color: '#16a34a', border: '1px solid #bbf7d0' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
          {reminderMsg}
        </div>
      )}

      {/* Section label */}
      <div
        className="mb-3"
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: '#94a3b8',
          padding: '0 4px',
        }}
      >
        状态总览
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

      <AISummaryCard domain="dental" childName={child.displayName} childId={child.childId}
        ageLabel={`${Math.floor(ageMonths / 12)}岁${ageMonths % 12}个月`} gender={child.gender}
        dataContext={records.length > 0 ? `共 ${records.length} 条记录 · 萌出 ${eruptedCount} · 龋齿 ${cariesCount}` : ''} />

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
      <div className="mt-2 mb-4 flex items-center justify-between gap-3 flex-wrap" style={{ padding: '0 4px' }}>
        <div className="flex items-baseline gap-2">
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: S.text }}>历史记录</h3>
          <span style={{ fontSize: 12, color: '#64748b', fontFamily: '"JetBrains Mono", "SF Mono", ui-monospace, monospace' }}>
            {sortedRecords.length} 条
          </span>
        </div>
        {filterTabs.length > 1 && (
          <div
            style={{
              display: 'flex',
              padding: 3,
              borderRadius: 999,
              gap: 2,
              background: 'rgba(226,232,240,0.45)',
              border: '1px solid rgba(226,232,240,0.6)',
            }}
          >
            {filterTabs.map((tab) => {
              const active = typeFilter === tab.key;
              return (
                <button
                  key={tab.key ?? 'all'}
                  type="button"
                  onClick={() => setTypeFilter(tab.key)}
                  style={{
                    border: 0,
                    background: active ? '#ffffff' : 'transparent',
                    color: active ? S.text : '#64748b',
                    fontWeight: active ? 600 : 400,
                    fontSize: 12,
                    padding: '6px 12px',
                    borderRadius: 999,
                    cursor: 'pointer',
                    boxShadow: active ? '0 1px 3px rgba(15,23,42,0.08)' : 'none',
                    transition: 'all 160ms',
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {sortedRecords.length === 0 && !showForm && (
        <div className={`${S.radius} p-8 text-center`} style={{ background: S.card, boxShadow: S.shadow }}>
          <span className="text-[28px]">🦷</span>
          <p className="text-[13px] mt-2 font-medium" style={{ color: S.text }}>还没有口腔记录</p>
          <p className="text-[11px] mt-1" style={{ color: S.sub }}>建议每半年进行一次口腔检查</p>
        </div>
      )}

      {sortedRecords.length > 0 && filteredSortedRecords.length === 0 && (
        <div className={`${S.radius} p-6 text-center`} style={{ background: S.card, boxShadow: S.shadow }}>
          <p className="text-[12px]" style={{ color: S.sub }}>该筛选下暂无记录</p>
        </div>
      )}

      {filteredSortedRecords.length > 0 && (
        <div style={{ position: 'relative', paddingLeft: 22 }}>
          <div
            style={{
              position: 'absolute',
              left: 6,
              top: 6,
              bottom: 6,
              width: 1,
              background: 'linear-gradient(to bottom, rgba(226,232,240,0.9), rgba(226,232,240,0.9) 80%, transparent)',
            }}
          />

          {recordGroups.map(([date, dayRecords], gi) => (
            <div key={date} style={{ marginBottom: gi === recordGroups.length - 1 ? 0 : 24, position: 'relative' }}>
              <div
                style={{
                  position: 'absolute',
                  left: -22,
                  top: 4,
                  width: 13,
                  height: 13,
                  borderRadius: 999,
                  background: '#ffffff',
                  border: `2px solid ${S.accent}`,
                  boxShadow: '0 0 0 3px rgba(255,255,255,0.9)',
                }}
              />

              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: S.text }}>{formatDateLabel(date)}</span>
                <span style={{ fontSize: 11, color: '#64748b', fontFamily: '"JetBrains Mono", "SF Mono", ui-monospace, monospace' }}>
                  {dayRecords.length} 条
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {dayRecords.map((r) => {
                  const evtInfo = EVENT_TYPES.find((e) => e.key === r.eventType);
                  const toothLabel = formatDentalToothLabel(r.toothId);
                  const recordAttachments = attachmentMap.get(r.recordId) ?? [];
                  const tone = DENTAL_TYPE_TONE[r.eventType] ?? DENTAL_TYPE_TONE_DEFAULT;
                  return (
                    <article
                      key={r.recordId}
                      className="group"
                      style={{
                        background: S.card,
                        padding: 20,
                        borderRadius: 20,
                        boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 6px 18px rgba(15,23,42,0.04)',
                        transition: 'box-shadow 160ms',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                          <div
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 10,
                              display: 'grid',
                              placeItems: 'center',
                              background: tone.bg,
                              color: tone.fg,
                              fontSize: 16,
                              flexShrink: 0,
                            }}
                          >
                            <span style={{ lineHeight: 1 }}>{evtInfo?.emoji ?? '🦷'}</span>
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: S.text, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <span>{evtInfo?.label ?? r.eventType}</span>
                              {toothLabel && (
                                <span
                                  style={{
                                    background: 'rgba(241,245,249,0.8)',
                                    color: '#475569',
                                    padding: '2px 8px',
                                    borderRadius: 999,
                                    fontSize: 10,
                                    fontWeight: 500,
                                    fontFamily: '"JetBrains Mono", "SF Mono", ui-monospace, monospace',
                                  }}
                                >
                                  {toothLabel}
                                </span>
                              )}
                              {r.severity && (
                                <span
                                  style={{
                                    padding: '2px 8px',
                                    borderRadius: 999,
                                    fontSize: 10,
                                    fontWeight: 500,
                                    background:
                                      r.severity === 'severe' ? 'rgba(239,68,68,0.12)'
                                      : r.severity === 'moderate' ? 'rgba(245,158,11,0.14)'
                                      : 'rgba(148,163,184,0.16)',
                                    color:
                                      r.severity === 'severe' ? '#b91c1c'
                                      : r.severity === 'moderate' ? '#b45309'
                                      : '#64748b',
                                  }}
                                >
                                  {SEVERITY_LABELS[r.severity] ?? r.severity}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                              {fmtAge(r.ageMonths)}{r.hospital ? ` · ${r.hospital}` : ''}
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleAskAiAboutRecord(r);
                            }}
                            style={{
                              width: 28,
                              height: 28,
                              display: 'grid',
                              placeItems: 'center',
                              borderRadius: 8,
                              border: 0,
                              background: 'transparent',
                              color: '#64748b',
                              cursor: 'pointer',
                              transition: 'all 160ms',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(78,204,163,0.12)'; e.currentTarget.style.color = '#053D2C'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#64748b'; }}
                            aria-label="和 AI 聊这条记录"
                            title="和 AI 聊这条记录"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z" />
                              <path d="M19 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z" />
                            </svg>
                          </button>
                          <div className="opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                            <DentalRecordActionMenu
                              onEdit={() => startEditingRecord(r)}
                              onDelete={() => void handleDeleteRecord(r)}
                            />
                          </div>
                        </div>
                      </div>

                      {r.notes && (
                        <p style={{ margin: '14px 0 0', fontSize: 13.5, lineHeight: 1.75, color: S.text, letterSpacing: '0.005em' }}>
                          {r.notes}
                        </p>
                      )}

                      {recordAttachments.length > 0 && (
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(5, 1fr)',
                            gap: 8,
                            marginTop: 14,
                          }}
                        >
                          {recordAttachments.map((a) => (
                            <img
                              key={a.attachmentId}
                              src={convertFileSrc(a.filePath)}
                              alt={a.fileName}
                              style={{
                                aspectRatio: '1 / 1',
                                width: '100%',
                                objectFit: 'cover',
                                borderRadius: 12,
                                cursor: 'pointer',
                                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.4)',
                                border: '1px solid rgba(226,232,240,0.8)',
                                transition: 'opacity 160ms',
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                            />
                          ))}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
