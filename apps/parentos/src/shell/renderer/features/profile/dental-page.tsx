import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
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
import { ProfileDatePicker } from './profile-date-picker.js';
import { readImageFileAsDataUrl } from './checkup-ocr.js';

/* ── Event types ─────────────────────────────────────────── */

const EVENT_TYPES = [
  { key: 'eruption', label: '萌出', emoji: '🌱', desc: '新牙冒出', minAge: 0 },
  { key: 'loss', label: '脱落', emoji: '🦷', desc: '乳牙脱落', minAge: 60 },
  { key: 'caries', label: '龋齿', emoji: '🔴', desc: '蛀牙', minAge: 12 },
  { key: 'filling', label: '补牙', emoji: '🔧', desc: '龋齿治疗', minAge: 24 },
  { key: 'cleaning', label: '洁牙', emoji: '✨', desc: '定期洁牙', minAge: 24 },
  { key: 'fluoride', label: '涂氟', emoji: '💧', desc: '氟化物防龋', minAge: 6 },
  { key: 'sealant', label: '窝沟封闭', emoji: '🛡️', desc: '防龋保护', minAge: 36 },
  { key: 'ortho-assessment', label: '正畸评估', emoji: '📐', desc: '咬合检查', minAge: 84 },
  { key: 'ortho-start', label: '开始正畸', emoji: '🦷', desc: '佩戴矫治器', minAge: 84 },
  { key: 'checkup', label: '口腔检查', emoji: '🔍', desc: '常规检查', minAge: 0 },
] as const;

const SEVERITY_LABELS: Record<string, string> = { mild: '轻度', moderate: '中度', severe: '重度' };
const NEEDS_SEVERITY = new Set(['caries']);
const NEEDS_TOOTH = new Set(['eruption', 'loss', 'caries', 'filling', 'sealant']);

/* ── Auto-reminder config: eventType → months until next ── */
const DENTAL_REMINDER_INTERVALS: Record<string, { months: number; title: string }> = {
  fluoride: { months: 6, title: '涂氟复查' },
  cleaning: { months: 6, title: '定期洁牙' },
  sealant: { months: 12, title: '窝沟封闭复查' },
  checkup: { months: 6, title: '口腔常规检查' },
  filling: { months: 6, title: '补牙后复查' },
};

/* ── FDI tooth map ───────────────────────────────────────── */

// Primary teeth: 51-55 (upper-right), 61-65 (upper-left), 71-75 (lower-left), 81-85 (lower-right)
// Permanent teeth: 11-18, 21-28, 31-38, 41-48

const PRIMARY_UPPER_R = ['55', '54', '53', '52', '51'];
const PRIMARY_UPPER_L = ['61', '62', '63', '64', '65'];
const PRIMARY_LOWER_L = ['71', '72', '73', '74', '75'];
const PRIMARY_LOWER_R = ['85', '84', '83', '82', '81'];

const PERM_UPPER_R = ['18', '17', '16', '15', '14', '13', '12', '11'];
const PERM_UPPER_L = ['21', '22', '23', '24', '25', '26', '27', '28'];
const PERM_LOWER_L = ['31', '32', '33', '34', '35', '36', '37', '38'];
const PERM_LOWER_R = ['48', '47', '46', '45', '44', '43', '42', '41'];

const TOOTH_NAMES: Record<string, string> = {
  '11': '右上中切牙', '12': '右上侧切牙', '13': '右上尖牙', '14': '右上第一前磨', '15': '右上第二前磨', '16': '右上第一磨', '17': '右上第二磨', '18': '右上智齿',
  '21': '左上中切牙', '22': '左上侧切牙', '23': '左上尖牙', '24': '左上第一前磨', '25': '左上第二前磨', '26': '左上第一磨', '27': '左上第二磨', '28': '左上智齿',
  '31': '左下中切牙', '32': '左下侧切牙', '33': '左下尖牙', '34': '左下第一前磨', '35': '左下第二前磨', '36': '左下第一磨', '37': '左下第二磨', '38': '左下智齿',
  '41': '右下中切牙', '42': '右下侧切牙', '43': '右下尖牙', '44': '右下第一前磨', '45': '右下第二前磨', '46': '右下第一磨', '47': '右下第二磨', '48': '右下智齿',
  '51': '右上乳中切牙', '52': '右上乳侧切牙', '53': '右上乳尖牙', '54': '右上乳第一磨', '55': '右上乳第二磨',
  '61': '左上乳中切牙', '62': '左上乳侧切牙', '63': '左上乳尖牙', '64': '左上乳第一磨', '65': '左上乳第二磨',
  '71': '左下乳中切牙', '72': '左下乳侧切牙', '73': '左下乳尖牙', '74': '左下乳第一磨', '75': '左下乳第二磨',
  '81': '右下乳中切牙', '82': '右下乳侧切牙', '83': '右下乳尖牙', '84': '右下乳第一磨', '85': '右下乳第二磨',
};

/* ── Interactive tooth chart ─────────────────────────────── */

