import type { AttachmentRow, DentalRecordRow } from '../../bridge/sqlite-bridge.js';

/**
 * Event types admitted by the generic dental event picker for NEW writes.
 *
 * `ortho-start` is intentionally absent: per PO-PROF-008 and the
 * orthodontic-contract, new orthodontic treatment state must be modeled
 * through `orthodontic_cases` + `orthodontic_appliances`. Historical
 * `ortho-start` rows remain read-only — the dental timeline still renders
 * them (see DENTAL_HISTORY_TONE_TABLE in dental-history-record-list.tsx and
 * DENTAL_READ_ONLY_EVENT_LABELS below), but the Rust command layer rejects
 * new writes (see src-tauri/src/sqlite/queries/health_records.rs).
 *
 * The ortho-review / ortho-adjustment / ortho-issue / ortho-end events are
 * likewise NOT user-pickable here — they are written exclusively by the
 * orthodontic workflow's clinical-event shortcut, not via this generic picker.
 */
export const EVENT_TYPES = [
  { key: 'eruption', label: '萌出', emoji: '🌱', desc: '新牙冒出', minAge: 0 },
  { key: 'loss', label: '脱落', emoji: '🦷', desc: '乳牙脱落', minAge: 60 },
  { key: 'caries', label: '龋齿', emoji: '🔴', desc: '蛀牙', minAge: 12 },
  { key: 'filling', label: '补牙', emoji: '🔧', desc: '龋齿治疗', minAge: 24 },
  { key: 'cleaning', label: '洁牙', emoji: '✨', desc: '定期洁牙', minAge: 24 },
  { key: 'fluoride', label: '涂氟', emoji: '💧', desc: '氟化物防龋', minAge: 6 },
  { key: 'sealant', label: '窝沟封闭', emoji: '🛡️', desc: '防龋保护', minAge: 36 },
  { key: 'ortho-assessment', label: '正畸评估', emoji: '📐', desc: '咬合检查', minAge: 84 },
  { key: 'checkup', label: '口腔检查', emoji: '🔍', desc: '常规检查', minAge: 0 },
] as const;

/** Labels for dental eventTypes that are DISPLAY-ONLY (no new write path from the UI). */
export const DENTAL_READ_ONLY_EVENT_LABELS: Record<string, { label: string; emoji: string }> = {
  'ortho-start':      { label: '开始正畸（历史）', emoji: '🦷' },
  'ortho-review':     { label: '正畸复诊',       emoji: '📋' },
  'ortho-adjustment': { label: '正畸调整',       emoji: '🔧' },
  'ortho-issue':      { label: '正畸异常',       emoji: '⚠️' },
  'ortho-end':        { label: '结束正畸',       emoji: '✅' },
};

export const SEVERITY_LABELS: Record<string, string> = {
  mild: '轻度',
  moderate: '中度',
  severe: '重度',
};

export const NEEDS_SEVERITY = new Set(['caries']);
export const NEEDS_TOOTH = new Set(['eruption', 'loss', 'caries', 'filling', 'sealant']);

export const PRIMARY_UPPER_R = ['55', '54', '53', '52', '51'];
export const PRIMARY_UPPER_L = ['61', '62', '63', '64', '65'];
export const PRIMARY_LOWER_L = ['71', '72', '73', '74', '75'];
export const PRIMARY_LOWER_R = ['85', '84', '83', '82', '81'];

export const PERM_UPPER_R = ['18', '17', '16', '15', '14', '13', '12', '11'];
export const PERM_UPPER_L = ['21', '22', '23', '24', '25', '26', '27', '28'];
export const PERM_LOWER_L = ['31', '32', '33', '34', '35', '36', '37', '38'];
export const PERM_LOWER_R = ['48', '47', '46', '45', '44', '43', '42', '41'];

export const TOOTH_NAMES: Record<string, string> = {
  '11': '右上中切牙', '12': '右上侧切牙', '13': '右上尖牙', '14': '右上第一前磨', '15': '右上第二前磨', '16': '右上第一磨', '17': '右上第二磨', '18': '右上智齿',
  '21': '左上中切牙', '22': '左上侧切牙', '23': '左上尖牙', '24': '左上第一前磨', '25': '左上第二前磨', '26': '左上第一磨', '27': '左上第二磨', '28': '左上智齿',
  '31': '左下中切牙', '32': '左下侧切牙', '33': '左下尖牙', '34': '左下第一前磨', '35': '左下第二前磨', '36': '左下第一磨', '37': '左下第二磨', '38': '左下智齿',
  '41': '右下中切牙', '42': '右下侧切牙', '43': '右下尖牙', '44': '右下第一前磨', '45': '右下第二前磨', '46': '右下第一磨', '47': '右下第二磨', '48': '右下智齿',
  '51': '右上乳中切牙', '52': '右上乳侧切牙', '53': '右上乳尖牙', '54': '右上乳第一磨', '55': '右上乳第二磨',
  '61': '左上乳中切牙', '62': '左上乳侧切牙', '63': '左上乳尖牙', '64': '左上乳第一磨', '65': '左上乳第二磨',
  '71': '左下乳中切牙', '72': '左下乳侧切牙', '73': '左下乳尖牙', '74': '左下乳第一磨', '75': '左下乳第二磨',
  '81': '右下乳中切牙', '82': '右下乳侧切牙', '83': '右下乳尖牙', '84': '右下乳第一磨', '85': '右下乳第二磨',
};

