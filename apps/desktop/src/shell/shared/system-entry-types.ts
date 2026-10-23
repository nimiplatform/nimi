// @nimi-authority: rule.nimi.desktop.bridge-ipc.system-entry-isolation
// @nimi-authority: rule.nimi.desktop.shell-ui.system-entry-projection

export const SYSTEM_ENTRY_CHANNELS = Object.freeze({
  snapshot: 'nimi:system-entry:snapshot',
  changed: 'nimi:system-entry:changed',
  action: 'nimi:system-entry:action',
  close: 'nimi:system-entry:close',
  menu: 'nimi:system-entry:menu',
});
export const SYSTEM_ENTRY_HOME_COMMANDS = Object.freeze({
  context: 'system_entry_context_get',
  publish: 'system_entry_projection_publish',
  heartbeat: 'system_entry_heartbeat',
  actionResult: 'system_entry_action_result',
});
export const SYSTEM_ENTRY_ACTION_EVENT = 'system-entry://action';
export const SYSTEM_ENTRY_VISIBILITY_EVENT = 'system-entry://visibility';
export const SYSTEM_ENTRY_HEARTBEAT_MS = 10_000;
export const SYSTEM_ENTRY_LIVENESS_MS = 15_000;

export type SystemEntryAdmissionState = 'ready' | 'login-required' | 'recovery-required' | 'unknown' | 'locked';
export type SystemEntryAdmission = Readonly<{
  generation: string;
  state: SystemEntryAdmissionState;
}>;
export type SystemEntryLocale = 'zh' | 'en';
export type SystemEntrySectionStatus = 'loading' | 'available' | 'partial' | 'unavailable';
export type SystemEntryAction =
  | Readonly<{ kind: 'home' | 'messages' | 'activity' | 'usage' | 'downloads' | 'ai-capabilities' | 'apps' | 'settings' | 'notification-settings' | 'support' | 'chat' | 'pause-notifications' | 'resume-notifications' | 'refresh' | 'quit' }>
  | Readonly<{ kind: 'focus-app'; entryKey: string }>
  | Readonly<{ kind: 'continue-chat'; localAgentRef: string }>
  | Readonly<{ kind: 'open-activity'; activityId: string }>;
export type SystemEntryActionContext = Readonly<{ generation: string; revision: number }>;
export type SystemEntryActionRequest = SystemEntryActionContext & Readonly<{ action: SystemEntryAction }>;
export type SystemEntryActionDispatch = SystemEntryActionRequest & Readonly<{ requestId: string }>;
export type SystemEntryActionResult = Readonly<{ requestId: string; generation: string; error: string | null }>;
export type SystemEntryItem = Readonly<{
  id: string;
  title: string;
  detail: string;
  action: SystemEntryAction | null;
}>;
export type SystemEntrySection = Readonly<{
  status: SystemEntrySectionStatus;
  observedAt: string | null;
  total: number | null;
  items: readonly SystemEntryItem[];
}>;
export type SystemEntryUsage = Readonly<{
  status: SystemEntrySectionStatus;
  observedAt: string | null;
  periodLabel: string;
  attempts: string | null;
  localAttempts: string | null;
  cloudAttempts: string | null;
  costs: readonly Readonly<{ currency: string; estimate: string }>[];
  partial: boolean;
  note: string;
}>;
export type SystemEntryProjection = Readonly<{
  generation: string;
  revision: number;
  locale: SystemEntryLocale;
  observedAt: string;
  service: 'running' | 'degraded' | 'starting' | 'stopped' | 'unavailable';
  attention: SystemEntrySection;
  work: SystemEntrySection;
  recent: SystemEntrySection;
  apps: SystemEntrySection;
  downloads: SystemEntrySection;
  usage: SystemEntryUsage;
  notificationsEnabled: boolean;
  notificationsPausedUntil: number;
}>;
export type SystemEntrySnapshot = Readonly<{
  admission: SystemEntryAdmission;
  revision: number;
  locale: SystemEntryLocale;
  observation: 'waiting' | 'current' | 'unavailable';
  homeVisible: boolean;
  projection: SystemEntryProjection | null;
  actionError: string | null;
}>;
export type SystemEntryContext = SystemEntryAdmission & Readonly<{ homeVisible: boolean }>;
export type SystemEntryBridge = Readonly<{
  getSnapshot(): Promise<SystemEntrySnapshot>;
  onSnapshot(listener: (snapshot: SystemEntrySnapshot) => void): () => void;
  act(request: SystemEntryActionRequest): Promise<void>;
  close(): Promise<void>;
  openMenu(): Promise<void>;
}>;

const SIMPLE_ACTIONS = new Set(['home', 'messages', 'activity', 'usage', 'downloads', 'ai-capabilities', 'apps', 'settings', 'notification-settings', 'support', 'chat', 'pause-notifications', 'resume-notifications', 'refresh', 'quit']);
const SECTION_STATES = new Set(['loading', 'available', 'partial', 'unavailable']);

function fail(): never { throw new Error('system-entry-payload-invalid'); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const item = value as Record<string, unknown>;
  const actual = Object.keys(item).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail();
  return item;
}
function text(value: unknown, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) fail();
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail();
  return value;
}
function timestamp(value: unknown): string {
  const input = text(value, 64);
  if (!Number.isFinite(Date.parse(input))) fail();
  return new Date(input).toISOString();
}
function count(value: unknown): string | null {
  if (value === null) return null;
  const input = text(value, 30);
  if (!/^\d+$/u.test(input)) fail();
  return input;
}