function ToothChart({ selectedTeeth, onToggle, toothSet, recordedTeeth }: {
  selectedTeeth: string[]; onToggle: (id: string) => void; toothSet: 'primary' | 'permanent';
  recordedTeeth: Map<string, string>;
}) {
  const isPrimary = toothSet === 'primary';
  const upperR = isPrimary ? PRIMARY_UPPER_R : PERM_UPPER_R;
  const upperL = isPrimary ? PRIMARY_UPPER_L : PERM_UPPER_L;
  const lowerL = isPrimary ? PRIMARY_LOWER_L : PERM_LOWER_L;
  const lowerR = isPrimary ? PRIMARY_LOWER_R : PERM_LOWER_R;
  const sel = new Set(selectedTeeth);

  const toothColor = (id: string) => {
    if (sel.has(id)) return { bg: S.accent, color: '#fff' };
    const evt = recordedTeeth.get(id);
    if (evt === 'caries') return { bg: '#fecaca', color: '#dc2626' };
    if (evt === 'loss') return { bg: '#f1f5f9', color: '#475569' };
    if (evt === 'eruption') return { bg: '#d1fae5', color: '#059669' };
    if (evt === 'filling' || evt === 'sealant') return { bg: '#dbeafe', color: '#2563eb' };
    return { bg: '#f5f3ef', color: S.text };
  };

  const renderRow = (teeth: string[], label: string) => (
    <div className="flex items-center gap-0.5">
      <span className="text-[9px] w-8 text-right mr-1" style={{ color: S.sub }}>{label}</span>
      {teeth.map((id) => {
        const c = toothColor(id);
        return (
          <button key={id} onClick={() => onToggle(id)} title={`${id} ${TOOTH_NAMES[id] ?? ''}`}
            className="w-7 h-7 rounded-lg text-[10px] font-bold transition-all hover:scale-110"
            style={{ background: c.bg, color: c.color }}>
            {id}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className={`${S.radius} p-4`} style={{ background: S.card, boxShadow: S.shadow }}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[12px] font-semibold" style={{ color: S.text }}>
          {isPrimary ? '乳牙 (20颗)' : '恒牙 (32颗)'} · 点击选择牙位（可多选）
        </p>
        <div className="flex gap-1">
          {[
            { c: '#d1fae5', l: '萌出' }, { c: '#f1f5f9', l: '脱落' },
            { c: '#fecaca', l: '龋齿' }, { c: '#dbeafe', l: '治疗' },
          ].map((x) => (
            <span key={x.l} className="flex items-center gap-0.5 text-[9px]" style={{ color: S.sub }}>
              <span className="w-2 h-2 rounded-sm" style={{ background: x.c }} />{x.l}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-col items-center gap-1">
        <p className="text-[9px]" style={{ color: S.sub }}>上颌</p>
        <div className="flex gap-1">
          {renderRow(upperR, '右')}
          <span className="w-3" />
          {renderRow(upperL, '')}
          <span className="text-[9px] w-8 ml-1" style={{ color: S.sub }}>左</span>
        </div>
        <div className="w-full h-px my-1" style={{ background: S.border }} />
        <div className="flex gap-1">
          {renderRow(lowerR, '右')}
          <span className="w-3" />
          {renderRow(lowerL, '')}
          <span className="text-[9px] w-8 ml-1" style={{ color: S.sub }}>左</span>
        </div>
        <p className="text-[9px]" style={{ color: S.sub }}>下颌</p>
      </div>
      {selectedTeeth.length > 0 && (
        <p className="text-center text-[11px] mt-2 font-medium" style={{ color: S.accent }}>
          已选 {selectedTeeth.length} 颗: {selectedTeeth.map((id) => `${id}(${TOOTH_NAMES[id] ?? ''})`).join('、')}
        </p>
      )}
    </div>
  );
}

/* ── Tooth status overview ───────────────────────────────── */

// Primary tooth → corresponding permanent successor (FDI)
const PRIMARY_TO_PERMANENT: Record<string, string> = {
  '55': '15', '54': '14', '53': '13', '52': '12', '51': '11',
  '61': '21', '62': '22', '63': '23', '64': '24', '65': '25',
  '71': '31', '72': '32', '73': '33', '74': '34', '75': '35',
  '85': '45', '84': '44', '83': '43', '82': '42', '81': '41',
};

// Two orthogonal axes: eruption (border color) + health (fill color)
type EruptionState = 'unerupted' | 'primary_present' | 'lost_waiting' | 'permanent_erupted';
type HealthState = 'healthy' | 'caries' | 'treated';

const ERUPTION_STYLE: Record<EruptionState, { border: string; text: string; label: string }> = {
  unerupted:         { border: '#d4cfc3', text: '#94a3b8', label: '未萌出' },
  primary_present:   { border: '#10b981', text: '#065f46', label: '乳牙在位' },
  lost_waiting:      { border: '#f59e0b', text: '#92400e', label: '已脱落·待恒牙' },
  permanent_erupted: { border: '#2563eb', text: '#1e3a8a', label: '恒牙已长出' },
};

const HEALTH_STYLE: Record<HealthState, { bg: string; text: string; label: string }> = {
  healthy: { bg: '#ffffff', text: '',        label: '健康' },
  caries:  { bg: '#fecaca', text: '#b91c1c', label: '龋齿' },
  treated: { bg: '#e9d5ff', text: '#6b21a8', label: '已治疗' },
};

// Anatomical positions, referenced by primary id where a primary exists, otherwise by permanent id
const OVERVIEW_UPPER_R = ['18', '17', '16', '55', '54', '53', '52', '51'];
const OVERVIEW_UPPER_L = ['61', '62', '63', '64', '65', '26', '27', '28'];
const OVERVIEW_LOWER_L = ['71', '72', '73', '74', '75', '36', '37', '38'];
const OVERVIEW_LOWER_R = ['48', '47', '46', '85', '84', '83', '82', '81'];

interface OverviewCell {
  eruption: EruptionState;
  health: HealthState;
  displayId: string;
}

function deriveHealth(events: string[]): HealthState {
  // Walk in order; later events override earlier
  let health: HealthState = 'healthy';
  for (const t of events) {
    if (t === 'caries') health = 'caries';
    else if (t === 'filling' || t === 'sealant') health = 'treated';
  }
  return health;
}

function computeOverviewStates(records: DentalRecordRow[]): Map<string, OverviewCell> {
  const byTooth = new Map<string, string[]>();
  const sorted = [...records].sort((a, b) => a.eventDate.localeCompare(b.eventDate));
  for (const r of sorted) {
    for (const toothId of parseDentalToothIds(r.toothId)) {
      const arr = byTooth.get(toothId);
      if (arr) arr.push(r.eventType);
      else byTooth.set(toothId, [r.eventType]);
    }
  }

  const hasAnyEvent = (id: string) => (byTooth.get(id)?.length ?? 0) > 0;
  const hasHealthEvent = (id: string) => (byTooth.get(id) ?? []).some((t) => t === 'caries' || t === 'filling' || t === 'sealant');
  const hasEvent = (id: string, type: string) => (byTooth.get(id) ?? []).includes(type);

  const out = new Map<string, OverviewCell>();
  const positions = [...OVERVIEW_UPPER_R, ...OVERVIEW_UPPER_L, ...OVERVIEW_LOWER_L, ...OVERVIEW_LOWER_R];

  for (const posId of positions) {
    const permId = PRIMARY_TO_PERMANENT[posId];
    if (permId) {
      // Any permanent event implies the permanent tooth is erupted (or being treated)
      if (hasAnyEvent(permId)) {
        out.set(posId, {
          eruption: 'permanent_erupted',
          health: deriveHealth(byTooth.get(permId) ?? []),
          displayId: permId,
        });
      } else if (hasEvent(posId, 'loss')) {
        out.set(posId, { eruption: 'lost_waiting', health: 'healthy', displayId: posId });
      } else if (hasEvent(posId, 'eruption') || hasHealthEvent(posId)) {
        out.set(posId, {
          eruption: 'primary_present',
          health: deriveHealth(byTooth.get(posId) ?? []),
          displayId: posId,
        });
      } else {
        out.set(posId, { eruption: 'unerupted', health: 'healthy', displayId: posId });
      }
    } else {
      // Permanent-only position (molars / wisdom)
      if (hasAnyEvent(posId)) {
        out.set(posId, {
          eruption: 'permanent_erupted',
          health: deriveHealth(byTooth.get(posId) ?? []),
          displayId: posId,
        });
      } else {
        out.set(posId, { eruption: 'unerupted', health: 'healthy', displayId: posId });
      }
    }
  }
  return out;
}

function ToothStatusOverview({ records }: { records: DentalRecordRow[] }) {
  const states = useMemo(() => computeOverviewStates(records), [records]);

  const counts = useMemo(() => {
    const eruption: Record<EruptionState, number> = { unerupted: 0, primary_present: 0, lost_waiting: 0, permanent_erupted: 0 };
    const health: Record<HealthState, number> = { healthy: 0, caries: 0, treated: 0 };
    for (const c of states.values()) {
      eruption[c.eruption]++;
      health[c.health]++;
    }
    return { eruption, health };
  }, [states]);

  const renderRow = (positions: string[]) => (
    <div className="flex gap-1">
      {positions.map((posId) => {
        const cell = states.get(posId) ?? { eruption: 'unerupted', health: 'healthy', displayId: posId };
        const er = ERUPTION_STYLE[cell.eruption];
        const hl = HEALTH_STYLE[cell.health];
        const textColor = hl.text || er.text;
        const title = `${cell.displayId} ${TOOTH_NAMES[cell.displayId] ?? ''} · ${er.label}${cell.health !== 'healthy' ? ` · ${hl.label}` : ''}`;
        return (
          <div
            key={posId}
            title={title}
            className="w-7 h-8 text-[10px] font-bold flex items-center justify-center"
            style={{
              background: hl.bg,
              color: textColor,
              border: `2px solid ${er.border}`,
              borderRadius: '8px',
              boxSizing: 'border-box',
            }}
          >
            {cell.displayId}
          </div>
        );
      })}
    </div>
  );

  const legendChip = (swatchStyle: React.CSSProperties, label: string, count: number) => (
    <span key={label} className="flex items-center gap-1 text-[10px]" style={{ color: S.sub }}>
      <span className="w-3 h-3" style={{ borderRadius: 3, ...swatchStyle }} />
      {label} <span className="font-semibold" style={{ color: S.text }}>{count}</span>
    </span>
  );

  return (
    <div className={`${S.radius} p-4 mb-5`} style={{ background: S.card, boxShadow: S.shadow }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[15px]">🦷</span>
        <p className="text-[13px] font-semibold" style={{ color: S.text }}>牙齿状态总览</p>
      </div>

      {/* Legend: two axes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
        <div
          className={`flex items-center gap-x-3 gap-y-1.5 flex-wrap px-2.5 py-1.5 ${S.radiusSm}`}
          style={{ background: '#fafaf8' }}
        >
          <span className="inline-flex items-center gap-1.5 shrink-0 leading-none">
            <span
              className="text-[9px] font-semibold tracking-[0.12em]"
              style={{ color: S.sub }}
            >
              边框
            </span>
            <span className="h-3 w-px" style={{ background: S.border }} />
            <span className="text-[11px] font-semibold" style={{ color: S.text }}>
              萌出
            </span>
          </span>
          {(['primary_present', 'lost_waiting', 'permanent_erupted', 'unerupted'] as EruptionState[]).map((s) =>
            legendChip(
              { background: '#fff', border: `2px solid ${ERUPTION_STYLE[s].border}`, boxSizing: 'border-box' },
              ERUPTION_STYLE[s].label,
              counts.eruption[s],
            ),
          )}
        </div>
        <div
          className={`flex items-center gap-x-3 gap-y-1.5 flex-wrap px-2.5 py-1.5 ${S.radiusSm}`}
          style={{ background: '#fafaf8' }}
        >
          <span className="inline-flex items-center gap-1.5 shrink-0 leading-none">
            <span
              className="text-[9px] font-semibold tracking-[0.12em]"
              style={{ color: S.sub }}
            >
              填充
            </span>
            <span className="h-3 w-px" style={{ background: S.border }} />
            <span className="text-[11px] font-semibold" style={{ color: S.text }}>
              健康
            </span>
          </span>
          {(['healthy', 'caries', 'treated'] as HealthState[]).map((s) =>
            legendChip(
              { background: HEALTH_STYLE[s].bg, border: s === 'healthy' ? '1px solid #e5e7eb' : 'none' },
              HEALTH_STYLE[s].label,
              counts.health[s],
            ),
          )}
        </div>
      </div>

      <div className="flex flex-col items-center gap-1.5">
        <p className="text-[9px]" style={{ color: S.sub }}>上颌</p>
        <div className="flex gap-1.5 items-center">
          <span className="text-[9px] w-4 text-right" style={{ color: S.sub }}>右</span>
          {renderRow(OVERVIEW_UPPER_R)}
          <span className="w-2" />
          {renderRow(OVERVIEW_UPPER_L)}
          <span className="text-[9px] w-4" style={{ color: S.sub }}>左</span>
        </div>
        <div className="w-full h-px my-1" style={{ background: S.border }} />
        <div className="flex gap-1.5 items-center">
          <span className="text-[9px] w-4 text-right" style={{ color: S.sub }}>右</span>
          {renderRow(OVERVIEW_LOWER_R)}
          <span className="w-2" />
          {renderRow(OVERVIEW_LOWER_L)}
          <span className="text-[9px] w-4" style={{ color: S.sub }}>左</span>
        </div>
        <p className="text-[9px]" style={{ color: S.sub }}>下颌</p>
      </div>
      <p className="text-[10px] text-center mt-3" style={{ color: S.sub }}>
        共 32 位：20 颗乳牙位 + 12 颗恒牙磨牙/智齿位 · 鼠标悬停查看牙位详情
      </p>
    </div>
  );
}

/* ── Event entry type ────────────────────────────────────── */

interface EventEntry { eventType: string; toothIds: string[]; toothSet: 'primary' | 'permanent'; severity: string }
interface PendingDentalPhoto { base64: string; mimeType: string; fileName: string }

const PHOTO_MAX = 9;

function makeEventEntry(ageMonths: number): EventEntry {
  return { eventType: 'eruption', toothIds: [], toothSet: ageMonths < 72 ? 'primary' : 'permanent', severity: '' };
}

function parseDentalToothIds(toothId: string | null): string[] {
  if (!toothId) return [];
  return toothId
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function joinDentalToothIds(toothIds: string[]): string | null {
  const normalized = [...new Set(toothIds.map((value) => value.trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized.join(',') : null;
}

function formatDentalToothLabel(toothId: string | null): string | null {
  const toothIds = parseDentalToothIds(toothId);
  if (toothIds.length === 0) {
    return null;
  }
  return toothIds
    .map((id) => `${id}${TOOTH_NAMES[id] ? ` ${TOOTH_NAMES[id]}` : ''}`)
    .join(' 路 ');
}

function buildDentalAttachmentMap(attachments: AttachmentRow[]) {
  const next = new Map<string, AttachmentRow[]>();
  for (const attachment of attachments) {
    if (attachment.ownerTable !== 'dental_records') continue;
    const existing = next.get(attachment.ownerId);
    if (existing) existing.push(attachment);
    else next.set(attachment.ownerId, [attachment]);
  }
  return next;
}

/* ── Main page ───────────────────────────────────────────── */

export default function DentalPage() {
  const { activeChildId, setActiveChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [records, setRecords] = useState<DentalRecordRow[]>([]);
  const [showForm, setShowForm] = useState(false);

  const ageMonths = child ? computeAgeMonths(child.birthDate) : 0;

  const [eventEntries, setEventEntries] = useState<EventEntry[]>(() => [makeEventEntry(ageMonths)]);
  const [activeEntryIdx, setActiveEntryIdx] = useState(0);
  const [formEventDate, setFormEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [formHospital, setFormHospital] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [reminderMsg, setReminderMsg] = useState<string | null>(null);
  const [addEventHover, setAddEventHover] = useState(false);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [existingPhotoAttachments, setExistingPhotoAttachments] = useState<AttachmentRow[]>([]);
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState<string[]>([]);
  const [formPhotoPreviews, setFormPhotoPreviews] = useState<string[]>([]);
  const [formPhotoFiles, setFormPhotoFiles] = useState<PendingDentalPhoto[]>([]);
  const [photoDragOver, setPhotoDragOver] = useState(false);
  const [photoDropHover, setPhotoDropHover] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const isEditing = editingRecordId !== null;
  const visibleExistingPhotoAttachments = existingPhotoAttachments.filter((attachment) => !removedAttachmentIds.includes(attachment.attachmentId));
  const totalPhotoCount = visibleExistingPhotoAttachments.length + formPhotoFiles.length;

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
  const eruptedCount = new Set(records.filter((r) => r.eventType === 'eruption').flatMap((r) => parseDentalToothIds(r.toothId))).size;
  const lostCount = new Set(records.filter((r) => r.eventType === 'loss').flatMap((r) => parseDentalToothIds(r.toothId))).size;

  if (!child) return <div className="p-8" style={{ color: S.sub }}>请先添加孩子</div>;

  const sortedRecords = [...records].sort((a, b) => b.eventDate.localeCompare(a.eventDate));
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
      <div className="flex items-center gap-2 mb-5">
        <Link to="/profile" className="text-[13px] hover:underline" style={{ color: S.sub }}>← 返回档案</Link>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold" style={{ color: S.text }}>口腔记录</h1>
          <div className="group relative">
            <div className="w-[18px] h-[18px] rounded-full flex items-center justify-center cursor-help hover:bg-[#f0f0ec]" style={{ color: S.sub }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
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
        {!showForm && (
          <button onClick={() => setShowForm(true)} className={`flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium text-white ${S.radiusSm} hover:opacity-90`} style={{ background: S.accent }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            添加记录
          </button>
        )}
      </div>
      <div className="mb-5">
        <AppSelect value={activeChildId ?? ''} onChange={(v) => setActiveChildId(v || null)}
          options={children.map((c) => ({ value: c.childId, label: `${c.displayName}，${fmtAge(computeAgeMonths(c.birthDate))}` }))} />
      </div>

      {/* Reminder toast */}
      {reminderMsg && (
        <div className={`${S.radiusSm} px-4 py-2.5 mb-4 flex items-center gap-2 text-[12px] font-medium`}
          style={{ background: '#f0f7f0', color: '#16a34a', border: '1px solid #bbf7d0' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
          {reminderMsg}
        </div>
      )}

      {/* Tooth status overview — top of dental record */}
      <ToothStatusOverview records={records} />

      {/* Quick stats */}
      {records.length > 0 && (
        <div className="grid grid-cols-4 gap-3 mb-5">
          {[
            { label: '总记录', val: records.length, emoji: '📋' },
            { label: '已萌出', val: eruptedCount, emoji: '🌱' },
            { label: '已脱落', val: lostCount, emoji: '🦷' },
            { label: '龋齿', val: cariesCount, emoji: '🔴' },
          ].map((s) => (
            <div key={s.label} className={`${S.radius} p-3 text-center`} style={{ background: S.card, boxShadow: S.shadow }}>
              <span className="text-[16px]">{s.emoji}</span>
              <p className="text-[16px] font-bold mt-1" style={{ color: S.text }}>{s.val}</p>
              <p className="text-[10px]" style={{ color: S.sub }}>{s.label}</p>
            </div>
          ))}
        </div>
      )}

      <AISummaryCard domain="dental" childName={child.displayName} childId={child.childId}
        ageLabel={`${Math.floor(ageMonths / 12)}岁${ageMonths % 12}个月`} gender={child.gender}
        dataContext={records.length > 0 ? `共 ${records.length} 条记录 · 萌出 ${eruptedCount} · 龋齿 ${cariesCount}` : ''} />

      {/* ── Add form ─────────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={() => resetForm()}>
        <div className={`w-[680px] max-h-[85vh] overflow-y-auto ${S.radius} flex flex-col shadow-xl`} style={{ background: S.card }} onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 pt-6 pb-3">
            <div className="flex items-center gap-2">
              <span className="text-[20px]">{isEditing ? '✏️' : '🦷'}</span>
              <h2 className="text-[15px] font-bold" style={{ color: S.text }}>{isEditing ? '编辑口腔记录' : '添加口腔记录'}</h2>
            </div>
            <button onClick={resetForm} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#f0f0ec]" style={{ color: S.sub }}>✕</button>
          </div>

          <div className="px-6 pb-2 space-y-4 flex-1">

          {/* Date + hospital — shared across all events */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] mb-1" style={{ color: S.sub }}>就诊日期</p>
              <ProfileDatePicker value={formEventDate} onChange={setFormEventDate} style={{ background: '#fafaf8', color: S.text }} />
            </div>
            <div>
              <p className="text-[11px] mb-1" style={{ color: S.sub }}>医院/诊所</p>
              <input value={formHospital} onChange={(e) => setFormHospital(e.target.value)} placeholder="选填"
                className={`w-full ${S.radiusSm} px-3 py-2 text-[13px] border-0 outline-none transition-shadow focus:ring-2 focus:ring-[#4ECCA3]/50`} style={{ background: '#fafaf8', color: S.text }} />
            </div>
          </div>

          {/* Event entries */}
          {eventEntries.map((entry, idx) => {
            const isActive = idx === activeEntryIdx;
            const evtMeta = EVENT_TYPES.find((e) => e.key === entry.eventType);
            const entryNeedsTooth = NEEDS_TOOTH.has(entry.eventType);
            const entryNeedsSeverity = NEEDS_SEVERITY.has(entry.eventType);
            return (
              <div key={idx}
                className={`${S.radiusSm} p-3 transition-all cursor-pointer`}
                style={{
                  background: isActive ? '#fafaf8' : '#f9faf7',
                  border: `1.5px solid ${isActive ? S.accent + '60' : S.border}`,
                }}
                onClick={() => setActiveEntryIdx(idx)}>

                {/* Entry header */}
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-semibold" style={{ color: isActive ? S.accent : S.text }}>
                    事件 {idx + 1} {evtMeta ? `· ${evtMeta.emoji} ${evtMeta.label}` : ''}
                    {entry.toothIds.length > 0 && <span className="font-normal" style={{ color: S.sub }}> · {entry.toothIds.length} 颗牙</span>}
                  </p>
                  {eventEntries.length > 1 && (
                    <button onClick={(e) => { e.stopPropagation(); removeEntry(idx); }}
                      className="text-[10px] px-2 py-0.5 rounded-full hover:bg-red-50 transition-colors"
                      style={{ color: '#dc2626' }}>删除</button>
                  )}
                </div>

                {/* Expanded content for active entry */}
                {isActive && (
                  <div className="space-y-3 mt-2">
                    {/* Event type selector */}
                    <div>
                      <p className="text-[10px] mb-1.5" style={{ color: S.sub }}>类型</p>
                      <div className="flex flex-wrap gap-1.5">
                        {availableEventTypes.map((e) => (
                          <button key={e.key} onClick={(ev) => { ev.stopPropagation(); updateEntry(idx, { eventType: e.key, toothIds: [], severity: '' }); }}
                            className={`flex items-center gap-1 px-2.5 py-1 text-[10px] ${S.radiusSm} transition-all`}
                            style={entry.eventType === e.key
                              ? { background: S.accent, color: '#fff' }
                              : { background: '#f0f0ec', color: S.sub }}>
                            <span>{e.emoji}</span> {e.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Tooth chart */}
                    {entryNeedsTooth && (
                      <div>
                        <div className="flex items-center gap-3 mb-2">
                          <p className="text-[10px]" style={{ color: S.sub }}>牙位</p>
                          <div className="flex gap-1">
                            {(['primary', ...(ageMonths >= 60 ? ['permanent'] : [])] as const).map((ts) => (
                              <button key={ts} onClick={(ev) => { ev.stopPropagation(); updateEntry(idx, { toothSet: ts as 'primary' | 'permanent', toothIds: [] }); }}
                                className="px-2.5 py-0.5 text-[9px] rounded-full font-medium transition-all"
                                style={entry.toothSet === ts ? { background: S.accent, color: '#fff' } : { background: '#f0f0ec', color: S.sub }}>
                                {ts === 'primary' ? '乳牙' : '恒牙'}
                              </button>
                            ))}
                          </div>
                        </div>
                        <ToothChart selectedTeeth={entry.toothIds}
                          onToggle={(id) => updateEntry(idx, { toothIds: entry.toothIds.includes(id) ? entry.toothIds.filter((t) => t !== id) : [...entry.toothIds, id] })}
                          toothSet={entry.toothSet} recordedTeeth={toothStatus} />
                      </div>
                    )}

                    {/* Severity for caries */}
                    {entryNeedsSeverity && (
                      <div>
                        <p className="text-[10px] mb-1.5" style={{ color: S.sub }}>严重程度</p>
                        <div className="flex gap-1.5">
                          {(['mild', 'moderate', 'severe'] as const).map((sv) => (
                            <button key={sv} onClick={(ev) => { ev.stopPropagation(); updateEntry(idx, { severity: entry.severity === sv ? '' : sv }); }}
                              className={`px-2.5 py-1 text-[10px] ${S.radiusSm} transition-all`}
                              style={entry.severity === sv
                                ? { background: sv === 'severe' ? '#dc2626' : sv === 'moderate' ? '#d97706' : S.accent, color: '#fff' }
                                : { background: '#f0f0ec', color: S.sub }}>
                              {SEVERITY_LABELS[sv]}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Add another event */}
          <button onClick={addEntry} hidden={isEditing}
            onMouseEnter={() => setAddEventHover(true)}
            onMouseLeave={() => setAddEventHover(false)}
            className={`w-full flex items-center justify-center gap-2 py-3 text-[11px] font-medium ${S.radiusSm} cursor-pointer`}
            style={{
              border: `2px dashed ${addEventHover ? '#4ECCA3' : '#d0d0cc'}`,
              background: addEventHover ? '#f9fbf4' : '#fafaf8',
              color: addEventHover ? S.accent : S.sub,
              transition: 'border-color 0.25s ease, background 0.25s ease, color 0.25s ease',
            }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="1.5" strokeLinecap="round"
              style={{
                stroke: addEventHover ? '#1e293b' : '#b0b0aa',
                transform: addEventHover ? 'scale(1.15) rotate(90deg)' : 'scale(1) rotate(0deg)',
                transition: 'stroke 0.25s ease, transform 0.3s ease',
              }}>
              <path d="M12 5v14M5 12h14" />
            </svg>
            添加另一个事件
          </button>

          {/* Notes */}
          <div>
            <p className="text-[11px] mb-1" style={{ color: S.sub }}>备注</p>
            <input value={formNotes} onChange={(e) => setFormNotes(e.target.value)} placeholder="选填"
              className={`w-full ${S.radiusSm} px-3 py-2 text-[13px] border-0 outline-none transition-shadow focus:ring-2 focus:ring-[#4ECCA3]/50`} style={{ background: '#fafaf8', color: S.text }} />
          </div>

          {/* Photo upload */}
          <div>
            <p className="text-[11px] mb-1" style={{ color: S.sub }}>照片 {formPhotoFiles.length > 0 ? `(${formPhotoFiles.length}/${PHOTO_MAX})` : ''}</p>
            <input
              ref={photoRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={async (e) => {
                const files = e.target.files;
                e.target.value = '';
                if (!files || files.length === 0) return;
                await appendPhotoFiles(files);
              }}
            />
            <div
              onDragOver={(e) => { e.preventDefault(); setPhotoDragOver(true); }}
              onDragEnter={(e) => { e.preventDefault(); setPhotoDragOver(true); }}
              onDragLeave={() => setPhotoDragOver(false)}
              onDrop={async (e) => {
                e.preventDefault();
                setPhotoDragOver(false);
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  await appendPhotoFiles(e.dataTransfer.files);
                }
              }}
              className="grid grid-cols-3 gap-2"
            >
              {visibleExistingPhotoAttachments.map((attachment) => (
                <div key={attachment.attachmentId} className="relative group">
                  <img src={convertFileSrc(attachment.filePath)} alt={attachment.fileName} className={`w-full h-24 object-cover ${S.radiusSm}`} />
                  <button
                    type="button"
                    onClick={() => removeExistingPhoto(attachment.attachmentId)}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    ×
                  </button>
                </div>
              ))}
              {formPhotoPreviews.map((src, idx) => (
                <div key={idx} className="relative group">
                  <img src={src} alt={`preview-${idx}`} className={`w-full h-24 object-cover ${S.radiusSm}`} />
                  <button
                    type="button"
                    onClick={() => removePhotoAt(idx)}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {totalPhotoCount < PHOTO_MAX && (
                <button
                  type="button"
                  onClick={() => photoRef.current?.click()}
                  onMouseEnter={() => setPhotoDropHover(true)}
                  onMouseLeave={() => setPhotoDropHover(false)}
                  className={`w-full h-24 ${S.radiusSm} flex flex-col items-center justify-center gap-1.5 cursor-pointer`}
                  style={{
                    border: `2px dashed ${photoDragOver || photoDropHover ? '#4ECCA3' : '#d0d0cc'}`,
                    background: '#fafaf8',
                    transition: 'border-color 0.25s ease',
                  }}
                >
                  <svg
                    width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth="1.5" strokeLinecap="round"
                    style={{
                      stroke: photoDragOver || photoDropHover ? '#1e293b' : '#b0b0aa',
                      transform: photoDragOver || photoDropHover ? 'scale(1.15)' : 'scale(1)',
                      transition: 'stroke 0.25s ease, transform 0.25s ease',
                    }}
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  <span
                    className="text-[10px] text-center px-1"
                    style={{
                      color: photoDragOver || photoDropHover ? '#1e293b' : '#a0a0a0',
                      transition: 'color 0.25s ease',
                    }}
                  >
                    {formPhotoFiles.length === 0 ? `点击或拖拽上传口腔照片（最多 ${PHOTO_MAX} 张）` : '添加更多'}
                  </span>
                </button>
              )}
            </div>
          </div>
          </div>

          <div className="px-6 pt-3 pb-5 mt-1">
            <div className="flex items-center justify-end gap-2">
              <button onClick={resetForm} className={`px-4 py-2 text-[13px] ${S.radiusSm} transition-colors hover:bg-[#e8e8e4]`} style={{ background: '#f0f0ec', color: S.sub }}>取消</button>
              <button onClick={() => void handleSubmit()} className={`px-5 py-2 text-[13px] font-medium text-white ${S.radiusSm} transition-colors hover:brightness-110`} style={{ background: S.accent }}>{isEditing ? '保存修改' : '保存'}</button>
            </div>
          </div>
        </div>
        </div>
      )}

      {/* ── Records timeline ─────────────────────────────── */}
      <h2 className="text-[13px] font-semibold mb-3" style={{ color: S.text }}>
        {sortedRecords.length > 0 ? `历史记录（${sortedRecords.length} 条）` : '暂无记录'}
      </h2>
      {sortedRecords.length === 0 && !showForm && (
        <div className={`${S.radius} p-8 text-center`} style={{ background: S.card, boxShadow: S.shadow }}>
          <span className="text-[28px]">🦷</span>
          <p className="text-[13px] mt-2 font-medium" style={{ color: S.text }}>还没有口腔记录</p>
          <p className="text-[11px] mt-1" style={{ color: S.sub }}>建议每半年进行一次口腔检查</p>
        </div>
      )}
      <div className="space-y-2">
        {sortedRecords.map((r) => {
          const evtInfo = EVENT_TYPES.find((e) => e.key === r.eventType);
          const toothLabel = formatDentalToothLabel(r.toothId);
          const recordAttachments = attachmentMap.get(r.recordId) ?? [];
          return (
            <div key={r.recordId} className={`${S.radiusSm} p-3.5 flex items-start gap-3`}
              style={{ background: S.card, boxShadow: S.shadow, borderLeft: r.eventType === 'caries' ? '3px solid #dc2626' : `3px solid ${S.border}` }}>
              <span className="text-[16px] mt-0.5">{evtInfo?.emoji ?? '🦷'}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="text-[12px] font-semibold" style={{ color: S.text }}>{evtInfo?.label ?? r.eventType}</span>
                    {toothLabel && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#f5f3ef', color: S.sub }}>
                        {toothLabel}
                      </span>
                    )}
                    {r.severity && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${r.severity === 'severe' ? 'bg-red-100 text-red-700' : r.severity === 'moderate' ? 'bg-amber-100 text-amber-700' : ''}`}
                        style={r.severity === 'mild' ? { background: '#f0f0ec', color: S.sub } : undefined}>
                        {SEVERITY_LABELS[r.severity] ?? r.severity}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => startEditingRecord(r)}
                      className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] ${S.radiusSm}`}
                      style={{ background: '#eef6ff', color: '#2563eb' }}
                    >
                      <Pencil size={12} />
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteRecord(r)}
                      className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] ${S.radiusSm}`}
                      style={{ background: '#fef2f2', color: '#dc2626' }}
                    >
                      <Trash2 size={12} />
                      删除
                    </button>
                  </div>
                </div>
                <p className="text-[10px] mt-0.5" style={{ color: S.sub }}>
                  {r.eventDate.split('T')[0]} · {fmtAge(r.ageMonths)}
                  {r.hospital && ` · ${r.hospital}`}
                </p>
                {r.notes && <p className="text-[10px] mt-0.5" style={{ color: S.sub }}>{r.notes}</p>}
                {recordAttachments.length > 0 && (
                  <div className="flex gap-1.5 mt-1.5 flex-wrap">
                    {recordAttachments.map((a) => (
                      <img key={a.attachmentId} src={convertFileSrc(a.filePath)} alt={a.fileName}
                        className={`w-24 h-16 object-cover ${S.radiusSm} cursor-pointer hover:opacity-80 transition-opacity`} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