export interface EventEntry {
  eventType: string;
  toothIds: string[];
  toothSet: 'primary' | 'permanent';
  severity: string;
}

export interface PendingDentalPhoto {
  base64: string;
  mimeType: string;
  fileName: string;
}

export const PHOTO_MAX = 9;

export function makeEventEntry(ageMonths: number): EventEntry {
  return {
    eventType: 'eruption',
    toothIds: [],
    toothSet: ageMonths < 72 ? 'primary' : 'permanent',
    severity: '',
  };
}

export function parseDentalToothIds(toothId: string | null): string[] {
  if (!toothId) return [];
  return toothId
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function joinDentalToothIds(toothIds: string[]): string | null {
  const normalized = [...new Set(toothIds.map((value) => value.trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized.join(',') : null;
}

export function formatDentalToothLabel(toothId: string | null): string | null {
  const toothIds = parseDentalToothIds(toothId);
  if (toothIds.length === 0) {
    return null;
  }
  return toothIds
    .map((id) => `${id}${TOOTH_NAMES[id] ? ` ${TOOTH_NAMES[id]}` : ''}`)
    .join(' 路 ');
}

export function buildDentalAttachmentMap(attachments: AttachmentRow[]) {
  const next = new Map<string, AttachmentRow[]>();
  for (const attachment of attachments) {
    if (attachment.ownerTable !== 'dental_records') continue;
    const existing = next.get(attachment.ownerId);
    if (existing) existing.push(attachment);
    else next.set(attachment.ownerId, [attachment]);
  }
  return next;
}

type EruptionState = 'unerupted' | 'primary_present' | 'lost_waiting' | 'permanent_erupted';
type HealthState = 'healthy' | 'caries' | 'treated';

interface OverviewCell {
  eruption: EruptionState;
  health: HealthState;
  displayId: string;
}

const PRIMARY_TO_PERMANENT: Record<string, string> = {
  '55': '15', '54': '14', '53': '13', '52': '12', '51': '11',
  '61': '21', '62': '22', '63': '23', '64': '24', '65': '25',
  '71': '31', '72': '32', '73': '33', '74': '34', '75': '35',
  '85': '45', '84': '44', '83': '43', '82': '42', '81': '41',
};

const OVERVIEW_UPPER_R = ['18', '17', '16', '55', '54', '53', '52', '51'];
const OVERVIEW_UPPER_L = ['61', '62', '63', '64', '65', '26', '27', '28'];
const OVERVIEW_LOWER_L = ['71', '72', '73', '74', '75', '36', '37', '38'];
const OVERVIEW_LOWER_R = ['48', '47', '46', '85', '84', '83', '82', '81'];

function deriveHealth(events: string[]): HealthState {
  let health: HealthState = 'healthy';
  for (const eventType of events) {
    if (eventType === 'caries') health = 'caries';
    else if (eventType === 'filling' || eventType === 'sealant') health = 'treated';
  }
  return health;
}

export function computeDentalOverviewStates(records: DentalRecordRow[]): Map<string, OverviewCell> {
  const byTooth = new Map<string, string[]>();
  const sorted = [...records].sort((left, right) => left.eventDate.localeCompare(right.eventDate));
  for (const record of sorted) {
    for (const toothId of parseDentalToothIds(record.toothId)) {
      const events = byTooth.get(toothId);
      if (events) events.push(record.eventType);
      else byTooth.set(toothId, [record.eventType]);
    }
  }

  const hasAnyEvent = (id: string) => (byTooth.get(id)?.length ?? 0) > 0;
  const hasHealthEvent = (id: string) =>
    (byTooth.get(id) ?? []).some((eventType) => eventType === 'caries' || eventType === 'filling' || eventType === 'sealant');
  const hasEvent = (id: string, type: string) => (byTooth.get(id) ?? []).includes(type);

  const output = new Map<string, OverviewCell>();
  const positions = [...OVERVIEW_UPPER_R, ...OVERVIEW_UPPER_L, ...OVERVIEW_LOWER_L, ...OVERVIEW_LOWER_R];
  for (const positionId of positions) {
    const permanentId = PRIMARY_TO_PERMANENT[positionId];
    if (permanentId) {
      if (hasAnyEvent(permanentId)) {
        output.set(positionId, {
          eruption: 'permanent_erupted',
          health: deriveHealth(byTooth.get(permanentId) ?? []),
          displayId: permanentId,
        });
      } else if (hasEvent(positionId, 'loss')) {
        output.set(positionId, { eruption: 'lost_waiting', health: 'healthy', displayId: positionId });
      } else if (hasEvent(positionId, 'eruption') || hasHealthEvent(positionId)) {
        output.set(positionId, {
          eruption: 'primary_present',
          health: deriveHealth(byTooth.get(positionId) ?? []),
          displayId: positionId,
        });
      } else {
        output.set(positionId, { eruption: 'unerupted', health: 'healthy', displayId: positionId });
      }
    } else if (hasAnyEvent(positionId)) {
      output.set(positionId, {
        eruption: 'permanent_erupted',
        health: deriveHealth(byTooth.get(positionId) ?? []),
        displayId: positionId,
      });
    } else {
      output.set(positionId, { eruption: 'unerupted', health: 'healthy', displayId: positionId });
    }
  }
  return output;
}

export type { EruptionState, HealthState, OverviewCell };