export function parseSystemEntryAction(value: unknown): SystemEntryAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const kind = (value as Record<string, unknown>).kind;
  if (typeof kind !== 'string') fail();
  if (SIMPLE_ACTIONS.has(kind)) {
    record(value, ['kind']);
    return { kind } as SystemEntryAction;
  }
  if (kind === 'focus-app') return { kind, entryKey: text(record(value, ['kind', 'entryKey']).entryKey, 512) };
  if (kind === 'continue-chat') return { kind, localAgentRef: text(record(value, ['kind', 'localAgentRef']).localAgentRef, 256) };
  if (kind === 'open-activity') return { kind, activityId: text(record(value, ['kind', 'activityId']).activityId, 256) };
  return fail();
}

export function parseSystemEntryActionRequest(value: unknown): SystemEntryActionRequest {
  const item = record(value, ['generation', 'revision', 'action']);
  return { generation: text(item.generation, 128), revision: integer(item.revision), action: parseSystemEntryAction(item.action) };
}

export function parseSystemEntryHeartbeat(value: unknown): { generation: string } {
  const item = record(value, ['generation']);
  return { generation: text(item.generation, 128) };
}

export function parseSystemEntryActionDispatch(value: unknown): SystemEntryActionDispatch {
  const item = record(value, ['requestId', 'generation', 'revision', 'action']);
  return { requestId: text(item.requestId, 128), ...parseSystemEntryActionRequest({ generation: item.generation, revision: item.revision, action: item.action }) };
}

export function parseSystemEntryActionResult(value: unknown): SystemEntryActionResult {
  const item = record(value, ['requestId', 'generation', 'error']);
  return { requestId: text(item.requestId, 128), generation: text(item.generation, 128), error: item.error === null ? null : text(item.error, 128) };
}

function section(value: unknown): SystemEntrySection {
  const item = record(value, ['status', 'observedAt', 'total', 'items']);
  if (typeof item.status !== 'string' || !SECTION_STATES.has(item.status) || !Array.isArray(item.items) || item.items.length > 20) fail();
  const ids = new Set<string>();
  const items = item.items.map((raw): SystemEntryItem => {
    const row = record(raw, ['id', 'title', 'detail', 'action']);
    const id = text(row.id, 512);
    if (ids.has(id)) fail();
    ids.add(id);
    return { id, title: text(row.title, 256), detail: text(row.detail, 512, true), action: row.action === null ? null : parseSystemEntryAction(row.action) };
  });
  const total = item.total === null ? null : integer(item.total);
  if (total !== null && total < items.length) fail();
  return { status: item.status as SystemEntrySectionStatus, observedAt: item.observedAt === null ? null : timestamp(item.observedAt), total, items };
}

function usage(value: unknown): SystemEntryUsage {
  const item = record(value, ['status', 'observedAt', 'periodLabel', 'attempts', 'localAttempts', 'cloudAttempts', 'costs', 'partial', 'note']);
  if (typeof item.status !== 'string' || !SECTION_STATES.has(item.status) || !Array.isArray(item.costs) || item.costs.length > 8 || typeof item.partial !== 'boolean') fail();
  const currencies = new Set<string>();
  const costs = item.costs.map(raw => {
    const cost = record(raw, ['currency', 'estimate']);
    const currency = text(cost.currency, 8);
    const estimate = text(cost.estimate, 40);
    if (!/^[A-Z]{3,8}$/u.test(currency) || !/^\d+(\.\d+)?$/u.test(estimate) || currencies.has(currency)) fail();
    currencies.add(currency);
    return { currency, estimate };
  });
  return { status: item.status as SystemEntrySectionStatus, observedAt: item.observedAt === null ? null : timestamp(item.observedAt), periodLabel: text(item.periodLabel, 100), attempts: count(item.attempts), localAttempts: count(item.localAttempts), cloudAttempts: count(item.cloudAttempts), costs, partial: item.partial, note: text(item.note, 512, true) };
}

export function parseSystemEntryProjection(value: unknown): SystemEntryProjection {
  const item = record(value, ['generation', 'revision', 'locale', 'observedAt', 'service', 'attention', 'work', 'recent', 'apps', 'downloads', 'usage', 'notificationsEnabled', 'notificationsPausedUntil']);
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 131_072 || (item.locale !== 'zh' && item.locale !== 'en') || typeof item.notificationsEnabled !== 'boolean' || !['running', 'degraded', 'starting', 'stopped', 'unavailable'].includes(String(item.service))) fail();
  return { generation: text(item.generation, 128), revision: integer(item.revision), locale: item.locale, observedAt: timestamp(item.observedAt), service: item.service as SystemEntryProjection['service'], attention: section(item.attention), work: section(item.work), recent: section(item.recent), apps: section(item.apps), downloads: section(item.downloads), usage: usage(item.usage), notificationsEnabled: item.notificationsEnabled, notificationsPausedUntil: integer(item.notificationsPausedUntil) };
}

export function isSystemEntryActionOffered(projection: SystemEntryProjection | null, action: SystemEntryAction): boolean {
  if (SIMPLE_ACTIONS.has(action.kind)) return true;
  if (!projection) return false;
  const identity = JSON.stringify(action);
  return [projection.attention, projection.work, projection.recent, projection.apps, projection.downloads]
    .some(source => source.status !== 'unavailable' && source.status !== 'loading' && source.items.some(row => row.action && JSON.stringify(row.action) === identity));
}
